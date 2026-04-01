"""
Advanced Error Handling System
==============================

Provides comprehensive error handling with retry mechanisms, circuit breakers,
and structured error responses for production environments.

Usage:
    from app.utils.error_handler import ErrorHandler, retry_with_backoff
    
    @retry_with_backoff(max_retries=3, backoff_factor=2)
    def risky_operation():
        # Operation that might fail
        pass
    
    # Or use the ErrorHandler class
    error_handler = ErrorHandler()
    result = error_handler.execute_with_retry(risky_operation, max_retries=3)
"""

import time
import logging
import traceback
from typing import Any, Callable, Optional, Dict, List, Union
from functools import wraps
from enum import Enum
import asyncio
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class ErrorSeverity(Enum):
    """Error severity levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ErrorCategory(Enum):
    """Error categories for better classification."""
    DATABASE = "database"
    NETWORK = "network"
    AUTHENTICATION = "authentication"
    VALIDATION = "validation"
    EXTERNAL_API = "external_api"
    BUSINESS_LOGIC = "business_logic"
    SYSTEM = "system"

class CircuitBreakerState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered

class ErrorHandler:
    """
    Advanced error handling with retry mechanisms and circuit breakers.
    """
    
    def __init__(self):
        self.circuit_breakers: Dict[str, Dict] = {}
        self.error_stats: Dict[str, Dict] = {}
        self.logger = logger
    
    def execute_with_retry(
        self,
        func: Callable,
        *args,
        max_retries: int = 3,
        backoff_factor: float = 2.0,
        base_delay: float = 1.0,
        exceptions: tuple = (Exception,),
        **kwargs
    ) -> Any:
        """
        Execute function with exponential backoff retry.
        
        Args:
            func: Function to execute
            max_retries: Maximum number of retries
            backoff_factor: Backoff multiplier
            base_delay: Base delay in seconds
            exceptions: Tuple of exceptions to retry on
            *args, **kwargs: Arguments for the function
            
        Returns:
            Function result
            
        Raises:
            Last exception if all retries fail
        """
        last_exception = None
        
        for attempt in range(max_retries + 1):
            try:
                return func(*args, **kwargs)
            except exceptions as e:
                last_exception = e
                
                if attempt == max_retries:
                    self.logger.error(f"Function {func.__name__} failed after {max_retries} retries: {e}")
                    break
                
                delay = base_delay * (backoff_factor ** attempt)
                self.logger.warning(f"Attempt {attempt + 1} failed for {func.__name__}, retrying in {delay}s: {e}")
                time.sleep(delay)
        
        raise last_exception
    
    async def execute_async_with_retry(
        self,
        func: Callable,
        *args,
        max_retries: int = 3,
        backoff_factor: float = 2.0,
        base_delay: float = 1.0,
        exceptions: tuple = (Exception,),
        **kwargs
    ) -> Any:
        """
        Execute async function with exponential backoff retry.
        """
        last_exception = None
        
        for attempt in range(max_retries + 1):
            try:
                return await func(*args, **kwargs)
            except exceptions as e:
                last_exception = e
                
                if attempt == max_retries:
                    self.logger.error(f"Async function {func.__name__} failed after {max_retries} retries: {e}")
                    break
                
                delay = base_delay * (backoff_factor ** attempt)
                self.logger.warning(f"Attempt {attempt + 1} failed for {func.__name__}, retrying in {delay}s: {e}")
                await asyncio.sleep(delay)
        
        raise last_exception
    
    def get_circuit_breaker(
        self,
        service_name: str,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        expected_exception: tuple = (Exception,)
    ) -> Dict:
        """
        Get or create circuit breaker for a service.
        
        Args:
            service_name: Name of the service
            failure_threshold: Number of failures before opening circuit
            recovery_timeout: Time in seconds before trying again
            expected_exception: Exceptions that count as failures
            
        Returns:
            Circuit breaker state dictionary
        """
        if service_name not in self.circuit_breakers:
            self.circuit_breakers[service_name] = {
                "state": CircuitBreakerState.CLOSED,
                "failure_count": 0,
                "failure_threshold": failure_threshold,
                "recovery_timeout": recovery_timeout,
                "last_failure_time": None,
                "expected_exception": expected_exception
            }
        
        return self.circuit_breakers[service_name]
    
    def execute_with_circuit_breaker(
        self,
        service_name: str,
        func: Callable,
        *args,
        **kwargs
    ) -> Any:
        """
        Execute function with circuit breaker protection.
        
        Args:
            service_name: Name of the service
            func: Function to execute
            *args, **kwargs: Arguments for the function
            
        Returns:
            Function result
            
        Raises:
            CircuitBreakerOpenException if circuit is open
            Original exception if function fails
        """
        circuit = self.get_circuit_breaker(service_name)
        
        # Check if circuit is open
        if circuit["state"] == CircuitBreakerState.OPEN:
            if circuit["last_failure_time"] and \
               time.time() - circuit["last_failure_time"] > circuit["recovery_timeout"]:
                circuit["state"] = CircuitBreakerState.HALF_OPEN
                self.logger.info(f"Circuit breaker for {service_name} moved to HALF_OPEN")
            else:
                raise CircuitBreakerOpenException(f"Circuit breaker for {service_name} is OPEN")
        
        try:
            result = func(*args, **kwargs)
            
            # Reset circuit breaker on success
            if circuit["state"] == CircuitBreakerState.HALF_OPEN:
                circuit["state"] = CircuitBreakerState.CLOSED
                circuit["failure_count"] = 0
                self.logger.info(f"Circuit breaker for {service_name} reset to CLOSED")
            
            return result
            
        except circuit["expected_exception"] as e:
            circuit["failure_count"] += 1
            circuit["last_failure_time"] = time.time()
            
            if circuit["failure_count"] >= circuit["failure_threshold"]:
                circuit["state"] = CircuitBreakerState.OPEN
                self.logger.error(f"Circuit breaker for {service_name} opened after {circuit['failure_count']} failures")
            
            raise e
    
    def log_error(
        self,
        error: Exception,
        context: Dict[str, Any] = None,
        severity: ErrorSeverity = ErrorSeverity.MEDIUM,
        category: ErrorCategory = ErrorCategory.SYSTEM
    ) -> str:
        """
        Log error with structured information.
        
        Args:
            error: Exception to log
            context: Additional context information
            severity: Error severity level
            category: Error category
            
        Returns:
            Error ID for tracking
        """
        error_id = f"ERR_{int(time.time())}_{hash(str(error)) % 10000:04d}"
        
        error_info = {
            "error_id": error_id,
            "timestamp": datetime.now().isoformat(),
            "error_type": type(error).__name__,
            "error_message": str(error),
            "severity": severity.value,
            "category": category.value,
            "context": context or {},
            "traceback": traceback.format_exc()
        }
        
        # Log based on severity
        if severity == ErrorSeverity.CRITICAL:
            self.logger.critical(f"CRITICAL ERROR {error_id}: {error}", extra=error_info)
        elif severity == ErrorSeverity.HIGH:
            self.logger.error(f"HIGH ERROR {error_id}: {error}", extra=error_info)
        elif severity == ErrorSeverity.MEDIUM:
            self.logger.warning(f"MEDIUM ERROR {error_id}: {error}", extra=error_info)
        else:
            self.logger.info(f"LOW ERROR {error_id}: {error}", extra=error_info)
        
        # Store error statistics
        self._update_error_stats(category, severity)
        
        return error_id
    
    def _update_error_stats(self, category: ErrorCategory, severity: ErrorSeverity):
        """Update error statistics."""
        key = f"{category.value}_{severity.value}"
        if key not in self.error_stats:
            self.error_stats[key] = {"count": 0, "last_occurrence": None}
        
        self.error_stats[key]["count"] += 1
        self.error_stats[key]["last_occurrence"] = datetime.now().isoformat()
    
    def get_error_stats(self) -> Dict[str, Any]:
        """Get error statistics."""
        return {
            "circuit_breakers": {
                name: {
                    "state": cb["state"].value,
                    "failure_count": cb["failure_count"],
                    "last_failure_time": cb["last_failure_time"]
                }
                for name, cb in self.circuit_breakers.items()
            },
            "error_statistics": self.error_stats,
            "total_errors": sum(stats["count"] for stats in self.error_stats.values())
        }


class CircuitBreakerOpenException(Exception):
    """Exception raised when circuit breaker is open."""
    pass


def retry_with_backoff(
    max_retries: int = 3,
    backoff_factor: float = 2.0,
    base_delay: float = 1.0,
    exceptions: tuple = (Exception,)
):
    """
    Decorator for retry with exponential backoff.
    
    Args:
        max_retries: Maximum number of retries
        backoff_factor: Backoff multiplier
        base_delay: Base delay in seconds
        exceptions: Tuple of exceptions to retry on
        
    Usage:
        @retry_with_backoff(max_retries=3, backoff_factor=2.0)
        def risky_function():
            pass
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            error_handler = ErrorHandler()
            return error_handler.execute_with_retry(
                func, *args,
                max_retries=max_retries,
                backoff_factor=backoff_factor,
                base_delay=base_delay,
                exceptions=exceptions,
                **kwargs
            )
        return wrapper
    return decorator


def async_retry_with_backoff(
    max_retries: int = 3,
    backoff_factor: float = 2.0,
    base_delay: float = 1.0,
    exceptions: tuple = (Exception,)
):
    """
    Decorator for async retry with exponential backoff.
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            error_handler = ErrorHandler()
            return await error_handler.execute_async_with_retry(
                func, *args,
                max_retries=max_retries,
                backoff_factor=backoff_factor,
                base_delay=base_delay,
                exceptions=exceptions,
                **kwargs
            )
        return wrapper
    return decorator


def circuit_breaker(
    service_name: str,
    failure_threshold: int = 5,
    recovery_timeout: int = 60,
    expected_exception: tuple = (Exception,)
):
    """
    Decorator for circuit breaker pattern.
    
    Args:
        service_name: Name of the service
        failure_threshold: Number of failures before opening circuit
        recovery_timeout: Time in seconds before trying again
        expected_exception: Exceptions that count as failures
        
    Usage:
        @circuit_breaker("external_api", failure_threshold=5)
        def call_external_api():
            pass
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            error_handler = ErrorHandler()
            return error_handler.execute_with_circuit_breaker(
                service_name, func, *args, **kwargs
            )
        return wrapper
    return decorator


def handle_errors(
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    category: ErrorCategory = ErrorCategory.SYSTEM,
    context: Dict[str, Any] = None
):
    """
    Decorator for error handling and logging.
    
    Args:
        severity: Error severity level
        category: Error category
        context: Additional context information
        
    Usage:
        @handle_errors(severity=ErrorSeverity.HIGH, category=ErrorCategory.DATABASE)
        def database_operation():
            pass
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                error_handler = ErrorHandler()
                error_id = error_handler.log_error(
                    e, context=context, severity=severity, category=category
                )
                raise
        return wrapper
    return decorator


# Global error handler instance
error_handler = ErrorHandler()
