"""
This script ensures all models are loaded and all tables are created in the database.
Run this script with: python -m app.db.ensure_tables
"""
from sqlalchemy import create_engine, inspect
from ..core.config import settings
from ..models.base import Base
from ..models.all_models import (
    Business, 
    WABAStatus,
    BusinessSubscription,
    SubscriptionPlan,
    BookingDetail,
    BookModel,
    CustomerModel,
    ConversationHistory,
    MainContract,
    AuftragsverarbeitungContract,
    Lastschriftmandat
)
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def verify_tables():
    """
    Verify all models are registered and all tables exist in the database.
    Creates missing tables if necessary.
    """
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=20,          # Increased from default 5 to 20
        max_overflow=30,       # Increased from default 10 to 30
        pool_timeout=30,       # Connection timeout in seconds
        pool_recycle=3600,     # Recycle connections after 1 hour
        pool_pre_ping=True     # Validate connections before use
    )
    inspector = inspect(engine)
    
    # Get all table names defined in models
    model_tables = Base.metadata.tables.keys()
    # Get all table names in the database
    db_tables = inspector.get_table_names()
    
    logger.info(f"Models defined: {len(model_tables)}")
    logger.info(f"Tables in database: {len(db_tables)}")
    
    # Find missing tables
    missing_tables = set(model_tables) - set(db_tables)
    
    if missing_tables:
        logger.info(f"Found {len(missing_tables)} missing tables: {', '.join(missing_tables)}")
        logger.info("Creating missing tables...")
        Base.metadata.create_all(bind=engine)
        logger.info("All tables created successfully!")
    else:
        logger.info("All tables already exist in the database.")
    
    # Final verification
    db_tables = inspector.get_table_names()
    logger.info(f"Final table count in database: {len(db_tables)}")
    logger.info(f"Tables in database: {', '.join(db_tables)}")

if __name__ == "__main__":
    verify_tables() 