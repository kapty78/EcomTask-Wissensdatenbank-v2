"""
Critical Function Tests
======================

Tests for critical functions to ensure production readiness.
These tests focus on the most important functionality for live deployment.

Run with: python -m pytest tests/test_critical_functions.py -v
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import tempfile
import os

# Import the main app
from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.models.base import Base
from app.utils.cache import CacheManager
from app.utils.monitoring import MonitoringSystem
from app.utils.error_handler import ErrorHandler

# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="module")
def client():
    """Create test client."""
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="module")
def mock_settings():
    """Mock settings for testing."""
    with patch('app.core.config.settings') as mock:
        mock.DATABASE_URL = SQLALCHEMY_DATABASE_URL
        mock.JWT_SECRET_KEY = "test-secret-key"
        mock.WHATSAPP_APP_ID = "test-app-id"
        mock.WHATSAPP_APP_SECRET = "test-app-secret"
        mock.TIMEGLOBE_API_KEY = "test-api-key"
        mock.OPENAI_API_KEY = "test-openai-key"
        yield mock

class TestHealthChecks:
    """Test health check endpoints."""
    
    def test_health_endpoint(self, client):
        """Test basic health endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "timestamp" in data
        assert "uptime_seconds" in data
    
    def test_metrics_endpoint(self, client):
        """Test metrics endpoint."""
        response = client.get("/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "timestamp" in data
        assert "uptime_seconds" in data
    
    def test_cache_stats_endpoint(self, client):
        """Test cache stats endpoint."""
        response = client.get("/cache/stats")
        assert response.status_code == 200
        data = response.json()
        assert "backend" in data

class TestCacheSystem:
    """Test caching system."""
    
    def test_cache_basic_operations(self):
        """Test basic cache operations."""
        cache = CacheManager.get_instance()
        
        # Test set and get
        cache.set("test_key", "test_value", ttl=60)
        value = cache.get("test_key")
        assert value == "test_value"
        
        # Test delete
        cache.delete("test_key")
        value = cache.get("test_key")
        assert value is None
    
    def test_cache_serialization(self):
        """Test cache serialization."""
        cache = CacheManager.get_instance()
        
        # Test complex object
        test_data = {"key": "value", "list": [1, 2, 3], "nested": {"a": 1}}
        cache.set("complex_key", test_data, ttl=60)
        retrieved = cache.get("complex_key")
        assert retrieved == test_data
    
    def test_cache_stats(self):
        """Test cache statistics."""
        cache = CacheManager.get_instance()
        
        # Clear cache first
        cache.clear()
        
        # Test stats
        cache.set("key1", "value1")
        cache.get("key1")
        cache.get("nonexistent")
        
        stats = cache.get_stats()
        assert stats["hits"] >= 1
        assert stats["misses"] >= 1
        assert stats["sets"] >= 1

class TestMonitoringSystem:
    """Test monitoring system."""
    
    def test_monitoring_basic_operations(self):
        """Test basic monitoring operations."""
        monitoring = MonitoringSystem()
        
        # Test counter
        monitoring.increment_counter("test_counter", 5)
        assert monitoring.get_counter("test_counter") == 5
        
        # Test gauge
        monitoring.set_gauge("test_gauge", 10.5)
        assert monitoring.get_gauge("test_gauge") == 10.5
        
        # Test timing
        monitoring.record_timing("test_timing", 0.5)
        stats = monitoring.get_timing_stats("test_timing")
        assert stats["count"] == 1
        assert stats["avg"] == 0.5
    
    def test_health_check_registration(self):
        """Test health check registration."""
        monitoring = MonitoringSystem()
        
        def test_check():
            return {"status": "healthy", "message": "OK"}
        
        monitoring.register_health_check("test_check", test_check)
        result = monitoring.run_health_check("test_check")
        
        assert result.status == "healthy"
        assert result.message == "OK"
    
    def test_system_metrics(self):
        """Test system metrics collection."""
        monitoring = MonitoringSystem()
        metrics = monitoring.get_system_metrics()
        
        assert "system" in metrics
        assert "process" in metrics
        assert "cpu_percent" in metrics["system"]
        assert "memory_percent" in metrics["system"]

class TestErrorHandler:
    """Test error handling system."""
    
    def test_error_logging(self):
        """Test error logging."""
        error_handler = ErrorHandler()
        
        try:
            raise ValueError("Test error")
        except Exception as e:
            error_id = error_handler.log_error(
                e, 
                context={"test": "data"}, 
                severity=ErrorSeverity.MEDIUM,
                category=ErrorCategory.SYSTEM
            )
            
            assert error_id.startswith("ERR_")
    
    def test_retry_mechanism(self):
        """Test retry mechanism."""
        error_handler = ErrorHandler()
        
        call_count = 0
        
        def failing_function():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ConnectionError("Connection failed")
            return "success"
        
        result = error_handler.execute_with_retry(failing_function, max_retries=3)
        assert result == "success"
        assert call_count == 3
    
    def test_circuit_breaker(self):
        """Test circuit breaker pattern."""
        error_handler = ErrorHandler()
        
        def failing_function():
            raise ConnectionError("Service unavailable")
        
        # Should fail and open circuit
        for _ in range(6):
            try:
                error_handler.execute_with_circuit_breaker("test_service", failing_function)
            except ConnectionError:
                pass
        
        # Circuit should be open now
        circuit = error_handler.get_circuit_breaker("test_service")
        assert circuit["state"].value == "open"

class TestSecurity:
    """Test security measures."""
    
    def test_no_hardcoded_secrets(self):
        """Test that no hardcoded secrets are present."""
        # Check config file for hardcoded secrets
        config_file = "app/core/config.py"
        with open(config_file, 'r') as f:
            content = f.read()
            
        # Should not contain hardcoded passwords
        assert "23f45g568ughswgjz86" not in content
        assert "super-secret" not in content
    
    def test_api_key_cleaning(self):
        """Test API key cleaning function."""
        from app.core.config import clean_api_key
        
        # Test various formats
        test_cases = [
            ('"test-key"', 'test-key'),
            ("'test-key'", 'test-key'),
            ('   test-key   ', 'test-key'),
            ('\n\ttest-key\n\t', 'test-key'),
        ]
        
        for input_key, expected in test_cases:
            result = clean_api_key(input_key)
            assert result == expected

class TestDatabaseOperations:
    """Test database operations."""
    
    def test_database_connection(self, client):
        """Test database connection."""
        # This test ensures the database is accessible
        response = client.get("/health")
        assert response.status_code == 200
        
        # Check that storage info is available
        data = response.json()
        assert "storage" in data
    
    def test_database_indexes(self):
        """Test that database indexes are properly defined."""
        from app.models.customer_model import CustomerModel
        from app.models.business_model import Business
        from app.models.booked_appointment import BookModel
        
        # Check that models have proper indexes
        assert hasattr(CustomerModel, '__table_args__')
        assert hasattr(Business, '__table_args__')
        assert hasattr(BookModel, '__table_args__')

class TestPerformance:
    """Test performance optimizations."""
    
    def test_cache_performance(self):
        """Test cache performance."""
        cache = CacheManager.get_instance()
        
        import time
        
        # Test cache hit performance
        cache.set("perf_test", "value", ttl=60)
        
        start_time = time.time()
        for _ in range(100):
            cache.get("perf_test")
        end_time = time.time()
        
        # Should be fast (less than 1 second for 100 operations)
        assert (end_time - start_time) < 1.0
    
    def test_monitoring_performance(self):
        """Test monitoring performance."""
        monitoring = MonitoringSystem()
        
        import time
        
        # Test metrics collection performance
        start_time = time.time()
        for _ in range(100):
            monitoring.increment_counter("perf_test")
            monitoring.record_timing("perf_test", 0.1)
        end_time = time.time()
        
        # Should be fast (less than 1 second for 100 operations)
        assert (end_time - start_time) < 1.0

class TestIntegration:
    """Test integration scenarios."""
    
    def test_full_request_flow(self, client):
        """Test full request flow."""
        # Test root endpoint
        response = client.get("/")
        assert response.status_code == 200
        
        # Test health endpoint
        response = client.get("/health")
        assert response.status_code == 200
        
        # Test metrics endpoint
        response = client.get("/metrics")
        assert response.status_code == 200
    
    def test_error_handling_flow(self, client):
        """Test error handling flow."""
        # Test non-existent endpoint
        response = client.get("/nonexistent")
        assert response.status_code == 404
        
        # Test invalid method
        response = client.post("/health")
        assert response.status_code == 405

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
