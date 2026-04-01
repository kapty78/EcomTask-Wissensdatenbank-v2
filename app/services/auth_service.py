from typing import Optional, Dict, Any
from fastapi import HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from ..repositories.business_repository import BusinessRepository
from ..schemas.auth import (
    BusinessCreate,
    OTPVerificationRequest,
    ResetPasswordRequest,
    Business,
    ForgetPasswordRequest,
)
from ..models.business_model import Business
from ..models.reset_token import ResetToken
from ..core.config import settings
from ..utils import email_util
from ..services.timeglobe_service import TimeGlobeService
import secrets, string, time
from uuid import uuid4
from datetime import datetime
from ..logger import main_logger
import httpx

# OAuth2 setup
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

otp_storage = {}


class AuthService:
    def __init__(self, business_repository: BusinessRepository, db: Session = None):
        self.business_repository = business_repository
        self.db = db or business_repository.db

    # ------------------------------------------------------------------
    # Supabase helpers
    # ------------------------------------------------------------------

    def _supabase_enabled(self) -> bool:
        try:
            from ..core.database_manager import db_manager

            return db_manager.storage_mode.value in ["supabase", "dual"]
        except Exception:
            return False

    def _sync_reset_token_to_supabase(self, token: ResetToken) -> None:
        if not self._supabase_enabled():
            return
        try:
            from ..repositories.supabase_repository import supabase_repository

            supabase_repository.create_reset_token({
                "id": token.id,
                "token": token.token,
                "business_id": token.business_id,
                "created_at": token.created_at,
                "expires_at": token.expires_at,
                "used_at": token.used_at,
            })
        except Exception as exc:
            main_logger.warning(f"Failed to sync reset token {token.id} to Supabase: {exc}")

    def _delete_reset_token_from_supabase(self, token_id: str) -> None:
        if not self._supabase_enabled():
            return
        try:
            from ..repositories.supabase_repository import supabase_repository

            supabase_repository.delete_reset_token(token_id)
        except Exception as exc:
            main_logger.warning(f"Failed to delete reset token {token_id} in Supabase: {exc}")

    def _delete_expired_tokens_from_supabase(self, cutoff: datetime) -> None:
        if not self._supabase_enabled():
            return
        try:
            from ..repositories.supabase_repository import supabase_repository

            supabase_repository.delete_expired_reset_tokens(cutoff)
        except Exception as exc:
            main_logger.warning(f"Failed to purge expired reset tokens in Supabase: {exc}")

    # ------------------------------------------------------------------
    # Supabase auth helpers
    # ------------------------------------------------------------------

    def _base_supabase_url(self) -> Optional[str]:
        if not settings.SUPABASE_URL:
            main_logger.warning("SUPABASE_URL is not configured")
            return None
        return settings.SUPABASE_URL.rstrip("/")

    def _supabase_anon_headers(self) -> Optional[Dict[str, str]]:
        api_key = settings.SUPABASE_ANON_KEY or settings.SUPABASE_SERVICE_ROLE_KEY
        if not api_key:
            main_logger.warning("Supabase anon key not configured")
            return None
        return {
            "apikey": api_key,
            "Content-Type": "application/json",
        }

    def _supabase_admin_headers(self) -> Optional[Dict[str, str]]:
        service_key = settings.SUPABASE_SERVICE_ROLE_KEY
        if not service_key:
            main_logger.warning("Supabase service role key not configured; skipping admin operation")
            return None
        return {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def supabase_sign_in(self, email: str, password: str) -> Dict[str, Any]:
        base_url = self._base_supabase_url()
        headers = self._supabase_anon_headers()

        if not base_url or not headers:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Supabase authentication is not configured")

        payload = {"email": email, "password": password}

        try:
            response = httpx.post(
                f"{base_url}/auth/v1/token",
                params={"grant_type": "password"},
                headers=headers,
                json=payload,
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            main_logger.error(f"Supabase sign-in failed: {exc}")
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication service unavailable")

        if response.status_code != status.HTTP_200_OK:
            main_logger.warning(
                "Supabase sign-in failed for %s: %s - %s",
                email,
                response.status_code,
                response.text,
            )
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return response.json()

    def _get_supabase_user_from_token(self, access_token: str) -> Dict[str, Any]:
        base_url = self._base_supabase_url()
        api_key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY

        if not base_url or not api_key:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Supabase authentication is not configured")

        headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {access_token}",
        }

        try:
            response = httpx.get(
                f"{base_url}/auth/v1/user",
                headers=headers,
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            main_logger.error(f"Failed to verify Supabase token: {exc}")
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Authentication service unavailable")

        if response.status_code == status.HTTP_200_OK:
            return response.json()

        if response.status_code == status.HTTP_401_UNAUTHORIZED:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")

        main_logger.error(
            "Unexpected Supabase verify response: %s - %s",
            response.status_code,
            response.text,
        )
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to validate authentication token")

    def _ensure_supabase_user(self, email: str, password: str) -> None:
        base_url = self._base_supabase_url()
        headers = self._supabase_admin_headers()

        if not base_url or not headers:
            return

        payload = {
            "email": email,
            "password": password,
            "email_confirm": True,
        }

        try:
            response = httpx.post(
                f"{base_url}/auth/v1/admin/users",
                headers=headers,
                json=payload,
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            main_logger.error(f"Failed to create Supabase user for {email}: {exc}")
            return

        if response.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED):
            main_logger.info(f"Supabase auth user created for {email}")
        elif response.status_code in (status.HTTP_409_CONFLICT, status.HTTP_422_UNPROCESSABLE_ENTITY):
            main_logger.info(f"Supabase auth user already exists for {email}")
        else:
            main_logger.warning(
                "Could not create Supabase user for %s: %s - %s",
                email,
                response.status_code,
                response.text,
            )

    def _get_supabase_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        base_url = self._base_supabase_url()
        headers = self._supabase_admin_headers()

        if not base_url or not headers:
            return None

        try:
            response = httpx.get(
                f"{base_url}/auth/v1/admin/users",
                headers=headers,
                params={"email": email},
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            main_logger.error(f"Failed to lookup Supabase user {email}: {exc}")
            return None

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            users = data.get("users") if isinstance(data, dict) else None
            if isinstance(users, list) and users:
                return users[0]
            main_logger.warning(f"Supabase user lookup returned no results for {email}")
            return None

        if response.status_code == status.HTTP_404_NOT_FOUND:
            return None

        main_logger.warning(
            "Supabase user lookup unexpected response for %s: %s - %s",
            email,
            response.status_code,
            response.text,
        )
        return None

    def _update_supabase_password(self, email: str, new_password: str) -> None:
        base_url = self._base_supabase_url()
        headers = self._supabase_admin_headers()

        if not base_url or not headers:
            return

        user = self._get_supabase_user_by_email(email)
        if not user:
            main_logger.warning(f"No Supabase user found for {email}; skipping password update")
            return

        user_id = user.get("id")
        if not user_id:
            main_logger.warning(f"Supabase user response for {email} missing id")
            return

        try:
            response = httpx.patch(
                f"{base_url}/auth/v1/admin/users/{user_id}",
                headers=headers,
                json={"password": new_password},
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            main_logger.error(f"Failed to update Supabase password for {email}: {exc}")
            return

        if response.status_code not in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT):
            main_logger.warning(
                "Unexpected response updating Supabase password for %s: %s - %s",
                email,
                response.status_code,
                response.text,
            )

    def create_business(self, business_data: BusinessCreate) -> dict:
        main_logger.debug(f"Creating business with email: {business_data.email}")

        # check if email is already registered
        existing_business = self.business_repository.get_by_email(business_data.email)
        if existing_business:
            main_logger.warning(f"Email {business_data.email} already exists")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
        
        # We no longer validate TimeGlobe auth key during registration

        expiry = time.time() + 300  # OTP valid for 5 minutes
        otp = self.generate_otp()
        otp_storage[business_data.email] = {
            "otp": otp,
            "expiry": expiry,
            "data": {
                "business_name": business_data.business_name,
                "email": business_data.email,
                "password": business_data.password,
                "phone_number": business_data.phone_number,
                # timeglobe_auth_key is removed from initial registration
                # No customer_cd here since we haven't validated the auth key yet
            },
        }

        main_logger.debug(f"OTP generated for {business_data.email}: {otp}")
        
        # Send OTP email using the new email utility
        email_sent = email_util.send_otp_email(
            recipient_email=business_data.email,
            otp=otp,
            business_name=business_data.business_name
        )
        
        if not email_sent:
            main_logger.error(f"Failed to send OTP email to {business_data.email}")
            raise HTTPException(
                status_code=500,
                detail="Failed to send OTP email. Please try again or contact support."
            )
        
        main_logger.info(f"OTP sent successfully to {business_data.email}")

        return {
            "message": "OTP sent to your email. Please verify to complete registration."
        }

    def get_current_business(self, token: str) -> Business:
        main_logger.debug("Fetching current business from Supabase token")

        user = self._get_supabase_user_from_token(token)
        business_email = user.get("email") if user else None

        if not business_email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        business = self.business_repository.get_by_email(business_email)
        if business is None:
            main_logger.warning(f"No local business record for Supabase user {business_email}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Business not registered",
            )

        main_logger.info(f"Current business fetched via Supabase token: {business_email}")
        return business

    def generate_otp(self, length=6):
        otp = "".join(secrets.choice(string.digits) for _ in range(length))
        main_logger.debug(f"Generated OTP: {otp}")
        return otp

    def verify_otp(self, request: OTPVerificationRequest):
        main_logger.debug(f"Verifying OTP for email: {request.email}")
        stored_otp = otp_storage.get(request.email)
        if not stored_otp:
            main_logger.warning(f"No OTP found for email: {request.email}")
            raise HTTPException(status_code=400, detail="No OTP found for this email.")
        if time.time() > stored_otp["expiry"]:
            otp_storage.pop(request.email, None)
            main_logger.warning(f"OTP expired for email: {request.email}")
            raise HTTPException(status_code=400, detail="OTP expired!")
        if stored_otp["otp"] != request.otp:
            main_logger.warning(f"Invalid OTP for email: {request.email}")
            raise HTTPException(status_code=400, detail="Invalid OTP")
            
        business_data = stored_otp["data"]
        
        # If TimeGlobe auth key provided in request, use it
        timeglobe_auth_key = request.timeglobe_auth_key or business_data.get("timeglobe_auth_key")
        customer_cd = request.customer_cd or business_data.get("customer_cd")
        
        # Create business using repository
        new_business = self.business_repository.create_business(
            business_name=business_data["business_name"],
            email=business_data["email"],
            password=business_data["password"],
            phone_number=business_data["phone_number"],
            timeglobe_auth_key=timeglobe_auth_key,
            customer_cd=customer_cd
        )

        otp_storage.pop(request.email)
        main_logger.info(f"Business registered successfully: {request.email}")

        self._ensure_supabase_user(business_data["email"], business_data["password"])
        
        # If TimeGlobe API key and customerCd are provided during registration
        if timeglobe_auth_key and customer_cd:
            main_logger.info(f"Business registered with TimeGlobe integration: {request.email}, customerCd: {customer_cd}")
            return {
                "message": "Registration Successful",
                "timeglobe_connected": True,
                "customer_cd": customer_cd
            }
        
        return {
            "message": "Registration Successful",
            "timeglobe_connected": False
        }

    def resend_otp(self, request: OTPVerificationRequest):
        main_logger.debug(f"Resending OTP for email: {request.email}")
        stored_otp_data = otp_storage.get(request.email)
        if not stored_otp_data:
            main_logger.warning(
                f"No registration process found for email: {request.email}"
            )
            raise HTTPException(
                status_code=404, detail="No registration process found for this email."
            )

        otp = self.generate_otp()
        expiry = time.time() + 300  # New OTP valid for 5 minutes

        otp_storage[request.email]["otp"] = otp
        otp_storage[request.email]["expiry"] = expiry
        
        # Get business name from stored data for personalization
        business_name = stored_otp_data.get("data", {}).get("business_name", "Business Owner")
        
        # Send OTP email using the new email utility
        email_sent = email_util.send_otp_email(
            recipient_email=request.email,
            otp=otp,
            business_name=business_name
        )
        
        if not email_sent:
            main_logger.error(f"Failed to resend OTP email to {request.email}")
            raise HTTPException(
                status_code=500,
                detail="Failed to resend OTP email. Please try again or contact support."
            )

        main_logger.info(f"OTP resent successfully to {request.email}")
        return {
            "message": "OTP has been resent to your email. Please verify to complete registration."
        }

    def _cleanup_expired_reset_tokens(self):
        """Remove expired reset tokens from database"""
        try:
            cutoff = datetime.utcnow()
            expired_count = self.db.query(ResetToken).filter(
                ResetToken.expires_at < cutoff
            ).delete()
            if expired_count > 0:
                self.db.commit()
                main_logger.debug(f"Cleaned up {expired_count} expired reset tokens")
                self._delete_expired_tokens_from_supabase(cutoff)
        except Exception as e:
            self.db.rollback()
            main_logger.error(f"Error cleaning up expired tokens: {e}")

    def forget_password(self, request: ForgetPasswordRequest):
        """Handles forgot password flow and sends OTP for password reset."""
        main_logger.debug(f"Processing forget password request for email: {request.email}")
        
        # Clean up expired tokens first
        self._cleanup_expired_reset_tokens()
        
        # Check if business exists
        business = self.business_repository.get_by_email(request.email)
        if not business:
            main_logger.warning(f"No business found with email: {request.email}")
            raise HTTPException(status_code=404, detail="No business found with this email.")
        
        try:
            # Generate a unique reset token
            reset_token_str = str(uuid4())
            
            # Create and save reset token to database
            reset_token = ResetToken(
                token=reset_token_str,
                business_id=business.id
            )
            
            self.db.add(reset_token)
            self.db.commit()
            self._sync_reset_token_to_supabase(reset_token)
            
            main_logger.info(f"Generated reset token for business {business.email}: {reset_token_str[:8]}... (expires in 24h)")
            
            # Construct the reset password URL
            reset_link = f"{settings.FRONTEND_RESET_PASSWORD_URL}/{business.id}/{reset_token_str}"
            
            # Send password reset email using the new email utility
            email_sent = email_util.send_password_reset_email(
                recipient_email=business.email,
                reset_link=reset_link,
                business_name=business.business_name
            )
            
            if not email_sent:
                # Remove the token if email failed to send
                self.db.delete(reset_token)
                self.db.commit()
                self._delete_reset_token_from_supabase(reset_token.id)
                main_logger.error(f"Failed to send password reset email to {request.email}")
                raise HTTPException(
                    status_code=500,
                    detail="Failed to send password reset email. Please try again or contact support."
                )
            
            main_logger.info(f"Password reset link sent successfully to {request.email}")
            return {
                "message": "Reset password link has been sent to your email."
            }
            
        except Exception as e:
            self.db.rollback()
            main_logger.error(f"Error creating reset token: {e}")
            raise HTTPException(status_code=500, detail="Failed to process password reset request")

    def reset_password(self, data: ResetPasswordRequest):
        main_logger.info(f"Processing reset password request for token: {data.token[:8]}...")
        
        # Clean up expired tokens first
        self._cleanup_expired_reset_tokens()
        
        try:
            # Find the reset token in database
            reset_token = self.db.query(ResetToken).filter(
                ResetToken.token == data.token,
                ResetToken.used_at.is_(None)
            ).first()
            
            if not reset_token:
                main_logger.warning(f"Reset token not found: {data.token[:8]}...")
                raise HTTPException(
                    status_code=400, detail="Invalid or expired reset token"
                )
            
            # Check if token is expired
            if reset_token.is_expired:
                main_logger.warning(f"Reset token expired: {data.token[:8]}...")
                raise HTTPException(
                    status_code=400, detail="Reset token has expired"
                )
            
            main_logger.info(f"Found valid reset token for business ID: {reset_token.business_id}")
            
            # Get business record
            business = self.business_repository.get_by_id(reset_token.business_id)
            if not business:
                main_logger.error(f"Business not found for ID: {reset_token.business_id}")
                raise HTTPException(status_code=404, detail="Business not found")

            # Update password
            main_logger.info(f"Updating password for business: {business.email}")
            self.business_repository.update_password(reset_token.business_id, data.new_password)

            # Sync password change to Supabase auth
            self._update_supabase_password(business.email, data.new_password)
            
            # Mark token as used
            reset_token.used_at = datetime.utcnow()
            self.db.commit()
            self._sync_reset_token_to_supabase(reset_token)
            
            main_logger.info(f"Password reset successfully for business: {business.email}")
            return {"message": "Password has been reset successfully"}
            
        except HTTPException:
            raise
        except Exception as e:
            self.db.rollback()
            main_logger.error(f"Failed to reset password: {str(e)}")
            raise HTTPException(
                status_code=500, 
                detail="Failed to update password. Please try again."
            )

    def validate_timeglobe_auth_key(self, auth_key: str, business_email: str) -> dict:
        """
        Validates TimeGlobe authentication key and updates the business record if valid
        
        Args:
            auth_key: The TimeGlobe authentication key to validate
            business_email: Email of the business to update with the auth key and customer_cd
            
        Returns:
            dict: Response containing validation result and customer_cd if successful
        """
        main_logger.info(f"Validating TimeGlobe auth key for business: {business_email}")
        
        # If no auth_key provided, return an error
        if not auth_key:
            main_logger.warning(f"No TimeGlobe auth key provided for {business_email}")
            return {
                "valid": False,
                "message": "No TimeGlobe authentication key provided"
            }
        
        # Check if business exists
        business = self.business_repository.get_by_email(business_email)
        
        # If business exists and already has customer_cd and timeglobe_auth_key set
        if business and business.customer_cd and business.timeglobe_auth_key:
            # If the same auth key is being validated, return success immediately
            if business.timeglobe_auth_key == auth_key:
                main_logger.info(f"Business {business_email} already has valid TimeGlobe credentials with customer_cd: {business.customer_cd}")
                return {
                    "valid": True,
                    "customer_cd": business.customer_cd,
                    "message": "TimeGlobe authentication key already validated"
                }
        
        # Validate the auth key via API call
        timeglobe_service = TimeGlobeService()
        validation_result = timeglobe_service.validate_auth_key(auth_key)
        
        if not validation_result.get("valid", False):
            main_logger.warning(f"Invalid TimeGlobe auth key for {business_email}: {validation_result.get('message')}")
            return {
                "valid": False,
                "message": validation_result.get('message', "Invalid TimeGlobe authentication key")
            }
        
        # Get the customer_cd from validation result
        customer_cd = validation_result.get("customer_cd")
        main_logger.info(f"Valid TimeGlobe auth key with customerCd: {customer_cd} for {business_email}")
        
        # Check if business exists and update if it does
        if business:
            # Update the business record with auth key and customer_cd
            self.business_repository.update(
                business.id, 
                {
                    "timeglobe_auth_key": auth_key,
                    "customer_cd": customer_cd
                }
            )
            main_logger.info(f"Updated business record for {business_email} with TimeGlobe auth key and customer_cd: {customer_cd}")
        else:
            # Business doesn't exist yet, just return the validation result
            main_logger.info(f"Business with email {business_email} doesn't exist yet, skipping update")
        
        return {
            "valid": True,
            "customer_cd": customer_cd,
            "message": "TimeGlobe authentication key validated successfully"
        }

    def update_business_info(self, business: Business, info_update) -> dict:
        """
        Update business information with the provided data
        
        Args:
            business: Current business object
            info_update: BusinessInfoUpdate object with fields to update
            
        Returns:
            dict: Status message
        """
        # Convert Pydantic model to dict, excluding None values
        update_data = {k: v for k, v in info_update.dict().items() if v is not None}
        
        if not update_data:
            return {"message": "No data provided for update"}
        
        # Check if trying to update email to an existing one
        if "email" in update_data and update_data["email"] != business.email:
            existing = self.business_repository.get_by_email(update_data["email"])
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered by another business"
                )
        
        # Update business information
        updated_business = self.business_repository.update_business_info(business.id, update_data)
        
        if not updated_business:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Business not found"
            )
        
        return {
            "message": "Business information updated successfully",
            "updated_fields": list(update_data.keys())
        }
    
    def delete_business_info_fields(self, business: Business, fields: list) -> dict:
        """
        Delete specific business information fields
        
        Args:
            business: Current business object
            fields: List of field names to clear
            
        Returns:
            dict: Status message
        """
        # Filter out fields that aren't allowed to be deleted
        protected_fields = ["id", "email", "password", "is_active", "created_at"]
        fields_to_delete = [f for f in fields if f not in protected_fields]
        
        if not fields_to_delete:
            return {"message": "No valid fields provided for deletion"}
        
        # Delete the specified fields
        updated_business = self.business_repository.delete_business_info(business.id, fields_to_delete)
        
        if not updated_business:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Business not found"
            )
        
        return {
            "message": "Business information fields deleted successfully",
            "deleted_fields": fields_to_delete
        }
