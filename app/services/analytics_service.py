from ..repositories.analytics_repository import AnalyticsRepository
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..models.booked_appointment import BookModel
from ..logger import main_logger
from datetime import datetime, timedelta
from typing import Optional, List

class AnalyticsService:
    """Service class for business analytics"""
    
    def __init__(self, db: Session):
        self.db = db
        self.analytics_repo = AnalyticsRepository(db)
    
    def get_business_dashboard(self, business_phone: str, month: Optional[str] = None):
        """
        Get a complete dashboard data for a business
        Optionally filter data by month.
        
        Args:
            business_phone: Business phone number to filter by
            month: Optional month to filter data (format YYYY-MM).
            
        Returns:
            Dictionary with all dashboard components
        """
        try:
            # Normalize business phone number - remove + prefix if present
            if business_phone and business_phone.startswith('+'):
                business_phone = business_phone[1:]
                main_logger.info(f"Normalized business phone number to: {business_phone}")

            # Determine the date range based on the month parameter
            if month:
                try:
                    year, month_num = map(int, month.split("-"))
                    # Get the first day of the month
                    start_date = datetime(year, month_num, 1)
                    # Get the last moment of the month
                    if month_num == 12:
                        end_date = datetime(year + 1, 1, 1) - timedelta(seconds=1)
                    else:
                        end_date = datetime(year, month_num + 1, 1) - timedelta(seconds=1)
                    main_logger.info(
                        f"Filtering dashboard data for month: {month}. Range: {start_date} to {end_date}"
                    )
                except ValueError:
                    main_logger.warning(
                        f"Invalid month format: {month}. Using last 30 days instead."
                    )
                    month = None  # Fallback to default

            # If no valid month is provided, use the last 30 days
            if not month:
                end_date = datetime.now().replace(hour=23, minute=59, second=59, microsecond=999999)
                start_date = (end_date - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
                main_logger.info(
                    f"Filtering dashboard data for last 30 days. Range: {start_date} to {end_date}"
                )

            # Get summary data (quick stats)
            # Pass start and end dates to the repository method
            summary = self.analytics_repo.get_dashboard_summary(business_phone, start_date, end_date)
            
            # Get revenue estimates (needed for monthly services booked)
            # Pass start and end dates to the repository method
            revenue = self.analytics_repo.get_revenue_estimates(business_phone, start_date, end_date)
            
            # Get recent appointments (still get the 10 most recent overall, not month-specific)
            recent_appointments = self.analytics_repo.get_recent_appointments(business_phone, limit=10)

            # Get appointment time series data for the specified range
            # Pass start and end dates to the repository method
            appointment_time_series_data = self.analytics_repo.get_appointments_by_timeframe(business_phone, start_date, end_date)

            # Construct the dashboard response with only the required fields
            dashboard_data = {
                "summary": {
                    "today_appointments": summary["today_appointments"],
                    "today_cancelled": summary["today_cancelled"],
                    "todays_services": summary["todays_services_count"],
                    "costs_today": summary["costs_today_calculated"],
                    "costs_last_30_days": summary["costs_last_30_days_calculated"],
                    "monthly_appointments": summary["thirty_day_appointments"],
                    "monthly_cancelled": summary["thirty_day_cancelled"],
                    "monthly_services_booked": revenue["services_booked"],
                    "monthly_growth_rate": summary["thirty_day_growth_rate"]
                },
                "recent_appointments": recent_appointments,
                "appointment_time_series": appointment_time_series_data
            }
            
            return {
                "status": "success",
                "data": dashboard_data
            }
            
        except Exception as e:
            main_logger.error(f"Error getting business dashboard: {str(e)}")
            return {
                "status": "error",
                "message": f"Failed to generate dashboard: {str(e)}"
            }
    
    def get_appointment_analytics(self, business_phone: str, timeframe: int = 30):
        """
        Get detailed appointment analytics
        
        Args:
            business_phone: Business phone number
            timeframe: Number of days to analyze
            
        Returns:
            Dictionary with appointment analytics
        """
        try:
            # Determine analysis range based on timeframe
            end_date = datetime.now().replace(hour=23, minute=59, second=59, microsecond=999999)
            start_date = (end_date - timedelta(days=timeframe)).replace(hour=0, minute=0, second=0, microsecond=0)

            # Get daily appointment data
            daily_data = self.analytics_repo.get_appointments_by_timeframe(business_phone, start_date, end_date)

            # Get busiest times
            busy_times = self.analytics_repo.get_busiest_times(business_phone)

            # Get summary data for the timeframe
            summary = self.analytics_repo.get_dashboard_summary(business_phone, start_date, end_date)

            # Yesterday's appointment count for completeness
            yesterday = end_date - timedelta(days=1)
            yesterday_stats = (
                self.db.query(
                    func.count(BookModel.id).label('total'),
                    func.count(func.case(
                        (BookModel.status == AppointmentStatus.CANCELLED, 1),
                        else_=None
                    )).label('cancelled')
                )
                .filter(
                    BookModel.business_phone_number == business_phone,
                    func.date(BookModel.created_at) == yesterday.date(),
                )
                .first()
            )
            
            return {
                "status": "success",
                "data": {
                    "daily_appointments": daily_data,
                    "busiest_times": busy_times,
                    "appointment_counts": {
                        "today": summary["today_appointments"],
                        "today_cancelled": summary["today_cancelled"],
                        "yesterday": yesterday_stats.total,
                        "yesterday_cancelled": yesterday_stats.cancelled,
                        "last_30_days": summary["thirty_day_appointments"],
                        "last_30_days_cancelled": summary["thirty_day_cancelled"],
                        "growth_rate": summary["thirty_day_growth_rate"],
                    },
                }
            }
            
        except Exception as e:
            main_logger.error(f"Error getting appointment analytics: {str(e)}")
            return {
                "status": "error",
                "message": f"Failed to generate appointment analytics: {str(e)}"
            }
    
    def get_customer_analytics(self, business_phone: str):
        """
        Get detailed customer analytics
        
        Args:
            business_phone: Business phone number
            
        Returns:
            Dictionary with customer analytics
        """
        try:
            # Get customer statistics
            customer_stats = self.analytics_repo.get_customer_statistics(business_phone)
            
            return {
                "status": "success",
                "data": customer_stats
            }
            
        except Exception as e:
            main_logger.error(f"Error getting customer analytics: {str(e)}")
            return {
                "status": "error",
                "message": f"Failed to generate customer analytics: {str(e)}"
            }
    
    def get_service_analytics(self, business_phone: str, limit: int = 10):
        """
        Get detailed service analytics
        
        Args:
            business_phone: Business phone number
            limit: Number of top services to return
            
        Returns:
            Dictionary with service analytics
        """
        try:
            # Get service popularity data
            service_popularity = self.analytics_repo.get_service_popularity(business_phone, limit)
            
            # Get revenue estimates
            revenue = self.analytics_repo.get_revenue_estimates(business_phone)
            
            return {
                "status": "success",
                "data": {
                    "popular_services": service_popularity,
                    "revenue_estimates": revenue
                }
            }
            
        except Exception as e:
            main_logger.error(f"Error getting service analytics: {str(e)}")
            return {
                "status": "error",
                "message": f"Failed to generate service analytics: {str(e)}"
            }
    
    def get_business_customers(self, business_phone: str, page: int = 1, page_size: int = 10):
        """
        Get a paginated list of customers for a business
        
        Args:
            business_phone: Business phone number
            page: Page number (starting from 1)
            page_size: Number of customers per page
            
        Returns:
            Dictionary with paginated customer data
        """
        try:
            # Get customer data from repository
            customer_data = self.analytics_repo.get_business_customers(
                business_phone, 
                page, 
                page_size
            )
            
            return {
                "status": "success",
                "data": customer_data
            }
            
        except Exception as e:
            main_logger.error(f"Error getting business customers: {str(e)}")
            return {
                "status": "error",
                "message": f"Failed to retrieve customer list: {str(e)}"
            }
    
    def get_available_appointment_dates(self, business_phone: str) -> List[str]:
        """
        Get a list of distinct dates for which appointments exist.
        
        Args:
            business_phone: The business phone number.
            
        Returns:
            List of dates in YYYY-MM-DD format.
        """
        main_logger.debug(f"Fetching available appointment dates for business: {business_phone}")
        try:
            available_dates = self.analytics_repo.get_dates_with_appointments(business_phone)
            main_logger.info(f"Found {len(available_dates)} available dates for business: {business_phone}")
            return available_dates
        except Exception as e:
            main_logger.error(f"Error in AnalyticsService.get_available_appointment_dates: {str(e)}")
            raise Exception(f"Failed to retrieve available dates: {str(e)}") 