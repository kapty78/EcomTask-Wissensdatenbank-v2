from .base import Base
from sqlalchemy import Column, String, Integer, Float, Boolean
from sqlalchemy.orm import relationship


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String)
    price = Column(Float, nullable=False)
    duration_days = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True)

    # Temporarily disabled relationships to fix startup issues
    # business_subscriptions = relationship("BusinessSubscription", back_populates="subscription_plan")
