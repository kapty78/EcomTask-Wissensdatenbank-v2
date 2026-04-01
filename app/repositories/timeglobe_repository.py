import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..models.customer_model import CustomerModel
from ..models.booked_appointment import BookModel
from ..models.booking_detail import BookingDetail
from ..models.appointment_status import AppointmentStatus
from datetime import datetime, timezone
from ..logger import (
    main_logger,
)
from ..utils.cache import cached, cache_invalidate


class TimeGlobeRepository:
    def __init__(self, db: Session):
        self.db = db

    @cached(ttl=600, key_prefix="customer")  # Cache for 10 minutes
    def get_customer(self, mobile_number: str) -> Optional[CustomerModel]:
        main_logger.debug(
            "Skipping customer lookup for %s (customer persistence disabled)",
            mobile_number,
        )
        return None

    @cache_invalidate("customer:*")  # Invalidate customer cache
    def create_customer(
        self,
        customer_data: dict,
        mobile_number: str,
        business_phone_number: str = None,
    ) -> Optional[CustomerModel]:
        main_logger.debug(
            "Skipping customer persistence for %s (handled via external systems)",
            mobile_number,
        )
        return None

    def save_book_appointment(self, booking_details: dict, mobileNumber: str, business_phone_number: str = None):
        try:
            # Look for orderId (from TimeGlobe service) or order_id (fallback)
            order_id = booking_details.get('orderId') or booking_details.get('order_id')
            
            main_logger.info(f"Saving booking appointment for order_id: {order_id}")
            
            if not order_id:
                main_logger.error("No order ID found in booking details")
                main_logger.debug(f"Booking details: {booking_details}")
                raise Exception("No order ID found in booking details")
                
            # Try to resolve the business for linking
            from ..models.business_model import Business

            phone_variants = {business_phone_number}
            if business_phone_number:
                if business_phone_number.startswith("+"):
                    phone_variants.add(business_phone_number[1:])
                else:
                    phone_variants.add(f"+{business_phone_number}")

            business = (
                self.db.query(Business)
                .filter(Business.whatsapp_number.in_(list(phone_variants)))
                .first()
            )

            business_id = business.id if business else None
            if not business_id:
                main_logger.warning(f"No business found for WhatsApp number: {business_phone_number}")

            site_cd = booking_details.get("siteCd")

            # Create the BookModel with the business phone number and optional customer
            appointment_created_at = datetime.utcnow()
            appointment_created_at_supabase = datetime.now(timezone.utc)

            book_appointment = BookModel(
                order_id=order_id,
                site_cd=site_cd,
                customer_id=None,  # Customer linkage disabled for Supabase sync
                customer_phone=mobileNumber,  # Always track phone
                business_phone_number=business_phone_number,
                business_id=business_id,
                status=AppointmentStatus.BOOKED,  # Set initial status as BOOKED
                created_at=appointment_created_at  # Store as UTC-naive for SQLite compatibility
            )
            
            main_logger.info(f"Creating booking with business phone: {business_phone_number}")
            self.db.add(book_appointment)
            self.db.commit()
            self.db.refresh(book_appointment)
            main_logger.info(f"Booking appointment saved with ID: {book_appointment.id}")
            
            # TODO: Also save to Supabase if dual storage is enabled
            try:
                from ..core.database_manager import db_manager
                if db_manager.storage_mode.value in ["supabase", "dual"]:
                    main_logger.info("Dual storage enabled, saving to Supabase...")
                    from ..repositories.supabase_repository import supabase_repository
                    
                    appointment_data = {
                        "id": book_appointment.id,
                        "order_id": book_appointment.order_id,
                        "site_cd": book_appointment.site_cd,
                        "business_id": business_id,
                        "customer_phone": book_appointment.customer_phone,
                        "business_phone_number": book_appointment.business_phone_number,
                        "status": book_appointment.status.value if hasattr(book_appointment.status, 'value') else str(book_appointment.status),
                        "created_at": appointment_created_at_supabase
                    }
                    
                    supabase_appointment_id = supabase_repository.create_appointment(appointment_data)
                    if supabase_appointment_id:
                        main_logger.info(f"Appointment also saved to Supabase: {supabase_appointment_id}")
            except Exception as supabase_error:
                main_logger.warning(f"Failed to save to Supabase (non-critical): {supabase_error}")

            # Save booking details (positions)
            for position in booking_details.get("positions", []):
                main_logger.info(f"Processing booking position: {position}")
                try:
                    begin_ts_local = datetime.strptime(
                        position["beginTs"], "%Y-%m-%dT%H:%M:%S.%fZ"
                    )
                    begin_ts_supabase = begin_ts_local.replace(tzinfo=timezone.utc)

                    detail_created_at_local = datetime.utcnow()
                    detail_created_at_supabase = datetime.now(timezone.utc)

                    booking_detail = BookingDetail(
                        begin_ts=begin_ts_local,
                        duration_millis=position["durationMillis"],
                        employee_id=position["employeeId"],
                        item_no=position["itemNo"],
                        item_nm=position.get("itemNm", ""), # Make itemNm optional
                        book_id=book_appointment.id,
                        created_at=detail_created_at_local
                    )
                    self.db.add(booking_detail)
                    self.db.flush()
                    try:
                        from ..core.database_manager import db_manager
                        if db_manager.storage_mode.value in ["supabase", "dual"]:
                            from ..repositories.supabase_repository import supabase_repository

                            booking_detail_data = {
                                "id": booking_detail.id,
                                "begin_ts": begin_ts_supabase,
                                "duration_millis": booking_detail.duration_millis,
                                "employee_id": booking_detail.employee_id,
                                "item_no": booking_detail.item_no,
                                "item_nm": booking_detail.item_nm,
                                "book_id": booking_detail.book_id,
                                "created_at": detail_created_at_supabase,
                            }

                            supabase_repository.create_booking_detail(booking_detail_data)
                    except Exception as supabase_detail_error:
                        main_logger.warning(f"Failed to save booking detail to Supabase (non-critical): {supabase_detail_error}")
                    main_logger.info(f"Added booking detail for position: {position.get('ordinalPosition', 'unknown')}")
                except Exception as detail_error:
                    main_logger.error(f"Error saving booking detail: {str(detail_error)}")
                    main_logger.error(f"Position data: {position}")
                    # Continue with other positions even if one fails
                    continue

            self.db.commit()
            main_logger.info(f"Booking details saved for order_id: {order_id}")
            return book_appointment

        except Exception as e:
            self.db.rollback()
            main_logger.error(f"Database error while saving appointment: {str(e)}")
            raise Exception(f"Database error {str(e)}")

    def cancel_appointment(self, order_id: int) -> bool:
        """
        Cancel an appointment by updating its status
        
        Args:
            order_id: The order ID of the appointment to cancel
            
        Returns:
            bool: True if cancellation was successful, False otherwise
        """
        try:
            appointment = self.db.query(BookModel).filter(BookModel.order_id == order_id).first()
            if appointment:
                appointment.status = AppointmentStatus.CANCELLED
                cancelled_at_utc = datetime.utcnow()
                appointment.cancelled_at = cancelled_at_utc
                self.db.commit()
                main_logger.info(f"Successfully cancelled appointment with order_id: {order_id}")
                
                # Also update in Supabase if dual storage is enabled
                try:
                    from ..core.database_manager import db_manager
                    if db_manager.storage_mode.value in ["supabase", "dual"]:
                        main_logger.info("Dual storage enabled, updating cancellation in Supabase...")
                        from ..repositories.supabase_repository import supabase_repository
                        
                        cancelled_at_supabase = cancelled_at_utc.replace(tzinfo=timezone.utc)
                        supabase_repository.cancel_appointment(
                            order_id=order_id,
                            cancelled_at=cancelled_at_supabase.isoformat()
                        )
                        main_logger.info(f"Appointment cancellation also saved to Supabase: {order_id}")
                except Exception as supabase_error:
                    main_logger.warning(f"Failed to update cancellation in Supabase (non-critical): {supabase_error}")
                
                return True
            else:
                main_logger.warning(f"No appointment found with order_id: {order_id}")
                return False
        except Exception as e:
            self.db.rollback()
            main_logger.error(f"Error cancelling appointment: {str(e)}")
            return False

    def update_customer_email(self, mobile_number: str, email: str) -> Optional[CustomerModel]:
        """
        Update the email address for a customer.
        
        Args:
            mobile_number: The customer's mobile number
            email: The new email address
            
        Returns:
            CustomerModel: The updated customer record
        """
        main_logger.debug(
            "Skipping customer email update for %s (customer persistence disabled)",
            mobile_number,
        )
        return None

    def update_customer_name(
        self,
        mobile_number: str,
        full_name: str,
        first_name: str = None,
        last_name: str = None,
    ) -> Optional[CustomerModel]:
        """
        Update the name fields for a customer.
        
        Args:
            mobile_number: The customer's mobile number
            full_name: The full name of the customer
            first_name: Optional first name
            last_name: Optional last name
            
        Returns:
            CustomerModel: The updated customer record
        """
        main_logger.debug(
            "Skipping customer name update for %s (customer persistence disabled)",
            mobile_number,
        )
        return None

    def update_customer_salutation(self, mobile_number: str, salutation_cd: str) -> Optional[CustomerModel]:
        """
        Update the salutation code for a customer.
        
        Args:
            mobile_number: The customer's mobile number
            salutation_cd: The salutation code ("na", "male", "female", "diverse")
            
        Returns:
            CustomerModel: The updated customer record
        """
        main_logger.debug(
            "Skipping customer salutation update for %s (customer persistence disabled)",
            mobile_number,
        )
        return None

    def update_customer_data_protection(self, mobile_number: str, dpl_accepted: bool) -> Optional[CustomerModel]:
        """
        Update the data protection acceptance status for a customer.
        
        Args:
            mobile_number: The customer's mobile number
            dpl_accepted: Whether data protection is accepted
            
        Returns:
            CustomerModel: The updated customer record
        """
        main_logger.debug(
            "Skipping customer data-protection update for %s (customer persistence disabled)",
            mobile_number,
        )
        return None
