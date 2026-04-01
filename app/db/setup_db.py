"""
Database setup module to be imported during application startup.
This ensures all models are loaded and tables are created.
"""
from sqlalchemy import create_engine, inspect, text
from ..core.config import settings
from ..models.base import Base
# Import all models explicitly to register them with SQLAlchemy
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
    Lastschriftmandat,
    ResetToken
)
import logging

logger = logging.getLogger(__name__)

def setup_database():
    """
    Ensure all tables are created in the database.
    This function should be called during application startup.
    """
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=20,          # Increased from default 5 to 20
        max_overflow=30,       # Increased from default 10 to 30
        pool_timeout=30,       # Connection timeout in seconds
        pool_recycle=3600,     # Recycle connections after 1 hour
        pool_pre_ping=True     # Validate connections before use
    )
    
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    
    # Verify all tables were created
    inspector = inspect(engine)
    db_tables = inspector.get_table_names()
    model_tables = set(Base.metadata.tables.keys())
    
    # Log table information
    logger.info(f"Database setup complete. Found {len(db_tables)} tables.")
    
    # Verify all expected tables exist
    missing_tables = model_tables - set(db_tables)
    if missing_tables:
        logger.warning(f"Some tables are missing: {', '.join(missing_tables)}")
    else:
        logger.info("All expected tables exist in the database.")

    # Ensure booked_appointments has business_id column for Supabase sync
    try:
        booked_cols = {col['name'] for col in inspector.get_columns('booked_appointments')}
        if 'business_id' not in booked_cols:
            with engine.connect() as connection:
                connection.execute(text("ALTER TABLE booked_appointments ADD COLUMN business_id VARCHAR"))
                logger.info("Added missing business_id column to booked_appointments table")
    except Exception as column_error:
        logger.warning(f"Could not ensure business_id column on booked_appointments: {column_error}")

    return True
