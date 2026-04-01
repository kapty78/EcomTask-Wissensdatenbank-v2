from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    email: Optional[str] = None


class BusinessBase(BaseModel):
    business_name: str
    email: EmailStr
    phone_number: Optional[str] = None


class BusinessCreate(BusinessBase):
    password: str


class Business(BusinessBase):
    id: str
    is_active: bool
    created_at: datetime
    whatsapp_number: Optional[str] = None
    customer_cd: Optional[str] = None  # TimeGlobe customer code
    # Business information fields
    tax_id: Optional[str] = None
    street_address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    contact_person: Optional[str] = None

    class Config:
        from_attributes = True


class OTPVerificationRequest(BaseModel):
    email: EmailStr
    otp: str
    timeglobe_auth_key: Optional[str] = None
    customer_cd: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class TokenPayload(BaseModel):
    sub: str
    exp: int


class TimeGlobeAuthKeyRequest(BaseModel):
    auth_key: Optional[str] = None


class TimeGlobeAuthKeyResponse(BaseModel):
    valid: bool
    customer_cd: Optional[str] = None
    message: Optional[str] = None


class BusinessInfoUpdate(BaseModel):
    business_name: Optional[str] = None
    tax_id: Optional[str] = None
    street_address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    contact_person: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[EmailStr] = None


class BusinessInfoDelete(BaseModel):
    fields: List[str]


class ForgetPasswordRequest(BaseModel):
    email: EmailStr
