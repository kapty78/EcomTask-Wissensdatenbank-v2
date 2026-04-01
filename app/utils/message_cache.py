from collections import OrderedDict
import time
import logging

class MessageCache:
    """
    OPTIMIZED: Memory-efficient cache with LRU eviction and O(1) operations
    Uses OrderedDict for efficient LRU implementation and prevents memory leaks
    """
    _instance = None
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = MessageCache()
        return cls._instance
    
    def __init__(self):
        # OPTIMIZATION: Use OrderedDict for O(1) LRU operations
        self.processed_messages = OrderedDict()
        # OPTIMIZATION: Use simple dict for business phones (no LRU needed)
        self.business_phones = {}
        # OPTIMIZATION: Reduced cache size to prevent memory issues
        self.max_cache_size = 500  # Reduced from 1000
        # OPTIMIZATION: Add TTL for automatic cleanup
        self.ttl_seconds = 3600  # 1 hour TTL
        self.logger = logging.getLogger(__name__)
        self.logger.info("Optimized MessageCache initialized")
        
    def is_processed(self, message_id):
        """
        OPTIMIZED: Check if a message ID has already been processed with TTL support
        Time Complexity: O(1)
        """
        if not message_id:
            self.logger.warning("Empty message_id passed to is_processed")
            return False
        
        current_time = time.time()
        
        # Check if message exists and is not expired
        if message_id in self.processed_messages:
            process_time = self.processed_messages[message_id]
            
            # OPTIMIZATION: Check TTL and remove expired entries
            if current_time - process_time > self.ttl_seconds:
                del self.processed_messages[message_id]
                self.logger.debug(f"Expired message removed from cache: {message_id}")
                return False
            
            # Move to end for LRU behavior (O(1) operation)
            self.processed_messages.move_to_end(message_id)
            elapsed_time = current_time - process_time
            self.logger.warning(f"Duplicate message detected - ID: {message_id}, first seen {elapsed_time:.2f} seconds ago")
            return True
        
        return False
        
    def mark_as_processed(self, message_id):
        """
        OPTIMIZED: Mark a message ID as processed with LRU eviction
        Time Complexity: O(1)
        """
        if not message_id:
            self.logger.warning("Empty message_id passed to mark_as_processed")
            return
         
        current_time = time.time()
        
        # OPTIMIZATION: Add/update message with current timestamp
        self.processed_messages[message_id] = current_time
        # Move to end for LRU behavior
        self.processed_messages.move_to_end(message_id)
        
        # OPTIMIZATION: Efficient LRU eviction - remove oldest entries
        while len(self.processed_messages) > self.max_cache_size:
            # Remove oldest entry (first item in OrderedDict)
            oldest_id, oldest_time = self.processed_messages.popitem(last=False)
            self.logger.debug(f"LRU eviction: removed message {oldest_id}")
        
        self.logger.debug(f"Message marked as processed: {message_id}")
            
    def set_business_phone(self, user_number, business_phone):
        """Store the business phone number for a user"""
        if not user_number or not business_phone:
            self.logger.warning("------------------------------------")
            self.logger.warning(f"[CACHE FLOW] Invalid parameters for set_business_phone: user={user_number}, phone={business_phone}")
            self.logger.warning("------------------------------------")
            return False
        
        self.logger.info("------------------------------------")
        self.logger.info(f"[CACHE FLOW] Storing business phone {business_phone} for user {user_number}")
        self.logger.info("------------------------------------")
        self.business_phones[user_number] = business_phone
        return True
        
    def get_business_phone(self, user_number):
        """Get the stored business phone number for a user"""
        if not user_number:
            self.logger.warning("------------------------------------")
            self.logger.warning("[CACHE FLOW] Empty user_number passed to get_business_phone")
            self.logger.warning("------------------------------------")
            return None
        
        business_phone = self.business_phones.get(user_number)
        if not business_phone:
            self.logger.debug("------------------------------------")
            self.logger.debug(f"[CACHE FLOW] No business phone found for user {user_number}")
            self.logger.debug("------------------------------------")
        else:
            self.logger.debug("------------------------------------")
            self.logger.debug(f"[CACHE FLOW] Retrieved business phone {business_phone} for user {user_number}")
            self.logger.debug("------------------------------------")
            
        return business_phone
    
    def cleanup_expired(self):
        """
        OPTIMIZATION: Manual cleanup method for expired entries
        Can be called periodically to free memory
        """
        current_time = time.time()
        expired_keys = [
            msg_id for msg_id, timestamp in self.processed_messages.items()
            if current_time - timestamp > self.ttl_seconds
        ]
        
        for key in expired_keys:
            del self.processed_messages[key]
        
        if expired_keys:
            self.logger.info(f"Cleaned up {len(expired_keys)} expired messages from cache")
    
    def get_cache_stats(self):
        """Get cache statistics for monitoring"""
        return {
            "processed_messages_count": len(self.processed_messages),
            "business_phones_count": len(self.business_phones),
            "max_cache_size": self.max_cache_size,
            "ttl_seconds": self.ttl_seconds
        } 