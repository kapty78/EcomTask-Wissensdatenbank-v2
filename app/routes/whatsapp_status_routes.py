from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..core.dependencies import get_current_business
from ..models.business_model import Business, WABAStatus
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from ..logger import main_logger

router = APIRouter()

class WhatsAppConnectivityResponse(BaseModel):
    """Response model for WhatsApp connectivity status."""
    is_connected: bool = Field(..., description="Whether WhatsApp is connected and ready to use")
    whatsapp_number: Optional[str] = Field(None, description="The WhatsApp phone number")
    waba_status: Optional[str] = Field(None, description="WABA connection status (pending, connected, failed)")
    channel_id: Optional[str] = Field(None, description="The WhatsApp channel ID")
    client_id: Optional[str] = Field(None, description="The client ID for the WhatsApp API")
    api_endpoint: Optional[str] = Field(None, description="The API endpoint URL")
    whatsapp_profile: Optional[Dict[str, Any]] = Field(None, description="WhatsApp profile information")
    message: str = Field(..., description="Status message explaining the current connection state")

class SimpleStatusResponse(BaseModel):
    """Simple status response for dashboard indicators."""
    status: str = Field(..., description="Status of WhatsApp connection: 'connected', 'pending', 'failed', or 'not_configured'")
    whatsapp_number: Optional[str] = Field(None, description="The WhatsApp phone number if available")

@router.get("/connectivity", response_model=WhatsAppConnectivityResponse)
async def get_whatsapp_connectivity_status(
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get the WhatsApp connectivity status for the logged-in business.
    
    Returns:
        WhatsAppConnectivityResponse: The connectivity status details including WhatsApp number,
        WABA status, channel ID, and other connection details if available.
    """
    try:
        main_logger.info(f"Fetching WhatsApp connectivity status for business: {current_business.email}")
        
        # Check if WhatsApp is connected based on whatsapp_number field
        is_connected = bool(current_business.whatsapp_number and current_business.waba_status == WABAStatus.connected.value)
        
        # Prepare the response message
        if is_connected:
            message = "WhatsApp Business API is connected and ready to use."
        else:
            if not current_business.whatsapp_number:
                message = "WhatsApp Business API is not connected. No WhatsApp number assigned."
            elif current_business.waba_status == WABAStatus.pending.value:
                message = "WhatsApp Business API connection is pending."
            elif current_business.waba_status == WABAStatus.failed.value:
                message = "WhatsApp Business API connection failed."
            else:
                message = "WhatsApp Business API connection status is unknown."
        
        # Create response
        response = WhatsAppConnectivityResponse(
            is_connected=is_connected,
            whatsapp_number=current_business.whatsapp_number,
            waba_status=current_business.waba_status.value if current_business.waba_status else None,
            channel_id=current_business.channel_id,
            client_id=current_business.client_id,
            api_endpoint=current_business.api_endpoint,
            whatsapp_profile=current_business.whatsapp_profile,
            message=message
        )
        
        main_logger.info(f"WhatsApp connectivity status for {current_business.email}: {is_connected}")
        return response
        
    except Exception as e:
        main_logger.error(f"Error fetching WhatsApp connectivity status: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve WhatsApp connectivity status: {str(e)}"
        )

@router.get("/status", response_model=SimpleStatusResponse)
async def get_simple_whatsapp_status(
    current_business: Business = Depends(get_current_business)
):
    """
    Get a simplified WhatsApp status for dashboard indicators.
    
    Returns:
        SimpleStatusResponse: A simple status response containing just the status and number
    """
    try:
        # Determine status
        if current_business.whatsapp_number and current_business.waba_status == WABAStatus.connected.value:
            status = "connected"
        elif current_business.waba_status == WABAStatus.pending.value:
            status = "pending"
        elif current_business.waba_status == WABAStatus.failed.value:
            status = "failed"
        else:
            status = "not_configured"
        
        return SimpleStatusResponse(
            status=status,
            whatsapp_number=current_business.whatsapp_number
        )
    
    except Exception as e:
        main_logger.error(f"Error fetching simple WhatsApp status: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve WhatsApp status: {str(e)}"
        ) 