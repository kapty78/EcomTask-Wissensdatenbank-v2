from pydantic import BaseModel, Field
from typing import List, Optional


class SenderRequest(BaseModel):
    """Schema for registering a WhatsApp sender"""

    phone_number: str = Field(..., description="WhatsApp Phone Number")
    waba_id: str = Field(
        ..., description="WhatsApp Business Account ID (WABA ID)", min_length=13
    )
    business_name: str = Field(..., description="Business Name")
    about: str = Field(..., description="About the business")
    business_type: str = Field(..., description="Type of business")
    address: str = Field(..., description="Business address")
    email: str = Field(..., description="Business email")
    website: str = Field(..., description="Business website")
    logo_url: Optional[str] = Field(None, description="URL to business logo")
    description: Optional[str] = Field(None, description="Business description")

    class Config:
        schema_extra = {
            "example": {
                "phone_number": "14155551234",
                "waba_id": "1234567890123",
                "business_name": "My Business",
                "about": "About my business",
                "business_type": "RETAIL",
                "address": "123 Main St, City, State, Zip",
                "email": "business@example.com",
                "website": "https://example.com",
                "logo_url": "https://example.com/logo.png",
                "description": "A detailed description of my business",
            }
        }


class VerificationRequest(BaseModel):
    """Schema for verifying a WhatsApp sender"""

    sender_id: str = Field(..., description="Sender ID")
    verification_code: str = Field(..., description="Verification code")

    class Config:
        schema_extra = {
            "example": {
                "sender_id": "whatsapp:+14155551234",
                "verification_code": "123456",
            }
        }


class SenderId(BaseModel):
    """Schema for a WhatsApp sender ID"""

    sender_id: str = Field(..., description="Sender ID")

    class Config:
        schema_extra = {"example": {"sender_id": "whatsapp:+14155551234"}}


class UpdateSenderRequest(BaseModel):
    """Schema for updating a WhatsApp sender"""

    sender_id: str = Field(..., description="Sender ID")
    business_name: Optional[str] = Field(None, description="Business Name")
    about: Optional[str] = Field(None, description="About the business")
    business_type: Optional[str] = Field(None, description="Type of business")
    address: Optional[str] = Field(None, description="Business address")
    email: Optional[str] = Field(None, description="Business email")
    website: Optional[str] = Field(None, description="Business website")
    logo_url: Optional[str] = Field(None, description="URL to business logo")
    description: Optional[str] = Field(None, description="Business description")

    class Config:
        schema_extra = {
            "example": {
                "sender_id": "whatsapp:+14155551234",
                "business_name": "My Business",
                "about": "About my business",
                "business_type": "RETAIL",
                "address": "123 Main St, City, State, Zip",
                "email": "business@example.com",
                "website": "https://example.com",
                "logo_url": "https://example.com/logo.png",
                "description": "A detailed description of my business",
            }
        } 