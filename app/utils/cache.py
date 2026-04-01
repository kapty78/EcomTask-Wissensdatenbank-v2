"""
High-Performance Caching System
===============================

Provides Redis-based caching with fallback to in-memory cache for optimal performance.
Supports TTL, serialization, and automatic cache invalidation.

Usage:
    from app.utils.cache import CacheManager
    
    cache = CacheManager.get_instance()
    
    # Set cache with TTL
    cache.set("user:123", {"name": "John"}, ttl=3600)
    
    # Get cached data
    user = cache.get("user:123")
    
    # Delete cache
    cache.delete("user:123")
    
    # Clear all cache
    cache.clear()
"""

import json
import pickle
import time
import hashlib
from typing import Any, Optional, Union, Dict, List
from datetime import datetime, timedelta
import logging
from functools import wraps
import threading

logger = logging.getLogger(__name__)

class CacheManager:
    """
    High-performance caching system with Redis backend and in-memory fallback.
    """
    
    _instance = None
    _lock = threading.Lock()
    
    @classmethod
    def get_instance(cls):
        """Thread-safe singleton pattern."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
    
    def __init__(self):
        self.redis_client = None
        self.memory_cache = {}
        self.cache_stats = {
            "hits": 0,
            "misses": 0,
            "sets": 0,
            "deletes": 0
        }
        self._init_redis()
        logger.info("CacheManager initialized")
    
    def _init_redis(self):
        """Initialize Redis connection with fallback to memory cache."""
        try:
            import redis
            from ..core.config import settings
            
            # Try to connect to Redis
            redis_url = getattr(settings, 'REDIS_URL', None)
            if redis_url:
                self.redis_client = redis.from_url(redis_url, decode_responses=True)
                # Test connection
                self.redis_client.ping()
                logger.info("Redis cache initialized successfully")
            else:
                logger.warning("REDIS_URL not configured, using memory cache")
                
        except Exception as e:
            logger.warning(f"Redis not available, using memory cache: {e}")
            self.redis_client = None
    
    def _serialize(self, data: Any) -> str:
        """Serialize data for storage."""
        try:
            return json.dumps(data, default=str)
        except (TypeError, ValueError):
            # Fallback to pickle for complex objects
            return pickle.dumps(data).hex()
    
    def _deserialize(self, data: str) -> Any:
        """Deserialize data from storage."""
        try:
            return json.loads(data)
        except (json.JSONDecodeError, TypeError):
            # Fallback to pickle for complex objects
            return pickle.loads(bytes.fromhex(data))
    
    def _get_memory_key(self, key: str) -> tuple:
        """Get key with TTL check for memory cache."""
        if key in self.memory_cache:
            data, expiry = self.memory_cache[key]
            if expiry is None or time.time() < expiry:
                return data, True
            else:
                del self.memory_cache[key]
        return None, False
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """
        Set cache value with optional TTL.
        
        Args:
            key: Cache key
            value: Value to cache
            ttl: Time to live in seconds (None for no expiry)
            
        Returns:
            bool: True if successful
        """
        try:
            serialized_value = self._serialize(value)
            
            if self.redis_client:
                # Use Redis
                if ttl:
                    result = self.redis_client.setex(key, ttl, serialized_value)
                else:
                    result = self.redis_client.set(key, serialized_value)
                success = bool(result)
            else:
                # Use memory cache
                expiry = time.time() + ttl if ttl else None
                self.memory_cache[key] = (serialized_value, expiry)
                success = True
            
            self.cache_stats["sets"] += 1
            logger.debug(f"Cache SET: {key} (TTL: {ttl})")
            return success
            
        except Exception as e:
            logger.error(f"Cache SET error for key {key}: {e}")
            return False
    
    def get(self, key: str) -> Optional[Any]:
        """
        Get cached value.
        
        Args:
            key: Cache key
            
        Returns:
            Cached value or None if not found/expired
        """
        try:
            if self.redis_client:
                # Use Redis
                data = self.redis_client.get(key)
                if data is not None:
                    self.cache_stats["hits"] += 1
                    logger.debug(f"Cache HIT: {key}")
                    return self._deserialize(data)
                else:
                    self.cache_stats["misses"] += 1
                    logger.debug(f"Cache MISS: {key}")
                    return None
            else:
                # Use memory cache
                data, found = self._get_memory_key(key)
                if found:
                    self.cache_stats["hits"] += 1
                    logger.debug(f"Cache HIT: {key}")
                    return self._deserialize(data)
                else:
                    self.cache_stats["misses"] += 1
                    logger.debug(f"Cache MISS: {key}")
                    return None
                    
        except Exception as e:
            logger.error(f"Cache GET error for key {key}: {e}")
            self.cache_stats["misses"] += 1
            return None
    
    def delete(self, key: str) -> bool:
        """
        Delete cached value.
        
        Args:
            key: Cache key
            
        Returns:
            bool: True if successful
        """
        try:
            if self.redis_client:
                result = self.redis_client.delete(key)
                success = bool(result)
            else:
                if key in self.memory_cache:
                    del self.memory_cache[key]
                    success = True
                else:
                    success = False
            
            self.cache_stats["deletes"] += 1
            logger.debug(f"Cache DELETE: {key}")
            return success
            
        except Exception as e:
            logger.error(f"Cache DELETE error for key {key}: {e}")
            return False
    
    def clear(self) -> bool:
        """Clear all cache."""
        try:
            if self.redis_client:
                self.redis_client.flushdb()
            else:
                self.memory_cache.clear()
            
            logger.info("Cache cleared")
            return True
            
        except Exception as e:
            logger.error(f"Cache CLEAR error: {e}")
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        total_requests = self.cache_stats["hits"] + self.cache_stats["misses"]
        hit_rate = (self.cache_stats["hits"] / total_requests * 100) if total_requests > 0 else 0
        
        return {
            **self.cache_stats,
            "hit_rate": round(hit_rate, 2),
            "backend": "redis" if self.redis_client else "memory",
            "memory_cache_size": len(self.memory_cache) if not self.redis_client else 0
        }
    
    def health_check(self) -> Dict[str, Any]:
        """Check cache system health."""
        try:
            if self.redis_client:
                # Test Redis connection
                self.redis_client.ping()
                return {
                    "status": "healthy",
                    "backend": "redis",
                    "connected": True
                }
            else:
                return {
                    "status": "healthy",
                    "backend": "memory",
                    "connected": True
                }
        except Exception as e:
            return {
                "status": "unhealthy",
                "backend": "redis" if self.redis_client else "memory",
                "connected": False,
                "error": str(e)
            }


def cached(ttl: Optional[int] = None, key_prefix: str = ""):
    """
    Decorator for caching function results.
    
    Args:
        ttl: Time to live in seconds
        key_prefix: Prefix for cache key
        
    Usage:
        @cached(ttl=3600, key_prefix="user")
        def get_user(user_id: int):
            return fetch_user_from_db(user_id)
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            key_data = f"{key_prefix}:{func.__name__}:{str(args)}:{str(sorted(kwargs.items()))}"
            cache_key = hashlib.md5(key_data.encode()).hexdigest()
            
            # Try to get from cache
            cache = CacheManager.get_instance()
            result = cache.get(cache_key)
            
            if result is not None:
                return result
            
            # Execute function and cache result
            result = func(*args, **kwargs)
            cache.set(cache_key, result, ttl)
            
            return result
        
        return wrapper
    return decorator


def cache_invalidate(pattern: str):
    """
    Decorator for invalidating cache entries.
    
    Args:
        pattern: Cache key pattern to invalidate
        
    Usage:
        @cache_invalidate("user:*")
        def update_user(user_id: int):
            return update_user_in_db(user_id)
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            
            # Invalidate cache
            cache = CacheManager.get_instance()
            if cache.redis_client:
                # Redis pattern deletion
                keys = cache.redis_client.keys(pattern)
                if keys:
                    cache.redis_client.delete(*keys)
            else:
                # Memory cache pattern deletion
                keys_to_delete = [k for k in cache.memory_cache.keys() if pattern.replace('*', '') in k]
                for key in keys_to_delete:
                    del cache.memory_cache[key]
            
            return result
        
        return wrapper
    return decorator


# Global cache instance
cache = CacheManager.get_instance()
