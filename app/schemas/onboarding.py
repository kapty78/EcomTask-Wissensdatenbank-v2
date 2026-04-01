from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from enum import Enum

class ConnectWhatsAppRequest(BaseModel):
    """Request to connect a WhatsApp number for a business"""
    waba_id: str = Field(..., description="WhatsApp Business Account ID")
    country_code: str = Field("US", description="Country code for phone number purchase (ISO 3166-1 alpha-2)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "waba_id": "waba_123456789",
                "country_code": "US"
            }
        }
