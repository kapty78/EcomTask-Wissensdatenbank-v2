from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..core.dependencies import get_current_business
from ..models.business_model import Business
from ..services.analytics_service import AnalyticsService
from ..logger import main_logger
from fastapi.responses import JSONResponse
from ..schemas.analytics_schemas import (
    DashboardResponse,
    AppointmentAnalyticsResponse,
    CustomerAnalyticsResponse,
    ServiceAnalyticsResponse,
    CustomerListResponse
)
from typing import Optional, List
from ..models.booked_appointment import BookModel
from ..models.appointment_status import AppointmentStatus
from datetime import datetime

router = APIRouter()

@router.get("/dashboard", status_code=status.HTTP_200_OK, response_model=DashboardResponse)
async def get_analytics_dashboard(
    month: Optional[str] = None,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get complete analytics dashboard for the logged-in business.
    Optionally filter data by month.

    Args:
        month: Optional month to filter data (format YYYY-MM).
    
    Returns:
        A dashboard with summary metrics, appointment trends, top services,
        busy times, and revenue estimates.
    """
    try:
        # Make sure business has a WhatsApp number
        if not current_business.whatsapp_number:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Business does not have a WhatsApp number configured"
                },
                status_code=400
            )
        
        # Create analytics service
        analytics_service = AnalyticsService(db)
        
        # Get dashboard data
        result = analytics_service.get_business_dashboard(current_business.whatsapp_number,month=month)
        
        return result
    except Exception as e:
        main_logger.error(f"Error in analytics dashboard endpoint: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve analytics dashboard: {str(e)}"
        )

@router.get("/appointments", status_code=status.HTTP_200_OK, response_model=AppointmentAnalyticsResponse)
async def get_appointment_analytics(
    timeframe: int = 30,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get detailed appointment analytics for the logged-in business.
    
    Query Parameters:
    - timeframe: Number of days to analyze (default: 30, min: 1, max: 365)
    
    Returns:
        Detailed analytics about appointments including daily trends and busiest times.
    """
    try:
        # Validate timeframe
        if timeframe < 1 or timeframe > 365:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Timeframe must be between 1 and 365 days"
                },
                status_code=400
            )
        
        # Make sure business has a WhatsApp number
        if not current_business.whatsapp_number:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Business does not have a WhatsApp number configured"
                },
                status_code=400
            )
        
        # Create analytics service
        analytics_service = AnalyticsService(db)
        
        # Get appointment analytics
        result = analytics_service.get_appointment_analytics(
            current_business.whatsapp_number, 
            timeframe
        )
        
        return result
    except Exception as e:
        main_logger.error(f"Error in appointment analytics endpoint: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve appointment analytics: {str(e)}"
        )

@router.get("/customers", status_code=status.HTTP_200_OK, response_model=CustomerAnalyticsResponse)
async def get_customer_analytics(
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get detailed customer analytics for the logged-in business.
    
    Returns:
        Statistics about customers including total count, new customers,
        returning customers, and retention rate.
    """
    try:
        # Make sure business has a WhatsApp number
        if not current_business.whatsapp_number:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Business does not have a WhatsApp number configured"
                },
                status_code=400
            )
        
        # Create analytics service
        analytics_service = AnalyticsService(db)
        
        # Get customer analytics
        result = analytics_service.get_customer_analytics(current_business.whatsapp_number)
        
        return result
    except Exception as e:
        main_logger.error(f"Error in customer analytics endpoint: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve customer analytics: {str(e)}"
        )

@router.get("/services", status_code=status.HTTP_200_OK, response_model=ServiceAnalyticsResponse)
async def get_service_analytics(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get detailed service analytics for the logged-in business.
    
    Query Parameters:
    - limit: Number of top services to return (default: 10, min: 1, max: 50)
    
    Returns:
        Analytics about service popularity and estimated revenue.
    """
    try:
        # Validate limit
        if limit < 1 or limit > 50:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Limit must be between 1 and 50"
                },
                status_code=400
            )
        
        # Make sure business has a WhatsApp number
        if not current_business.whatsapp_number:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Business does not have a WhatsApp number configured"
                },
                status_code=400
            )
        
        # Create analytics service
        analytics_service = AnalyticsService(db)
        
        # Get service analytics
        result = analytics_service.get_service_analytics(
            current_business.whatsapp_number, 
            limit
        )
        
        return result
    except Exception as e:
        main_logger.error(f"Error in service analytics endpoint: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve service analytics: {str(e)}"
        )

@router.get("/customers/list", status_code=status.HTTP_200_OK, response_model=CustomerListResponse)
async def list_business_customers(
    page: int = 1,
    page_size: int = 10,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get a paginated list of customers for the logged-in business.
    
    Query Parameters:
    - page: Page number (default: 1, min: 1)
    - page_size: Number of customers per page (default: 10, min: 1, max: 100)
    
    Returns:
        Paginated list of customers with basic information and booking stats
    """
    try:
        # Validate pagination parameters
        if page < 1:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Page number must be at least 1"
                },
                status_code=400
            )
            
        if page_size < 1 or page_size > 100:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Page size must be between 1 and 100"
                },
                status_code=400
            )
        
        # Make sure business has a WhatsApp number
        if not current_business.whatsapp_number:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Business does not have a WhatsApp number configured"
                },
                status_code=400
            )
        
        # Create analytics service
        analytics_service = AnalyticsService(db)
        
        # Get customer list
        result = analytics_service.get_business_customers(
            current_business.whatsapp_number,
            page,
            page_size
        )
        
        return result
    except Exception as e:
        main_logger.error(f"Error in business customers list endpoint: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve customer list: {str(e)}"
        )

@router.get("/available-dates", status_code=status.HTTP_200_OK, response_model=List[str])
async def get_available_analytics_dates(
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Fetch dates for which analytics data is available.

    Returns:
        A list of dates in YYYY-MM-DD format.
    """
    try:
        # Make sure business has a WhatsApp number
        if not current_business.whatsapp_number:
            # Return empty list if no WhatsApp number configured, as no data would be available
            return JSONResponse(
                content=[],
                status_code=200  # Returning 200 with empty list for no data
            )
        
        # Create analytics service
        analytics_service = AnalyticsService(db)
        
        # Get available dates
        available_dates = analytics_service.get_available_appointment_dates(current_business.whatsapp_number)
        
        return available_dates
    except Exception as e:
        main_logger.error(f"Error in available-dates endpoint: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve available dates: {str(e)}"
        )

@router.put("/appointments/{appointment_id}/cancel", status_code=status.HTTP_200_OK)
async def cancel_appointment(
    appointment_id: int,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Cancel an appointment
    
    Path Parameters:
    - appointment_id: ID of the appointment to cancel
    
    Returns:
        Success message if appointment was cancelled
    """
    try:
        # Get the appointment
        appointment = db.query(BookModel).filter(
            BookModel.id == appointment_id,
            BookModel.business_phone_number == current_business.whatsapp_number
        ).first()
        
        if not appointment:
            return JSONResponse(
                content={
                    "status": "error",
                    "message": "Appointment not found"
                },
                status_code=404
            )
        
        # Update the status and set cancelled_at timestamp
        appointment.status = AppointmentStatus.CANCELLED
        appointment.cancelled_at = datetime.now()
        db.commit()
        
        return {
            "status": "success",
            "message": "Appointment cancelled successfully"
        }
        
    except Exception as e:
        main_logger.error(f"Error cancelling appointment: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel appointment: {str(e)}"
        ) 