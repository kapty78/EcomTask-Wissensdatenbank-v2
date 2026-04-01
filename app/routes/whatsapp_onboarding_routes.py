from fastapi import APIRouter, Request, HTTPException, Depends, Query
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
import requests
import os
import time

from ..db.session import get_db
from ..core.dependencies import get_current_business
from ..models.business_model import Business, WABAStatus
from ..core.config import settings
from ..logger import main_logger
from ..utils.phone_util import normalize_phone_number, format_phone_number_variants

router = APIRouter()

class WhatsAppSignupEvent(BaseModel):
    """Schema for WhatsApp signup event data"""
    business_id: str
    phone_number_id: str
    waba_id: str
    event: str = "FINISH"
    type: str = "WA_EMBEDDED_SIGNUP"
    version: str = "3"

class AuthCodeExchangeRequest(BaseModel):
    """Schema for auth code exchange request"""
    auth_code: str
    signup_data: WhatsAppSignupEvent

class PublicAuthCodeExchangeRequest(BaseModel):
    """Schema for public auth code exchange request"""
    auth_code: str
    signup_data: WhatsAppSignupEvent
    business_email: str  # Email to identify which business to update

class WhatsAppOnboardingResponse(BaseModel):
    """Response schema for WhatsApp onboarding completion"""
    success: bool
    message: str
    business_id: Optional[str] = None
    phone_number_id: Optional[str] = None
    waba_id: Optional[str] = None
    access_token: Optional[str] = None
    facebook_permissions_url: Optional[str] = None

class WebhookConfigRequest(BaseModel):
    """Schema for webhook configuration request"""
    webhook_url: str
    verify_token: str

class WebhookConfigResponse(BaseModel):
    """Response schema for webhook configuration"""
    success: bool
    message: str
    webhook_url: Optional[str] = None
    phone_number_id: Optional[str] = None
    instructions: Optional[Dict[str, str]] = None

class PhoneRegistrationRequest(BaseModel):
    """Request schema for phone number registration"""
    phone_number_id: str
    otp_code: str
    pin: Optional[str] = None

class ProfilePhotoRequest(BaseModel):
    """Request schema for profile photo upload"""
    phone_number_id: str
    photo_base64: str

class WhatsAppLinkRequest(BaseModel):
    """Request schema for WhatsApp link generation"""
    phone_number: str
    message: Optional[str] = None

@router.get("/onboarding-test", response_class=HTMLResponse)
async def get_onboarding_test_page():
    """Serve the WhatsApp onboarding test page."""
    with open("app/static/whatsapp_onboarding_test.html", "r", encoding="utf-8") as f:
        content = f.read()
    return HTMLResponse(content=content)

@router.get("/onboarding-production", response_class=HTMLResponse)
async def get_onboarding_production_page():
    """Serve the WhatsApp onboarding production page (requires authentication)."""
    try:
        with open("app/static/whatsapp_onboarding_production.html", "r", encoding="utf-8") as f:
            content = f.read()
        return HTMLResponse(content=content)
    except FileNotFoundError:
        # If production file doesn't exist, return a basic page
        content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Business API - Production Onboarding</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { background: #25D366; color: white; padding: 20px; border-radius: 10px; margin-bottom: 30px; }
                .auth-section { background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
                .btn { background: #25D366; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
                .form-group { margin: 15px 0; }
                .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
                .form-group input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
                .hidden { display: none; }
                .status-card { padding: 15px; margin: 15px 0; border-radius: 5px; }
                .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
                .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🚀 WhatsApp Business API - Production Onboarding</h1>
                    <p>Secure & Authenticated Setup</p>
                </div>
                
                <div class="auth-section">
                    <h2>🔐 Authentication Required</h2>
                    <p>You must be logged in to access the WhatsApp Business API onboarding.</p>
                    
                    <div id="authStatus" style="padding: 10px; margin: 10px 0; background: #f8d7da; color: #721c24; border-radius: 5px;">
                        ❌ Not authenticated - Please log in first
                    </div>
                    
                    <div class="form-group">
                        <label for="email">Email Address</label>
                        <input type="email" id="email" placeholder="your@email.com" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" placeholder="Your password" required>
                    </div>
                    <button class="btn" onclick="login()">Login</button>
                    <button class="btn" onclick="logout()" style="background: #6c757d; margin-left: 10px;">Logout</button>
                </div>
                
                <div id="onboardingSection" class="hidden">
                    <h2>📋 WhatsApp Business API Setup</h2>
                    <p>Use the authenticated endpoints for secure onboarding:</p>
                    <ul>
                        <li><strong>Check Status:</strong> GET /api/whatsapp/status-auth</li>
                        <li><strong>Complete Onboarding:</strong> POST /api/whatsapp/complete-onboarding-auth</li>
                        <li><strong>Configure Webhook:</strong> POST /api/whatsapp/configure-webhook-auth</li>
                        <li><strong>Test Messaging:</strong> POST /api/whatsapp/test-messaging-auth</li>
                    </ul>
                    
                    <div id="statusResult" class="status-card hidden"></div>
                    <button class="btn" onclick="checkStatus()">Check Current Status</button>
                </div>
            </div>
            
            <script>
                let authToken = localStorage.getItem('authToken');
                
                document.addEventListener('DOMContentLoaded', function() {
                    if (authToken) {
                        validateToken();
                    }
                });
                
                async function login() {
                    const email = document.getElementById('email').value;
                    const password = document.getElementById('password').value;
                    
                    if (!email || !password) {
                        alert('Please enter both email and password');
                        return;
                    }
                    
                    try {
                        const response = await fetch('/api/auth/login', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
                        });
                        
                        const data = await response.json();
                        
                        if (response.ok) {
                            authToken = data.access_token;
                            localStorage.setItem('authToken', authToken);
                            updateAuthStatus(true, email);
                            showOnboardingSection();
                        } else {
                            alert('Login failed: ' + (data.detail || 'Invalid credentials'));
                        }
                    } catch (error) {
                        console.error('Login error:', error);
                        alert('Login failed: ' + error.message);
                    }
                }
                
                function logout() {
                    authToken = null;
                    localStorage.removeItem('authToken');
                    updateAuthStatus(false);
                    hideOnboardingSection();
                }
                
                async function validateToken() {
                    if (!authToken) {
                        updateAuthStatus(false);
                        return;
                    }
                    
                    try {
                        const response = await fetch('/api/whatsapp/status-auth', {
                            headers: {
                                'Authorization': `Bearer ${authToken}`
                            }
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            updateAuthStatus(true, data.business_email);
                            showOnboardingSection();
                        } else {
                            logout();
                        }
                    } catch (error) {
                        console.error('Token validation error:', error);
                        logout();
                    }
                }
                
                function updateAuthStatus(authenticated, email = null) {
                    const statusDiv = document.getElementById('authStatus');
                    if (authenticated) {
                        statusDiv.style.background = '#d4edda';
                        statusDiv.style.color = '#155724';
                        statusDiv.innerHTML = `✅ Authenticated as: ${email}`;
                    } else {
                        statusDiv.style.background = '#f8d7da';
                        statusDiv.style.color = '#721c24';
                        statusDiv.innerHTML = '❌ Not authenticated - Please log in first';
                    }
                }
                
                function showOnboardingSection() {
                    document.getElementById('onboardingSection').classList.remove('hidden');
                }
                
                function hideOnboardingSection() {
                    document.getElementById('onboardingSection').classList.add('hidden');
                }
                
                async function checkStatus() {
                    if (!authToken) {
                        alert('Please log in first');
                        return;
                    }
                    
                    try {
                        const response = await fetch('/api/whatsapp/status-auth', {
                            headers: {
                                'Authorization': `Bearer ${authToken}`
                            }
                        });
                        
                        const data = await response.json();
                        const resultDiv = document.getElementById('statusResult');
                        
                        if (response.ok) {
                            resultDiv.className = 'status-card success';
                            resultDiv.innerHTML = `
                                <h3>✅ Current Status</h3>
                                <p><strong>Business:</strong> ${data.business_name}</p>
                                <p><strong>Email:</strong> ${data.business_email}</p>
                                <p><strong>API Key:</strong> ${data.has_api_key ? '✅ Available' : '❌ Missing'}</p>
                                <p><strong>WhatsApp Profile:</strong> ${data.has_whatsapp_profile ? '✅ Available' : '❌ Missing'}</p>
                                <p><strong>WABA Status:</strong> ${data.waba_status}</p>
                                <p><strong>Onboarding Complete:</strong> ${data.onboarding_complete ? '✅ Yes' : '❌ No'}</p>
                            `;
                        } else {
                            resultDiv.className = 'status-card error';
                            resultDiv.innerHTML = `<h3>❌ Error</h3><p>${data.detail || 'Failed to get status'}</p>`;
                        }
                        
                        resultDiv.classList.remove('hidden');
                    } catch (error) {
                        console.error('Status check error:', error);
                        const resultDiv = document.getElementById('statusResult');
                        resultDiv.className = 'status-card error';
                        resultDiv.innerHTML = `<h3>❌ Error</h3><p>${error.message}</p>`;
                        resultDiv.classList.remove('hidden');
                    }
                }
            </script>
        </body>
        </html>
        """
    return HTMLResponse(content=content)

@router.get("/oauth/callback")
async def oauth_callback(
    code: str = Query(..., description="Authorization code from Facebook"),
    state: str = Query(None, description="State parameter for security"),
    error: str = Query(None, description="Error from Facebook if any"),
    error_reason: str = Query(None, description="Error reason from Facebook"),
    error_description: str = Query(None, description="Error description from Facebook"),
    db: Session = Depends(get_db)
):
    """
    OAuth callback endpoint for WhatsApp embedded signup flow.
    Facebook redirects here after user completes embedded signup with authorization code.
    
    This endpoint:
    1. Receives the authorization code from Facebook
    2. Immediately attempts to exchange it for an access token
    3. Returns detailed response with token and next steps
    """
    main_logger.info(f"OAuth callback received - Code: {code[:30] if code else 'None'}...")
    main_logger.info(f"Callback URL that was called: https://timeglobe-server.ecomtask.de/api/whatsapp/oauth/callback")
    
    try:
        # Check for errors from Facebook
        if error:
            main_logger.error(f"OAuth error from Facebook: {error} - {error_description}")
            error_response = {
                "success": False,
                "error": error,
                "error_reason": error_reason,
                "error_description": error_description,
                "message": f"OAuth error: {error_description or error}"
            }
            return JSONResponse(content=error_response, status_code=400)
        
        if not code:
            main_logger.error("No authorization code received in OAuth callback")
            raise HTTPException(status_code=400, detail="No authorization code received")
        
        main_logger.info(f"Authorization code received successfully")
        main_logger.info(f"State parameter: {state}")
        
        # Immediately exchange the authorization code for access token
        main_logger.info("Attempting to exchange authorization code for access token...")
        access_token = await exchange_auth_code_for_token(code)
        
        if access_token:
            main_logger.info("Successfully obtained access token from authorization code")
            
            callback_response = {
                "success": True,
                "message": "Authorization code successfully exchanged for access token",
                "authorization_code": code[:30] + "...",  # Truncated for security
                "access_token": access_token[:30] + "...",  # Truncated for security
                "token_type": "bearer",
                "state": state,
                "instructions": {
                    "next_step": "Use the access_token with signup data in /complete-onboarding-public endpoint",
                    "endpoint": "/api/whatsapp/complete-onboarding-public",
                    "required_data": {
                        "auth_code": "The authorization code (you already have this)",
                        "signup_data": {
                            "business_id": "From embedded signup webhook/callback",
                            "phone_number_id": "From embedded signup webhook/callback", 
                            "waba_id": "From embedded signup webhook/callback"
                        },
                        "business_email": "Email of the business to update"
                    },
                    "note": "You now have a valid access token to complete onboarding"
                },
                "curl_example": f"""
curl -X POST '{settings.API_BASE_URL}/api/whatsapp/complete-onboarding-public' \\
  -H 'Content-Type: application/json' \\
  -d '{{
    "auth_code": "{code}",
    "signup_data": {{
      "business_id": "YOUR_BUSINESS_ID",
      "phone_number_id": "YOUR_PHONE_NUMBER_ID",
      "waba_id": "YOUR_WABA_ID"
    }},
    "business_email": "your-business@email.com"
  }}'
                """.strip()
            }
            
            return JSONResponse(content=callback_response)
        else:
            main_logger.error("Failed to exchange authorization code for access token")
            
            callback_response = {
                "success": False,
                "message": "Authorization code received but failed to exchange for access token",
                "authorization_code": code[:30] + "...",  # Truncated for security
                "state": state,
                "instructions": {
                    "issue": "Token exchange failed - check app configuration",
                    "next_step": "Verify WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, and WHATSAPP_OAUTH_REDIRECT_URI",
                    "manual_exchange": f"You can try manual token exchange at /api/whatsapp/exchange-auth-code",
                    "note": "Authorization code expires in 10 minutes"
                },
                "manual_curl_example": f"""
curl -X POST 'https://graph.facebook.com/v22.0/oauth/access_token' \\
  -H 'Content-Type: application/json' \\
  -d '{{
    "client_id": "{settings.WHATSAPP_APP_ID}",
    "client_secret": "YOUR_APP_SECRET",
    "code": "{code}",
    "grant_type": "authorization_code",
    "redirect_uri": "{settings.WHATSAPP_OAUTH_REDIRECT_URI}"
  }}'
                """.strip()
            }
            
            return JSONResponse(content=callback_response, status_code=400)
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error in OAuth callback: {str(e)}")
        raise HTTPException(status_code=500, detail=f"OAuth callback failed: {str(e)}")

@router.get("/oauth/callback/auto-complete")
async def oauth_callback_auto_complete(
    code: str = Query(..., description="Authorization code from Facebook"),
    business_email: str = Query(..., description="Business email for auto-completion"),
    state: str = Query(None, description="State parameter for security"),
    db: Session = Depends(get_db)
):
    """
    Auto-completing OAuth callback that immediately processes the embedded signup.
    Use this if you want to automatically complete onboarding when callback is received.
    """
    main_logger.info(f"Auto-completing OAuth callback for business: {business_email}")
    
    try:
        # This is a more advanced version that automatically completes onboarding
        # You would need to have the signup data available (stored during embedded signup process)
        
        # For now, return instructions to manually complete
        return {
            "success": True,
            "message": "Use the complete-onboarding-public endpoint with this data",
            "authorization_code": code,
            "business_email": business_email,
            "next_step": "POST to /api/whatsapp/complete-onboarding-public with auth_code and signup_data"
        }
        
    except Exception as e:
        main_logger.error(f"Error in auto-complete OAuth callback: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Auto-complete callback failed: {str(e)}")

@router.post("/complete-onboarding-legacy", response_model=WhatsAppOnboardingResponse)
async def complete_whatsapp_onboarding_legacy(
    request: AuthCodeExchangeRequest,
    current_business: Business = Depends(get_current_business),
    db: Session = Depends(get_db)
):
    """
    LEGACY: Complete WhatsApp Business API onboarding by exchanging auth code for access token
    and updating business record with WhatsApp credentials.
    
    DEPRECATED: Use /complete-onboarding-auth instead.
    """
    main_logger.info(f"Completing WhatsApp onboarding for business: {current_business.email}")
    
    try:
        # Extract the signup data
        signup_data = request.signup_data
        auth_code = request.auth_code
        
        main_logger.info(f"Signup data - Business ID: {signup_data.business_id}, "
                        f"Phone Number ID: {signup_data.phone_number_id}, "
                        f"WABA ID: {signup_data.waba_id}")
        
        # Exchange auth code for access token
        access_token = await exchange_auth_code_for_token(auth_code)
        
        if not access_token:
            raise HTTPException(status_code=400, detail="Failed to exchange auth code for access token")
        
        # Get phone number details
        phone_details = await get_phone_number_details(signup_data.phone_number_id, access_token)
        whatsapp_number = phone_details.get("display_phone_number", "")
        
        # Update business record with WhatsApp credentials
        current_business.api_key = access_token
        current_business.channel_id = signup_data.phone_number_id
        current_business.app_id = settings.WHATSAPP_APP_ID
        current_business.whatsapp_number = normalize_phone_number(whatsapp_number)
        current_business.waba_status = "connected"
        
        # Generate webhook URL and verify token
        webhook_url = f"{settings.API_BASE_URL}/api/whatsapp/webhook" if settings.API_BASE_URL else "https://21ed-2a09-bac5-503b-228-00-37-34.ngrok-free.app/api/whatsapp/webhook"
        verify_token = f"whatsapp_verify_{current_business.id}_{signup_data.phone_number_id}"
        
        # Store additional WhatsApp profile information
        current_business.whatsapp_profile = {
            "business_id": signup_data.business_id,
            "waba_id": signup_data.waba_id,
            "phone_number_id": signup_data.phone_number_id,
            "display_phone_number": whatsapp_number,
            "onboarding_completed_at": signup_data.event,
            "api_version": signup_data.version,
            "webhook_url": webhook_url,
            "webhook_verify_token": verify_token
        }
        
        # Step 1: Check if phone number is already registered via Embedded Signup
        main_logger.info("Checking phone number status after Embedded Signup...")
        
        # Get phone number details to check status
        phone_details = await get_phone_number_details(signup_data.phone_number_id, access_token)
        
        if phone_details:
            main_logger.info(f"Phone number details: {phone_details}")
            phone_status = phone_details.get('status', 'UNKNOWN')
            verification_status = phone_details.get('code_verification_status', 'UNKNOWN')
            
            main_logger.info(f"Phone status: {phone_status}, Verification: {verification_status}")
            
            # Update business with phone details from Embedded Signup
            current_business.channel_id = signup_data.phone_number_id
            current_business.whatsapp_number = normalize_phone_number(phone_details.get("display_phone_number", ""))
            
            # Store phone status in profile
            current_business.whatsapp_profile["phone_status"] = phone_status
            current_business.whatsapp_profile["verification_status"] = verification_status
            current_business.whatsapp_profile["phone_details"] = phone_details
            
            if phone_status in ['CONNECTED', 'VERIFIED'] or verification_status == 'VERIFIED':
                main_logger.info("Phone number is already registered/verified via Embedded Signup")
                current_business.whatsapp_profile["registration_method"] = "embedded_signup_automatic"
            else:
                main_logger.info(f"Phone number status: {phone_status} - may need additional setup")
                current_business.whatsapp_profile["registration_method"] = "embedded_signup_pending"
        else:
            main_logger.warning("Could not retrieve phone number details")
            current_business.whatsapp_profile["registration_method"] = "unknown"
        
        # Step 2: Check webhook configuration status
        webhook_configured = False
        webhook_auto_configured = False
        
        # Check if webhook is already configured by Embedded Signup
        if phone_details and phone_details.get('webhook_configuration'):
            existing_webhook = phone_details.get('webhook_configuration', {}).get('application', '')
            if existing_webhook:
                main_logger.info(f"Webhook already configured by Embedded Signup: {existing_webhook}")
                webhook_configured = True
                webhook_auto_configured = True
                current_business.whatsapp_profile["webhook_configured"] = True
                current_business.whatsapp_profile["webhook_url"] = existing_webhook
                current_business.whatsapp_profile["webhook_source"] = "embedded_signup_automatic"
            else:
                main_logger.info("No webhook configured by Embedded Signup, attempting manual configuration...")
        
        # Only attempt manual webhook configuration if not already configured
        if not webhook_configured:
            main_logger.info("Attempting manual webhook configuration...")
        webhook_configured = await auto_configure_webhook(
            phone_number_id=signup_data.phone_number_id,
            access_token=access_token,
            webhook_url=webhook_url,
            verify_token=verify_token
        )
        
        if webhook_configured:
            current_business.whatsapp_profile["webhook_configured"] = True
            current_business.whatsapp_profile["webhook_source"] = "manual_configuration"
            main_logger.info(f"Webhook configured manually for {current_business.email}")
        else:
            current_business.whatsapp_profile["webhook_configured"] = False
            current_business.whatsapp_profile["webhook_source"] = "configuration_failed"
            main_logger.warning(f"Manual webhook configuration failed for {current_business.email}")
        
        db.commit()
        
        main_logger.info(f"WhatsApp onboarding completed successfully for {current_business.email}")
        
        # Create comprehensive response message
        phone_reg_message = ""
        if phone_details:
            phone_reg_message = f" Phone status: {phone_status}, Verification: {verification_status}."
        
        if webhook_auto_configured:
            webhook_message = "Webhook configured automatically by Embedded Signup"
        elif webhook_configured:
            webhook_message = "Webhook configured manually"
        else:
            webhook_message = "Webhook configuration failed (manual setup required)"
        
        complete_message = f"WhatsApp Business API onboarding completed successfully.{phone_reg_message} {webhook_message}"
        
        # Generate Facebook Business Manager permissions URL
        facebook_permissions_url = f"https://business.facebook.com/latest/settings/partners?business_id={signup_data.business_id}&selected_partner_id={settings.FACEBOOK_PARTNER_ID}"
        
        return WhatsAppOnboardingResponse(
            success=True,
            message=complete_message,
            business_id=signup_data.business_id,
            phone_number_id=signup_data.phone_number_id,
            waba_id=signup_data.waba_id,
            access_token=access_token[:20] + "..." if access_token else None,  # Truncated for security
            facebook_permissions_url=facebook_permissions_url
        )
        
    except Exception as e:
        db.rollback()
        main_logger.error(f"Error completing WhatsApp onboarding: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to complete onboarding: {str(e)}")

@router.post("/exchange-auth-code")
async def exchange_auth_code_only(
    auth_code: str,
    current_business: Business = Depends(get_current_business)
):
    """
    Exchange auth code for access token without completing full onboarding.
    Useful for testing or separate token exchange.
    """
    main_logger.info(f"Exchanging auth code for access token for business: {current_business.email}")
    
    try:
        access_token = await exchange_auth_code_for_token(auth_code)
        
        if not access_token:
            raise HTTPException(status_code=400, detail="Failed to exchange auth code for access token")
        
        return {
            "success": True,
            "message": "Auth code exchanged successfully",
            "access_token": access_token[:20] + "..." if access_token else None  # Truncated for security
        }
        
    except Exception as e:
        main_logger.error(f"Error exchanging auth code: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to exchange auth code: {str(e)}")

@router.post("/complete-onboarding-public", response_model=WhatsAppOnboardingResponse)
async def complete_whatsapp_onboarding_public(
    request: PublicAuthCodeExchangeRequest,
    db: Session = Depends(get_db)
):
    """
    Complete WhatsApp Business API onboarding without authentication.
    Uses business email to identify which business record to update.
    """
    main_logger.info(f"Completing public WhatsApp onboarding for email: {request.business_email}")
    
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == request.business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        # Extract the signup data
        signup_data = request.signup_data
        auth_code = request.auth_code
        
        main_logger.info(f"Signup data - Business ID: {signup_data.business_id}, "
                        f"Phone Number ID: {signup_data.phone_number_id}, "
                        f"WABA ID: {signup_data.waba_id}")
        
        # Exchange auth code for access token
        access_token = await exchange_auth_code_for_token(auth_code)
        
        if not access_token:
            raise HTTPException(status_code=400, detail="Failed to exchange auth code for access token")
        
        # Get phone number details
        phone_details = await get_phone_number_details(signup_data.phone_number_id, access_token)
        whatsapp_number = phone_details.get("display_phone_number", "")
        
        # Update business record with WhatsApp credentials
        business.api_key = access_token
        business.channel_id = signup_data.phone_number_id
        business.app_id = settings.WHATSAPP_APP_ID
        business.whatsapp_number = normalize_phone_number(whatsapp_number)
        business.waba_status = "connected"
        
        # Generate webhook URL and verify token
        webhook_url = f"{settings.API_BASE_URL}/api/whatsapp/webhook" if settings.API_BASE_URL else "https://21ed-2a09-bac5-503b-228-00-37-34.ngrok-free.app/api/whatsapp/webhook"
        verify_token = f"whatsapp_verify_{business.id}_{signup_data.phone_number_id}"
        
        # Store additional WhatsApp profile information
        business.whatsapp_profile = {
            "business_id": signup_data.business_id,
            "waba_id": signup_data.waba_id,
            "phone_number_id": signup_data.phone_number_id,
            "display_phone_number": whatsapp_number,
            "onboarding_completed_at": signup_data.event,
            "api_version": signup_data.version,
            "webhook_url": webhook_url,
            "webhook_verify_token": verify_token
        }
        
        # Step 1: Check if phone number is already registered via Embedded Signup
        main_logger.info("Checking phone number status after Embedded Signup...")
        
        # Get phone number details to check status
        phone_details = await get_phone_number_details(signup_data.phone_number_id, access_token)
        
        if phone_details:
            main_logger.info(f"Phone number details: {phone_details}")
            phone_status = phone_details.get('status', 'UNKNOWN')
            verification_status = phone_details.get('code_verification_status', 'UNKNOWN')
            
            main_logger.info(f"Phone status: {phone_status}, Verification: {verification_status}")
            
            # Update business with phone details from Embedded Signup
            business.channel_id = signup_data.phone_number_id
            business.whatsapp_number = normalize_phone_number(phone_details.get("display_phone_number", ""))
            
            # Store phone status in profile
            business.whatsapp_profile["phone_status"] = phone_status
            business.whatsapp_profile["verification_status"] = verification_status
            business.whatsapp_profile["phone_details"] = phone_details
            
            if phone_status in ['CONNECTED', 'VERIFIED'] or verification_status == 'VERIFIED':
                main_logger.info("Phone number is already registered/verified via Embedded Signup")
                business.whatsapp_profile["registration_method"] = "embedded_signup_automatic"
            else:
                main_logger.info(f"Phone number status: {phone_status} - may need additional setup")
                business.whatsapp_profile["registration_method"] = "embedded_signup_pending"
        else:
            main_logger.warning("Could not retrieve phone number details")
            business.whatsapp_profile["registration_method"] = "unknown"
        
        # Step 2: Subscribe app to WABA for webhook notifications
        main_logger.info(f"Subscribing app to WABA: {signup_data.waba_id}")
        
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        whatsapp_service = WhatsAppBusinessService(db)
        
        subscription_result = whatsapp_service.subscribe_app_to_waba(signup_data.waba_id, access_token)
        
        if subscription_result.get("success"):
            main_logger.info(f"Successfully subscribed app to WABA: {signup_data.waba_id}")
            business.whatsapp_profile["waba_subscribed"] = True
            business.whatsapp_profile["waba_subscription_result"] = subscription_result["data"]
            business.whatsapp_profile["waba_subscription_completed_at"] = "onboarding_automatic"
        else:
            main_logger.warning(f"Failed to subscribe app to WABA: {subscription_result.get('error')}")
            business.whatsapp_profile["waba_subscribed"] = False
            business.whatsapp_profile["waba_subscription_error"] = subscription_result.get("error")
            business.whatsapp_profile["waba_subscription_completed_at"] = "failed"
        
        # Step 3: Register phone number with WhatsApp Cloud API
        main_logger.info(f"Registering phone number with WhatsApp Cloud API: {signup_data.phone_number_id}")
        
        # Only attempt registration if phone is not already fully registered
        should_register = True
        if phone_details:
            phone_status = phone_details.get('status', 'UNKNOWN')
            verification_status = phone_details.get('code_verification_status', 'UNKNOWN')
            
            if phone_status in ['CONNECTED', 'VERIFIED'] and verification_status == 'VERIFIED':
                main_logger.info("Phone number already fully registered via Embedded Signup, skipping manual registration")
                should_register = False
                business.whatsapp_profile["registration_method"] = "embedded_signup_automatic"
                business.whatsapp_profile["registration_status"] = "already_registered"
        
        if should_register:
            registration_result = whatsapp_service.register_phone_number_on_cloud_api(
                phone_number_id=signup_data.phone_number_id,
            access_token=access_token,
                pin="000000"  # Default PIN for new registrations
            )
            
            if registration_result.get("success"):
                main_logger.info(f"Successfully registered phone number: {signup_data.phone_number_id}")
                business.whatsapp_profile["registration_method"] = "api_registration"
                business.whatsapp_profile["registration_status"] = "success"
                business.whatsapp_profile["registration_result"] = registration_result["data"]
            else:
                main_logger.warning(f"Failed to register phone number: {registration_result.get('error')}")
                business.whatsapp_profile["registration_method"] = "api_registration"
                business.whatsapp_profile["registration_status"] = "failed"
                business.whatsapp_profile["registration_error"] = registration_result.get("error")
                
                # Don't fail the entire onboarding if registration fails
                # Embedded signup might have already handled it
                main_logger.info("Continuing onboarding despite registration failure - embedded signup may have handled it")
        
        # Step 4: Check webhook configuration status
        webhook_configured = False
        webhook_auto_configured = False
        
        # Check if webhook is already configured by Embedded Signup
        if phone_details and phone_details.get('webhook_configuration'):
            existing_webhook = phone_details.get('webhook_configuration', {}).get('application', '')
            if existing_webhook:
                main_logger.info(f"Webhook already configured by Embedded Signup: {existing_webhook}")
                webhook_configured = True
                webhook_auto_configured = True
                business.whatsapp_profile["webhook_configured"] = True
                business.whatsapp_profile["webhook_url"] = existing_webhook
                business.whatsapp_profile["webhook_source"] = "embedded_signup_automatic"
        else:
                main_logger.info("No webhook configured by Embedded Signup, attempting manual configuration...")
        
        # Only attempt manual webhook configuration if not already configured
        if not webhook_configured:
            main_logger.info("Attempting manual webhook configuration...")
        webhook_configured = await auto_configure_webhook(
            phone_number_id=signup_data.phone_number_id,
            access_token=access_token,
            webhook_url=webhook_url,
            verify_token=verify_token
        )
        
        if webhook_configured:
            business.whatsapp_profile["webhook_configured"] = True
            business.whatsapp_profile["webhook_source"] = "manual_configuration"
            main_logger.info(f"Webhook configured manually for {business.email}")
        else:
            business.whatsapp_profile["webhook_configured"] = False
            business.whatsapp_profile["webhook_source"] = "configuration_failed"
            main_logger.warning(f"Manual webhook configuration failed for {business.email}")
        
        db.commit()
        
        main_logger.info(f"WhatsApp onboarding completed successfully for {business.email}")
        
        # Create comprehensive response message
        phone_reg_message = ""
        if phone_details:
            phone_reg_message = f" Phone status: {phone_status}, Verification: {verification_status}."
        
        # Phone registration message
        registration_status = business.whatsapp_profile.get("registration_status", "unknown")
        if registration_status == "already_registered":
            phone_reg_message += " Phone already registered via Embedded Signup."
        elif registration_status == "success":
            phone_reg_message += " Phone registered successfully with Cloud API."
        elif registration_status == "failed":
            phone_reg_message += " Phone registration failed (may still work via Embedded Signup)."
        
        # WABA subscription message
        if subscription_result.get("success"):
            waba_message = f"App subscribed to WABA {signup_data.waba_id}."
        else:
            waba_message = f"WABA subscription failed (webhooks may not work properly)."
        
        if webhook_auto_configured:
            webhook_message = "Webhook configured automatically by Embedded Signup"
        elif webhook_configured:
            webhook_message = "Webhook configured manually"
        else:
            webhook_message = "Webhook configuration failed (manual setup required)"
        
        complete_message = f"WhatsApp Business API onboarding completed successfully.{phone_reg_message} {waba_message} {webhook_message}"
        
        # Generate Facebook Business Manager permissions URL
        facebook_permissions_url = f"https://business.facebook.com/latest/settings/partners?business_id={signup_data.business_id}&selected_partner_id={settings.FACEBOOK_PARTNER_ID}"
        
        return WhatsAppOnboardingResponse(
            success=True,
            message=complete_message,
            business_id=signup_data.business_id,
            phone_number_id=signup_data.phone_number_id,
            waba_id=signup_data.waba_id,
            access_token=access_token[:20] + "..." if access_token else None,  # Truncated for security
            facebook_permissions_url=facebook_permissions_url
        )
        
    except Exception as e:
        db.rollback()
        main_logger.error(f"Error completing WhatsApp onboarding: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to complete onboarding: {str(e)}")

@router.post("/debug-token-exchange")
async def debug_token_exchange(
    auth_code: str = Query(..., description="Authorization code to test"),
    test_redirect_uri: str = Query(None, description="Custom redirect URI to test")
):
    """
    Debug endpoint to test token exchange with different redirect URIs
    """
    test_uri = test_redirect_uri or settings.WHATSAPP_OAUTH_REDIRECT_URI
    
    try:
        url = "https://graph.facebook.com/v22.0/oauth/access_token"
        request_data = {
            "client_id": settings.WHATSAPP_APP_ID,
            "client_secret": settings.WHATSAPP_APP_SECRET,
            "code": auth_code,
            "grant_type": "authorization_code",
            "redirect_uri": test_uri
        }
        
        main_logger.info(f"🧪 TESTING with redirect_uri: {test_uri}")
        
        response = requests.post(url, json=request_data, headers={"Content-Type": "application/json"})
        
        return {
            "status_code": response.status_code,
            "redirect_uri_tested": test_uri,
            "response": response.json() if response.content else {},
            "success": response.status_code == 200
        }
        
    except Exception as e:
        return {
            "error": str(e),
            "redirect_uri_tested": test_uri
        }

async def exchange_auth_code_for_token(auth_code: str) -> Optional[str]:
    """
    Exchange the authorization code for an access token using Facebook Graph API.
    This follows Meta's official documentation for token exchange after embedded signup.
    Uses v22.0 API and Content-Type: application/json as per Meta's specification.
    """
    try:
        # Facebook Graph API endpoint for token exchange - using v22.0 as in your example
        url = "https://graph.facebook.com/v22.0/oauth/access_token"
        
        # Complete request data as per Meta's documentation
        request_data = {
            "client_id": settings.WHATSAPP_APP_ID,
            "client_secret": settings.WHATSAPP_APP_SECRET,
            "code": auth_code,
            "grant_type": "authorization_code"
        }
        
        # Headers as per Meta's documentation
        headers = {
            "Content-Type": "application/json"
        }
        
        main_logger.info(f"Exchanging auth code with Facebook Graph API v22.0")
        main_logger.info(f"Using client_id: {settings.WHATSAPP_APP_ID}")
        main_logger.info(f"Using redirect_uri: {settings.WHATSAPP_OAUTH_REDIRECT_URI}")
        main_logger.debug(f"Auth code: {auth_code[:20]}...")
        main_logger.info(f"Request data: {request_data}")
        main_logger.info(f"Headers: {headers}")
        # Use POST request with JSON data and proper headers
        response = requests.post(url, json=request_data, headers=headers)
        
        main_logger.info(f"Token exchange response status: {response.status_code}")
        main_logger.info(f"Full response headers: {dict(response.headers)}")
        
        # Log the exact request details for debugging
        main_logger.info(f"🔍 DEBUGGING INFO:")
        main_logger.info(f"   Auth code (first 50): {auth_code[:50]}...")
        main_logger.info(f"   Client ID: {request_data['client_id']}")
        main_logger.info(f"   Request keys: {list(request_data.keys())}")
        
        if response.status_code == 200:
            token_data = response.json()
            access_token = token_data.get("access_token")
            token_type = token_data.get("token_type")
            
            if access_token:
                main_logger.info("Successfully exchanged auth code for access token")
                main_logger.info(f"Token type: {token_type}")
                main_logger.debug(f"Access token: {access_token[:30]}...")
                return access_token
            else:
                main_logger.error("No access token in response")
                main_logger.error(f"Response data: {token_data}")
                return None
        else:
            # Try to get error details
            try:
                error_data = response.json()
                main_logger.error(f"Failed to exchange auth code. Status: {response.status_code}")
                main_logger.error(f"Error response: {error_data}")
            except:
                main_logger.error(f"Failed to exchange auth code. Status: {response.status_code}")
                main_logger.error(f"Response text: {response.text}")
            return None
            
    except Exception as e:
        main_logger.error(f"Exception during auth code exchange: {str(e)}")
        return None

async def get_phone_number_details(phone_number_id: str, access_token: str) -> Dict[str, Any]:
    """
    Get phone number details from WhatsApp Business API.
    """
    try:
        url = f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{phone_number_id}"
        headers = {
            "Authorization": f"Bearer {access_token}"
        }
        
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            phone_data = response.json()
            main_logger.info(f"Retrieved phone number details: {phone_data}")
            return phone_data
        else:
            main_logger.error(f"Failed to get phone number details. Status: {response.status_code}")
            return {}
            
    except Exception as e:
        main_logger.error(f"Error getting phone number details: {str(e)}")
        return {}

@router.get("/status")
async def get_onboarding_status(
    current_business: Business = Depends(get_current_business)
):
    """
    Get the current WhatsApp onboarding status for the business.
    """
    # Extract WABA subscription and phone registration info from profile
    waba_subscribed = False
    waba_subscription_status = "unknown"
    phone_registration_status = "unknown"
    registration_method = "unknown"
    
    if current_business.whatsapp_profile:
        waba_subscribed = current_business.whatsapp_profile.get("waba_subscribed", False)
        waba_subscription_status = current_business.whatsapp_profile.get("waba_subscription_completed_at", "unknown")
        phone_registration_status = current_business.whatsapp_profile.get("registration_status", "unknown")
        registration_method = current_business.whatsapp_profile.get("registration_method", "unknown")
    
    return {
        "business_email": current_business.email,
        "waba_status": current_business.waba_status if current_business.waba_status else "pending",
        "has_whatsapp_number": bool(current_business.whatsapp_number),
        "whatsapp_number": current_business.whatsapp_number,
        "phone_number_id": current_business.channel_id,
        "waba_subscribed": waba_subscribed,
        "waba_subscription_status": waba_subscription_status,
        "phone_registration_status": phone_registration_status,
        "registration_method": registration_method,
        "whatsapp_profile": current_business.whatsapp_profile,
        "is_connected": current_business.waba_status == "connected" if current_business.waba_status else False
    }

@router.get("/status-public")
async def get_onboarding_status_public(
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Get the current WhatsApp onboarding status for a business using email.
    Public endpoint that doesn't require authentication.
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        main_logger.info(f"Fetching public WhatsApp status for business: {business.email}")
        
        # Extract WABA subscription and phone registration info from profile
        waba_subscribed = False
        waba_subscription_status = "unknown"
        phone_registration_status = "unknown"
        registration_method = "unknown"
        
        if business.whatsapp_profile:
            waba_subscribed = business.whatsapp_profile.get("waba_subscribed", False)
            waba_subscription_status = business.whatsapp_profile.get("waba_subscription_completed_at", "unknown")
            phone_registration_status = business.whatsapp_profile.get("registration_status", "unknown")
            registration_method = business.whatsapp_profile.get("registration_method", "unknown")
        
        return {
            "business_email": business.email,
            "business_name": business.business_name,
            "waba_status": business.waba_status if business.waba_status else "pending",
            "has_whatsapp_number": bool(business.whatsapp_number),
            "whatsapp_number": business.whatsapp_number,
            "phone_number_id": business.channel_id,
            "has_access_token": bool(business.api_key),
            "waba_subscribed": waba_subscribed,
            "waba_subscription_status": waba_subscription_status,
            "phone_registration_status": phone_registration_status,
            "registration_method": registration_method,
            "whatsapp_profile": business.whatsapp_profile,
            "is_connected": business.waba_status == "connected" if business.waba_status else False,
            "last_updated": business.whatsapp_profile.get("onboarding_completed_at") if business.whatsapp_profile else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error fetching public WhatsApp status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch status: {str(e)}")

@router.post("/configure-webhook", response_model=WebhookConfigResponse)
async def configure_webhook_for_business(
    request: WebhookConfigRequest,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Configure webhook URL for a WhatsApp Business phone number.
    This endpoint helps you set up the webhook URL in Facebook's system.
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        if not business.api_key or not business.channel_id:
            raise HTTPException(status_code=400, detail="Business not properly onboarded. Complete onboarding first.")
        
        main_logger.info(f"Configuring webhook for business: {business.email}")
        
        # Configure webhook using Facebook Graph API
        success = await configure_webhook_api(
            phone_number_id=business.channel_id,
            access_token=business.api_key,
            webhook_url=request.webhook_url,
            verify_token=request.verify_token
        )
        
        if success:
            # Update business record with webhook info
            if business.whatsapp_profile:
                business.whatsapp_profile["webhook_url"] = request.webhook_url
                business.whatsapp_profile["webhook_verify_token"] = request.verify_token
            else:
                business.whatsapp_profile = {
                    "webhook_url": request.webhook_url,
                    "webhook_verify_token": request.verify_token
                }
            
            db.commit()
            
            return WebhookConfigResponse(
                success=True,
                message="Webhook configured successfully",
                webhook_url=request.webhook_url,
                phone_number_id=business.channel_id,
                instructions={
                    "verification_url": f"{request.webhook_url}?hub.mode=subscribe&hub.challenge=test&hub.verify_token={request.verify_token}",
                    "webhook_url": request.webhook_url,
                    "verify_token": request.verify_token
                }
            )
        else:
            raise HTTPException(status_code=400, detail="Failed to configure webhook")
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error configuring webhook: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to configure webhook: {str(e)}")

async def auto_configure_webhook(phone_number_id: str, access_token: str, webhook_url: str, verify_token: str) -> bool:
    """
    Automatically configure webhook during onboarding process.
    """
    try:
        main_logger.info(f"Auto-configuring webhook for phone number {phone_number_id}")
        return await configure_webhook_api(phone_number_id, access_token, webhook_url, verify_token)
    except Exception as e:
        main_logger.error(f"Auto webhook configuration failed: {str(e)}")
        return False

async def configure_webhook_api(phone_number_id: str, access_token: str, webhook_url: str, verify_token: str) -> bool:
    """
    Configure webhook URL using Facebook Graph API.
    """
    try:
        # Facebook Graph API endpoint for webhook configuration
        url = f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{phone_number_id}"
        
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        
        # Webhook configuration payload
        payload = {
            "webhook_url": webhook_url,
            "verify_token": verify_token
        }
        
        main_logger.info(f"Configuring webhook for phone number ID: {phone_number_id}")
        
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            main_logger.info("Webhook configured successfully via API")
            return True
        else:
            error_data = response.json() if response.content else {}
            main_logger.error(f"Failed to configure webhook via API. Status: {response.status_code}, Error: {error_data}")
            return False
            
    except Exception as e:
        main_logger.error(f"Exception during webhook configuration: {str(e)}")
        return False

@router.get("/webhook-status")
async def get_webhook_status(
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Get the current webhook configuration status for a business.
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        webhook_info = {}
        if business.whatsapp_profile:
            webhook_info = {
                "webhook_url": business.whatsapp_profile.get("webhook_url"),
                "has_verify_token": bool(business.whatsapp_profile.get("webhook_verify_token")),
                "phone_number_id": business.channel_id,
                "whatsapp_number": business.whatsapp_number
            }
        
        return {
            "business_email": business.email,
            "webhook_configured": bool(webhook_info.get("webhook_url")),
            "webhook_info": webhook_info,
            "endpoints": {
                "webhook_verification": "/api/whatsapp/webhook (GET)",
                "webhook_receiver": "/api/whatsapp/webhook (POST)"
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error getting webhook status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get webhook status: {str(e)}")


# WhatsApp Phone Number Registration Endpoints (3-Phase Process)

@router.post("/phone/request-code")
async def request_phone_code(
    phone_number_id: str,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Phase 1: Request OTP code for phone number registration.
    This must be called first to trigger SMS/voice verification.
    """
    try:
        from ..models.business_model import Business
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        if not business or not business.api_key:
            raise HTTPException(status_code=404, detail="Business not found or missing access token")
        
        main_logger.info(f"Requesting phone code for {phone_number_id}, business: {business.email}")
        
        # Use WhatsApp Business Service
        service = WhatsAppBusinessService(db)
        result = service.request_phone_code(phone_number_id, business.api_key)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error requesting phone code: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to request phone code: {str(e)}")

@router.post("/phone/verify-code")
async def verify_phone_code(
    phone_number_id: str,
    otp_code: str,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Phase 2: Verify OTP code for phone number registration.
    Call this after receiving the OTP from request-code.
    """
    try:
        from ..models.business_model import Business
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        if not business or not business.api_key:
            raise HTTPException(status_code=404, detail="Business not found or missing access token")
        
        main_logger.info(f"Verifying phone code for {phone_number_id}, business: {business.email}")
        
        # Use WhatsApp Business Service
        service = WhatsAppBusinessService(db)
        result = service.verify_phone_code(phone_number_id, business.api_key, otp_code)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error verifying phone code: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to verify phone code: {str(e)}")

@router.post("/phone/register")
async def register_phone_number(
    request: PhoneRegistrationRequest,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Phase 3: Register phone number with WhatsApp Business API.
    This finalizes the phone number registration process.
    The phone must be in CONNECTED status after this step.
    """
    try:
        from ..models.business_model import Business, WABAStatus
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        if not business or not business.api_key:
            raise HTTPException(status_code=404, detail="Business not found or missing access token")
        
        main_logger.info(f"Registering phone number {request.phone_number_id}, business: {business.email}")
        
        # Use WhatsApp Business Service
        service = WhatsAppBusinessService(db)
        result = service.register_phone_number(
            request.phone_number_id, 
            business.api_key, 
            request.otp_code, 
            request.pin
        )
        
        # Update business status if registration successful
        if result.get("success") and result.get("is_connected"):
            business.waba_status = "connected"
            db.commit()
            main_logger.info(f"Phone number {request.phone_number_id} is now CONNECTED")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error registering phone number: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to register phone number: {str(e)}")

@router.get("/phone/status")
async def check_phone_status(
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Check the status of all phone numbers in the WhatsApp Business Account.
    Use this to verify if phone numbers are CONNECTED and ready to use.
    """
    try:
        from ..models.business_model import Business
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        if not business or not business.api_key:
            raise HTTPException(status_code=404, detail="Business not found or missing access token")
        
        # Get WABA ID from business profile
        waba_id = None
        if business.whatsapp_profile:
            waba_id = business.whatsapp_profile.get("waba_id")
        
        if not waba_id:
            raise HTTPException(status_code=400, detail="WABA ID not found in business profile")
        
        main_logger.info(f"Checking phone status for WABA {waba_id}, business: {business.email}")
        
        # Use WhatsApp Business Service
        service = WhatsAppBusinessService(db)
        result = service.check_phone_status(waba_id, business.api_key)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error checking phone status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to check phone status: {str(e)}")

@router.post("/phone/wait-connection")
async def wait_for_phone_connection(
    phone_number_id: str,
    business_email: str,
    timeout_minutes: int = 10,
    db: Session = Depends(get_db)
):
    """
    Poll phone number status until it becomes CONNECTED or timeout.
    Use this after the register call to ensure the phone is fully operational.
    """
    try:
        from ..models.business_model import Business, WABAStatus
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        if not business or not business.api_key:
            raise HTTPException(status_code=404, detail="Business not found or missing access token")
        
        # Get WABA ID from business profile
        waba_id = None
        if business.whatsapp_profile:
            waba_id = business.whatsapp_profile.get("waba_id")
        
        if not waba_id:
            raise HTTPException(status_code=400, detail="WABA ID not found in business profile")
        
        main_logger.info(f"Waiting for phone {phone_number_id} to connect, business: {business.email}")
        
        # Use WhatsApp Business Service
        service = WhatsAppBusinessService(db)
        result = service.wait_for_connection(waba_id, business.api_key, phone_number_id, timeout_minutes)
        
        # Update business status if phone is connected
        if result.get("connected"):
            business.waba_status = "connected"
            db.commit()
            main_logger.info(f"Phone number {phone_number_id} is now CONNECTED")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error waiting for phone connection: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to wait for phone connection: {str(e)}")

@router.post("/phone/upload-profile-photo")
async def upload_profile_photo(
    request: ProfilePhotoRequest,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Upload profile photo for WhatsApp Business number.
    This only works after the phone number status is CONNECTED.
    Photo should be square, ≥640x640px, ≤5MB, PNG/JPG format, base64 encoded.
    """
    try:
        from ..models.business_model import Business
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        if not business or not business.api_key:
            raise HTTPException(status_code=404, detail="Business not found or missing access token")
        
        main_logger.info(f"Uploading profile photo for {request.phone_number_id}, business: {business.email}")
        
        # Use WhatsApp Business Service
        service = WhatsAppBusinessService(db)
        result = service.upload_profile_photo(request.phone_number_id, business.api_key, request.photo_base64)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error uploading profile photo: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to upload profile photo: {str(e)}")

@router.post("/generate-whatsapp-link")
async def generate_whatsapp_link(
    request: WhatsAppLinkRequest,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Generate wa.me click-to-chat link for WhatsApp Business number.
    Use this to create links that customers can click to start a conversation.
    """
    try:
        from ..models.business_model import Business
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        if not business:
            raise HTTPException(status_code=404, detail="Business not found")
        
        main_logger.info(f"Generating WhatsApp link for {request.phone_number}, business: {business.email}")
        
        # Use WhatsApp Business Service
        service = WhatsAppBusinessService(db)
        link = service.generate_whatsapp_link(request.phone_number, request.message)
        
        return {
            "success": True,
            "whatsapp_link": link,
            "phone_number": request.phone_number,
            "message": request.message
        }
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error generating WhatsApp link: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate WhatsApp link: {str(e)}")

@router.post("/complete-phone-registration")
async def complete_phone_registration(
    waba_id: str,
    business_email: str,
    pin: str = "000000",
    db: Session = Depends(get_db)
):
    """
    Complete the phone registration flow for a WhatsApp Business Account.
    This includes:
    1. Getting phone numbers from WABA
    2. Subscribing app to WABA
    3. Registering phone numbers on Cloud API
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        if not business.api_key:
            raise HTTPException(status_code=400, detail="Business does not have access token. Complete onboarding first.")
        
        main_logger.info(f"Starting phone registration flow for business: {business.email}, WABA: {waba_id}")
        
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        whatsapp_service = WhatsAppBusinessService(db)
        
        # Complete phone registration flow
        registration_result = whatsapp_service.complete_phone_registration_flow(
            waba_id=waba_id,
            access_token=business.api_key,
            pin=pin
        )
        
        # Update business record with registration results
        if not business.whatsapp_profile:
            business.whatsapp_profile = {}
        
        business.whatsapp_profile["phone_registration_result"] = registration_result
        business.whatsapp_profile["phone_registration_completed_at"] = "MANUAL"
        
        # If successful, update primary phone details
        if registration_result.get("success"):
            primary_phone = registration_result.get("primary_phone_number")
            if primary_phone:
                business.channel_id = primary_phone["phone_number_id"]
                business.whatsapp_number = normalize_phone_number(primary_phone["display_phone_number"])
                main_logger.info(f"Updated primary phone: {primary_phone['display_phone_number']}")
        
        db.commit()
        
        return {
            "success": registration_result.get("success", False),
            "message": registration_result.get("message", "Phone registration flow completed"),
            "waba_id": waba_id,
            "business_email": business_email,
            "phone_numbers": registration_result.get("phone_numbers", []),
            "successful_registrations": registration_result.get("successful_registrations", []),
            "failed_registrations": registration_result.get("failed_registrations", []),
            "primary_phone_number": registration_result.get("primary_phone_number"),
            "subscription_result": registration_result.get("subscription_result"),
            "registration_results": registration_result.get("registration_results", [])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error in phone registration flow: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Phone registration failed: {str(e)}")

@router.get("/phone-numbers/{waba_id}")
async def get_phone_numbers_for_waba(
    waba_id: str,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Get phone numbers associated with a WhatsApp Business Account.
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        if not business.api_key:
            raise HTTPException(status_code=400, detail="Business does not have access token. Complete onboarding first.")
        
        main_logger.info(f"Getting phone numbers for WABA: {waba_id}, Business: {business.email}")
        
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        whatsapp_service = WhatsAppBusinessService(db)
        
        result = whatsapp_service.get_whatsapp_business_phone_numbers(waba_id, business.api_key)
        
        if result.get("success"):
            return {
                "success": True,
                "message": "Phone numbers retrieved successfully",
                "waba_id": waba_id,
                "business_email": business_email,
                "phone_numbers": result["data"]["data"],
                "total_count": len(result["data"]["data"])
            }
        else:
            raise HTTPException(
                status_code=result.get("status_code", 500),
                detail=f"Failed to get phone numbers: {result.get('error', 'Unknown error')}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error getting phone numbers: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get phone numbers: {str(e)}")

@router.post("/subscribe-app/{waba_id}")
async def subscribe_app_to_waba(
    waba_id: str,
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Subscribe the app to a WhatsApp Business Account.
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        if not business.api_key:
            raise HTTPException(status_code=400, detail="Business does not have access token. Complete onboarding first.")
        
        main_logger.info(f"Subscribing app to WABA: {waba_id}, Business: {business.email}")
        
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        whatsapp_service = WhatsAppBusinessService(db)
        
        result = whatsapp_service.subscribe_app_to_waba(waba_id, business.api_key)
        
        if result.get("success"):
            return {
                "success": True,
                "message": "App subscribed to WABA successfully",
                "waba_id": waba_id,
                "business_email": business_email,
                "subscription_data": result["data"]
            }
        else:
            raise HTTPException(
                status_code=result.get("status_code", 500),
                detail=f"Failed to subscribe app: {result.get('error', 'Unknown error')}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error subscribing app to WABA: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to subscribe app: {str(e)}")

@router.post("/register-phone/{phone_number_id}")
async def register_single_phone_number(
    phone_number_id: str,
    business_email: str,
    pin: str = "000000",
    db: Session = Depends(get_db)
):
    """
    Register a single phone number on WhatsApp Cloud API.
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found with provided email")
        
        if not business.api_key:
            raise HTTPException(status_code=400, detail="Business does not have access token. Complete onboarding first.")
        
        main_logger.info(f"Registering phone number: {phone_number_id}, Business: {business.email}")
        
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        whatsapp_service = WhatsAppBusinessService(db)
        
        result = whatsapp_service.register_phone_number_on_cloud_api(phone_number_id, business.api_key, pin)
        
        if result.get("success"):
            return {
                "success": True,
                "message": "Phone number registered successfully",
                "phone_number_id": phone_number_id,
                "business_email": business_email,
                "registration_data": result["data"]
            }
        else:
            raise HTTPException(
                status_code=result.get("status_code", 500),
                detail=f"Failed to register phone number: {result.get('error', 'Unknown error')}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error registering phone number: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to register phone number: {str(e)}")

@router.get("/app-review-guidance")
async def get_app_review_guidance():
    """
    Provide guidance for App Review and permissions setup.
    Helps resolve phone registration and webhook configuration issues.
    """
    return {
        "app_status_check": {
            "url": f"https://developers.facebook.com/apps/{settings.WHATSAPP_APP_ID}/settings/basic/",
            "description": "Check if your app is in Development or Live mode"
        },
        "required_permissions": {
            "whatsapp_business_management": {
                "description": "Required for WABA settings and phone number management",
                "required_for": ["Phone number registration", "WABA management", "Message templates"],
                "app_review_required": True
            },
            "whatsapp_business_messaging": {
                "description": "Required for phone number settings and messaging",
                "required_for": ["Sending/receiving messages", "Phone number configuration"],
                "app_review_required": True
            }
        },
        "current_issues": {
            "missing_permission_error": {
                "error_code": 100,
                "description": "Your app needs advanced access to whatsapp_business_management permission",
                "solution": "Submit your app for App Review"
            },
            "application_capability_error": {
                "error_code": 3,
                "description": "Your app doesn't have capability to make webhook API calls",
                "solution": "App Review approval required for advanced access"
            }
        },
        "solutions": {
            "development_mode": {
                "description": "In development mode, permissions work for app admins/developers/testers only",
                "action": "Ensure you're logged in as an admin/developer of the app"
            },
            "app_review_process": {
                "description": "Submit app for review to get advanced access to permissions",
                "url": f"https://developers.facebook.com/apps/{settings.WHATSAPP_APP_ID}/app-review/",
                "requirements": [
                    "App must be in Live mode",
                    "Provide detailed use case explanation",
                    "Submit demo video showing functionality",
                    "Privacy policy and terms of service required"
                ]
            },
            "embedded_signup_automatic": {
                "description": "Embedded Signup should handle phone registration automatically",
                "note": "Manual phone registration might not be necessary for most use cases"
            }
        },
        "webhook_configuration": {
            "manual_setup": {
                "description": "If automatic webhook setup fails, configure manually in Facebook App",
                "url": f"https://developers.facebook.com/apps/{settings.WHATSAPP_APP_ID}/whatsapp-business/wa-settings/",
                "webhook_url": f"{settings.API_BASE_URL}/api/whatsapp/webhook" if hasattr(settings, 'API_BASE_URL') else "Your ngrok URL + /api/whatsapp/webhook"
            }
        },
        "testing_recommendations": {
            "sandbox_account": {
                "description": "Use sandbox test account for testing instead of real Facebook account",
                "url": f"https://developers.facebook.com/apps/{settings.WHATSAPP_APP_ID}/whatsapp-business/wa-dev-console/"
            },
            "555_numbers": {
                "description": "Use 555 test numbers for development",
                "note": "These numbers are automatically verified and don't require manual registration"
            }
        }
    }

@router.post("/test-messaging")
async def test_whatsapp_messaging(
    business_email: str,
    recipient_phone: str,
    test_message: str = "Hello! This is a test message from WhatsApp Business API.",
    db: Session = Depends(get_db)
):
    """
    Test WhatsApp messaging functionality after successful onboarding.
    This helps verify that the registration is fully working.
    """
    try:
        # Find business by email
        from ..models.business_model import Business
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found")
        
        if not business.api_key or not business.channel_id:
            raise HTTPException(status_code=400, detail="Business not properly onboarded")
        
        main_logger.info(f"Testing messaging for business: {business.email}")
        
        # Send test message using WhatsApp Cloud API
        url = f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{business.channel_id}/messages"
        
        headers = {
            "Authorization": f"Bearer {business.api_key}",
            "Content-Type": "application/json"
        }
        
        # Clean recipient phone number (remove any non-digits except +)
        clean_phone = ''.join(c for c in recipient_phone if c.isdigit() or c == '+')
        if not clean_phone.startswith('+'):
            clean_phone = '+' + clean_phone
        
        message_data = {
            "messaging_product": "whatsapp",
            "to": clean_phone,
            "type": "text",
            "text": {
                "body": test_message
            }
        }
        
        main_logger.info(f"Sending test message to {clean_phone}")
        
        response = requests.post(url, json=message_data, headers=headers)
        
        if response.status_code == 200:
            result = response.json()
            main_logger.info(f"Test message sent successfully: {result}")
            
            return {
                "success": True,
                "message": "Test message sent successfully",
                "recipient": clean_phone,
                "message_id": result.get("messages", [{}])[0].get("id"),
                "whatsapp_number": business.whatsapp_number,
                "response": result
            }
        else:
            error_data = response.json() if response.content else {}
            main_logger.error(f"Failed to send test message: {error_data}")
            
            return {
                "success": False,
                "message": f"Failed to send message: {error_data.get('error', {}).get('message', 'Unknown error')}",
                "recipient": clean_phone,
                "status_code": response.status_code,
                "error": error_data
            }
            
    except Exception as e:
        main_logger.error(f"Error testing messaging: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to test messaging: {str(e)}")

@router.get("/debug-permissions")
async def debug_whatsapp_permissions(
    business_email: str,
    db: Session = Depends(get_db)
):
    """
    Debug endpoint to check WhatsApp permissions and phone number status.
    Helps diagnose Error #33 permission issues.
    """
    try:
        # Find business by email
        business = db.query(Business).filter(Business.email == business_email).first()
        
        if not business:
            raise HTTPException(status_code=404, detail="Business not found")
        
        if not business.api_key:
            raise HTTPException(status_code=400, detail="No access token found")
        
        main_logger.info(f"Debugging permissions for business: {business.email}")
        
        from ..services.whatsapp_business_service import WhatsAppBusinessService
        whatsapp_service = WhatsAppBusinessService(db)
        
        debug_info = {
            "business_info": {
                "email": business.email,
                "whatsapp_number": business.whatsapp_number,
                "phone_number_id": business.channel_id,
                "waba_status": business.waba_status if business.waba_status else None,
                "has_access_token": bool(business.api_key),
                "access_token_prefix": business.api_key[:20] + "..." if business.api_key else None
            }
        }
        
        # Check phone number details
        if business.channel_id and business.api_key:
            try:
                phone_details = await get_phone_number_details(business.channel_id, business.api_key)
                debug_info["phone_number_details"] = phone_details
            except Exception as e:
                debug_info["phone_number_error"] = str(e)
        
        # Check WABA details if available
        if business.whatsapp_profile and business.whatsapp_profile.get("waba_id"):
            waba_id = business.whatsapp_profile["waba_id"]
            try:
                waba_phones = whatsapp_service.get_whatsapp_business_phone_numbers(waba_id, business.api_key)
                debug_info["waba_phone_numbers"] = waba_phones
            except Exception as e:
                debug_info["waba_error"] = str(e)
        
        # Test basic API access
        try:
            test_url = f"https://graph.facebook.com/v18.0/{business.channel_id}"
            headers = {"Authorization": f"Bearer {business.api_key}"}
            
            response = requests.get(test_url, headers=headers)
            
            if response.status_code == 200:
                debug_info["api_access_test"] = {
                    "status": "success",
                    "data": response.json()
                }
            else:
                debug_info["api_access_test"] = {
                    "status": "failed",
                    "status_code": response.status_code,
                    "error": response.json() if response.content else "No response content"
                }
        except Exception as e:
            debug_info["api_access_test"] = {
                "status": "error",
                "error": str(e)
            }
        
        # Add troubleshooting recommendations
        debug_info["troubleshooting_steps"] = {
            "1_check_system_user": "Verify System User has Admin role in Business Manager",
            "2_check_waba_assignment": "Ensure System User is assigned to the correct WABA",
            "3_regenerate_token": "Try regenerating the System User access token",
            "4_verify_phone_status": "Check if phone number is fully registered and verified",
            "5_business_manager_url": f"https://business.facebook.com/settings/system-users",
            "6_whatsapp_manager_url": "https://business.facebook.com/wa/manage/"
        }
        
        return debug_info
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error in debug permissions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Debug failed: {str(e)}")

# =============================================================================
# AUTHENTICATED ENDPOINTS FOR PRODUCTION USE
# =============================================================================

@router.post("/complete-onboarding-auth", response_model=WhatsAppOnboardingResponse)
async def complete_whatsapp_onboarding_authenticated(
    request: AuthCodeExchangeRequest,
    current_business: Business = Depends(get_current_business),
    db: Session = Depends(get_db)
):
    """
    AUTHENTICATED VERSION: Complete WhatsApp Business API onboarding for authenticated users.
    This endpoint requires a valid JWT token and completes onboarding for the authenticated business.
    
    Use this endpoint in production instead of the public version.
    """
    main_logger.info(f"Authenticated onboarding request for business: {current_business.business_name} ({current_business.email})")
    
    try:
        # Exchange auth code for access token
        main_logger.info("Exchanging authorization code for access token...")
        access_token = await exchange_auth_code_for_token(request.auth_code)
        
        if not access_token:
            main_logger.error("Failed to exchange authorization code for access token")
            raise HTTPException(
                status_code=400,
                detail="Failed to exchange authorization code for access token. Please try again."
            )
        
        main_logger.info("Successfully obtained access token")
        
        # Get phone number details
        phone_details = await get_phone_number_details(
            request.signup_data.phone_number_id, 
            access_token
        )
        
        # Update the authenticated business with WhatsApp details
        current_business.api_key = access_token
        current_business.channel_id = request.signup_data.phone_number_id
        current_business.app_id = settings.WHATSAPP_APP_ID
        
        # Extract and normalize WhatsApp number
        whatsapp_number = phone_details.get("display_phone_number", "") if phone_details else ""
        if whatsapp_number:
            current_business.whatsapp_number = normalize_phone_number(whatsapp_number)
            main_logger.info(f"WhatsApp number saved: {current_business.whatsapp_number}")
        
        current_business.whatsapp_profile = {
            "business_id": request.signup_data.business_id,
            "phone_number_id": request.signup_data.phone_number_id,
            "waba_id": request.signup_data.waba_id,
            "phone_details": phone_details,
            "onboarding_completed_at": str(time.time()),
            "event": request.signup_data.event,
            "type": request.signup_data.type,
            "version": request.signup_data.version
        }
        current_business.waba_status = "connected"
        
        db.commit()
        
        main_logger.info(f"WhatsApp onboarding completed successfully for {current_business.business_name}")
        
        return WhatsAppOnboardingResponse(
            success=True,
            message="WhatsApp Business API onboarding completed successfully!",
            business_id=request.signup_data.business_id,
            phone_number_id=request.signup_data.phone_number_id,
            waba_id=request.signup_data.waba_id,
            access_token=access_token[:30] + "..." if access_token else None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error during authenticated WhatsApp onboarding: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Internal error during onboarding: {str(e)}"
        )

@router.get("/status-auth")
async def get_onboarding_status_authenticated(
    current_business: Business = Depends(get_current_business)
):
    """
    AUTHENTICATED VERSION: Get WhatsApp onboarding status for authenticated user.
    Use this endpoint in production instead of the public version.
    """
    main_logger.info(f"Getting onboarding status for authenticated business: {current_business.email}")
    
    has_api_key = bool(current_business.api_key)
    has_whatsapp_profile = bool(current_business.whatsapp_profile)
    
    status_info = {
        "business_name": current_business.business_name,
        "business_email": current_business.email,
        "has_api_key": has_api_key,
        "has_whatsapp_profile": has_whatsapp_profile,
        "waba_status": current_business.waba_status if current_business.waba_status else "not_started",
        "onboarding_complete": has_api_key and has_whatsapp_profile,
    }
    
    if has_whatsapp_profile and current_business.whatsapp_profile:
        profile = current_business.whatsapp_profile
        status_info.update({
            "business_id": profile.get("business_id"),
            "phone_number_id": profile.get("phone_number_id"),
            "waba_id": profile.get("waba_id"),
            "phone_details": profile.get("phone_details", {}),
            "onboarding_completed_at": profile.get("onboarding_completed_at")
        })
    
    return status_info

@router.post("/configure-webhook-auth", response_model=WebhookConfigResponse)
async def configure_webhook_authenticated(
    request: WebhookConfigRequest,
    current_business: Business = Depends(get_current_business),
    db: Session = Depends(get_db)
):
    """
    AUTHENTICATED VERSION: Configure webhook for authenticated business.
    Use this endpoint in production instead of the public version.
    """
    main_logger.info(f"Configuring webhook for authenticated business: {current_business.business_name}")
    
    if not current_business.api_key:
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Business API not configured. Complete onboarding first."
        )
    
    if not current_business.whatsapp_profile:
        raise HTTPException(
            status_code=400,
            detail="WhatsApp profile not found. Complete onboarding first."
        )
    
    phone_number_id = current_business.whatsapp_profile.get("phone_number_id")
    if not phone_number_id:
        raise HTTPException(
            status_code=400,
            detail="Phone number ID not found in WhatsApp profile."
        )
    
    try:
        # Configure webhook using the WhatsApp API
        success = await configure_webhook_api(
            phone_number_id=phone_number_id,
            access_token=current_business.api_key,
            webhook_url=request.webhook_url,
            verify_token=request.verify_token
        )
        
        if success:
            # Update business profile with webhook info
            if not current_business.whatsapp_profile:
                current_business.whatsapp_profile = {}
            
            current_business.whatsapp_profile["webhook_url"] = request.webhook_url
            current_business.whatsapp_profile["webhook_verify_token"] = request.verify_token
            current_business.whatsapp_profile["webhook_configured_at"] = str(time.time())
            
            db.commit()
            
            main_logger.info(f"Webhook configured successfully for business: {current_business.business_name}")
            
            return WebhookConfigResponse(
                success=True,
                message="Webhook configured successfully!",
                webhook_url=request.webhook_url,
                phone_number_id=phone_number_id,
                instructions={
                    "next_step": "Test webhook by sending a message to your WhatsApp Business number",
                    "verify_token": "Make sure your webhook endpoint validates the verify_token",
                    "webhook_events": "messages, message_status, messaging_optins, messaging_postbacks"
                }
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Failed to configure webhook. Please check your webhook URL and try again."
            )
            
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error configuring webhook: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal error configuring webhook: {str(e)}"
        )

@router.get("/webhook-status-auth")
async def get_webhook_status_authenticated(
    current_business: Business = Depends(get_current_business)
):
    """
    AUTHENTICATED VERSION: Get webhook configuration status for authenticated business.
    Use this endpoint in production instead of the public version.
    """
    main_logger.info(f"Getting webhook status for authenticated business: {current_business.email}")
    
    if not current_business.whatsapp_profile:
        return {
            "webhook_configured": False,
            "message": "WhatsApp profile not found. Complete onboarding first."
        }
    
    profile = current_business.whatsapp_profile
    webhook_url = profile.get("webhook_url")
    webhook_configured = bool(webhook_url)
    
    status = {
        "business_name": current_business.business_name,
        "webhook_configured": webhook_configured,
        "webhook_url": webhook_url if webhook_configured else None,
        "phone_number_id": profile.get("phone_number_id"),
        "webhook_configured_at": profile.get("webhook_configured_at")
    }
    
    if webhook_configured:
        status["message"] = "Webhook is configured and ready to receive messages"
    else:
        status["message"] = "Webhook not configured. Use /configure-webhook-auth to set it up."
    
    return status

@router.post("/phone/request-code-auth")
async def request_phone_code_authenticated(
    phone_number_id: str,
    current_business: Business = Depends(get_current_business),
    db: Session = Depends(get_db)
):
    """
    AUTHENTICATED VERSION: Request phone verification code for authenticated business.
    Use this endpoint in production instead of the public version.
    """
    main_logger.info(f"Requesting phone code for authenticated business: {current_business.business_name}")
    
    if not current_business.api_key:
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Business API not configured. Complete onboarding first."
        )
    
    try:
        url = f"https://graph.facebook.com/v22.0/{phone_number_id}/request_code"
        headers = {
            "Authorization": f"Bearer {current_business.api_key}",
            "Content-Type": "application/json"
        }
        data = {"code_method": "SMS"}
        
        response = requests.post(url, headers=headers, json=data)
        result = response.json()
        
        if response.status_code == 200 and result.get("success"):
            main_logger.info(f"Phone verification code requested successfully for business: {current_business.business_name}")
            return {
                "success": True,
                "message": "Verification code sent to your phone number via SMS",
                "phone_number_id": phone_number_id
            }
        else:
            main_logger.error(f"Failed to request phone code: {result}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to request verification code: {result.get('error', {}).get('message', 'Unknown error')}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error requesting phone code: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal error requesting phone code: {str(e)}"
        )

@router.post("/phone/verify-code-auth")
async def verify_phone_code_authenticated(
    phone_number_id: str,
    otp_code: str,
    current_business: Business = Depends(get_current_business),
    db: Session = Depends(get_db)
):
    """
    AUTHENTICATED VERSION: Verify phone number with OTP code for authenticated business.
    Use this endpoint in production instead of the public version.
    """
    main_logger.info(f"Verifying phone code for authenticated business: {current_business.business_name}")
    
    if not current_business.api_key:
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Business API not configured. Complete onboarding first."
        )
    
    try:
        url = f"https://graph.facebook.com/v22.0/{phone_number_id}/verify_code"
        headers = {
            "Authorization": f"Bearer {current_business.api_key}",
            "Content-Type": "application/json"
        }
        data = {"code": otp_code}
        
        response = requests.post(url, headers=headers, json=data)
        result = response.json()
        
        if response.status_code == 200 and result.get("success"):
            # Update business profile with verification status
            if current_business.whatsapp_profile:
                current_business.whatsapp_profile["phone_verified"] = True
                current_business.whatsapp_profile["phone_verified_at"] = str(time.time())
                db.commit()
            
            main_logger.info(f"Phone number verified successfully for business: {current_business.business_name}")
            return {
                "success": True,
                "message": "Phone number verified successfully!",
                "phone_number_id": phone_number_id
            }
        else:
            main_logger.error(f"Failed to verify phone code: {result}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to verify phone number: {result.get('error', {}).get('message', 'Invalid verification code')}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error verifying phone code: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal error verifying phone code: {str(e)}"
        )

@router.post("/test-messaging-auth")
async def test_whatsapp_messaging_authenticated(
    recipient_phone: str,
    test_message: str = "Hello! This is a test message from WhatsApp Business API.",
    current_business: Business = Depends(get_current_business),
    db: Session = Depends(get_db)
):
    """
    AUTHENTICATED VERSION: Test WhatsApp messaging for authenticated business.
    Use this endpoint in production instead of the public version.
    """
    main_logger.info(f"Testing messaging for authenticated business: {current_business.business_name}")
    
    if not current_business.api_key:
        raise HTTPException(
            status_code=400,
            detail="WhatsApp Business API not configured. Complete onboarding first."
        )
    
    if not current_business.whatsapp_profile:
        raise HTTPException(
            status_code=400,
            detail="WhatsApp profile not found. Complete onboarding first."
        )
    
    phone_number_id = current_business.whatsapp_profile.get("phone_number_id")
    if not phone_number_id:
        raise HTTPException(
            status_code=400,
            detail="Phone number ID not found in WhatsApp profile."
        )
    
    try:
        # Normalize the recipient phone number
        normalized_phone = normalize_phone_number(recipient_phone)
        if not normalized_phone:
            raise HTTPException(
                status_code=400,
                detail="Invalid phone number format. Please provide a valid international phone number."
            )
        
        # Send test message via WhatsApp Business API
        url = f"https://graph.facebook.com/v22.0/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {current_business.api_key}",
            "Content-Type": "application/json"
        }
        data = {
            "messaging_product": "whatsapp",
            "to": normalized_phone,
            "type": "text",
            "text": {"body": test_message}
        }
        
        response = requests.post(url, json=data, headers=headers)
        result = response.json()
        
        if response.status_code == 200 and result.get("messages"):
            message_id = result["messages"][0]["id"]
            main_logger.info(f"Test message sent successfully for business: {current_business.business_name}, message_id: {message_id}")
            
            return {
                "success": True,
                "message": "Test message sent successfully!",
                "recipient": normalized_phone,
                "message_id": message_id,
                "phone_number_id": phone_number_id
            }
        else:
            main_logger.error(f"Failed to send test message: {result}")
            error_message = result.get("error", {}).get("message", "Unknown error")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to send test message: {error_message}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        main_logger.error(f"Error sending test message: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal error sending test message: {str(e)}"
        )

# =============================================================================
# END OF AUTHENTICATED ENDPOINTS
# =============================================================================