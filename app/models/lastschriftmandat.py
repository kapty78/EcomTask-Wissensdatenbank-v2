from sqlalchemy import Column, String, DateTime, ForeignKey, LargeBinary, Text
import uuid
from datetime import datetime
from ..utils.timezone_util import BERLIN_TZ
from .base import Base
from sqlalchemy.orm import relationship

class Lastschriftmandat(Base):
    __tablename__ = "lastschriftmandats"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    business_id = Column(String, ForeignKey("businesses.id"), nullable=False)
    pdf_file = Column(LargeBinary, nullable=False)  # Store the PDF directly
    file_name = Column(String, nullable=False)
    description = Column(Text, nullable=True)  # Optional description
    created_at = Column(DateTime, default=datetime.now(BERLIN_TZ))
    updated_at = Column(DateTime, default=datetime.now(BERLIN_TZ), onupdate=datetime.now(BERLIN_TZ))

    # Relationship
    # Temporarily disabled relationships to fix startup issues
    # business = relationship("Business", back_populates="lastschriftmandat") 