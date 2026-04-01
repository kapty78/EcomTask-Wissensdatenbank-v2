from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from ..core.config import settings
from contextlib import contextmanager

# Define the Base class
Base = declarative_base()

# Create engine with connection pool configuration
engine = create_engine(
    settings.DATABASE_URL, 
    echo=True,
    pool_size=20,          # Increased from default 5 to 20
    max_overflow=30,       # Increased from default 10 to 30
    pool_timeout=30,       # Connection timeout in seconds
    pool_recycle=3600,     # Recycle connections after 1 hour
    pool_pre_ping=True     # Validate connections before use
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
