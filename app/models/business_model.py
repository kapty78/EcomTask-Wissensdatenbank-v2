from sqlalchemy import Column, String, Boolean, DateTime, JSON, Index
import uuid
from enum import Enum as PyEnum
from datetime import datetime
from ..utils.timezone_util import BERLIN_TZ
from .base import Base
from sqlalchemy.orm import relationship

# Forward reference to avoid circular imports
# BusinessSubscription will be imported in all_models.py

class WABAStatus(PyEnum):
    pending = "pending"
    connected = "connected"
    failed = "failed"

class Business(Base):
    __tablename__ = "businesses"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    business_name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True, index=True)  # OPTIMIZATION: Add index for login queries
    password = Column(String, nullable=False)
    phone_number = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, index=True)  # OPTIMIZATION: Add index for active business queries
    created_at = Column(DateTime, default=lambda: datetime.now(BERLIN_TZ))
    
    # Business information fields
    tax_id = Column(String, nullable=True)  # Umsatzsteuer-ID
    street_address = Column(String, nullable=True)  # Straße und Hausnummer
    postal_code = Column(String, nullable=True)  # Postleitzahl
    city = Column(String, nullable=True)  # Stadt
    country = Column(String, nullable=True)  # Land
    contact_person = Column(String, nullable=True)  # Ansprechpartner
    
    # 360dialog WhatsApp Business API fields
    client_id = Column(String, nullable=True)
    channel_id = Column(String, nullable=True)
    api_key = Column(String, nullable=True)
    api_endpoint = Column(String, nullable=True)  # This will store the address
    app_id = Column(String, nullable=True)
    waba_status = Column(String, default="pending")
    whatsapp_profile = Column(JSON, nullable=True)
    whatsapp_number = Column(String, nullable=True, index=True)  # OPTIMIZATION: Add index for phone lookup
    
    # TimeGlobe-specific fields
    timeglobe_auth_key = Column(String, nullable=True)
    customer_cd = Column(String, nullable=True)  # Used for API calls to TimeGlobe

    # Temporarily disabled relationships to fix startup issues
    # subscriptions = relationship("BusinessSubscription", back_populates="business")
    # customers = relationship("CustomerModel", back_populates="business")
    # main_contract = relationship("MainContract", back_populates="business", uselist=False)
    # auftragsverarbeitung_contract = relationship("AuftragsverarbeitungContract", back_populates="business", uselist=False)
    # lastschriftmandat = relationship("Lastschriftmandat", back_populates="business", uselist=False)

# OPTIMIZATION: Add composite indexes for common query patterns
__table_args__ = (
    Index('idx_business_whatsapp_active', 'whatsapp_number', 'is_active'),
    Index('idx_business_email_active', 'email', 'is_active'),
)
