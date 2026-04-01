from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
import base64

class ContractCreate(BaseModel):
    contract_text: str = Field(..., description="The legal contract text content")
    signature_image: str = Field(..., description="Base64 encoded signature image")

class ContractResponse(BaseModel):
    id: str
    file_name: str
    contract_text: str
    signature_image: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True 