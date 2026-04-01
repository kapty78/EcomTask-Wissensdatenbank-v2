"""
Advanced Monitoring and Health Check System
==========================================

Provides comprehensive monitoring, metrics collection, and health checks
for production environments with real-time performance tracking.

Usage:
    from app.utils.monitoring import MonitoringSystem, health_check
    
    # Initialize monitoring
    monitoring = MonitoringSystem()
    
    # Add custom metrics
    monitoring.increment_counter("api_requests")
    monitoring.record_timing("api_response_time", 0.5)
    
    # Health check decorator
    @health_check("database")
    def check_database():
        return {"status": "healthy", "response_time": 0.1}
"""

import time
import threading
import psutil
import logging
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from collections import defaultdict, deque
import asyncio
from functools import wraps

logger = logging.getLogger(__name__)

@dataclass
class Metric:
    """Metric data structure."""
    name: str
    value: float
    timestamp: datetime
    tags: Dict[str, str] = field(default_factory=dict)

@dataclass
class HealthCheckResult:
    """Health check result structure."""
    name: str
    status: str  # "healthy", "unhealthy", "degraded"
    message: str
    response_time: float
    timestamp: datetime
    details: Dict[str, Any] = field(default_factory=dict)

class MonitoringSystem:
    """
    Advanced monitoring system with metrics collection and health checks.
    """
    
    def __init__(self):
        self.counters: Dict[str, int] = defaultdict(int)
        self.gauges: Dict[str, float] = {}
        self.timings: Dict[str, List[float]] = defaultdict(list)
        self.health_checks: Dict[str, Callable] = {}
        self.metrics_history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))
        self.lock = threading.Lock()
        self.start_time = datetime.now()
        self.logger = logger
        
        # Performance tracking
        self.request_times: deque = deque(maxlen=1000)
        self.error_counts: Dict[str, int] = defaultdict(int)
        
        logger.info("MonitoringSystem initialized")
    
    def increment_counter(self, name: str, value: int = 1, tags: Dict[str, str] = None):
        """Increment a counter metric."""
        with self.lock:
            self.counters[name] += value
            self._record_metric(name, self.counters[name], tags)
            logger.debug(f"Counter {name} incremented by {value}")
    
    def set_gauge(self, name: str, value: float, tags: Dict[str, str] = None):
        """Set a gauge metric."""
        with self.lock:
            self.gauges[name] = value
            self._record_metric(name, value, tags)
            logger.debug(f"Gauge {name} set to {value}")
    
    def record_timing(self, name: str, duration: float, tags: Dict[str, str] = None):
        """Record a timing metric."""
        with self.lock:
            self.timings[name].append(duration)
            # Keep only last 1000 timings
            if len(self.timings[name]) > 1000:
                self.timings[name] = self.timings[name][-1000:]
            self._record_metric(name, duration, tags)
            logger.debug(f"Timing {name} recorded: {duration}s")
    
    def _record_metric(self, name: str, value: float, tags: Dict[str, str] = None):
        """Record metric in history."""
        metric = Metric(
            name=name,
            value=value,
            timestamp=datetime.now(),
            tags=tags or {}
        )
        self.metrics_history[name].append(metric)
    
    def get_counter(self, name: str) -> int:
        """Get counter value."""
        with self.lock:
            return self.counters.get(name, 0)
    
    def get_gauge(self, name: str) -> float:
        """Get gauge value."""
        with self.lock:
            return self.gauges.get(name, 0.0)
    
    def get_timing_stats(self, name: str) -> Dict[str, float]:
        """Get timing statistics."""
        with self.lock:
            timings = self.timings.get(name, [])
            if not timings:
                return {"count": 0, "avg": 0.0, "min": 0.0, "max": 0.0, "p95": 0.0, "p99": 0.0}
            
            timings_sorted = sorted(timings)
            count = len(timings)
            avg = sum(timings) / count
            min_val = timings_sorted[0]
            max_val = timings_sorted[-1]
            p95_idx = int(count * 0.95)
            p99_idx = int(count * 0.99)
            
            return {
                "count": count,
                "avg": round(avg, 4),
                "min": round(min_val, 4),
                "max": round(max_val, 4),
                "p95": round(timings_sorted[p95_idx] if p95_idx < count else max_val, 4),
                "p99": round(timings_sorted[p99_idx] if p99_idx < count else max_val, 4)
            }
    
    def register_health_check(self, name: str, check_func: Callable):
        """Register a health check function."""
        self.health_checks[name] = check_func
        logger.info(f"Health check '{name}' registered")
    
    def run_health_check(self, name: str) -> HealthCheckResult:
        """Run a specific health check."""
        if name not in self.health_checks:
            return HealthCheckResult(
                name=name,
                status="unhealthy",
                message=f"Health check '{name}' not found",
                response_time=0.0,
                timestamp=datetime.now()
            )
        
        start_time = time.time()
        try:
            result = self.health_checks[name]()
            response_time = time.time() - start_time
            
            if isinstance(result, dict):
                status = result.get("status", "healthy")
                message = result.get("message", "OK")
                details = result.get("details", {})
            else:
                status = "healthy" if result else "unhealthy"
                message = "OK" if result else "Check failed"
                details = {}
            
            return HealthCheckResult(
                name=name,
                status=status,
                message=message,
                response_time=response_time,
                timestamp=datetime.now(),
                details=details
            )
            
        except Exception as e:
            response_time = time.time() - start_time
            logger.error(f"Health check '{name}' failed: {e}")
            return HealthCheckResult(
                name=name,
                status="unhealthy",
                message=f"Health check failed: {str(e)}",
                response_time=response_time,
                timestamp=datetime.now()
            )
    
    def run_all_health_checks(self) -> Dict[str, HealthCheckResult]:
        """Run all registered health checks."""
        results = {}
        for name in self.health_checks:
            results[name] = self.run_health_check(name)
        return results
    
    def get_system_metrics(self) -> Dict[str, Any]:
        """Get system-level metrics."""
        try:
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            cpu_count = psutil.cpu_count()
            
            # Memory usage
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            memory_available = memory.available / (1024**3)  # GB
            
            # Disk usage
            disk = psutil.disk_usage('/')
            disk_percent = (disk.used / disk.total) * 100
            disk_free = disk.free / (1024**3)  # GB
            
            # Process info
            process = psutil.Process()
            process_memory = process.memory_info().rss / (1024**2)  # MB
            process_cpu = process.cpu_percent()
            
            return {
                "system": {
                    "cpu_percent": cpu_percent,
                    "cpu_count": cpu_count,
                    "memory_percent": memory_percent,
                    "memory_available_gb": round(memory_available, 2),
                    "disk_percent": disk_percent,
                    "disk_free_gb": round(disk_free, 2)
                },
                "process": {
                    "memory_mb": round(process_memory, 2),
                    "cpu_percent": process_cpu,
                    "uptime_seconds": (datetime.now() - self.start_time).total_seconds()
                }
            }
        except Exception as e:
            logger.error(f"Failed to get system metrics: {e}")
            return {"error": str(e)}
    
    def get_performance_metrics(self) -> Dict[str, Any]:
        """Get application performance metrics."""
        with self.lock:
            # Request timing statistics
            request_times = list(self.request_times)
            if request_times:
                avg_response_time = sum(request_times) / len(request_times)
                max_response_time = max(request_times)
                min_response_time = min(request_times)
            else:
                avg_response_time = max_response_time = min_response_time = 0.0
            
            # Error rates
            total_requests = self.get_counter("total_requests")
            total_errors = sum(self.error_counts.values())
            error_rate = (total_errors / total_requests * 100) if total_requests > 0 else 0
            
            return {
                "requests": {
                    "total": total_requests,
                    "avg_response_time": round(avg_response_time, 4),
                    "max_response_time": round(max_response_time, 4),
                    "min_response_time": round(min_response_time, 4)
                },
                "errors": {
                    "total": total_errors,
                    "rate_percent": round(error_rate, 2),
                    "by_type": dict(self.error_counts)
                },
                "counters": dict(self.counters),
                "gauges": dict(self.gauges)
            }
    
    def get_all_metrics(self) -> Dict[str, Any]:
        """Get all metrics in one call."""
        return {
            "timestamp": datetime.now().isoformat(),
            "uptime_seconds": (datetime.now() - self.start_time).total_seconds(),
            "system": self.get_system_metrics(),
            "performance": self.get_performance_metrics(),
            "health_checks": {name: result.__dict__ for name, result in self.run_all_health_checks().items()}
        }
    
    def record_request(self, method: str, endpoint: str, status_code: int, duration: float):
        """Record HTTP request metrics."""
        self.increment_counter("total_requests")
        self.increment_counter(f"requests_{method.lower()}")
        self.increment_counter(f"requests_status_{status_code}")
        
        if status_code >= 400:
            self.error_counts[f"status_{status_code}"] += 1
        
        self.record_timing("request_duration", duration)
        self.request_times.append(duration)
        
        logger.debug(f"Request recorded: {method} {endpoint} {status_code} {duration}s")
    
    def cleanup_old_metrics(self, max_age_hours: int = 24):
        """Clean up old metrics to prevent memory leaks."""
        cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
        
        with self.lock:
            for name, history in self.metrics_history.items():
                # Remove old metrics
                while history and history[0].timestamp < cutoff_time:
                    history.popleft()
        
        logger.info(f"Cleaned up metrics older than {max_age_hours} hours")


def health_check(name: str):
    """
    Decorator for registering health checks.
    
    Args:
        name: Name of the health check
        
    Usage:
        @health_check("database")
        def check_database():
            return {"status": "healthy", "message": "Database connected"}
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
        
        # Register the health check
        monitoring_system.register_health_check(name, wrapper)
        return wrapper
    return decorator


def track_performance(name: str):
    """
    Decorator for tracking function performance.
    
    Args:
        name: Name of the performance metric
        
    Usage:
        @track_performance("api_call")
        def api_call():
            pass
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start_time
                monitoring_system.record_timing(name, duration)
                return result
            except Exception as e:
                duration = time.time() - start_time
                monitoring_system.record_timing(name, duration)
                monitoring_system.increment_counter(f"{name}_errors")
                raise
        return wrapper
    return decorator


def track_requests():
    """
    Decorator for tracking HTTP requests.
    
    Usage:
        @app.middleware("http")
        @track_requests()
        async def track_requests_middleware(request: Request, call_next):
            # Middleware implementation
            pass
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(request, call_next):
            start_time = time.time()
            response = await call_next(request)
            duration = time.time() - start_time
            
            monitoring_system.record_request(
                method=request.method,
                endpoint=request.url.path,
                status_code=response.status_code,
                duration=duration
            )
            
            return response
        return wrapper
    return decorator


# Global monitoring system instance
monitoring_system = MonitoringSystem()

# Register default health checks
@health_check("system")
def check_system():
    """Check system health."""
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory_percent = psutil.virtual_memory().percent
        
        if cpu_percent > 90 or memory_percent > 90:
            return {
                "status": "degraded",
                "message": f"High resource usage: CPU {cpu_percent}%, Memory {memory_percent}%",
                "details": {"cpu_percent": cpu_percent, "memory_percent": memory_percent}
            }
        
        return {
            "status": "healthy",
            "message": f"System OK: CPU {cpu_percent}%, Memory {memory_percent}%",
            "details": {"cpu_percent": cpu_percent, "memory_percent": memory_percent}
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "message": f"System check failed: {str(e)}"
        }

@health_check("storage")
def check_storage():
    """Check storage health."""
    try:
        from ..utils.storage import get_storage_info
        storage_info = get_storage_info()
        
        if storage_info.get("is_writable", False):
            return {
                "status": "healthy",
                "message": "Storage is writable",
                "details": storage_info
            }
        else:
            return {
                "status": "unhealthy",
                "message": "Storage is not writable",
                "details": storage_info
            }
    except Exception as e:
        return {
            "status": "unhealthy",
            "message": f"Storage check failed: {str(e)}"
        }
