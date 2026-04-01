from sqlalchemy import create_engine
from ..core.config import settings
from ..models.base import Base, metadata
# Import explicitly to ensure all models are registered
from ..models.all_models import (
    Business, 
    WABAStatus,
    BusinessSubscription,
    SubscriptionPlan,
    BookingDetail,
    BookModel,
    CustomerModel
)

def init_db():
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=20,          # Increased from default 5 to 20
        max_overflow=30,       # Increased from default 10 to 30
        pool_timeout=30,       # Connection timeout in seconds
        pool_recycle=3600,     # Recycle connections after 1 hour
        pool_pre_ping=True     # Validate connections before use
    )
    # This will create all tables defined in all imported models
    metadata.create_all(bind=engine)
    # print("Database tables created successfully!")

if __name__ == "__main__":
    init_db() 