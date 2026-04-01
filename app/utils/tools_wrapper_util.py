import re
import logging
import time
from datetime import datetime, timedelta
from .timezone_util import BERLIN_TZ
from ..core.config import settings
from typing import List, Dict, Optional
from .validation_util import validate_function_parameters, ValidationError

# Set up logging
logger = logging.getLogger(__name__)

# Remove circular imports - use lazy loading instead
_assistant_manager = None
_chat_agent = None
_timeglobe_service = None


def _get_assistant_manager():
    """Lazy initialization of the AssistantManager to avoid circular imports"""
    global _assistant_manager
    if _assistant_manager is None:
        from ..agent import AssistantManager

    return _assistant_manager


def _get_chat_agent():
    """Lazy initialization of the ChatAgent to avoid circular imports"""
    global _chat_agent
    if _chat_agent is None:
        from ..chat_agent import ChatAgent
        from ..core.config import settings
        from ..db.session import SessionLocal
        
        # Create a new session for the chat agent
        db = SessionLocal()
        _chat_agent = ChatAgent(db=db)  # No need to pass the API key, it will use from settings
    return _chat_agent


def _get_timeglobe_service():
    """Lazy initialization of the TimeGlobeService to avoid circular imports"""
    global _timeglobe_service
    if _timeglobe_service is None:
        from ..services.timeglobe_service import TimeGlobeService

        _timeglobe_service = TimeGlobeService()
    return _timeglobe_service


def get_sites():
    """Get a list of available salons"""
    logger.info("Tool called: get_sites()")
    start_time = time.time()
    try:
        service = _get_timeglobe_service()
        auth_key = service.get_auth_key()
        logger.info(f"🔑 [get_sites] Using auth key (length={len(auth_key) if auth_key else 0}): {auth_key[:15] if auth_key else 'NONE'}...{auth_key[-15:] if auth_key and len(auth_key) > 15 else ''}")
        response = service.get_sites()
        execution_time = time.time() - start_time
        logger.info(f"get_sites() completed successfully in {execution_time:.2f}s")
        return {"status": "success", "response": response}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in get_sites(): {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}


def get_products(siteCd: str):
    """Get a list of available services for a specific salon"""
    logger.info(f"Tool called: get_products(siteCd={siteCd})")
    start_time = time.time()
    try:
        service = _get_timeglobe_service()
        auth_key = service.get_auth_key()
        logger.info(f"🔑 [get_products] Using auth key (length={len(auth_key) if auth_key else 0}): {auth_key[:15] if auth_key else 'NONE'}...{auth_key[-15:] if auth_key and len(auth_key) > 15 else ''}")
        products = service.get_products(siteCd)
        execution_time = time.time() - start_time
        logger.info(f"get_products() completed successfully in {execution_time:.2f}s")
        return {"status": "success", "products": products}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in get_products(): {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}


def get_employee(items, siteCd,week):
    """Get a list of available employees for a specific service.
     Parameters:
    items (int): The item number of the selected service for which employees are to be retrieved.
    siteCd (str): The siteCd of the salon"""
    logger.info(f"Tool called: get_employee(items={items}, siteCd={siteCd},week={week})")
    start_time = time.time()
    try:
        employees = _get_timeglobe_service().get_employee(items, siteCd,week)
        execution_time = time.time() - start_time
        logger.info(f"get_employee() completed successfully in {execution_time:.2f}s")
        return {"status": "success", "employees": employees}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in get_employee(): {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}


def AppointmentSuggestion(siteCd: str, week: int, positions: List[Dict], dateSearchString: Optional[List[str]] = None):
    """Get available appointment slots for selected services and salon
    
    Args:
        siteCd: Site code from getSites
        week: Week number (0 = current week, 1 = next week, etc.)
        positions: List of position objects with itemNo and optional employeeId
        dateSearchString: Optional list of date strings to filter suggestions
    """
    logger.info(
        f"Tool called: AppointmentSuggestion(siteCd={siteCd}, week={week}, positions={positions}, dateSearchString={dateSearchString})"
    )
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "AppointmentSuggestion",
            siteCd=siteCd,
            week=week,
            positions=positions,
            dateSearchString=dateSearchString
        )
        
        # Call the service with the validated parameters
        suggestions = _get_timeglobe_service().AppointmentSuggestion(
            week=validated_params["week"],
            siteCd=validated_params["siteCd"],
            positions=validated_params["positions"],
            date_search_string=dateSearchString,
        )
        
        execution_time = time.time() - start_time
        logger.info(
            f"AppointmentSuggestion() completed successfully in {execution_time:.2f}s"
        )
        return {"status": "success", "suggestions": suggestions}
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(
            f"Validation error in AppointmentSuggestion(): {str(e)} - took {execution_time:.2f}s"
        )
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(
            f"Error in AppointmentSuggestion(): {str(e)} - took {execution_time:.2f}s"
        )
        return {"status": "error", "message": str(e)}


def book_appointment(
    mobileNumber: str,
    siteCd: str,
    positions: list,
    reminderSms: bool = True,
    reminderEmail: bool = True,
    business_phone_number: str = None
):
    """Book appointments with the selected parameters. Supports multiple positions."""
    logger.info(
        f"Tool called: book_appointment(positions={positions}, siteCd={siteCd}, business_phone_number={business_phone_number})"
    )
    start_time = time.time()
    try:
        # Format mobile number if needed
        if not mobileNumber.startswith("+"):
            mobileNumber = f"+{mobileNumber}"
            
        # Validate each position has required fields
        required_fields = ["beginTs", "durationMillis", "employeeId", "itemNo", "ordinalPosition"]
        for pos in positions:
            missing = [k for k in required_fields if k not in pos]
            if missing:
                logger.warning(f"Missing required fields in position: {missing}")
                return {"status": "error", "message": f"Missing required fields in position: {missing}"}
            
            # Ensure itemNm is present, use itemNo as fallback
            if "itemNm" not in pos or not pos["itemNm"]:
                pos["itemNm"] = f"Service {pos.get('itemNo')}"
                logger.info(f"Added default itemNm for itemNo: {pos.get('itemNo')}")
                
            logger.info(f"Processing appointment with date and time={pos.get('beginTs')}")

        # Call the service function with multiple positions
        result = _get_timeglobe_service().book_appointment(
            mobileNumber=mobileNumber,
            siteCd=siteCd,
            positions=positions,
            reminderSms=reminderSms,
            reminderEmail=reminderEmail,
            business_phone_number=business_phone_number
        )
        
        execution_time = time.time() - start_time
        if result.get("code") == 90:
            logger.info(
                f"book_appointment() - user already has 2 appointments - took {execution_time:.2f}s"
            )
            return {
                "status": "success",
                "booking_result": "you already have 2 appointments in future \
            in order to make another appointment please cancel one of them.",
            }
        elif result.get("code") == 0:
            order_id = result.get("orderId")
            logger.info(
                f"book_appointment() - appointment booked successfully (orderID: {order_id}) - took {execution_time:.2f}s"
            )
            return {
                "status": "success",
                "booking_result": f"appointment booked successfully orderID is {order_id}",
            }
        else:
            logger.warning(
                f"book_appointment() - unexpected code: {result.get('code')} - took {execution_time:.2f}s"
            )
            return {
                "status": "error",
                "message": f"Unexpected response code: {result.get('code')}",
            }
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(
            f"Error in book_appointment(): {str(e)} - took {execution_time:.2f}s"
        )
        return {"status": "error", "message": str(e)}


def cancel_appointment(order_id: int, mobileNumber: str, siteCd: str):
    """Cancel an appointment with the given order ID."""
    logger.info(f"Tool called: cancel_appointment(order_id={order_id})")
    start_time = time.time()
    
    try:
        result = _get_timeglobe_service().cancel_appointment(order_id, mobileNumber, siteCd)
        
        execution_time = time.time() - start_time
        logger.info(f"cancel_appointment() completed in {execution_time:.2f}s")
        
        return result
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in cancel_appointment(): {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}


def get_profile(mobile_number: str):
    """Get the profile data for a given phone number"""
    logger.info(f"Tool called: get_profile(mobile_number={mobile_number})")
    start_time = time.time()
    try:
        # Get the business phone number from MessageCache
        from .message_cache import MessageCache
        message_cache = MessageCache.get_instance()
        business_phone = message_cache.get_business_phone(mobile_number)
        
        if business_phone:
            logger.info(f"Found business phone {business_phone} for customer {mobile_number}")
        
        # Get TimeGlobe service instance
        service = _get_timeglobe_service()
        
        # Get profile from TimeGlobe API
        profile = service.get_profile(mobile_number, business_phone)
        execution_time = time.time() - start_time

        if profile.get("code") == 0:
            logger.info(
                f"get_profile() - profile retrieved successfully - took {execution_time:.2f}s"
            )
            
            # Ensure profile is saved to local database
            try:
                # The profile should already be saved by the service.get_profile call,
                # but we'll make an explicit call to ensure it's saved
                logger.info(f"Ensuring profile is saved to local database")
                service.timeglobe_repo.create_customer(profile, mobile_number, business_phone)
                logger.info(f"Successfully saved/updated profile in local database")
                if business_phone:
                    logger.info(f"Customer linked to business phone: {business_phone}")
            except Exception as db_error:
                logger.error(f"Error ensuring profile is in local database: {str(db_error)}")
                # Continue even if DB save fails
                
            return {"status": "success", "profile": profile}
        elif profile.get("code") == -3:
            logger.info(
                f"get_profile() - user does not exist - took {execution_time:.2f}s"
            )
            return {
                "status": "success",
                "message": "user with this number does not exist",
            }
        else:
            logger.warning(
                f"get_profile() - error getting user info, code: {profile.get('code')} - took {execution_time:.2f}s"
            )
            return {"status": "success", "message": "there is error getting user info"}

    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in get_profile(): {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}


def get_orders(mobile_number: str):
    """Get a list of open appointments"""
    logger.info("Tool called: get_orders()")
    start_time = time.time()
    try:
        service = _get_timeglobe_service()
        auth_key = service.get_auth_key(mobile_number)
        logger.info(f"🔑 [get_orders] Using auth key for {mobile_number} (length={len(auth_key) if auth_key else 0}): {auth_key[:15] if auth_key else 'NONE'}...{auth_key[-15:] if auth_key and len(auth_key) > 15 else ''}")
        orders = service.get_orders(mobile_number=mobile_number)
        execution_time = time.time() - start_time
        logger.info(f"get_orders() completed successfully in {execution_time:.2f}s")
        return {"status": "success", "orders": orders}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in get_orders(): {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}


def store_profile_wrapper(fullNm=None, lastNm=None, firstNm=None, salutationCd=None, email=None, newContact=None, dplAccepted=None, marketingAccepted=None, mobile_number=None):
    """Wrapper for store_profile that accepts German schema parameters"""
    logger.info(f"🔧 TOOL CALLED: store_profile_wrapper")
    logger.info(f"   Parameters: fullNm={fullNm}, salutationCd={salutationCd}, email={email}, mobile_number={mobile_number}, dplAccepted={dplAccepted}")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "store_profile_wrapper",
            fullNm=fullNm,
            lastNm=lastNm,
            firstNm=firstNm,
            salutationCd=salutationCd,
            email=email,
            dplAccepted=dplAccepted,
            mobile_number=mobile_number
        )
        
        # Map the German parameters to the existing function
        # Map salutationCd to gender
        gender_mapping = {
            "male": "M",
            "female": "F", 
            "diverse": "D",
            "na": "M"  # Default to male if not specified
        }
        
        salutation_cd = validated_params.get("salutationCd", salutationCd)
        gender = gender_mapping.get(salutation_cd, "M") if salutation_cd else "M"
        
        execution_time = time.time() - start_time
        logger.info(f"store_profile_wrapper validation completed in {execution_time:.2f}s")
        
        # Call the TimeGlobe service directly with the correct parameters
        service = _get_timeglobe_service()
        result = service.store_profile(
            mobile_number=validated_params.get("mobile_number", mobile_number or ""),
            email=validated_params.get("email", email or ""),
            gender=salutation_cd,  # Use the original salutationCd value, not the mapped gender
            title="",  # Not provided in schema
            full_name=validated_params.get("fullNm", fullNm or ""),
            first_name=firstNm or "",
            last_name=lastNm or "",
            dplAccepted=validated_params.get("dplAccepted", dplAccepted or False)
        )
        
        execution_time = time.time() - start_time

        if result.get("code") == 0:
            logger.info(f"store_profile_wrapper() completed successfully in {execution_time:.2f}s")
            return {"status": "success", "message": result.get("message", "Profile created successfully")}
        else:
            logger.warning(f"store_profile_wrapper() returned error code {result.get('code')} in {execution_time:.2f}s")
            return {"status": "error", "message": result.get("message", "Failed to create profile")}
        
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in store_profile_wrapper: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in store_profile_wrapper: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}


def format_response(text):
    logger.debug(f"Tool called: format_response(text length={len(text) if text else 0})")
    start_time = time.time()
    try:
        # Handle None or empty text
        if not text:
            logger.warning("Empty text passed to format_response")
            return "I'm sorry, I couldn't generate a proper response. Please try again."
            
        final_response = replace_double_with_single_asterisks(text)  # removing single *
        final_response = remove_sources(final_response)  # removing sources if any
        final_response = remove_brackets(
            final_response
        )  # removing brackets before linke
        final_response = remove_small_brackets(
            final_response
        )  # removing small brackets from link
        # remove all ### from the response
        final_response = final_response.replace("### ", "")

        execution_time = time.time() - start_time
        logger.debug(f"format_response() completed in {execution_time:.4f}s")
        return final_response
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(
            f"Error in format_response(): {str(e)} - took {execution_time:.4f}s"
        )
        return text or "I'm sorry, I couldn't generate a proper response. Please try again."  # Return original text or default message if formatting fails


def replace_double_with_single_asterisks(text):
    return re.sub(r"\*\*(.*?)\*\*", r"*\1*", text)


def remove_sources(text):
    # Use regex to match the pattern 【number:number†filename.extension】
    clean_text = re.sub(r"【\d+:\d+†[^\s]+】", "", text)
    return clean_text


def remove_brackets(text):
    # Use regex to find and remove square brackets and their content
    return re.sub(r"\[.*?\]", "", text)


def remove_small_brackets(text):
    # Use regex to find and remove only the parentheses, but keep the content inside
    return re.sub(r"[()]", "", text)


def format_datetime(user_date_time: str) -> str:
    """
    Converts various user date-time formats to ISO 8601 format using the Berlin timezone.
    Handles formats like:
    - YYYY-MM-DD HH:MM
    - YYYY-MM-DD HH:MM AM/PM
    - Month DD, YYYY HH:MM AM/PM
    - Already ISO 8601 formatted strings (returns as-is)

    Args:
        user_date_time: A string containing date and time

    Returns:
        ISO 8601 formatted string (YYYY-MM-DDT00:00:00.000Z) in Berlin timezone

    Raises:
        ValueError: If the date-time format cannot be parsed
    """
    start_time = time.time()
    logger.info(f"format_datetime() called with input: {user_date_time}")

    # Check if input is already in ISO 8601 format
    iso_pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$"
    if re.match(iso_pattern, user_date_time):
        # Validate it's a real date by parsing and reformatting
        try:
            dt = datetime.strptime(user_date_time, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=BERLIN_TZ)
            dt = dt.astimezone(BERLIN_TZ)
            result = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            logger.info(f"Input already in ISO format: {user_date_time}")
            return result
        except ValueError:
            try:
                dt = datetime.strptime(user_date_time, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=BERLIN_TZ)
                dt = dt.astimezone(BERLIN_TZ)
                result = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                logger.info(f"Input already in ISO format: {user_date_time}")
                return result
            except ValueError:
                logger.debug(
                    "Input matched ISO pattern but failed validation, trying other formats"
                )
                pass  # Not a valid ISO format, continue with other formats

    formats = [
        # YYYY-MM-DD formats
        "%Y-%m-%d %H:%M",  # 2025-03-21 14:00
        "%Y-%m-%d %I:%M %p",  # 2025-03-21 02:00 PM
        # Month name formats
        "%B %d, %Y %I:%M %p",  # March 21, 2025 10:00 AM
        "%b %d, %Y %I:%M %p",  # Mar 21, 2025 10:00 AM
        # Additional formats with various separators
        "%Y/%m/%d %H:%M",  # 2025/03/21 14:00
        "%d/%m/%Y %H:%M",  # 21/03/2025 14:00
        "%m/%d/%Y %I:%M %p",  # 03/21/2025 02:00 PM
        "%d-%b-%Y %I:%M %p",  # 21-Mar-2025 02:00 PM
    ]

    # If input contains separate date and time parameters
    if " " in user_date_time and len(user_date_time.split(" ")) == 2:
        user_date, user_time = user_date_time.split(" ", 1)
        logger.debug(f"Split input into date: {user_date} and time: {user_time}")
        # Try both formats from the original function
        try:
            dt = datetime.strptime(f"{user_date} {user_time}", "%Y-%m-%d %H:%M")
            dt = dt.replace(tzinfo=BERLIN_TZ)
            result = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            execution_time = time.time() - start_time
            logger.info(
                f"format_datetime() completed successfully in {execution_time:.4f}s"
            )
            return result
        except ValueError:
            logger.debug(
                "Failed to parse with format %Y-%m-%d %H:%M, trying %Y-%m-%d %I:%M %p"
            )
            try:
                dt = datetime.strptime(f"{user_date} {user_time}", "%Y-%m-%d %I:%M %p")
                dt = dt.replace(tzinfo=BERLIN_TZ)
                result = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                execution_time = time.time() - start_time
                logger.info(
                    f"format_datetime() completed successfully in {execution_time:.4f}s"
                )
                return result
            except ValueError:
                logger.debug(
                    "Failed to parse with both initial formats, continuing to other formats"
                )
                pass  # Continue to the general case

    # Try all formats
    for fmt in formats:
        try:
            logger.debug(f"Trying format: {fmt}")
            dt = datetime.strptime(user_date_time, fmt)
            dt = dt.replace(tzinfo=BERLIN_TZ)
            result = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            execution_time = time.time() - start_time
            logger.info(
                f"format_datetime() completed successfully in {execution_time:.4f}s"
            )
            return result
        except ValueError:
            continue

    # If still no match, try to be more flexible by normalizing the input
    normalized_input = user_date_time.replace(",", "")  # Remove commas
    logger.debug(f"Using normalized input: {normalized_input}")

    # Check for common patterns
    month_pattern = r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2})[\w,]* (\d{4})"
    time_pattern = r"(\d{1,2}):(\d{2})(?:\s*([AP]M))?"

    month_match = re.search(month_pattern, user_date_time, re.IGNORECASE)
    time_match = re.search(time_pattern, user_date_time)

    if month_match and time_match:
        logger.debug("Found month and time patterns in the input")
        month = month_match.group(1)
        day = month_match.group(2)
        year = month_match.group(3)

        hour = time_match.group(1)
        minute = time_match.group(2)
        ampm = time_match.group(3) if time_match.group(3) else ""

        logger.debug(
            f"Extracted components - Month: {month}, Day: {day}, Year: {year}, Hour: {hour}, Minute: {minute}, AM/PM: {ampm}"
        )

        try:
            date_str = f"{month} {day} {year} {hour}:{minute} {ampm}".strip()
            format_str = "%b %d %Y %I:%M %p" if ampm else "%b %d %Y %H:%M"
            logger.debug(
                f"Attempting to parse: '{date_str}' with format: '{format_str}'"
            )

            dt = datetime.strptime(date_str, format_str)
            dt = dt.replace(tzinfo=BERLIN_TZ)
            result = dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            execution_time = time.time() - start_time
            logger.info(
                f"format_datetime() completed successfully in {execution_time:.4f}s"
            )
            return result
        except ValueError as e:
            logger.debug(f"Failed to parse extracted components: {e}")
            pass

    # If we get here, no format matched
    execution_time = time.time() - start_time
    logger.error(
        f"Invalid date-time format: {user_date_time} (processing took {execution_time:.4f}s)"
    )
    raise ValueError(f"Invalid date-time format: {user_date_time}")


def get_response_from_gpt(msg, user_id, _assistant_manager=None):
    logger.info(f"Tool called: get_response_from_gpt(user_id={user_id})")
    start_time = time.time()
    
    # Retry configuration
    max_retries = 2
    retry_count = 0
    
    while retry_count <= max_retries:
        try:
            # Get business phone number from cache
            from .message_cache import MessageCache
            message_cache = MessageCache.get_instance()
            business_phone = message_cache.get_business_phone(user_id)
            
            if business_phone:
                logger.info(f"Retrieved business phone {business_phone} for user {user_id}")
                # Add business phone number to the message context
                msg = f"{msg}\n\nBUSINESS_PHONE:{business_phone}"
                logger.debug(f"Updated message with business phone: {msg}")
            
            # Use the new ChatAgent instead of AssistantManager
            chat_agent = _get_chat_agent()
            response = chat_agent.run_conversation(user_id, msg)
            
            # Check if response is empty or error-like
            if not response or response.strip() == "" or "couldn't generate" in response.lower() or "error" in response.lower():
                logger.warning(f"Empty or error-like response from ChatAgent (attempt {retry_count + 1}): {response}")
                if retry_count < max_retries:
                    logger.info(f"Retrying get_response_from_gpt (attempt {retry_count + 1}/{max_retries})")
                    retry_count += 1
                    time.sleep(1)  # Wait 1 second before retry
                    continue
                else:
                    logger.error("Max retries exceeded for get_response_from_gpt")
                    return "Entschuldigung, ich konnte keine Antwort generieren. Bitte versuchen Sie es erneut."
            
            execution_time = time.time() - start_time
            logger.info(
                f"get_response_from_gpt() for user {user_id} completed successfully in {execution_time:.2f}s"
            )
            return response
            
        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(
                f"Error in get_response_from_gpt() (attempt {retry_count + 1}): {str(e)} - took {execution_time:.2f}s"
            )
            
            if retry_count < max_retries:
                logger.info(f"Retrying get_response_from_gpt due to error (attempt {retry_count + 1}/{max_retries})")
                retry_count += 1
                time.sleep(1)  # Wait 1 second before retry
                continue
            else:
                logger.error("Max retries exceeded for get_response_from_gpt due to errors")
                return f"Entschuldigung, es ist ein Fehler aufgetreten: {str(e)}"
    
    # This should never be reached, but just in case
    return "Entschuldigung, ich konnte keine Antwort generieren. Bitte versuchen Sie es erneut."


# Function aliases to match the German function names
def getSites():
    return get_sites()

def getProducts(siteCd: str):
    """Wrapper for get_products that validates siteCd"""
    logger.info(f"Tool called: getProducts(siteCd={siteCd})")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "getProducts",
            siteCd=siteCd
        )
        
        execution_time = time.time() - start_time
        logger.info(f"getProducts validation completed in {execution_time:.2f}s")
        
        return get_products(validated_params["siteCd"])
        
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in getProducts: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in getProducts: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}

def getEmployees(siteCd: str, week: int, items: List[str]):
    """Get available employees for selected services
    
    Args:
        siteCd: Site code from getSites
        week: Week number (0 = current week, 1 = next week, etc.)
        items: Array of itemNo strings from getProducts
    """
    logger.info(f"Tool called: getEmployees(siteCd={siteCd}, week={week}, items={items})")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "getEmployees",
            siteCd=siteCd,
            week=week
        )
        
        # Validate parameters
        if not items or not isinstance(items, list):
            return {"status": "error", "message": "items parameter must be a non-empty list"}
        
        # Convert string items to integers if needed
        try:
            items_int = [int(item) for item in items]
        except (ValueError, TypeError):
            return {"status": "error", "message": "All items must be valid integers"}
        
        execution_time = time.time() - start_time
        logger.info(f"getEmployees validation completed in {execution_time:.2f}s")
        
        # Call the existing get_employee function
        return get_employee(items_int, validated_params["siteCd"], validated_params["week"])
        
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in getEmployees: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in getEmployees: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}

def getProfile(mobile_number:str=None):
    """Wrapper for get_profile that accepts mobile_number"""
    # Directly call the timeglobe_service method to avoid recursive calls
    try:
        # Make sure we have a valid mobile number
        if not mobile_number:
            mobile_number = ""
        logger.info(f"getProfile wrapper called with mobile_number={mobile_number}")
        
        # Get the business phone number from MessageCache
        from .message_cache import MessageCache
        message_cache = MessageCache.get_instance()
        business_phone = message_cache.get_business_phone(mobile_number)
        
        if business_phone:
            logger.info(f"Found business phone {business_phone} for customer {mobile_number}")
        
        # Get the TimeGlobe service instance
        service = _get_timeglobe_service()
        
        # Log auth key being used
        auth_key = service.get_auth_key(mobile_number)
        logger.info(f"🔑 [getProfile] Using auth key for {mobile_number} (length={len(auth_key) if auth_key else 0}): {auth_key[:15] if auth_key else 'NONE'}...{auth_key[-15:] if auth_key and len(auth_key) > 15 else ''}")
        
        # Call the service to get the profile with business phone
        response = service.get_profile(mobile_number, business_phone)
        
        # Check if response is successful (code is 0 or None, any negative code is an error)
        response_code = response.get("code") if isinstance(response, dict) else None
        
        # Ensure profile data is stored in local database if valid
        if response and (response_code is None or response_code == 0):
            logger.info(f"Valid profile found for {mobile_number}, ensuring it's saved to local DB")
            try:
                # Get the repository from the service to avoid creating a new one
                repo = service.timeglobe_repo
                repo.create_customer(response, mobile_number, business_phone)
                logger.info(f"Successfully saved/updated profile in local database")
                if business_phone:
                    logger.info(f"Customer linked to business phone: {business_phone}")
            except Exception as db_error:
                logger.error(f"Error saving profile to local database: {str(db_error)}")
                # Continue even if saving to DB fails - we still want to return the profile
        else:
            if response_code:
                logger.error(f"❌ Failed to get profile for {mobile_number}: code={response_code}, message={response.get('text', 'No message')}")
        
        return response
    except Exception as e:
        logger.error(f"Error in getProfile wrapper: {str(e)}")
        return {"status": "error", "message": f"Error retrieving profile: {str(e)}"}

def getOrders(mobile_number:str=None):
    """Wrapper for get_orders that accepts mobile_number"""
    # Directly call the timeglobe_service method to avoid recursive calls
    try:
        # Make sure we have a valid mobile number
        if not mobile_number:
            mobile_number = ""
        logger.info(f"getOrders wrapper called with mobile_number={mobile_number}")
        service = _get_timeglobe_service()
        auth_key = service.get_auth_key(mobile_number)
        logger.info(f"🔑 [getOrders] Using auth key for {mobile_number} (length={len(auth_key) if auth_key else 0}): {auth_key[:15] if auth_key else 'NONE'}...{auth_key[-15:] if auth_key and len(auth_key) > 15 else ''}")
        return service.get_orders(mobile_number)
    except Exception as e:
        logger.error(f"Error in getOrders wrapper: {str(e)}")
        return {"status": "error", "message": f"Error retrieving orders: {str(e)}"}

def getBookableCustomers(siteCd: str, mobile_number: str = None):
    """Get bookable customers for a site"""
    logger.info(f"Tool called: getBookableCustomers(siteCd={siteCd}, mobile_number={mobile_number})")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "getBookableCustomers",
            siteCd=siteCd
        )
        
        response = _get_timeglobe_service().get_bookable_customers(validated_params["siteCd"], mobile_number)
        execution_time = time.time() - start_time
        logger.info(f"getBookableCustomers() completed in {execution_time:.2f}s")
        return response
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in getBookableCustomers: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in getBookableCustomers(): {str(e)} - took {execution_time:.2f}s")
        return {"error": str(e)}

def AppointmentSuggestion_wrapper(siteCd: str, week: int, positions: List[Dict], dateSearchString: Optional[List[str]] = None):
    """Wrapper for AppointmentSuggestion to match the new schema.

    Parameters
    ----------
    siteCd : str
        Site code from getSites.
    week : int
        Week index for which suggestions are retrieved.
    positions : List[Dict]
        List of service positions.
    dateSearchString : Optional[List[str]]
        Optional list of date strings used to filter suggestions.
    """
    logger.info(
        f"Tool called: AppointmentSuggestion_wrapper(siteCd={siteCd}, week={week}, positions={positions}, dateSearchString={dateSearchString})"
    )
    
    # Call the updated AppointmentSuggestion function directly
    return AppointmentSuggestion(
            siteCd=siteCd,
        week=week,
            positions=positions,
        dateSearchString=dateSearchString
        )

def bookAppointment(siteCd: str, positions: List[Dict], reminderSms: bool = True, reminderEmail: bool = True, customerId: str = None, business_phone_number: str = None):
    """Book an appointment with validation"""
    logger.info(f"Tool called: bookAppointment(siteCd={siteCd}, positions={positions})")
    start_time = time.time()
    
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "bookAppointment",
            siteCd=siteCd,
            reminderSms=reminderSms,
            reminderEmail=reminderEmail,
            positions=positions
        )
        
        if not positions or len(positions) == 0:
            return {"status": "error", "message": "No positions specified"}
        
        execution_time = time.time() - start_time
        logger.info(f"bookAppointment validation completed in {execution_time:.2f}s")
        
        # Pass all positions to the booking function
        return book_appointment(
            mobileNumber=customerId,
            siteCd=validated_params["siteCd"],
            positions=positions,
            reminderSms=validated_params["reminderSms"],
            reminderEmail=validated_params["reminderEmail"],
            business_phone_number=business_phone_number
        )
        
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in bookAppointment: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in bookAppointment: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}

def cancelAppointment(siteCd: str, orderId: int, mobileNumber: str = ""):
    """Cancel an appointment with validation"""
    logger.info(f"Tool called: cancelAppointment(siteCd={siteCd}, orderId={orderId})")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "cancelAppointment",
            siteCd=siteCd,
            orderId=orderId
        )
        
        execution_time = time.time() - start_time
        logger.info(f"cancelAppointment validation completed in {execution_time:.2f}s")
        
        # The mobileNumber will be provided by the handler
        return cancel_appointment(
            order_id=validated_params["orderId"],  # Changed from orderId to order_id
            mobileNumber=mobileNumber, 
            siteCd=validated_params["siteCd"]
        )
        
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in cancelAppointment: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in cancelAppointment: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}

def updateProfileName(fullNm: str, firstNm: str = None, lastNm: str = None, mobile_number: str = None):
    """Update only the name in the existing user profile"""
    logger.info(f"Tool called: updateProfileName(fullNm={fullNm}, firstNm={firstNm}, lastNm={lastNm})")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "updateProfileName",
            fullNm=fullNm,
            firstNm=firstNm,
            lastNm=lastNm,
            mobile_number=mobile_number
        )
        
        # Call the TimeGlobe service to update profile name
        service = _get_timeglobe_service()
        result = service.update_profile_name(
            mobile_number=validated_params.get("mobile_number", ""),
            full_name=validated_params.get("fullNm", fullNm),
            first_name=firstNm,
            last_name=lastNm
        )
        
        execution_time = time.time() - start_time
        
        if result.get("code") == 0:
            logger.info(f"updateProfileName() completed successfully in {execution_time:.2f}s")
            return {"status": "success", "message": result.get("message", "Profile name updated successfully")}
        else:
            logger.warning(f"updateProfileName() returned error code {result.get('code')} in {execution_time:.2f}s")
            return {"status": "error", "message": result.get("message", "Failed to update profile name")}
            
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in updateProfileName: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in updateProfileName: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}

def updateProfileEmail(email: str, mobile_number: str = None):
    """Update only the email in the existing user profile"""
    logger.debug(f"Tool called: updateProfileEmail(email={email}, mobile_number={mobile_number})")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "updateProfileEmail",
            email=email,
            mobile_number=mobile_number
        )
        logger.debug(f"Validated parameters: {validated_params}")
        
        # Call the TimeGlobe service to update profile email
        service = _get_timeglobe_service()
        logger.debug("Calling TimeGlobe service to update email")
        result = service.update_profile_email(
            mobile_number=validated_params.get("mobile_number", ""),
            email=validated_params["email"]
        )
        
        execution_time = time.time() - start_time
        logger.debug(f"TimeGlobe service response: {result}")
        
        if result.get("code") == 0:
            logger.info(f"updateProfileEmail() completed successfully in {execution_time:.2f}s")
            return {"status": "success", "message": result.get("message", "Profile email updated successfully")}
        else:
            logger.warning(f"updateProfileEmail() returned error code {result.get('code')} in {execution_time:.2f}s")
            return {"status": "error", "message": result.get("message", "Failed to update profile email")}
            
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in updateProfileEmail: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in updateProfileEmail: {str(e)} - took {execution_time:.2f}s", exc_info=True)
        return {"status": "error", "message": str(e)}

def updateProfileSalutation(salutationCd: str, mobile_number: str = None):
    """Update only the salutation/gender in the existing user profile"""
    logger.info(f"Tool called: updateProfileSalutation(salutationCd={salutationCd})")
    start_time = time.time()
    try:
        # Validate parameters using centralized validation
        validated_params = validate_function_parameters(
            "updateProfileSalutation",
            salutationCd=salutationCd,
            mobile_number=mobile_number
        )
        
        # Call the TimeGlobe service to update profile salutation
        service = _get_timeglobe_service()
        result = service.update_profile_salutation(
            mobile_number=validated_params.get("mobile_number", ""),
            salutation_cd=validated_params["salutationCd"]
        )
        
        execution_time = time.time() - start_time
        
        if result.get("code") == 0:
            logger.info(f"updateProfileSalutation() completed successfully in {execution_time:.2f}s")
            return {"status": "success", "message": result.get("message", "Profile salutation updated successfully")}
        else:
            logger.warning(f"updateProfileSalutation() returned error code {result.get('code')} in {execution_time:.2f}s")
            return {"status": "error", "message": result.get("message", "Failed to update profile salutation")}
            
    except ValidationError as e:
        execution_time = time.time() - start_time
        logger.error(f"Validation error in updateProfileSalutation: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": f"Validation error: {str(e)}"}
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in updateProfileSalutation: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}

def updateDataProtection(dplAccepted: bool, mobile_number: str = None):
    """Update only the GDPR consent in the existing user profile"""
    logger.info(f"Tool called: updateDataProtection(dplAccepted={dplAccepted})")
    start_time = time.time()
    try:
        # Call the TimeGlobe service to update data protection consent
        service = _get_timeglobe_service()
        result = service.update_data_protection(
        mobile_number=mobile_number or "",
            dpl_accepted=dplAccepted
        )
        
        execution_time = time.time() - start_time
        
        if result.get("code") == 0:
            logger.info(f"updateDataProtection() completed successfully in {execution_time:.2f}s")
            return {"status": "success", "message": result.get("message", "Data protection updated successfully")}
        else:
            logger.warning(f"updateDataProtection() returned error code {result.get('code')} in {execution_time:.2f}s")
            return {"status": "error", "message": result.get("message", "Failed to update data protection")}
            
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"Error in updateDataProtection: {str(e)} - took {execution_time:.2f}s")
        return {"status": "error", "message": str(e)}
