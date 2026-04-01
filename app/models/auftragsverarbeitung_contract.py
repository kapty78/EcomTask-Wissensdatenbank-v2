from sqlalchemy import Column, String, DateTime, ForeignKey, LargeBinary, Text
import uuid
from datetime import datetime
from ..utils.timezone_util import BERLIN_TZ
from .base import Base
from sqlalchemy.orm import relationship

class AuftragsverarbeitungContract(Base):
    __tablename__ = "auftragsverarbeitung_contracts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    business_id = Column(String, ForeignKey("businesses.id"), nullable=False)
    contract_text = Column(Text, nullable=False)
    signature_image = Column(Text, nullable=True)  # Store base64 signature image
    pdf_file = Column(LargeBinary, nullable=True)  # Store the PDF as binary data
    file_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.now(BERLIN_TZ))
    updated_at = Column(DateTime, default=datetime.now(BERLIN_TZ), onupdate=datetime.now(BERLIN_TZ))

    # Relationship
    # Temporarily disabled relationships to fix startup issues
    # business = relationship("Business", back_populates="auftragsverarbeitung_contract") 