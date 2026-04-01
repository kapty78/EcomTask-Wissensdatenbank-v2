#!/usr/bin/env python3
"""
Script to create all database tables using SQLAlchemy
"""
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from sqlalchemy import create_engine
from app.models.base import Base
from app.core.config import settings
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_tables():
    """Create all database tables"""
    try:
        # Create engine
        engine = create_engine(
            settings.DATABASE_URL,
            pool_size=20,
            max_overflow=30,
            pool_timeout=30,
            pool_recycle=3600,
            pool_pre_ping=True
        )

        logger.info("Creating all database tables...")
        Base.metadata.create_all(bind=engine)
        logger.info("All tables created successfully!")

        # Verify tables were created
        from sqlalchemy import inspect
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        logger.info(f"Created {len(tables)} tables: {', '.join(tables)}")

    except Exception as e:
        logger.error(f"Error creating tables: {e}")
        raise

if __name__ == "__main__":
    create_tables()
