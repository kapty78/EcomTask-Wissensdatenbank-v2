import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from typing import Optional, List
import time
from datetime import datetime

from ..schemas.auth import (
    Token,
    BusinessCreate,
    Business,
    OTPVerificationRequest,
    ResetPasswordRequest,
    TimeGlobeAuthKeyRequest,
    TimeGlobeAuthKeyResponse,
    BusinessInfoUpdate,
    BusinessInfoDelete,
    ForgetPasswordRequest,
)
from ..services.auth_service import AuthService
from ..core.dependencies import get_auth_service, get_current_business
from ..utils import email_util
from ..logger import main_logger
from ..core.config import settings
from ..models.reset_token import ResetToken

router = APIRouter()


@router.post("/register", response_class=JSONResponse)
def register(
    business_data: BusinessCreate, auth_service: AuthService = Depends(get_auth_service)
):
    """Handles business registration."""
    main_logger.info(f"Registering new business: {business_data.email}")
    try:
        result = auth_service.create_business(business_data)
        main_logger.info(f"Business registered successfully: {business_data.email}")
        return result
    except Exception as e:
        main_logger.error(f"Registration failed for {business_data.email}: {e}")
        raise HTTPException(status_code=400, detail="Registration failed")


@router.post("/login", response_model=Token)
def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service: AuthService = Depends(get_auth_service),
):
    """Handles business login and token generation."""
    main_logger.info(f"Login attempt for {form_data.username}")

    supabase_tokens = auth_service.supabase_sign_in(form_data.username, form_data.password)

    business = auth_service.business_repository.get_by_email(form_data.username)
    if not business:
        main_logger.warning(f"Supabase user {form_data.username} has no corresponding business record")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Business not registered",
        )

    access_token = supabase_tokens.get("access_token")
    if not access_token:
        main_logger.error("Supabase response missing access token for %s", form_data.username)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Invalid authentication response")

    token_type = supabase_tokens.get("token_type", "bearer")
    main_logger.info(f"Business {form_data.username} authenticated via Supabase")
    return Token(access_token=access_token, token_type=token_type)


@router.post("/verify-otp", response_class=JSONResponse)
def verify_otp(
    request: OTPVerificationRequest,
    auth_service: AuthService = Depends(get_auth_service),
):
    """Verifies the OTP for a business."""
    main_logger.info(f"Verifying OTP for {request.email}")
    return auth_service.verify_otp(request)


@router.post("/resend-otp", response_class=JSONResponse)
def resend_otp(
    request: OTPVerificationRequest,
    auth_service: AuthService = Depends(get_auth_service),
):
    """Resends OTP to the business's email."""
    main_logger.info(f"Resending OTP for {request.email}")
    return auth_service.resend_otp(request)


@router.post("/forget-password", response_class=JSONResponse)
def forget_password(
    request: ForgetPasswordRequest,
    auth_service: AuthService = Depends(get_auth_service),
):
    """Handles forgot password flow and sends OTP for password reset."""
    main_logger.info(f"Password reset requested for {request.email}")
    return auth_service.forget_password(request)


@router.post("/reset-password", response_class=JSONResponse)
def reset_password(
    request: ResetPasswordRequest, auth_service: AuthService = Depends(get_auth_service)
):
    """Resets business password after OTP verification."""
    main_logger.info(f"Resetting password with token")
    return auth_service.reset_password(request)


@router.get("/business/me", response_model=Business)
def get_business_profile(current_business: Business = Depends(get_current_business)):
    """Fetches the logged-in business's profile."""
    main_logger.info(f"Fetching profile for {current_business.email}")
    return current_business


@router.post("/validate-timeglobe-key", response_model=TimeGlobeAuthKeyResponse)
def validate_timeglobe_key(
    request: TimeGlobeAuthKeyRequest,
    current_business: Business = Depends(get_current_business),
    auth_service: AuthService = Depends(get_auth_service),
):
    """Validates TimeGlobe API key and updates the business record if valid."""
    main_logger.info(f"Validating TimeGlobe API key for {current_business.email}")
    
    # If no auth_key provided, check if business already has valid credentials
    if not request.auth_key:
        if current_business.customer_cd and current_business.timeglobe_auth_key:
            return {
                "valid": True,
                "customer_cd": current_business.customer_cd,
                "message": "TimeGlobe authentication key already validated"
            }
        return {
            "valid": False,
            "message": "No TimeGlobe authentication key provided"
        }
    
    # Normal validation with auth_key
    result = auth_service.validate_timeglobe_auth_key(request.auth_key, current_business.email)
    return result


@router.get("/business/timeglobe-key", response_model=dict)
def get_timeglobe_auth_key(current_business: Business = Depends(get_current_business)):
    """Get the TimeGlobe auth key and customer_cd for the logged-in business."""
    main_logger.info(f"Fetching TimeGlobe key for {current_business.email}")
    return {
        "timeglobe_auth_key": current_business.timeglobe_auth_key,
        "customer_cd": current_business.customer_cd
    }


# Add a new schema that includes email for public validation
# class PublicTimeGlobeAuthKeyRequest(BaseModel):
#     auth_key: Optional[str] = None
#     email: EmailStr

# @router.post("/public/validate-timeglobe-key", response_model=TimeGlobeAuthKeyResponse)
# def validate_timeglobe_key_public(
#     request: PublicTimeGlobeAuthKeyRequest,
#     auth_service: AuthService = Depends(get_auth_service),
# ):
#     """Validates TimeGlobe API key without requiring authentication."""
#     main_logger.info(f"Validating TimeGlobe API key publicly for {request.email}")
    
#     # If no auth_key provided, check if business already has valid credentials
#     if not request.auth_key:
#         # Check if business exists and has TimeGlobe credentials
#         business = auth_service.business_repository.get_by_email(request.email)
#         if business and business.customer_cd and business.timeglobe_auth_key:
#             return {


@router.post("/update-business-info", response_model=dict)
def update_business_info(
    business_info_update: BusinessInfoUpdate,
    current_business: Business = Depends(get_current_business),
    auth_service: AuthService = Depends(get_auth_service),
):
    """Updates business information."""
    main_logger.info(f"Updating business information for {current_business.email}")
    try:
        result = auth_service.update_business_info(current_business, business_info_update)
        main_logger.info(f"Business information updated successfully for {current_business.email}")
        return result
    except Exception as e:
        main_logger.error(f"Failed to update business information for {current_business.email}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/delete-business-info", response_model=dict)
def delete_business_info(
    fields: BusinessInfoDelete,
    current_business: Business = Depends(get_current_business),
    auth_service: AuthService = Depends(get_auth_service),
):
    """Deletes specific business information fields."""
    main_logger.info(f"Deleting business information fields for {current_business.email}: {fields.fields}")
    try:
        result = auth_service.delete_business_info_fields(current_business, fields.fields)
        main_logger.info(f"Business information fields deleted successfully for {current_business.email}")
        return result
    except Exception as e:
        main_logger.error(f"Failed to delete business information fields: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/business/info", response_model=Business)
def get_business_info(current_business: Business = Depends(get_current_business)):
    """Gets the complete business information."""
    main_logger.info(f"Fetching business information for {current_business.email}")
    return current_business


@router.post("/test-email")
async def test_email_configuration(
    recipient_email: str,
    current_business: Business = Depends(get_current_business)
):
    """
    Test endpoint to verify email configuration is working.
    Only accessible by authenticated users.
    """
    main_logger.info(f"Testing email configuration for business: {current_business.business_name}")
    
    try:
        # Send a test email
        email_sent = email_util.send_email(
            recipient_email=recipient_email,
            subject="Email Configuration Test - TimeGlobe",
            body=f"""Hello {current_business.business_name},

This is a test email to verify that the email configuration is working correctly.

Email sent from: TimeGlobe System
Business: {current_business.business_name}
Email: {current_business.email}
Test performed at: {time.strftime('%Y-%m-%d %H:%M:%S')}

If you received this email, the configuration is working properly!

Best regards,
TimeGlobe Team""",
            sender_name="TimeGlobe Test"
        )
        
        if email_sent:
            main_logger.info(f"Test email sent successfully to {recipient_email}")
            return {
                "success": True,
                "message": f"Test email sent successfully to {recipient_email}",
                "smtp_server": settings.SMTP_SERVER,
                "smtp_port": settings.SMTP_PORT,
                "email_from": settings.EMAIL_FROM
            }
        else:
            main_logger.error(f"Failed to send test email to {recipient_email}")
            return {
                "success": False,
                "message": "Failed to send test email. Check server logs for details.",
                "smtp_server": settings.SMTP_SERVER,
                "smtp_port": settings.SMTP_PORT,
                "email_from": settings.EMAIL_FROM
            }
            
    except Exception as e:
        main_logger.error(f"Error in test email endpoint: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Email test failed: {str(e)}"
        )


@router.get("/debug/reset-tokens")
def debug_reset_tokens(
    current_business: Business = Depends(get_current_business),
    auth_service: AuthService = Depends(get_auth_service)
):
    """
    Debug endpoint to show active reset tokens.
    Only accessible by authenticated users.
    """
    main_logger.info(f"Debug reset tokens requested by {current_business.email}")
    
    # Clean up expired tokens first
    auth_service._cleanup_expired_reset_tokens()
    
    # Get all active reset tokens from database
    reset_tokens = auth_service.db.query(ResetToken).filter(
        ResetToken.used_at.is_(None)
    ).all()
    
    current_time = datetime.utcnow()
    token_info = []
    
    for token in reset_tokens:
        token_info.append({
            "token_preview": token.token[:8] + "...",
            "business_id": token.business_id,
            "created_at": token.created_at.strftime('%Y-%m-%d %H:%M:%S UTC'),
            "expires_at": token.expires_at.strftime('%Y-%m-%d %H:%M:%S UTC'),
            "is_expired": token.is_expired,
            "is_used": token.is_used,
            "seconds_until_expiry": max(0, int((token.expires_at - current_time).total_seconds()))
        })
    
    return {
        "total_tokens": len(reset_tokens),
        "current_time": current_time.strftime('%Y-%m-%d %H:%M:%S UTC'),
        "tokens": token_info
    }
