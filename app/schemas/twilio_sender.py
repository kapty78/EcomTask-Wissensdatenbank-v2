from pydantic import BaseModel, EmailStr, HttpUrl, Field
from typing import Optional


class BusinessBase(BaseModel):
    """Base model with common business information fields."""

    business_name: str
    about: str
    description: str
    business_type: str
    address: str
    email: EmailStr
    website: str
    logo_url: str
    phone_number: str = Field(pattern=r"^\+?[1-9]\d{1,14}$")  # E.164 format validation


class SenderRequest(BusinessBase):
    """Model for creating a new sender."""

    waba_id: str
    # callback_url: Optional[HttpUrl] = None  # Uncomment if needed


class SenderId(BaseModel):
    """Model containing only the sender ID."""

    sender_id: str


class VerificationRequest(SenderId):
    """Model for verification code submission."""

    verification_code: str


class UpdateSenderRequest(BusinessBase, SenderId):
    """Model for updating an existing sender."""

    pass
