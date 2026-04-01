from .base import Base
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, BigInteger
from sqlalchemy.orm import relationship
from datetime import datetime


class BookingDetail(Base):
    __tablename__ = "booking_details"
    id = Column(Integer, primary_key=True, autoincrement=True)
    begin_ts = Column(DateTime, nullable=False)
    duration_millis = Column(BigInteger, nullable=False)
    employee_id = Column(Integer, nullable=True)
    item_no = Column(Integer, nullable=True)
    item_nm = Column(String, nullable=True)
    book_id = Column(Integer, ForeignKey("booked_appointments.id"), nullable=False)
    # Temporarily disabled relationship to fix startup issues
    # book = relationship("BookModel", back_populates="booking_details", primaryjoin="BookingDetail.book_id == BookModel.id")
    created_at = Column(DateTime, default=datetime.now)
