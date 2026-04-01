from .base import Base
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, Index, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
from .appointment_status import AppointmentStatus

class BookModel(Base):
    __tablename__ = "booked_appointments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, unique=True, index=True)
    site_cd = Column(String, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    customer_phone = Column(String(50), nullable=True, index=True)  # Track phone without customer record
    business_phone_number = Column(String(50), nullable=True, index=True)
    business_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.now, index=True)
    status = Column(Enum(AppointmentStatus), default=AppointmentStatus.BOOKED, nullable=False)
    cancelled_at = Column(DateTime, nullable=True)

    # Temporarily disabled relationships to fix startup issues
    # booking_details = relationship("BookingDetail", back_populates="book", primaryjoin="BookModel.id == BookingDetail.book_id")
    # customer = relationship("CustomerModel", back_populates="appointments")

    __table_args__ = (
        Index('idx_appointment_business_date', 'business_phone_number', 'created_at'),
        Index('idx_appointment_customer_date', 'customer_id', 'created_at'),
        Index('idx_appointment_cancelled_date', 'business_phone_number', 'cancelled_at'),
    )
