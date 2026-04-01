import requests
import json
from typing import Optional, Dict, Any
from ..core.config import settings
from ..models.business_model import Business
from fastapi import HTTPException
from sqlalchemy.orm import Session
from ..logger import main_logger
from ..utils.phone_util import format_phone_number_variants
from ..utils.cache import cached, cache_invalidate
from ..utils.error_handler import retry_with_backoff, circuit_breaker, handle_errors, ErrorSeverity, ErrorCategory


class WhatsAppBusinessService:
    """
    Direct WhatsApp Business API integration service.
    Replaces Dialog360Service with Meta's official WhatsApp Business API.
    """
    
    def __init__(self, db: Session):
        self.logger = main_logger
        self.db = db
        self.base_url = "https://graph.facebook.com/v18.0"

    def _get_business_by_phone(self, phone_number: str) -> Optional[Business]:
        """
        Get the business information based on the phone number.
        OPTIMIZED: Uses single SQL query with IN clause instead of sequential lookups
        Used to retrieve API credentials from DB.
        """
        # Normalize phone number for comparison
        normalized_phone = phone_number
        if phone_number.startswith("whatsapp:"):
            normalized_phone = phone_number.replace("whatsapp:", "")
        
        self.logger.debug(f"Looking for business with number: {normalized_phone}")
        
        try:
            # OPTIMIZATION: Use the phone utility to generate all possible variants
            formats_to_try = format_phone_number_variants(normalized_phone)
            
            # OPTIMIZATION: Use a single query with IN clause instead of sequential queries
            # This reduces database round trips from O(n) to O(1)
            business = (
                self.db.query(Business)
                .filter(Business.whatsapp_number.in_(formats_to_try))
                .first()
            )
            
            if business:
                self.logger.debug(f"Found business with number format: {business.whatsapp_number}")
                return business
            
            # If we got here, no match was found
            self.logger.warning(f"No business found for WhatsApp number: {normalized_phone}")
            
        except Exception as e:
            self.logger.error(f"Error finding business by whatsapp_number: {str(e)}")
            return None
        
        return None

    def _get_api_headers(self, business: Business) -> Dict[str, str]:
        """Return API headers for WhatsApp Business API requests."""
        if not business or not business.api_key:
            raise HTTPException(status_code=400, detail="No API key found for business")
        
        return {
            "Authorization": f"Bearer {business.api_key}",
            "Content-Type": "application/json"
        }

    def _get_phone_number_id(self, business: Business) -> str:
        """Get the phone number ID for WhatsApp Business API."""
        if not business or not business.channel_id:
            raise HTTPException(status_code=400, detail="No phone number ID found for business")
        
        # In direct WhatsApp Business API, channel_id stores the phone_number_id
        return business.channel_id

    @retry_with_backoff(max_retries=3, backoff_factor=2.0, exceptions=(requests.RequestException,))
    @circuit_breaker("whatsapp_api", failure_threshold=5, recovery_timeout=60)
    @handle_errors(severity=ErrorSeverity.HIGH, category=ErrorCategory.EXTERNAL_API)
    def send_message(self, to: str, message: str, business_phone: str) -> Dict[str, Any]:
        """
        Send a WhatsApp message using Meta's WhatsApp Business API.
        
        Args:
            to: Recipient phone number
            message: Message text to send
            business_phone: Business phone number (sender)
            
        Returns:
            Dict containing response data
        """
        # Format recipient number without "whatsapp:" prefix
        if to.startswith("whatsapp:"):
            to = to.replace("whatsapp:", "")
        
        # Ensure number has country code
        if not to.startswith("+"):
            to = f"+{to}"
        
        self.logger.info(f"Sending WhatsApp message to {to}")
        
        try:
            # Get the business record
            business = self._get_business_by_phone(business_phone)
            if not business:
                raise HTTPException(status_code=400, detail="Invalid business phone number")
            
            # Get phone number ID and headers
            phone_number_id = self._get_phone_number_id(business)
            headers = self._get_api_headers(business)
            
            # Construct the message payload
            payload = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {
                    "body": message
                }
            }
            
            # WhatsApp Business API endpoint
            url = f"{self.base_url}/{phone_number_id}/messages"
            
            self.logger.debug(f"Making request to: {url}")
            self.logger.debug(f"Payload: {json.dumps(payload, indent=2)}")
            
            # Make the API request
            response = requests.post(url, headers=headers, json=payload)
            
            if response.status_code in [200, 201]:
                response_data = response.json()
                self.logger.info("WhatsApp message sent successfully")
                self.logger.debug(f"Response data: {response_data}")
                return {
                    "success": True,
                    "message": "Message sent successfully",
                    "data": response_data
                }
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to send WhatsApp message. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to send message: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error sending WhatsApp message: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to send WhatsApp message: {str(e)}"
            )

    def verify_webhook(self, verify_token: str, challenge: str) -> str:
        """
        Verify webhook for WhatsApp Business API.
        Supports both global and business-specific verify tokens.
        
        Args:
            verify_token: Token to verify
            challenge: Challenge string from Facebook
            
        Returns:
            Challenge string if verification successful
        """
        # First check global webhook verify token for backwards compatibility
        global_token = settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        if verify_token == global_token and global_token:
            self.logger.info("Webhook verification successful (global token)")
            return challenge
        
        # Check business-specific verify tokens
        try:
            # Look for a business with this verify token in their profile
            businesses = self.db.query(Business).filter(
                Business.whatsapp_profile.isnot(None)
            ).all()
            
            for business in businesses:
                if business.whatsapp_profile:
                    stored_token = business.whatsapp_profile.get("webhook_verify_token")
                    if stored_token and verify_token == stored_token:
                        self.logger.info(f"Webhook verification successful for business: {business.email}")
                        return challenge
            
            # If no match found
            self.logger.error(f"Webhook verification failed. No matching token found for: {verify_token}")
            raise HTTPException(status_code=403, detail="Webhook verification failed")
            
        except Exception as e:
            self.logger.error(f"Error during webhook verification: {str(e)}")
            raise HTTPException(status_code=403, detail="Webhook verification failed")

    def get_business_profile(self, business_phone: str) -> Dict[str, Any]:
        """
        Get WhatsApp Business profile information.
        
        Args:
            business_phone: Business phone number
            
        Returns:
            Dict containing profile information
        """
        try:
            business = self._get_business_by_phone(business_phone)
            if not business:
                raise HTTPException(status_code=400, detail="Invalid business phone number")
            
            phone_number_id = self._get_phone_number_id(business)
            headers = self._get_api_headers(business)
            
            # WhatsApp Business API endpoint for business profile
            url = f"{self.base_url}/{phone_number_id}/whatsapp_business_profile"
            
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                profile_data = response.json()
                self.logger.info(f"Retrieved business profile: {profile_data}")
                return profile_data
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to get business profile. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to get business profile: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error getting business profile: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get business profile: {str(e)}"
            )

    def update_business_profile(self, business_phone: str, profile_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update WhatsApp Business profile information.
        
        Args:
            business_phone: Business phone number
            profile_data: Profile data to update
            
        Returns:
            Dict containing response data
        """
        try:
            business = self._get_business_by_phone(business_phone)
            if not business:
                raise HTTPException(status_code=400, detail="Invalid business phone number")
            
            phone_number_id = self._get_phone_number_id(business)
            headers = self._get_api_headers(business)
            
            # WhatsApp Business API endpoint for updating business profile
            url = f"{self.base_url}/{phone_number_id}/whatsapp_business_profile"
            
            response = requests.post(url, headers=headers, json=profile_data)
            
            if response.status_code in [200, 201]:
                response_data = response.json()
                self.logger.info(f"Business profile updated successfully: {response_data}")
                return response_data
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to update business profile. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to update business profile: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error updating business profile: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to update business profile: {str(e)}"
            )

    def get_phone_numbers(self, waba_id: str, access_token: str) -> Dict[str, Any]:
        """
        Get phone numbers associated with a WhatsApp Business Account.
        
        Args:
            waba_id: WhatsApp Business Account ID
            access_token: Access token for the WABA
            
        Returns:
            Dict containing phone numbers data
        """
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            url = f"{self.base_url}/{waba_id}/phone_numbers"
            
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                phone_data = response.json()
                self.logger.info(f"Retrieved phone numbers: {phone_data}")
                return phone_data
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to get phone numbers. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to get phone numbers: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error getting phone numbers: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get phone numbers: {str(e)}"
            )

    # Legacy method name compatibility
    def send_whatsapp(self, to: str, message: str, business_phone: str) -> Dict[str, Any]:
        """Legacy method name for backward compatibility."""
        return self.send_message(to, message, business_phone)

    def _get_system_headers(self) -> Dict[str, str]:
        """Return API headers using system token for system-level operations."""
        return {
            "Authorization": f"Bearer {settings.WHATSAPP_SYSTEM_TOKEN}",
            "Content-Type": "application/json"
        }

    def request_phone_code(self, phone_number_id: str, access_token: str = None) -> Dict[str, Any]:
        """
        Request OTP code for phone number registration.
        Uses system token for system-level operations.
        
        Args:
            phone_number_id: Phone number ID to register
            access_token: Access token (optional, uses system token by default)
            
        Returns:
            Dict containing response data
        """
        try:
            # Use system token for phone registration operations
            headers = self._get_system_headers() if not access_token else {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            url = f"{self.base_url}/{phone_number_id}/request_code"
            
            payload = {
                "code_method": "SMS",  # or "VOICE"
                "language": "en"
            }
            
            self.logger.info(f"Requesting phone code for {phone_number_id}")
            
            response = requests.post(url, headers=headers, json=payload)
            
            if response.status_code == 200:
                response_data = response.json()
                self.logger.info(f"Phone code requested successfully: {response_data}")
                return {
                    "success": True,
                    "message": "OTP code sent successfully",
                    "data": response_data
                }
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to request phone code. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to request phone code: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error requesting phone code: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to request phone code: {str(e)}"
            )

    def verify_phone_code(self, phone_number_id: str, access_token: str, code: str) -> Dict[str, Any]:
        """
        Verify OTP code for phone number registration.
        
        Args:
            phone_number_id: Phone number ID to verify
            access_token: Access token for authentication
            code: OTP code to verify
            
        Returns:
            Dict containing response data
        """
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            url = f"{self.base_url}/{phone_number_id}/verify_code"
            
            payload = {
                "code": code
            }
            
            self.logger.info(f"Verifying phone code for {phone_number_id}")
            
            response = requests.post(url, headers=headers, json=payload)
            
            if response.status_code == 200:
                response_data = response.json()
                self.logger.info(f"Phone code verified successfully: {response_data}")
                return {
                    "success": True,
                    "message": "OTP code verified successfully",
                    "data": response_data
                }
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to verify phone code. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to verify phone code: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error verifying phone code: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to verify phone code: {str(e)}"
            )

    def register_phone_number(self, phone_number_id: str, access_token: str, code: str, pin: str = None) -> Dict[str, Any]:
        """
        Register phone number with WhatsApp Business API.
        
        Args:
            phone_number_id: Phone number ID to register
            access_token: Access token for authentication
            code: OTP code for verification
            pin: Optional PIN for 2-step verification
            
        Returns:
            Dict containing response data including connection status
        """
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            url = f"{self.base_url}/{phone_number_id}/register"
            
            payload = {
                "messaging_product": "whatsapp",
                "code": code
            }
            
            if pin:
                payload["pin"] = pin
            
            self.logger.info(f"Registering phone number {phone_number_id}")
            
            response = requests.post(url, headers=headers, json=payload)
            
            if response.status_code == 200:
                response_data = response.json()
                self.logger.info(f"Phone number registered successfully: {response_data}")
                
                # Check if phone is connected
                is_connected = response_data.get("success", False)
                
                return {
                    "success": True,
                    "message": "Phone number registered successfully",
                    "is_connected": is_connected,
                    "data": response_data
                }
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to register phone number. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to register phone number: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error registering phone number: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to register phone number: {str(e)}"
            )

    def check_phone_status(self, waba_id: str, access_token: str) -> Dict[str, Any]:
        """
        Check the status of phone numbers in a WhatsApp Business Account.
        Uses system token for system-level operations.
        
        Args:
            waba_id: WhatsApp Business Account ID
            access_token: Access token for authentication
            
        Returns:
            Dict containing phone numbers and their status
        """
        try:
            # Use system token for WABA-level operations
            headers = self._get_system_headers()
            
            url = f"{self.base_url}/{waba_id}/phone_numbers"
            
            self.logger.info(f"Checking phone status for WABA {waba_id}")
            
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                response_data = response.json()
                phone_numbers = response_data.get("data", [])
                
                # Process phone number statuses
                phone_statuses = []
                for phone in phone_numbers:
                    phone_statuses.append({
                        "id": phone.get("id"),
                        "display_phone_number": phone.get("display_phone_number"),
                        "verified_name": phone.get("verified_name"),
                        "status": phone.get("status", "UNKNOWN"),
                        "quality_rating": phone.get("quality_rating"),
                        "messaging_limit_tier": phone.get("messaging_limit_tier")
                    })
                
                self.logger.info(f"Retrieved {len(phone_statuses)} phone numbers")
                
                return {
                    "success": True,
                    "phone_numbers": phone_statuses,
                    "total_count": len(phone_statuses)
                }
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to check phone status. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to check phone status: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error checking phone status: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to check phone status: {str(e)}"
            )

    def wait_for_connection(self, waba_id: str, access_token: str, phone_number_id: str, timeout_minutes: int = 10) -> Dict[str, Any]:
        """
        Wait for phone number to be connected and ready for messaging.
        
        Args:
            waba_id: WhatsApp Business Account ID
            access_token: Access token for authentication
            phone_number_id: Phone number ID to check
            timeout_minutes: Maximum time to wait (default: 10 minutes)
            
        Returns:
            Dict containing connection status
        """
        import time
        
        start_time = time.time()
        timeout_seconds = timeout_minutes * 60
        check_interval = 30  # Check every 30 seconds
        
        self.logger.info(f"Waiting for phone {phone_number_id} to connect (timeout: {timeout_minutes} minutes)")
        
        while (time.time() - start_time) < timeout_seconds:
            try:
                # Check current status
                status_result = self.check_phone_status(waba_id, access_token)
                
                if status_result.get("success"):
                    phone_numbers = status_result.get("phone_numbers", [])
                    
                    # Find our specific phone number
                    for phone in phone_numbers:
                        if phone.get("id") == phone_number_id:
                            status = phone.get("status", "").upper()
                            
                            if status == "CONNECTED":
                                self.logger.info(f"Phone {phone_number_id} is now CONNECTED")
                                return {
                                    "success": True,
                                    "connected": True,
                                    "status": status,
                                    "phone_data": phone,
                                    "wait_time_seconds": int(time.time() - start_time)
                                }
                            else:
                                self.logger.info(f"Phone {phone_number_id} status: {status} - waiting...")
                
                # Wait before next check
                time.sleep(check_interval)
                
            except Exception as e:
                self.logger.error(f"Error during wait check: {str(e)}")
                time.sleep(check_interval)
        
        # Timeout reached
        self.logger.warning(f"Timeout reached waiting for phone {phone_number_id} to connect")
        return {
            "success": False,
            "connected": False,
            "message": f"Timeout reached after {timeout_minutes} minutes",
            "wait_time_seconds": int(time.time() - start_time)
        }

    def upload_profile_photo(self, phone_number_id: str, access_token: str, photo_base64: str) -> Dict[str, Any]:
        """
        Upload profile photo for WhatsApp Business number.
        
        Args:
            phone_number_id: Phone number ID
            access_token: Access token for authentication
            photo_base64: Base64 encoded photo data
            
        Returns:
            Dict containing upload response
        """
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            url = f"{self.base_url}/{phone_number_id}/whatsapp_business_profile"
            
            payload = {
                "messaging_product": "whatsapp",
                "profile_picture_url": f"data:image/jpeg;base64,{photo_base64}"
            }
            
            self.logger.info(f"Uploading profile photo for {phone_number_id}")
            
            response = requests.post(url, headers=headers, json=payload)
            
            if response.status_code in [200, 201]:
                response_data = response.json()
                self.logger.info(f"Profile photo uploaded successfully: {response_data}")
                return {
                    "success": True,
                    "message": "Profile photo uploaded successfully",
                    "data": response_data
                }
            else:
                error_data = response.json() if response.content else {}
                error_message = error_data.get("error", {}).get("message", "Unknown error")
                self.logger.error(f"Failed to upload profile photo. Status: {response.status_code}, Error: {error_message}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to upload profile photo: {error_message}"
                )
                
        except Exception as e:
            self.logger.exception(f"Error uploading profile photo: {str(e)}")
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Failed to upload profile photo: {str(e)}"
            )

    def generate_whatsapp_link(self, phone_number: str, message: str = None) -> str:
        """
        Generate a WhatsApp link for direct messaging.
        
        Args:
            phone_number: Target phone number
            message: Optional pre-filled message
            
        Returns:
            WhatsApp link URL
        """
        # Clean phone number
        clean_number = phone_number.replace("+", "").replace(" ", "").replace("-", "")
        
        base_url = "https://wa.me/"
        link = f"{base_url}{clean_number}"
        
        if message:
            import urllib.parse
            encoded_message = urllib.parse.quote(message)
            link += f"?text={encoded_message}"
        
        self.logger.info(f"Generated WhatsApp link: {link}")
        return link 

    def get_whatsapp_business_phone_numbers(self, waba_id: str, access_token: str) -> Dict[str, Any]:
        """
        Get phone numbers associated with a WhatsApp Business Account.
        
        Args:
            waba_id: WhatsApp Business Account ID
            access_token: Access token for the business
            
        Returns:
            Dict containing phone numbers data
        """
        try:
            url = f"https://graph.facebook.com/v22.0/{waba_id}/phone_numbers"
            
            params = {
                "fields": "id,cc,country_dial_code,display_phone_number,verified_name,status,quality_rating,search_visibility,platform_type,code_verification_status",
                "access_token": access_token
            }
            
            self.logger.info(f"Getting phone numbers for WABA ID: {waba_id}")
            response = requests.get(url, params=params)
            
            if response.status_code == 200:
                phone_data = response.json()
                self.logger.info(f"Successfully retrieved phone numbers: {phone_data}")
                return {
                    "success": True,
                    "data": phone_data
                }
            else:
                error_data = response.json() if response.content else {}
                self.logger.error(f"Failed to get phone numbers. Status: {response.status_code}, Error: {error_data}")
                return {
                    "success": False,
                    "error": error_data,
                    "status_code": response.status_code
                }
                
        except Exception as e:
            self.logger.error(f"Exception getting phone numbers: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def subscribe_app_to_waba(self, waba_id: str, access_token: str) -> Dict[str, Any]:
        """
        Subscribe the app to a WhatsApp Business Account to receive webhooks.
        
        Args:
            waba_id: WhatsApp Business Account ID
            access_token: Access token for the business
            
        Returns:
            Dict containing subscription result
        """
        try:
            url = f"https://graph.facebook.com/v22.0/{waba_id}/subscribed_apps"
            
            request_data = {
                "access_token": access_token
            }
            
            self.logger.info(f"Subscribing app to WABA ID: {waba_id}")
            response = requests.post(url, json=request_data)
            
            if response.status_code == 200:
                result = response.json()
                self.logger.info(f"Successfully subscribed app to WABA: {result}")
                return {
                    "success": True,
                    "data": result
                }
            else:
                error_data = response.json() if response.content else {}
                self.logger.error(f"Failed to subscribe app to WABA. Status: {response.status_code}, Error: {error_data}")
                return {
                    "success": False,
                    "error": error_data,
                    "status_code": response.status_code
                }
                
        except Exception as e:
            self.logger.error(f"Exception subscribing app to WABA: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def register_phone_number_on_cloud_api(self, phone_number_id: str, access_token: str, pin: str = "000000") -> Dict[str, Any]:
        """
        Register a phone number on WhatsApp Cloud API.
        Follows the official Facebook API specification:
        https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration/
        
        Args:
            phone_number_id: Phone number ID to register
            access_token: Access token for the business
            pin: 6-digit PIN for registration (default: 000000)
            
        Returns:
            Dict containing registration result
        """
        try:
            url = f"https://graph.facebook.com/v22.0/{phone_number_id}/register"
            
            # Request body as per Facebook API specification
            request_data = {
                "messaging_product": "whatsapp",
                "pin": pin
            }
            
            # Headers with authorization
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            self.logger.info(f"Registering phone number ID: {phone_number_id} on WhatsApp Cloud API")
            self.logger.info(f"Registration URL: {url}")
            self.logger.info(f"Request data: {request_data}")
            
            response = requests.post(url, json=request_data, headers=headers)
            
            if response.status_code == 200:
                result = response.json()
                self.logger.info(f"Successfully registered phone number: {result}")
                return {
                    "success": True,
                    "data": result
                }
            else:
                error_data = response.json() if response.content else {}
                self.logger.error(f"Failed to register phone number. Status: {response.status_code}, Error: {error_data}")
                return {
                    "success": False,
                    "error": error_data,
                    "status_code": response.status_code
                }
                
        except Exception as e:
            self.logger.error(f"Exception registering phone number: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def complete_phone_registration_flow(self, waba_id: str, access_token: str, pin: str = "000000") -> Dict[str, Any]:
        """
        Complete the entire phone registration flow:
        1. Get phone numbers from WABA
        2. Subscribe app to WABA
        3. Register phone numbers on Cloud API
        
        Args:
            waba_id: WhatsApp Business Account ID
            access_token: Access token for the business
            pin: 6-digit PIN for registration
            
        Returns:
            Dict containing complete flow result
        """
        try:
            self.logger.info(f"Starting complete phone registration flow for WABA: {waba_id}")
            
            # Step 1: Get phone numbers
            phone_numbers_result = self.get_whatsapp_business_phone_numbers(waba_id, access_token)
            if not phone_numbers_result.get("success"):
                return {
                    "success": False,
                    "step": "get_phone_numbers",
                    "error": phone_numbers_result.get("error"),
                    "message": "Failed to get phone numbers from WABA"
                }
            
            phone_numbers_data = phone_numbers_result["data"]["data"]
            if not phone_numbers_data:
                return {
                    "success": False,
                    "step": "get_phone_numbers",
                    "error": "No phone numbers found in WABA",
                    "message": "No phone numbers associated with this WhatsApp Business Account"
                }
            
            # Step 2: Subscribe app to WABA
            subscription_result = self.subscribe_app_to_waba(waba_id, access_token)
            if not subscription_result.get("success"):
                return {
                    "success": False,
                    "step": "subscribe_app",
                    "error": subscription_result.get("error"),
                    "message": "Failed to subscribe app to WABA",
                    "phone_numbers": phone_numbers_data
                }
            
            # Step 3: Register each phone number
            registration_results = []
            for phone_number in phone_numbers_data:
                phone_number_id = phone_number["id"]
                self.logger.info(f"Registering phone number ID: {phone_number_id}")
                
                registration_result = self.register_phone_number_on_cloud_api(phone_number_id, access_token, pin)
                registration_results.append({
                    "phone_number_id": phone_number_id,
                    "display_phone_number": phone_number.get("display_phone_number"),
                    "registration_result": registration_result
                })
            
            # Check if all registrations were successful
            successful_registrations = [r for r in registration_results if r["registration_result"].get("success")]
            failed_registrations = [r for r in registration_results if not r["registration_result"].get("success")]
            
            return {
                "success": len(successful_registrations) > 0,
                "message": f"Registration flow completed. {len(successful_registrations)} successful, {len(failed_registrations)} failed",
                "phone_numbers": phone_numbers_data,
                "subscription_result": subscription_result,
                "registration_results": registration_results,
                "successful_registrations": successful_registrations,
                "failed_registrations": failed_registrations,
                "primary_phone_number": successful_registrations[0] if successful_registrations else None
            }
            
        except Exception as e:
            self.logger.error(f"Exception in complete phone registration flow: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "message": "Exception occurred during phone registration flow"
            }