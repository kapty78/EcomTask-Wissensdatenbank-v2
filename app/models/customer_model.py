from .base import Base
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime


class CustomerModel(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String)
    last_name = Column(String)
    mobile_number = Column(String, unique=True, index=True)
    email = Column(String, nullable=True, index=True)
    gender = Column(String, nullable=True)
    business_id = Column(String, ForeignKey("businesses.id"), nullable=True, index=True)
    # Temporarily disabled relationships to fix startup issues
    # appointments = relationship("BookModel", back_populates="customer")
    # business = relationship("Business", back_populates="customers")
    dplAccepted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now, index=True)

    # PERFORMANCE: Add composite indexes for common query patterns
    __table_args__ = (
        Index('idx_customer_mobile_business', 'mobile_number', 'business_id'),
        Index('idx_customer_email_business', 'email', 'business_id'),
        Index('idx_customer_created_business', 'created_at', 'business_id'),
        Index('idx_customer_dpl_business', 'dplAccepted', 'business_id'),
    )
