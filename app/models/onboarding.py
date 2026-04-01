from sqlalchemy import Column, Integer, String, JSON, Boolean, ForeignKey, Enum
from sqlalchemy.orm import relationship
from ..db.base_class import Base
from ..schemas.onboarding import OnboardingStep, BusinessType

class BusinessProfile(Base):
    __tablename__ = "business_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    business_name = Column(String, nullable=False)
    location = Column(String, nullable=True)
    business_email = Column(String, nullable=False)
    website = Column(String, nullable=True)
    industry = Column(Enum(BusinessType), nullable=True)
    description = Column(String, nullable=True)

    user = relationship("       ", back_populates="business_profile")

class WhatsAppConnection(Base):
    __tablename__ = "whatsapp_connections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    phone_number = Column(String, nullable=False)
    waba_id = Column(String, nullable=False)
    business_manager_id = Column(String, nullable=False)
    sender_sid = Column(String, nullable=False)

    user = relationship("User", back_populates="whatsapp_connection")

class BookingSettings(Base):
    __tablename__ = "booking_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    working_hours = Column(JSON, nullable=False)
    services = Column(JSON, nullable=False)
    welcome_message = Column(String, nullable=False)
    faq = Column(JSON, nullable=True)

    user = relationship("User", back_populates="booking_settings")

class OnboardingProgress(Base):
    __tablename__ = "onboarding_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    current_step = Column(Enum(OnboardingStep), nullable=False)
    completed = Column(Boolean, default=False)
    data = Column(JSON, nullable=True)

    user = relationship("User", back_populates="onboarding_progress") 