"""
Database Manager Module
Handles dual storage (SQLite + Supabase) and migration
"""

import os
import logging
from typing import Optional, Union, Any, Dict, List
from enum import Enum
from sqlalchemy import create_engine, Engine, text
from sqlalchemy.orm import sessionmaker, Session

from .supabase_config import supabase_config, get_supabase_session
from ..db.session import get_db

logger = logging.getLogger(__name__)

class DatabaseType(Enum):
    """Database type enumeration"""
    SQLITE = "sqlite"
    SUPABASE = "supabase"
    DUAL = "dual"

class DatabaseManager:
    """Manages database operations with support for dual storage"""
    
    def __init__(self):
        # Support multiple ways to configure storage mode
        storage_mode_env = os.getenv("STORAGE_MODE", "").lower()
        database_type_env = os.getenv("DATABASE_TYPE", "sqlite").lower()
        enable_dual = os.getenv("ENABLE_DUAL_STORAGE", "false").lower() == "true"

        # Check if Supabase is properly configured and working
        supabase_configured = supabase_config.is_configured()
        supabase_working = False

        # Test Supabase connection to see if it actually works
        if supabase_configured:
            try:
                # Try multiple times in case of temporary network issues
                for attempt in range(3):
                    try:
                        test_session = supabase_config.get_session()
                        test_session.execute(text("SELECT 1"))
                        test_session.commit()
                        test_session.close()
                        supabase_working = True
                        logger.info("Supabase connection test successful")
                        break
                    except Exception as e:
                        if attempt == 2:  # Last attempt
                            logger.warning(f"Supabase connection test failed after 3 attempts: {e}")
                            supabase_working = False
                        else:
                            logger.info(f"Supabase connection attempt {attempt + 1} failed, retrying...")
                            import time
                            time.sleep(1)
            except Exception as e:
                logger.warning(f"Supabase connection test failed: {e}")
                supabase_working = False

        # If Supabase is not working, force SQLite-only mode
        if not supabase_working:
            logger.info("Supabase not working (likely IPv6/network issue), falling back to SQLite-only mode")
            storage_mode_env = "sqlite"
            enable_dual = False
        
        # Determine storage mode (STORAGE_MODE takes precedence)
        if storage_mode_env:
            self.storage_mode = DatabaseType(storage_mode_env)
            self.database_type = self.storage_mode
            self.enable_dual_storage = (storage_mode_env == "dual")
        elif enable_dual:
            self.storage_mode = DatabaseType.DUAL
            self.database_type = DatabaseType(database_type_env)
            self.enable_dual_storage = True
        else:
            self.database_type = DatabaseType(database_type_env)
            self.storage_mode = self.database_type
            self.enable_dual_storage = False

        # Override to SQLite-only if Supabase is not available but dual storage is requested
        if self.enable_dual_storage and not supabase_configured:
            logger.warning("Dual storage requested but Supabase not available, falling back to SQLite-only")
            self.storage_mode = DatabaseType.SQLITE
            self.enable_dual_storage = False
        
        logger.info(f"Database manager initialized with storage mode: {self.storage_mode.value}")
        logger.info(f"Dual storage enabled: {self.enable_dual_storage}")
    
    def get_session(self, database_type: Optional[DatabaseType] = None) -> Session:
        """Get database session for specified type"""
        if database_type is None:
            database_type = self.storage_mode
        
        if database_type == DatabaseType.SQLITE:
            return next(get_db())
        elif database_type == DatabaseType.SUPABASE:
            return get_supabase_session()
        elif database_type == DatabaseType.DUAL:
            # For dual storage, return SQLite session by default
            # Supabase operations will be handled separately
            return next(get_db())
        else:
            raise ValueError(f"Unsupported database type: {database_type}")
    
    def get_supabase_session(self) -> Session:
        """Get Supabase session specifically"""
        return get_supabase_session()
    
    def get_sqlite_session(self) -> Session:
        """Get SQLite session specifically"""
        return next(get_db())
    
    def execute_in_both(self, operation_func, *args, **kwargs) -> Dict[str, Any]:
        """Execute operation in both SQLite and Supabase"""
        results = {}
        
        try:
            # Execute in SQLite
            if self.storage_mode in [DatabaseType.SQLITE, DatabaseType.DUAL]:
                sqlite_session = self.get_sqlite_session()
                try:
                    results["sqlite"] = operation_func(sqlite_session, *args, **kwargs)
                    logger.debug("Operation executed successfully in SQLite")
                except Exception as e:
                    logger.error(f"SQLite operation failed: {e}")
                    results["sqlite"] = {"error": str(e)}
                finally:
                    sqlite_session.close()
            
            # Execute in Supabase
            if self.storage_mode in [DatabaseType.SUPABASE, DatabaseType.DUAL]:
                supabase_session = self.get_supabase_session()
                try:
                    results["supabase"] = operation_func(supabase_session, *args, **kwargs)
                    logger.debug("Operation executed successfully in Supabase")
                except Exception as e:
                    logger.error(f"Supabase operation failed: {e}")
                    results["supabase"] = {"error": str(e)}
                finally:
                    supabase_session.close()
            
            return results
            
        except Exception as e:
            logger.error(f"Dual storage operation failed: {e}")
            return {"error": str(e)}
    
    def migrate_data(self, table_name: str, batch_size: int = 100) -> Dict[str, Any]:
        """Migrate data from SQLite to Supabase"""
        logger.info(f"Starting migration for table: {table_name}")
        
        try:
            # Get SQLite session
            sqlite_session = self.get_sqlite_session()
            supabase_session = self.get_supabase_session()
            
            # Get table metadata
            from sqlalchemy import inspect
            inspector = inspect(sqlite_session.bind)
            
            if table_name not in inspector.get_table_names():
                logger.warning(f"Table {table_name} not found in SQLite")
                return {"error": f"Table {table_name} not found"}
            
            # Count total records
            total_count = sqlite_session.execute(f"SELECT COUNT(*) FROM {table_name}").scalar()
            logger.info(f"Total records to migrate: {total_count}")
            
            migrated_count = 0
            errors = []
            
            # Migrate in batches
            offset = 0
            while offset < total_count:
                try:
                    # Fetch batch from SQLite
                    query = f"SELECT * FROM {table_name} LIMIT {batch_size} OFFSET {offset}"
                    batch = sqlite_session.execute(query).fetchall()
                    
                    if not batch:
                        break
                    
                    # Insert batch into Supabase
                    for row in batch:
                        try:
                            # Convert row to dict
                            row_dict = dict(row._mapping)
                            
                            # Insert into Supabase
                            supabase_session.execute(
                                f"INSERT INTO {table_name} VALUES ({','.join([':' + str(i) for i in range(len(row_dict))])})",
                                row_dict
                            )
                            migrated_count += 1
                            
                        except Exception as e:
                            errors.append(f"Row {offset + migrated_count}: {e}")
                            logger.error(f"Error migrating row: {e}")
                    
                    offset += batch_size
                    logger.info(f"Migrated {migrated_count}/{total_count} records")
                    
                except Exception as e:
                    logger.error(f"Error in batch migration: {e}")
                    errors.append(f"Batch {offset}: {e}")
                    break
            
            supabase_session.commit()
            logger.info(f"Migration completed. Migrated: {migrated_count}, Errors: {len(errors)}")
            
            return {
                "total_records": total_count,
                "migrated_records": migrated_count,
                "errors": errors,
                "success": len(errors) == 0
            }
            
        except Exception as e:
            logger.error(f"Migration failed: {e}")
            return {"error": str(e)}
        
        finally:
            sqlite_session.close()
            supabase_session.close()
    
    def test_connections(self) -> Dict[str, bool]:
        """Test both database connections"""
        results = {}
        
        # Test SQLite
        try:
            sqlite_session = self.get_sqlite_session()
            sqlite_session.execute(text("SELECT 1"))
            sqlite_session.commit()  # Need to commit for some engines
            sqlite_session.close()
            results["sqlite"] = True
            logger.info("SQLite connection test successful")
        except Exception as e:
            results["sqlite"] = False
            logger.error(f"SQLite connection test failed: {e}")

        # Test Supabase (only if configured)
        if supabase_config.is_configured():
            try:
                supabase_session = self.get_supabase_session()
                supabase_session.execute(text("SELECT 1"))
                supabase_session.commit()  # Need to commit for some engines
                supabase_session.close()
                results["supabase"] = True
                logger.info("Supabase connection test successful")
            except Exception as e:
                results["supabase"] = False
                logger.error(f"Supabase connection test failed: {e}")
        else:
            results["supabase"] = False
            logger.info("Supabase not configured, skipping connection test")
        
        return results
    
    def get_storage_info(self) -> Dict[str, Any]:
        """Get information about current storage configuration"""
        return {
            "database_type": self.database_type.value,
            "storage_mode": self.storage_mode.value,
            "dual_storage_enabled": self.enable_dual_storage,
            "sqlite_available": True,  # Always available
            "supabase_available": supabase_config.test_connection()
        }

# Global database manager instance
db_manager = DatabaseManager()

def get_database_manager() -> DatabaseManager:
    """Get database manager instance"""
    return db_manager

def get_session(database_type: Optional[DatabaseType] = None) -> Session:
    """Get database session"""
    return db_manager.get_session(database_type)

def execute_in_both(operation_func, *args, **kwargs) -> Dict[str, Any]:
    """Execute operation in both databases"""
    return db_manager.execute_in_both(operation_func, *args, **kwargs)

def test_connections() -> Dict[str, bool]:
    """Test database connections"""
    return db_manager.test_connections()
