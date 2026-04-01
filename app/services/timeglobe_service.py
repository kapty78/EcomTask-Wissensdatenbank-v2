from ..core.config import settings
import requests, time, json
from fastapi import HTTPException, status
from ..repositories.timeglobe_repository import TimeGlobeRepository
from ..db.session import get_db
from ..logger import main_logger
from datetime import datetime, timedelta
from ..utils.timezone_util import BERLIN_TZ
from typing import List, Optional
import re
from ..utils.error_handler import retry_with_backoff, circuit_breaker, handle_errors, ErrorSeverity, ErrorCategory


# format_datetime function is now imported from utils.tools_wrapper_util to avoid duplication


def clean_api_key(api_key: str) -> str:
    """
    Comprehensive API key cleaning function to handle all edge cases.
    
    Handles:
    - Leading/trailing whitespace (spaces, tabs, newlines)
    - All types of quotes (single, double, backticks, unicode quotes)
    - Escaped quotes (\", \')
    - Multiple nested quotes
    - Unicode whitespace characters
    - Zero-width characters
    - BOM (Byte Order Mark)
    - Line breaks within the key
    - Control characters
    
    Args:
        api_key: Raw API key string from environment
        
    Returns:
        Cleaned API key string
    """
    if not api_key:
        return api_key
    
    # Step 1: Remove BOM (Byte Order Mark) if present
    if api_key.startswith('\ufeff'):
        api_key = api_key[1:]
    
    # Step 2: Remove all types of line breaks and carriage returns
    api_key = api_key.replace('\r\n', '').replace('\n', '').replace('\r', '')
    
    # Step 3: Strip all leading/trailing whitespace (including unicode whitespace)
    api_key = api_key.strip()
    
    # Step 4: Remove zero-width characters
    zero_width_chars = ['\u200b', '\u200c', '\u200d', '\ufeff', '\u2060']
    for char in zero_width_chars:
        api_key = api_key.replace(char, '')
    
    # Step 5: Remove quotes (all types) from beginning and end
    quote_chars = ['"', "'", '`', '"', '"', ''', ''']
    
    prev_length = 0
    while len(api_key) != prev_length:  # Keep stripping until no change
        prev_length = len(api_key)
        api_key = api_key.strip()
        
        # Strip each type of quote (matching pairs)
        for quote in quote_chars:
            if api_key.startswith(quote) and api_key.endswith(quote) and len(api_key) > 1:
                api_key = api_key[1:-1]
        
        # Handle escaped quotes at the boundaries
        if api_key.startswith('\\"') or api_key.startswith("\\'"):
            api_key = api_key[2:]
        if api_key.endswith('\\"') or api_key.endswith("\\'"):
            api_key = api_key[:-2]
        
        # Handle mixed quotes (different quote types at start and end)
        for quote in quote_chars:
            if api_key.startswith(quote) and len(api_key) > 1:
                api_key = api_key[1:]
            if api_key.endswith(quote) and len(api_key) > 1:
                api_key = api_key[:-1]
    
    # Step 6: Final trim of any remaining whitespace
    api_key = api_key.strip()
    
    # Step 7: Remove any internal line breaks
    api_key = re.sub(r'[\r\n\t]+', '', api_key)
    
    # Step 8: Collapse multiple spaces
    api_key = re.sub(r' +', ' ', api_key)
    
    # Step 9: Final safety trim
    api_key = api_key.strip()
    
    return api_key


class TimeGlobeService:
    def __init__(self):
        self.base_url = settings.TIMEGLOBE_BASE_URL
        self.username = settings.TIMEGLOBE_LOGIN_USERNAME
        self.password = settings.TIMEGLOBE_LOGIN_PASSWORD
        self.timeglobe_repo = TimeGlobeRepository(next(get_db()))
        self.logger = main_logger
        self.token = None
        self.expire_time = 3600  # 1 hour
        self.db = next(get_db())

    def get_business_by_phone(self, phone_number: str):
        """
        Get the business record associated with a phone number
        """
        from ..models.business_model import Business
        
        if not phone_number:
            return None
            
        # Normalize phone number
        normalized_phone = phone_number
        if phone_number.startswith("whatsapp:"):
            normalized_phone = phone_number.replace("whatsapp:", "")
            
        # Try different formats (with and without + prefix)
        formats_to_try = []
        if normalized_phone.startswith("+"):
            formats_to_try.append(normalized_phone)  # +923463109994
            formats_to_try.append(normalized_phone[1:])  # 923463109994
        else:
            formats_to_try.append(normalized_phone)  # 923463109994
            formats_to_try.append(f"+{normalized_phone}")  # +923463109994
            
        self.logger.info(f"Looking for business with phone formats: {formats_to_try}")
        
        # Try each format
        for phone_format in formats_to_try:
            business = self.db.query(Business).filter(Business.whatsapp_number == phone_format).first()
            if business:
                self.logger.info(f"Found business: {business.business_name} with phone: {phone_format}")
                return business
                
        self.logger.warning(f"No business found for phone number: {phone_number}")
        return None
        
    def get_customer_cd(self, mobile_number: str = None):
        """
        Get the customerCd to use for TimeGlobe API calls
        If a mobile number is provided, looks up the business and returns its customerCd
        Otherwise falls back to the default "demo"
        """
        if mobile_number:
            business = self.get_business_by_phone(mobile_number)
            if business and business.customer_cd:
                self.logger.info(f"Using customerCd: {business.customer_cd} for phone: {mobile_number}")
                return business.customer_cd
                
            # If no business found or no customerCd set, log a warning
            if business:
                self.logger.warning(f"Business found for {mobile_number} but no customerCd set")
            
        # Fall back to default
        self.logger.info("Using default customerCd: demo")
        return "demo"
        
    def get_auth_key(self, mobile_number: str = None):
        """
        Get the auth key to use for TimeGlobe API calls
        If a mobile number is provided, looks up the business and returns its auth key
        Otherwise falls back to the default from settings
        """
        auth_key = None
        
        if mobile_number:
            business = self.get_business_by_phone(mobile_number)
            if business and business.timeglobe_auth_key:
                self.logger.info(f"Using TimeGlobe auth key from business: {business.business_name}")
                auth_key = business.timeglobe_auth_key
                self.logger.debug(f"🔑 Raw auth key from business (length={len(auth_key)}): {auth_key[:10]}...{auth_key[-10:]}")
        
        # Fall back to default if no business-specific key
        if not auth_key:
            self.logger.info("Using default TimeGlobe auth key from settings")
            auth_key = settings.TIMEGLOBE_API_KEY
            if auth_key:
                self.logger.debug(f"🔑 Raw auth key from settings (length={len(auth_key)}): {auth_key[:10]}...{auth_key[-10:]}")
        
        # Clean the auth key to handle all edge cases (whitespace, quotes, etc.)
        if auth_key:
            original_length = len(auth_key)
            auth_key = clean_api_key(auth_key)
            cleaned_length = len(auth_key)
            if original_length != cleaned_length:
                self.logger.warning(f"⚠️ Auth key was cleaned: length changed from {original_length} to {cleaned_length}")
            self.logger.info(f"🔑 Cleaned auth key (length={cleaned_length}): {auth_key[:10]}...{auth_key[-10:]}")
            
        return auth_key

    def login(self) -> None:
        """Authenticate and retrieve a new JWT token."""
        main_logger.debug("Attempting to log in to Time Globe API")
        payload = {
            "customerCd": "demo",
            "loginNm": self.username,
            "password": self.password,
        }
        response = requests.post(url=self.base_url + "/auth/login", json=payload)
        if response.status_code == 200:
            self.token = response.json().get("jwt")
            self.expire_time = time.time() + 3600  # 1 hour
            main_logger.info("Successfully logged in to Time Globe API")
        else:
            main_logger.error("Failed to log in to Time Globe API")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Failed to login"
            )

    def get_token(self) -> str:
        """Return a valid token, refreshing if expired."""
        main_logger.debug("Checking token validity")
        if not self.token or time.time() > self.expire_time:
            main_logger.info("Token expired or missing, refreshing token")
            self.login()
        return self.token

    @retry_with_backoff(max_retries=3, backoff_factor=2.0, exceptions=(requests.RequestException,))
    @circuit_breaker("timeglobe_api", failure_threshold=5, recovery_timeout=60)
    @handle_errors(severity=ErrorSeverity.HIGH, category=ErrorCategory.EXTERNAL_API)
    def request(
        self,
        method: str,
        endpoint: str,
        mobile_number: str = None,
        data=None,
        is_header=False,
    ):
        """Generic method to make authenticated requests."""
        main_logger.debug(f"Making {method} request to {endpoint}")

        if mobile_number and not mobile_number.startswith("+"):
            mobile_number = f"+{mobile_number}"

        # Get auth key based on mobile number
        auth_key = self.get_auth_key(mobile_number)
        
        # Log the final auth key that will be sent (SECURITY: Don't log sensitive data)
        main_logger.info(f"📤 Sending request to {endpoint}")
        main_logger.info(f"📱 Mobile number: {mobile_number}")
        if auth_key:
            main_logger.info(f"🔑 Auth key available (length={len(auth_key)})")
            main_logger.debug(f"🔑 Auth key present: {'*' * len(auth_key)}")
        else:
            main_logger.error("❌ No auth key available!")

        headers = {
            "Content-Type": "application/json",
            "x-book-auth-key": auth_key,
            "x-book-login-nm": mobile_number,
        }
        url = f"{self.base_url}{endpoint}"
        main_logger.info(f"********************************************Request payload: {data}")
        main_logger.debug(f"********************************************Request headers: {headers}")

        if data:
            response = requests.request(
                method=method,
                url=url,
                json=data,
                headers=headers if is_header else None,
            )
        else:
            response = requests.request(
                method=method, url=url, headers=headers if is_header else None
            )

        main_logger.debug(f"Response status code: {response.status_code}")
        main_logger.debug(f"Response body: {response.text}")

        if response.status_code in [401, 500]:  # token expired or invalid
            main_logger.warning("Token expired or invalid, attempting to refresh token")
            self.login()
            response = requests.request(
                method=method, url=url, json=data, headers=headers
            )

        return response.json()

    def get_sites(self, mobile_number: str = None):
        """Get the available salons."""
        main_logger.debug("Fetching available salons")
        customer_cd = self.get_customer_cd(mobile_number)
        payload = {"customerCd": customer_cd}
        response = self.request("POST", "/browse/getSites", mobile_number=mobile_number, data=payload)
        #sites = []
        #for item in response.get("sites"):
        #    sites.append(
        #        {"salon name": item.get("siteNm"), "siteCd": item.get("siteCd")}
        #    )
        #main_logger.info(f"Successfully fetched {len(sites)} salons")
        #return sites
        return response
    
    def get_config(self, mobile_number: str = None):
        """Retrieve the customer config from time globe"""
        main_logger.debug("Fetching customer config")
        response = self.request("GET", "/bot/getConfig", mobile_number=mobile_number, is_header=True)
        return response

    def get_products(self, siteCd: str, mobile_number: str = None):
        """Retrieve a list of available services for a selected salon."""
        main_logger.debug(f"Fetching products for site: {siteCd}")
        customer_cd = self.get_customer_cd(mobile_number)
        payload = {"customerCd": customer_cd, "siteCd": siteCd}
        response = self.request("POST", "/browse/getProducts", mobile_number=mobile_number, data=payload)
        main_logger.info(f"Successfully fetched products for site: {siteCd}")
        return response

    def get_employee(self, items: list, siteCd: str, week: int, mobile_number: str = None):
        """Retrieve a list of available employees for a studio."""
        main_logger.debug(f"Fetching employees for item: {items}")
        customer_cd = self.get_customer_cd(mobile_number)
        payload = {
            "customerCd": customer_cd,
            "siteCd": siteCd,
            "week": week,
            "items": items,
        }

        response = self.request("POST", "/browse/getEmployees", mobile_number=mobile_number, data=payload)
        main_logger.info(f"Successfully fetched employees for item: {items}")
        return response

    def AppointmentSuggestion(
        self,
        week: int,
        siteCd: str,
        positions: list = None,
        employee_id: int = None,
        item_no: int = None,
        mobile_number: str = None,
        date_search_string: Optional[List[str]] = None,
    ):
        """
        Retrieve available appointment slots for selected services.
        
        Args:
            week: Week number
            siteCd: Site code
            positions: List of position dictionaries with itemNo and optional employeeId
            employee_id: (Legacy) Employee ID for a single position
            item_no: (Legacy) Item number for a single position
            mobile_number: Customer mobile number
            date_search_string: Optional list of date strings used to filter the
                returned suggestions after retrieval.
        """
        main_logger.debug(f"Fetching appointment suggestions")
        
        # Handle both new (positions list) and legacy (single item/employee) formats
        if positions:
            main_logger.info(f"Using multiple positions: {positions}")
        elif item_no is not None:
            # Support legacy format with single position
            main_logger.info(f"Using legacy format with single position - employee: {employee_id}, item: {item_no}")
            if employee_id is not None and int(employee_id) != 0:
                positions = [{"itemNo": item_no, "employeeId": employee_id}]
            else:
                positions = [{"itemNo": item_no}]
        else:
            main_logger.error("No positions or item_no provided")
            return {"code": -1, "message": "No positions or item_no provided"}

        customer_cd = self.get_customer_cd(mobile_number)
        payload = {
            "customerCd": customer_cd,
            "siteCd": siteCd,
            "week": week,
            "positions": positions,
        }
        response = self.request("POST", "/browse/getSuggestions", mobile_number=mobile_number, data=payload)
        
        # Define the cutoff date (April 1st, 2025)
        cutoff_date = datetime(2025, 4, 1)
        main_logger.info(f"Using cutoff date: {cutoff_date.strftime('%Y-%m-%d')}")
        
        # OPTIMIZATION: Process suggestions more efficiently
        if response and "suggestions" in response:
            suggestions_list = response.get("suggestions", [])
            main_logger.info(f"Processing {len(suggestions_list)} appointment suggestions")
            
            # OPTIMIZATION: Process suggestions in batches and reduce logging overhead
            processed_suggestions = []
            
            for idx, suggestion in enumerate(suggestions_list, 1):
                try:
                    # Process main beginTs
                    original_dt = datetime.strptime(suggestion["beginTs"], "%Y-%m-%dT%H:%M:%S.%fZ")
                    hours_to_add = 2 if original_dt >= cutoff_date else 1
                    adjusted_dt = original_dt.replace(hour=original_dt.hour + hours_to_add)
                    suggestion["beginTs"] = adjusted_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                    
                    # OPTIMIZATION: Process positions more efficiently
                    positions = suggestion.get("positions", [])
                    for position in positions:
                        try:
                            pos_original_dt = datetime.strptime(position["beginTs"], "%Y-%m-%dT%H:%M:%S.%fZ")
                            # Reuse the same hours calculation
                            pos_hours_to_add = 2 if pos_original_dt >= cutoff_date else 1
                            pos_adjusted_dt = pos_original_dt.replace(hour=pos_original_dt.hour + pos_hours_to_add)
                            position["beginTs"] = pos_adjusted_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                        except Exception as pos_e:
                            main_logger.error(f"Error adjusting time for suggestion {idx}, position: {str(pos_e)}")
                            continue
                    
                    processed_suggestions.append(suggestion)
                    
                    # OPTIMIZATION: Reduce logging frequency - only log every 10th suggestion for large batches
                    if idx <= 10 or idx % 10 == 0:
                        main_logger.debug(f"Processed suggestion {idx}/{len(suggestions_list)}")
                        
                except Exception as e:
                    main_logger.error(f"Error processing suggestion {idx}: {str(e)}")
                    continue

            # OPTIMIZATION: Efficient filtering using list comprehension
            if date_search_string:
                main_logger.info(f"Filtering suggestions for dates: {date_search_string}")
                # Pre-compile search patterns for efficiency
                search_patterns = [f"{ds}" for ds in date_search_string]
                
                filtered_suggestions = [
                    suggestion for suggestion in processed_suggestions
                    if any(pattern in suggestion.get("beginTs", "") for pattern in search_patterns)
                ]
                
                if filtered_suggestions:
                    processed_suggestions = filtered_suggestions
                    main_logger.info(f"Found {len(filtered_suggestions)} matching suggestions")
                else:
                    main_logger.info("No suggestions match date_search_string; returning full list")

            # OPTIMIZATION: Use built-in sort with key function
            processed_suggestions.sort(key=lambda x: x.get("beginTs", ""))
            response["suggestions"] = processed_suggestions
        else:
            main_logger.warning("No suggestions found in response or invalid response format")

        main_logger.info("Successfully fetched appointment suggestions")
        return response

    def get_profile(self, mobile_number: str, business_phone: str = None):
        """
        Retrieve the profile data for a given phone number.
        
        Args:
            mobile_number: The customer's mobile number
            business_phone: The business phone number from webhook (if available)
        """
        main_logger.debug(f"Fetching profile for mobile number: {mobile_number}")
        # Make sure the number includes country code and starts with +
        if not mobile_number.startswith("+"):
            mobile_number = f"+{mobile_number}"
        # self.mobile_number = mobile_number
        response = self.request(
            method="GET",
            endpoint="/bot/getProfile",
            mobile_number=mobile_number,
            is_header=True,
        )

        # Check if response is successful (code is 0 or code field doesn't exist)
        # Any negative code is an error
        response_code = response.get("code") if isinstance(response, dict) else None
        
        if response and (response_code is None or response_code == 0):
            main_logger.info(f"Profile found for mobile number: {mobile_number}")
            
            # Save profile to database with proper error handling
            try:
                # Pass the business_phone to link the customer with the business
                self.timeglobe_repo.create_customer(response, mobile_number, business_phone)
                main_logger.info(f"Successfully saved/updated profile in database for {mobile_number}")
                if business_phone:
                    main_logger.info(f"Customer linked to business phone: {business_phone}")
            except Exception as e:
                main_logger.error(f"Error saving profile to database: {str(e)}")
                # Continue execution even if database save fails
                # We want to return the profile data regardless of DB save success
        else:
            if response_code:
                main_logger.error(f"❌ Error getting profile for {mobile_number}: code={response_code}, response={response}")
            else:
                main_logger.warning(f"No profile found for mobile number: {mobile_number}")

        return response

    def get_orders(self, mobile_number):
        """Retrieve a list of open appointments."""
        main_logger.debug("Fetching open orders")
        if not mobile_number.startswith("+"):
            mobile_number = f"+{mobile_number}"
        response = self.request(
            "GET", "/bot/getOrders", is_header=True, mobile_number=mobile_number
        )
        
        # Define the cutoff date (April 1st, 2025)
        cutoff_date = datetime(2025, 4, 1)
        main_logger.info(f"Using cutoff date: {cutoff_date.strftime('%Y-%m-%d')}")
        
        # Adjust order times based on the date
        if response and isinstance(response, list):
            main_logger.info(f"Processing {len(response)} open orders")
            for idx, order in enumerate(response, 1):
                try:
                    # Adjust orderBegin
                    begin_dt = datetime.strptime(order["orderBegin"], "%Y-%m-%dT%H:%M:%S.%fZ")
                    hours_to_add = 0 if begin_dt >= cutoff_date else 0      # 2 ,1 
                    adjusted_begin_dt = begin_dt.replace(hour=begin_dt.hour + hours_to_add)
                    order["orderBegin"] = adjusted_begin_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                    
                    # Adjust orderEnd
                    end_dt = datetime.strptime(order["orderEnd"], "%Y-%m-%dT%H:%M:%S.%fZ")
                    adjusted_end_dt = end_dt.replace(hour=end_dt.hour + hours_to_add)
                    order["orderEnd"] = adjusted_end_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                    
                    main_logger.info(
                        f"Order {idx} (ID: {order.get('orderId')}): Adjusted times - "
                        f"Begin: {begin_dt.strftime('%Y-%m-%d %H:%M')} → {adjusted_begin_dt.strftime('%Y-%m-%d %H:%M')} "
                        f"(+{hours_to_add} hour{'s' if hours_to_add > 1 else ''}), "
                        f"End: {end_dt.strftime('%Y-%m-%d %H:%M')} → {adjusted_end_dt.strftime('%Y-%m-%d %H:%M')}"
                    )
                except Exception as e:
                    main_logger.error(f"Error adjusting times for order {idx}: {str(e)}")
                    continue
        else:
            main_logger.warning("No orders found in response or invalid response format")
            
        main_logger.info("Successfully fetched open orders")
        return response

    def get_old_orders(self, mobile_number: str = None):
        """Retrieve a list of past appointments."""
        main_logger.debug("Fetching old orders")
        if not mobile_number.startswith("+"):
            mobile_number = f"+{mobile_number}"
        response = self.request("GET", "/bot/getOldOrders", mobile_number=mobile_number, is_header=True)
        main_logger.info("Successfully fetched old orders")
        return response

    def get_item_name(self, item_no, siteCd, mobile_number=None):
        """
        Get the name of an item by its item number
        
        Args:
            item_no: The item number to look up
            siteCd: The site code
            mobile_number: The mobile number for context
            
        Returns:
            str: The item name or a default string if not found
        """
        try:
            products = self.get_products(siteCd, mobile_number)
            if products and "products" in products:
                for product in products["products"]:
                    if product.get("itemNo") == item_no:
                        return product.get("itemNm", "")
                        
            # If we get here, item was not found
            self.logger.warning(f"Item name not found for item_no {item_no} in site {siteCd}")
            return f"Service {item_no}"
        except Exception as e:
            self.logger.error(f"Error getting item name: {str(e)}")
            return f"Service {item_no}"
            
    def book_appointment(
        self,
        mobileNumber: str,
        siteCd: str,
        positions: list,
        reminderSms: bool = True,
        reminderEmail: bool = True,
        business_phone_number: str = None
    ):
        """
        Book an appointment with multiple positions.
        
        Args:
            mobileNumber: Client's mobile number
            siteCd: Site code
            positions: List of position dictionaries with keys:
                - beginTs: Timestamp when the appointment begins
                - durationMillis: Duration in milliseconds
                - employeeId: ID of the employee
                - itemNo: Service item number
                - ordinalPosition: Position in sequence
            reminderSms: Whether to send SMS reminders
            reminderEmail: Whether to send email reminders
            business_phone_number: The phone number of the business from the webhook
        """
        main_logger.debug("Booking appointment with multiple positions")
        try:
            if not mobileNumber.startswith("+"):
                mobileNumber = f"+{mobileNumber}"
            
            # Define the cutoff date for time adjustment
            cutoff_date = datetime(2025, 4, 1)
            main_logger.info(f"Using cutoff date: {cutoff_date.strftime('%Y-%m-%d')}")

            # Adjust beginTs in all positions by subtracting hours (reverse of what we do when displaying times)
            adjusted_positions = []
            for i, pos in enumerate(positions):
                main_logger.debug(f"Original position data: {pos}")
                
                try:
                    # Make sure itemNm is present
                    if "itemNm" not in pos or not pos["itemNm"]:
                        item_no = pos.get("itemNo")
                        if item_no:
                            item_name = self.get_item_name(item_no, siteCd, mobileNumber)
                            pos["itemNm"] = item_name
                            main_logger.info(f"Added missing itemNm: {item_name} for item {item_no}")
                
                    original_dt = datetime.strptime(pos["beginTs"], "%Y-%m-%dT%H:%M:%S.%fZ")
                    hours_to_subtract = 2 if original_dt >= cutoff_date else 1
                    adjusted_dt = original_dt.replace(hour=original_dt.hour - hours_to_subtract)
                    adjusted_beginTs = adjusted_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

                    main_logger.info(
                        f"[Position {i+1}] Adjusting appointment time - "
                        f"Original: {original_dt.strftime('%Y-%m-%d %H:%M')} → "
                        f"Adjusted: {adjusted_dt.strftime('%Y-%m-%d %H:%M')} (-{hours_to_subtract} hour{'s' if hours_to_subtract > 1 else ''})"
                    )

                    # Create adjusted position with updated beginTs
                    adjusted_position = pos.copy()
                    adjusted_position["beginTs"] = adjusted_beginTs
                    adjusted_positions.append(adjusted_position)

                except Exception as e:
                    main_logger.warning(f"Could not adjust beginTs for position {i+1}: {str(e)}")
                    adjusted_positions.append(pos)  # fallback to original if parsing fails
                
            payload = {
                "siteCd": siteCd,
                "reminderSms": reminderSms,
                "reminderEmail": reminderEmail,
                "positions": adjusted_positions
            }
            
            # Log the final payload for debugging
            main_logger.debug(f"Final booking payload: {payload}")
            
            response = self.request(
                "POST",
                "/bot/book",
                data=payload,
                is_header=True,
                mobile_number=mobileNumber,
            )
            
            if response.get("code") == 0:
                main_logger.info("Appointment with multiple positions booked successfully")
                # Make sure we pass orderId correctly
                orderId = response.get("orderId")
                main_logger.debug(f"Order ID from TimeGlobe: {orderId}")
                
                # Add the orderId and mobileNumber to the payload
                booking_payload = {
                    "orderId": orderId, 
                    "siteCd": siteCd,
                    "positions": adjusted_positions,
                    "reminderSms": reminderSms, 
                    "reminderEmail": reminderEmail
                }
                
                try:
                    # Log the business phone number being used
                    main_logger.info(f"Saving appointment with orderId: {orderId}, business phone: {business_phone_number}")
                    self.timeglobe_repo.save_book_appointment(booking_payload, mobileNumber, business_phone_number)
                    main_logger.info(f"Successfully saved appointment to database")
                except Exception as db_error:
                    main_logger.error(f"Error saving appointment to database: {str(db_error)}")
            else:
                main_logger.error(f"Failed to book appointment: {response}")
                
            return response
        except Exception as e:
            main_logger.error(f"Error in book_appointment: {str(e)}")
            raise

    def cancel_appointment(self, orderId: int, mobileNumber: str, siteCd):
        """Cancel an existing appointment."""
        main_logger.debug(f"Canceling appointment with order ID: {orderId}")
        payload = {
            "siteCd": siteCd,
            "orderId": orderId,
        }
        response = self.request(
            "POST",
            "/bot/cancel",
            data=payload,
            is_header=True,
            mobile_number=mobileNumber,
        )
        if response.get("code") == 0:
            main_logger.info(f"Appointment canceled successfully: {orderId}")
            # Update the appointment status instead of deleting
            try:
                self.timeglobe_repo.cancel_appointment(orderId)
                main_logger.info(f"Updated appointment status to cancelled: {orderId}")
            except Exception as e:
                main_logger.error(f"Error updating appointment status: {str(e)}")
        else:
            main_logger.error(f"Failed to cancel appointment: {orderId}")
        return response

    def validate_auth_key(self, auth_key: str):
        """
        Validates a TimeGlobe authentication key by making an API call and returns customerCd if valid
        
        Args:
            auth_key: The authentication key to validate
            
        Returns:
            dict: A dictionary containing validation result and customerCd if successful
        """
        try:
            # Clean the auth key first to handle all edge cases
            if auth_key:
                auth_key = clean_api_key(auth_key)
            
            # Endpoint for validation (as shown in the screenshot)
            url = f"{self.base_url}/bot/getConfig"
            
            # Headers with the auth key
            headers = {
                "Content-Type": "application/json",
                "x-book-auth-key": auth_key
            }
            
            self.logger.info(f"Validating TimeGlobe auth key: {auth_key[:5]}***** (cleaned)")
            
            # Make the API call
            response = requests.get(url, headers=headers)
            
            # Process the response
            if response.status_code == 200:
                data = response.json()
                self.logger.info(f"TimeGlobe auth key validation response: {data}")
                
                # Check if response contains an error code
                if data.get("code") == -1003 and "unauthorized" in data.get("text", "").lower():
                    self.logger.warning("TimeGlobe auth key is unauthorized")
                    return {
                        "valid": False,
                        "message": "The TimeGlobe authentication key is invalid. Please get a valid API key from TimeGlobe."
                    }
                
                # Check if response contains customerCd
                if "customerCd" in data:
                    customer_cd = data.get("customerCd")
                    self.logger.info(f"TimeGlobe auth key is valid with customerCd: {customer_cd}")
                    return {
                        "valid": True,
                        "customer_cd": customer_cd
                    }
                
                # Fallback error if format is unexpected
                self.logger.warning(f"Unexpected TimeGlobe validation response format: {data}")
                return {
                    "valid": False,
                    "message": "The TimeGlobe API response was in an unexpected format."
                }
                
            else:
                self.logger.error(f"TimeGlobe auth key validation failed: {response.status_code} - {response.text}")
                return {
                    "valid": False,
                    "message": f"The TimeGlobe API returned an error: {response.text}"
                }
                
        except Exception as e:
            self.logger.exception(f"Error validating TimeGlobe auth key: {str(e)}")
            return {
                "valid": False,
                "message": f"Error connecting to TimeGlobe API: {str(e)}"
            }
    
    def make_api_call(self, endpoint: str, method: str = "GET", data: dict = None, customer_cd: str = None, auth_key: str = None):
        """
        Makes an API call to TimeGlobe with the proper authentication
        
        Args:
            endpoint: The API endpoint to call
            method: HTTP method (GET, POST, etc.)
            data: The payload for the request
            customer_cd: The customer code to use (will be included in the data)
            auth_key: The authentication key to use (if not using the default)
            
        Returns:
            dict: The API response
        """
        try:
            url = f"{self.base_url}/{endpoint}"
            
            # Use provided auth key or default from settings, then clean it
            final_auth_key = auth_key or settings.TIMEGLOBE_API_KEY
            if final_auth_key:
                final_auth_key = clean_api_key(final_auth_key)
            
            # Use provided auth key or default from settings
            headers = {
                "Content-Type": "application/json",
                "x-book-auth-key": final_auth_key
            }
            
            # Add customerCd to the data if provided
            if data is None:
                data = {}
            
            if customer_cd:
                data["customerCd"] = customer_cd
                
            self.logger.info(f"Making {method} request to TimeGlobe {endpoint} with customerCd: {customer_cd}")
            
            # Make the API call
            response = requests.request(
                method=method,
                url=url,
                json=data if method.upper() in ["POST", "PUT", "PATCH"] else None,
                params=data if method.upper() == "GET" else None,
                headers=headers
            )
            
            if response.status_code in [200, 201, 202]:
                result = response.json()
                self.logger.info(f"TimeGlobe API call successful: {endpoint}")
                return result
            else:
                error_message = f"TimeGlobe API call failed: {response.status_code} - {response.text}"
                self.logger.error(error_message)
                raise HTTPException(status_code=response.status_code, detail=error_message)
                
        except Exception as e:
            error_message = f"Error making TimeGlobe API call: {str(e)}"
            self.logger.exception(error_message)
            raise HTTPException(status_code=500, detail=error_message) 
        
        
    def store_profile(
        self,
        mobile_number: str,
        email: str,
        gender: str,
        title: str,
        full_name: str,
        first_name: str,
        last_name: str,
        dplAccepted: bool = False
    ):
        """Store user profile."""
        main_logger.debug(f"Storing profile for mobile number: {mobile_number}")

        # Ensure mobile number is properly formatted (remove leading zeroes, ensure country code, etc.)
        if mobile_number.startswith("0"):
            mobile_number = mobile_number[1:]  # Remove leading zero
        if not mobile_number.startswith("+"):
            # Add + if missing (commonly expected format for international numbers)
            mobile_number = "+" + mobile_number

        # self.mobile_number = mobile_number
        # full_name = first_name + " " + last_name
        
        # Create the payload with proper field names
        payload = {
            "salutationCd": gender,
            "email": email,
            "title": title,
            "fullNm": full_name,
            "firstNm": first_name,
            "lastNm": last_name,
            "dplAccepted": dplAccepted
        }

        # Add extra debugging
        main_logger.debug(f"Sending profile data to API: {payload}")

        try:
            main_logger.info(f"🌐 Sending profile creation request to TimeGlobe API for {mobile_number}")
            response = self.request(
                "POST",
                "/bot/storeProfileData",
                data=payload,
                is_header=True,
                mobile_number=mobile_number,
            )

            # Check for specific response patterns
            main_logger.info(f"📥 TimeGlobe API response for store_profile: {response}")

            if response and isinstance(response, dict):
                code = response.get("code")
                main_logger.info(f"Profile API response code: {code}")

                if code == 0:
                    main_logger.info(
                        f"Profile stored successfully in API: {mobile_number}"
                    )
                    # Make sure customer data has the right field names for the repository
                    customer_data = {
                        "salutationCd": gender,
                        "email": email,
                        "fullNm": full_name,
                        "firstNm": first_name,
                        "lastNm": last_name,
                        "dplAccepted": dplAccepted
                    }
                    self.timeglobe_repo.create_customer(customer_data, mobile_number)
                    return {"code": 0, "message": "Profile created successfully"}
                else:
                    main_logger.error(f"API returned error code: {code}")
                    return response
            else:
                main_logger.error(f"Invalid response from API: {response}")
                return {"code": -1, "message": "Invalid response from API"}
        except Exception as e:
            main_logger.error(f"Error storing profile: {str(e)}")
            return {"code": -1, "message": f"Error: {str(e)}"}

    def update_profile_email(self, mobile_number: str, email: str):
        """
        Update only the email in an existing user profile.
        
        Args:
            mobile_number: The user's mobile number
            email: The new email address
            
        Returns:
            dict: Response containing success/error status and message
        """
        main_logger.debug(f"Updating email for mobile number: {mobile_number} to {email}")

        # Ensure mobile number is properly formatted
        if mobile_number.startswith("0"):
            mobile_number = mobile_number[1:]  # Remove leading zero
            main_logger.debug(f"Removed leading zero from mobile number: {mobile_number}")
        if not mobile_number.startswith("+"):
            mobile_number = "+" + mobile_number
            main_logger.debug(f"Added + prefix to mobile number: {mobile_number}")

        # Create the payload with just the email field
        payload = {
            "email": email
        }

        main_logger.debug(f"Sending email update to API with payload: {payload}")

        try:
            response = self.request(
                "POST",
                "/bot/updateProfileEmail",
                data=payload,
                is_header=True,
                mobile_number=mobile_number,
            )

            main_logger.debug(f"Raw API response for update_profile_email: {response}")

            if response and isinstance(response, dict):
                code = response.get("code")
                main_logger.info(f"Email update API response code: {code}")

                if code == 0:
                    main_logger.info(f"Email updated successfully for: {mobile_number}")
                    # Update email in local database
                    main_logger.debug("Updating email in local database")
                    self.timeglobe_repo.update_customer_email(mobile_number, email)
                    return {"code": 0, "message": "Email updated successfully"}
                else:
                    main_logger.error(f"API returned error code: {code}, full response: {response}")
                    return response
            else:
                main_logger.error(f"Invalid response from API: {response}")
                return {"code": -1, "message": "Invalid response from API"}
        except Exception as e:
            main_logger.error(f"Error updating email: {str(e)}", exc_info=True)
            return {"code": -1, "message": f"Error: {str(e)}"}

    def update_profile_name(self, mobile_number: str, full_name: str, first_name: str = None, last_name: str = None):
        """
        Update only the name fields in an existing user profile.
        
        Args:
            mobile_number: The user's mobile number
            full_name: Full name of the user (Required)
            first_name: First name of the user (Optional)
            last_name: Last name of the user (Optional)
            
        Returns:
            dict: Response containing success/error status and message
        """
        main_logger.debug(f"Updating name for mobile number: {mobile_number}")

        # Ensure mobile number is properly formatted
        if mobile_number.startswith("0"):
            mobile_number = mobile_number[1:]
        if not mobile_number.startswith("+"):
            mobile_number = "+" + mobile_number

        # Create the payload with name fields
        payload = {
            "fullNm": full_name
        }
        if first_name:
            payload["firstNm"] = first_name
        if last_name:
            payload["lastNm"] = last_name

        main_logger.debug(f"Sending name update to API: {payload}")

        try:
            response = self.request(
                "POST",
                "/bot/updateProfileName",
                data=payload,
                is_header=True,
                mobile_number=mobile_number,
            )

            main_logger.debug(f"API response for update_profile_name: {response}")

            if response and isinstance(response, dict):
                code = response.get("code")
                main_logger.info(f"Name update API response code: {code}")

                if code == 0:
                    main_logger.info(f"Name updated successfully for: {mobile_number}")
                    # Update name in local database
                    self.timeglobe_repo.update_customer_name(mobile_number, full_name, first_name, last_name)
                    return {"code": 0, "message": "Name updated successfully"}
                else:
                    main_logger.error(f"API returned error code: {code}")
                    return response
            else:
                main_logger.error(f"Invalid response from API: {response}")
                return {"code": -1, "message": "Invalid response from API"}
        except Exception as e:
            main_logger.error(f"Error updating name: {str(e)}")
            return {"code": -1, "message": f"Error: {str(e)}"}

    def update_profile_salutation(self, mobile_number: str, salutation_cd: str):
        """
        Update only the salutation in an existing user profile.
        
        Args:
            mobile_number: The user's mobile number
            salutation_cd: The salutation code ("na", "male", "female", "diverse")
            
        Returns:
            dict: Response containing success/error status and message
        """
        main_logger.debug(f"Updating salutation for mobile number: {mobile_number}")

        # Validate salutation code
        valid_salutations = ["na", "male", "female", "diverse"]
        if salutation_cd not in valid_salutations:
            return {"code": -1, "message": f"Invalid salutation code. Must be one of: {', '.join(valid_salutations)}"}

        # Ensure mobile number is properly formatted
        if mobile_number.startswith("0"):
            mobile_number = mobile_number[1:]
        if not mobile_number.startswith("+"):
            mobile_number = "+" + mobile_number

        # Create the payload
        payload = {
            "salutationCd": salutation_cd
        }

        main_logger.debug(f"Sending salutation update to API: {payload}")

        try:
            response = self.request(
                "POST",
                "/bot/updateProfileSalutation",
                data=payload,
                is_header=True,
                mobile_number=mobile_number,
            )

            main_logger.debug(f"API response for update_profile_salutation: {response}")

            if response and isinstance(response, dict):
                code = response.get("code")
                main_logger.info(f"Salutation update API response code: {code}")

                if code == 0:
                    main_logger.info(f"Salutation updated successfully for: {mobile_number}")
                    # Update salutation in local database
                    self.timeglobe_repo.update_customer_salutation(mobile_number, salutation_cd)
                    return {"code": 0, "message": "Salutation updated successfully"}
                else:
                    main_logger.error(f"API returned error code: {code}")
                    return response
            else:
                main_logger.error(f"Invalid response from API: {response}")
                return {"code": -1, "message": "Invalid response from API"}
        except Exception as e:
            main_logger.error(f"Error updating salutation: {str(e)}")
            return {"code": -1, "message": f"Error: {str(e)}"}

    def update_data_protection(self, mobile_number: str, dpl_accepted: bool):
        """
        Update only the data protection acceptance status in an existing user profile.
        
        Args:
            mobile_number: The user's mobile number
            dpl_accepted: Whether data protection is accepted
            
        Returns:
            dict: Response containing success/error status and message
        """
        main_logger.debug(f"Updating data protection for mobile number: {mobile_number}")

        # Ensure mobile number is properly formatted
        if mobile_number.startswith("0"):
            mobile_number = mobile_number[1:]
        if not mobile_number.startswith("+"):
            mobile_number = "+" + mobile_number

        # Create the payload
        payload = {
            "dplAccepted": dpl_accepted
        }

        main_logger.debug(f"Sending data protection update to API: {payload}")

        try:
            response = self.request(
                "POST",
                "/bot/updateDataProtection",
                data=payload,
                is_header=True,
                mobile_number=mobile_number,
            )

            main_logger.debug(f"API response for update_data_protection: {response}")

            if response and isinstance(response, dict):
                code = response.get("code")
                main_logger.info(f"Data protection update API response code: {code}")

                if code == 0:
                    main_logger.info(f"Data protection updated successfully for: {mobile_number}")
                    # Update data protection in local database
                    self.timeglobe_repo.update_customer_data_protection(mobile_number, dpl_accepted)
                    return {"code": 0, "message": "Data protection updated successfully"}
                else:
                    main_logger.error(f"API returned error code: {code}")
                    return response
            else:
                main_logger.error(f"Invalid response from API: {response}")
                return {"code": -1, "message": "Invalid response from API"}
        except Exception as e:
            main_logger.error(f"Error updating data protection: {str(e)}")
            return {"code": -1, "message": f"Error: {str(e)}"}
