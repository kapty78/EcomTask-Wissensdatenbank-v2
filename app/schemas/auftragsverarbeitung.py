from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
import base64

class AuftragsverarbeitungContractCreate(BaseModel):
    contract_text: str = Field(..., description="The Auftragsverarbeitung contract text content")
    signature_image: str = Field(..., description="Base64 encoded signature image")

class AuftragsverarbeitungContractResponse(BaseModel):
    id: str
    file_name: str
    contract_text: str
    signature_image: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True 