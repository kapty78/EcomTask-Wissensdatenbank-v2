import datetime
import time
import threading
import json
import re
from typing import Any, Dict, List, Callable, Optional
from openai import OpenAI
import os
import logging
from sqlalchemy.orm import Session

from .repositories.conversation_repository import ConversationRepository
from .system_prompt import System_prompt
from .tools_schema import Tools
from .core.config import settings
from datetime import timedelta
from .utils.timezone_util import BERLIN_TZ


# Set up logging with debug level
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - [%(threadName)s] - %(levelname)s - %(filename)s:%(lineno)d - %(funcName)s() - %(message)s"
)
logger = logging.getLogger(__name__)

# Thread-safe locks
threads_lock = threading.RLock()


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
    
    # Step 5: Remove control characters (keep only printable characters)
    api_key = ''.join(char for char in api_key if char.isprintable() or char == ' ')
    
    # Step 6: Remove quotes (all types) from beginning and end
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
        # Remove any single quote character from the beginning or end
        for quote in quote_chars:
            if api_key.startswith(quote) and len(api_key) > 1:
                api_key = api_key[1:]
            if api_key.endswith(quote) and len(api_key) > 1:
                api_key = api_key[:-1]
    
    # Step 7: Final trim of any remaining whitespace
    api_key = api_key.strip()
    
    # Step 8: Remove any internal line breaks
    api_key = re.sub(r'[\r\n\t]+', '', api_key)
    
    # Step 9: Collapse multiple spaces
    api_key = re.sub(r' +', ' ', api_key)
    
    # Step 10: Final safety trim
    api_key = api_key.strip()
    
    return api_key


class ChatAgent:
    def __init__(self, api_key: str = None, model: str = "gpt-4.1", db: Session = None):
        """Initialize the ChatAgent with API key and model name."""
        # Use the provided API key or fall back to the one from settings
        api_key = api_key or settings.OPENAI_API_KEY
        
        # Clean the API key to handle all edge cases (whitespace, quotes, etc.)
        if api_key:
            api_key = clean_api_key(api_key)
        
        logger.debug(f'Initializing ChatAgent with model: {model}')
        logger.info(f'Using OpenAI API key from settings: {api_key[:5]}...' if api_key else 'No API key provided')
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self._function_mapping = None
        self.db = db
        
        # Load available functions from the tools wrapper
        self.available_functions = self._get_available_functions()
        logger.debug(f'Loaded {len(self.available_functions)} available functions')
        
        # Initialize repository if db is provided
        self.conversation_repo = ConversationRepository(db) if db else None
        logger.debug('Conversation repository initialized' if self.conversation_repo else 'No conversation repository')

    def _get_available_functions(self) -> List[Dict[str, Any]]:
        """Define the functions available to the model."""
        logger.debug('Getting available functions from Tools schema')
        return Tools

    def _get_function_mapping(self) -> Dict[str, Callable]:
        """Get cached function mapping or create a new one."""
        if self._function_mapping is None:
            logger.debug('Creating new function mapping')
            # Import only once when needed
            from .utils.tools_wrapper_util import (
                getSites,
                getProducts,
                getEmployees,
                AppointmentSuggestion_wrapper,
                bookAppointment,
                cancelAppointment,
                getProfile,
                getOrders,
                getBookableCustomers,
                store_profile_wrapper,
                updateProfileName,
                updateProfileEmail,
                updateProfileSalutation,
                updateDataProtection,
            )
            
            self._function_mapping = {
                "getSites": getSites,
                "getProducts": getProducts,
                "getEmployees": getEmployees,
                "AppointmentSuggestion": AppointmentSuggestion_wrapper,
                "bookAppointment": bookAppointment,
                "cancelAppointment": cancelAppointment,
                "getProfile": getProfile,
                "getOrders": getOrders,
                "getBookableCustomers": getBookableCustomers,
                "store_profile": store_profile_wrapper,
                "updateProfileName": updateProfileName,
                "updateProfileEmail": updateProfileEmail,
                "updateProfileSalutation": updateProfileSalutation,
                "updateDataProtection": updateDataProtection,
            }
            logger.debug(f'Created function mapping with {len(self._function_mapping)} functions')
        
        return self._function_mapping

    def handle_tool_calls(self, tool_calls: List[Any], user_id: str) -> List[Dict]:
        """Execute the specified functions and return the results."""
        logger.info(f"Handling {len(tool_calls)} tool calls for user {user_id}")
        
        function_mapping = self._get_function_mapping()
        results = []
        
        # Get business phone for this user if it's stored in the cache
        from app.utils.message_cache import MessageCache
        message_cache = MessageCache.get_instance()
        business_phone = message_cache.get_business_phone(user_id)
        if business_phone:
            logger.info("------------------------------------")
            logger.info(f"[CHAT FLOW] Found business phone number for user {user_id}: {business_phone}")
            logger.info("------------------------------------")
        else:
            logger.debug("------------------------------------")
            logger.debug(f"[CHAT FLOW] No business phone found for user {user_id}")
            logger.debug("------------------------------------")
        
        for tool_call in tool_calls:
            # Handle different object formats
            try:
                function_name = tool_call.function.name
                function_args = json.loads(tool_call.function.arguments)
                tool_call_id = tool_call.id
                logger.debug(f"Processing tool call: {function_name} with args: {function_args}")
            except AttributeError as e:
                logger.error(f"Error accessing function attributes as object: {str(e)}")
                try:
                    # Try accessing attributes as dictionary
                    function_name = tool_call["function"]["name"]
                    function_args = json.loads(tool_call["function"]["arguments"])
                    tool_call_id = tool_call["id"]
                    logger.debug(f"Successfully accessed tool call as dictionary: {function_name}")
                except Exception as e2:
                    logger.error(f"Both object and dict access failed: {str(e2)}")
                    continue
            
            function_to_call = function_mapping.get(function_name)
            if not function_to_call:
                error_message = f"Function {function_name} not found"
                logger.error(error_message)
                results.append({
                    "tool_call_id": tool_call_id,
                    "role": "tool",
                    "content": json.dumps({"error": error_message})
                })
                continue
            
            try:
                # Handle special cases for different functions
                if function_name == "bookAppointment":
                    # Add customerId if not provided
                    if "customerId" not in function_args:
                        logger.debug(f"Adding customerId={user_id} to bookAppointment call")
                        function_args["customerId"] = user_id
                    
                    # Add business_phone_number if available
                    if business_phone and "business_phone_number" not in function_args:
                        logger.debug(f"Adding business phone {business_phone} to bookAppointment call")
                        function_args["business_phone_number"] = business_phone
                        
                elif function_name == "cancelAppointment":
                    # Add mobileNumber if needed by the wrapper
                    logger.debug(f"Adding mobileNumber={user_id} to cancelAppointment call")
                    function_args["mobileNumber"] = user_id
                elif function_name == "getProfile" or function_name == "getOrders":
                    # These functions have a mobile_number parameter
                    if not function_args:
                        function_args = {}
                    function_args["mobile_number"] = user_id
                    logger.debug(f"Adding mobile_number={user_id} to {function_name} call")
                elif function_name == "getBookableCustomers":
                    # This function has a mobile_number parameter
                    if "mobile_number" not in function_args:
                        function_args["mobile_number"] = user_id
                        logger.debug(f"Adding mobile_number={user_id} to {function_name} call")
                elif function_name == "store_profile":
                    # For store_profile, ensure mobile_number is set
                    if "mobile_number" not in function_args:
                        function_args["mobile_number"] = user_id
                        logger.debug(f"Adding mobile_number={user_id} to store_profile call")
                elif function_name in ["updateProfileName", "updateProfileEmail", "updateProfileSalutation", "updateDataProtection"]:
                    # For update profile functions, ensure mobile_number is set
                    if "mobile_number" not in function_args:
                        function_args["mobile_number"] = user_id
                        logger.debug(f"Adding mobile_number={user_id} to {function_name} call")
                
                # Debug logging before function call
                logger.debug(f"Calling function {function_name} with final args: {function_args}")
                
                # Execute the function with proper error handling
                try:
                    function_response = function_to_call(**function_args)
                    logger.debug(f"Function {function_name} response: {function_response}")
                except TypeError as type_error:
                    # Handle parameter mismatches more gracefully
                    logger.error(f"TypeError in {function_name}: {str(type_error)}")
                    
                    # Special handling for common parameter errors
                    if function_name == "getProfile" and "mobile_number" in str(type_error):
                        # Try calling without parameters
                        logger.debug("Retrying getProfile without any parameters")
                        function_response = getProfile()
                    elif function_name == "getOrders" and "mobile_number" in str(type_error):
                        # Try calling without parameters
                        logger.debug("Retrying getOrders without any parameters")
                        function_response = getOrders()
                    else:
                        # If unsure how to fix, return error
                        raise
                
                results.append({
                    "tool_call_id": tool_call_id,
                    "role": "tool",
                    "content": json.dumps(function_response)
                })
                
                logger.info(f"Successfully executed {function_name} for user {user_id}")
            except Exception as e:
                error_message = f"Error executing {function_name}: {str(e)}"
                logger.error(error_message, exc_info=True)  # Include full traceback
                results.append({
                    "tool_call_id": tool_call_id,
                    "role": "tool",
                    "content": json.dumps({"error": error_message})
                })
        
        return results

    def run_conversation(self, user_id: str, question: str) -> str:
        """Run a conversation using ChatCompletion API instead of Assistant API."""
        logger.info(f"Starting conversation for user {user_id}")
        
        # Add current date and time to the question for context using Berlin timezone
        current_datetime = datetime.datetime.now(BERLIN_TZ).strftime("%Y-%m-%d %H:%M:%S")
        question_with_time = f"{question}\n\n(Current Date and Time: {current_datetime})"
        
        # Get business phone and name for this user
        from app.utils.message_cache import MessageCache
        from app.services.timeglobe_service import TimeGlobeService
        message_cache = MessageCache.get_instance()
        business_phone = message_cache.get_business_phone(user_id)
        
        # Get business name if we have a business phone
        business_name = "TimeGlobe"
        if business_phone:
            logger.info(f"Found business phone number for user {user_id}: {business_phone}")
            timeglobe_service = TimeGlobeService()
            business = timeglobe_service.get_business_by_phone(business_phone)
            if business and business.business_name:
                business_name = business.business_name
                logger.info(f"Using business name: {business_name}")
        
        # Format system prompt with business name
        formatted_system_prompt = System_prompt.replace("{{company_name}}", business_name)
        
        # Retrieve conversation history from database or initialize if new
        try:
            conversation_history = self._get_conversation_history(user_id)
            if not conversation_history:
                logger.warning(f"No conversation history found for user {user_id}, using default")
                conversation_history = [{"role": "system", "content": formatted_system_prompt}]
            else:
                # Update system prompt in existing history
                if conversation_history and conversation_history[0].get("role") == "system":
                    conversation_history[0]["content"] = formatted_system_prompt
                else:
                    conversation_history.insert(0, {"role": "system", "content": formatted_system_prompt})
        except Exception as e:
            logger.error(f"Error retrieving conversation history: {str(e)}")
            conversation_history = [{"role": "system", "content": formatted_system_prompt}]
        
        # Set a reasonable timeout for the entire conversation
        timeout = 30  # 30 seconds max
        start_time = time.time()
        
        # Retry configuration
        max_retries = 2
        retry_count = 0
        
        try:
            # Add user message to history
            conversation_history.append({"role": "user", "content": question_with_time})
            
            # Initial completion call with retry mechanism
            response = None
            while retry_count <= max_retries and response is None:
                try:
                    logger.info(f"Attempting OpenAI API call (attempt {retry_count + 1}/{max_retries + 1})")
                    response = self.client.chat.completions.create(
                        model=self.model,
                        messages=conversation_history,
                        tools=self.available_functions,
                        tool_choice="auto",
                        temperature=0.25,
                    )
                except Exception as api_error:
                    error_str = str(api_error)
                    logger.error(f"OpenAI API error (attempt {retry_count + 1}): {error_str}")
                    
                    if "messages with role 'tool' must be a response to a preceeding message with 'tool_calls'" in error_str or "must be followed by tool messages responding to each 'tool_call_id'" in error_str:
                        logger.warning("Detected tool_call mismatch error, clearing chat history and retrying.")
                        # Clear chat history for this user
                        self._save_conversation_history(user_id, [{"role": "system", "content": System_prompt}])
                        # Retry with only the system and user message
                        conversation_history = [{"role": "system", "content": System_prompt},
                                               {"role": "user", "content": question_with_time}]
                        retry_count += 1
                        continue
                    elif retry_count < max_retries:
                        logger.warning(f"API error occurred, retrying in 1 second (attempt {retry_count + 1}/{max_retries})")
                        time.sleep(1)  # Wait 1 second before retry
                        retry_count += 1
                        continue
                    else:
                        logger.error(f"Max retries ({max_retries}) exceeded, giving up")
                        return f"Sorry, I couldn't process your request after {max_retries + 1} attempts: {error_str}"
            
            # Process the response with safety checks
            if not response or not response.choices or len(response.choices) == 0:
                logger.error("Empty response from OpenAI API")
                return "Sorry, I received an empty response from the API. Please try again."
                
            response_message = response.choices[0].message
            
            # Process the response
            response_dict = {
                "role": response_message.role,
                "content": response_message.content if response_message.content is not None else "",
            }
            
            if response_message.tool_calls:
                # Debug print
                print(f"Tool calls in response: {response_message.tool_calls}")
                
                try:
                    tool_calls_for_storage = []
                    for tool in response_message.tool_calls:
                        tool_calls_for_storage.append({
                            "id": tool.id,
                            "type": tool.type,
                            "function": {
                                "name": tool.function.name,
                                "arguments": tool.function.arguments
                            }
                        })
                    response_dict["tool_calls"] = tool_calls_for_storage
                except Exception as e:
                    logger.error(f"Error processing tool calls for storage: {str(e)}")
                    # Fallback to a simpler representation
                    response_dict["tool_calls"] = [{"id": f"call_{i}", "type": "function", "function": {"name": "unknown", "arguments": "{}"}} 
                                                  for i, _ in enumerate(response_message.tool_calls)]
            
            conversation_history.append(response_dict)
            
            # Check if the model wants to call a function
            max_iterations = 5  # Reduced to prevent excessive loops
            iterations = 0
            consecutive_errors = 0  # Track consecutive errors
            
            # Log whether tools were called or not
            if response_message.tool_calls:
                logger.info(f"GPT requested {len(response_message.tool_calls)} tool call(s)")
                for tc in response_message.tool_calls:
                    logger.info(f"  - Tool: {tc.function.name}")
            else:
                logger.info("GPT did not request any tool calls - providing direct text response")
                if response_message.content and "problem" in response_message.content.lower():
                    logger.warning(f"GPT response mentions a 'problem': {response_message.content[:200]}")
            
            while (
                response_message.tool_calls 
                and iterations < max_iterations 
                and consecutive_errors < 3  # Stop after 3 consecutive errors
                and (time.time() - start_time) < timeout
            ):
                iterations += 1
                logger.info(f"Processing tool calls, iteration {iterations}/{max_iterations}")
                
                # Execute the tool calls
                tool_results = self.handle_tool_calls(response_message.tool_calls, user_id)
                
                # Check for errors in tool results
                has_errors = any("error" in str(result.get("content", "")) for result in tool_results)
                if has_errors:
                    consecutive_errors += 1
                    logger.warning(f"Tool call error detected, consecutive errors: {consecutive_errors}")
                else:
                    consecutive_errors = 0  # Reset on success
                
                # Add tool results to conversation history
                conversation_history.extend(tool_results)
                
                # Get a new response from the model
                try:
                    response = self.client.chat.completions.create(
                        model=self.model,
                        messages=conversation_history,
                        tools=self.available_functions,
                        tool_choice="auto",
                        temperature=0.2,
                    )
                except Exception as api_error:
                    error_str = str(api_error)
                    logger.error(f"OpenAI API error after tool calls: {error_str}")
                    if "must be followed by tool messages responding to each 'tool_call_id'" in error_str:
                        logger.warning("Detected tool_call mismatch error after tool calls, clearing chat history and retrying once.")
                        self._save_conversation_history(user_id, [{"role": "system", "content": System_prompt}])
                        conversation_history = [{"role": "system", "content": System_prompt},
                                               {"role": "user", "content": question_with_time}]
                        try:
                            response = self.client.chat.completions.create(
                                model=self.model,
                                messages=conversation_history,
                                tools=self.available_functions,
                                tool_choice="auto",
                                temperature=0.2,
                            )
                        except Exception as api_error2:
                            logger.error(f"OpenAI API error after clearing history: {str(api_error2)}")
                            return f"Sorry, I couldn't process your request: {str(api_error2)}"
                    else:
                        return f"Sorry, I couldn't process your request after executing functions: {error_str}"
                
                # Safety check for the response
                if not response or not response.choices or len(response.choices) == 0:
                    logger.error("Empty response from OpenAI API after tool calls")
                    return "Sorry, I received an empty response after processing your request. Please try again."
                
                # Process the new response
                response_message = response.choices[0].message
                
                # Check if user wants to stop (e.g., "später", "später", "nein", etc.)
                user_message_lower = question_with_time.lower()
                if any(word in user_message_lower for word in ["später", "nein", "stop", "aufhören", "abbruch"]):
                    logger.info("User indicated they want to stop, breaking tool call loop")
                    break
                
                # Convert the response_message to a dict for storage
                response_dict = {
                    "role": response_message.role,
                    "content": response_message.content if response_message.content is not None else "",
                }
                
                if response_message.tool_calls:
                    # Debug print
                    print(f"Tool calls in response: {response_message.tool_calls}")
                    
                    try:
                        tool_calls_for_storage = []
                        for tool in response_message.tool_calls:
                            tool_calls_for_storage.append({
                                "id": tool.id,
                                "type": tool.type,
                                "function": {
                                    "name": tool.function.name,
                                    "arguments": tool.function.arguments
                                }
                            })
                        response_dict["tool_calls"] = tool_calls_for_storage
                    except Exception as e:
                        logger.error(f"Error processing tool calls for storage: {str(e)}")
                        # Fallback to a simpler representation
                        response_dict["tool_calls"] = [{"id": f"call_{i}", "type": "function", "function": {"name": "unknown", "arguments": "{}"}} 
                                                      for i, _ in enumerate(response_message.tool_calls)]
                
                conversation_history.append(response_dict)
            
            # Save updated history (limit history to prevent token explosion)
            if conversation_history:
                try:
                    trimmed_history = self._trim_conversation_history(conversation_history)
                    if trimmed_history:
                        self._save_conversation_history(user_id, trimmed_history)
                    else:
                        logger.warning("Trimmed history is empty, not saving")
                except Exception as save_error:
                    logger.error(f"Error saving conversation history: {str(save_error)}")
            else:
                logger.warning(f"Not saving empty conversation history for user {user_id}")
            
            # Return the final text response
            if not response_message.content or response_message.content.strip() == "":
                logger.warning(f"Empty response content from OpenAI API for user {user_id}")
                return "Sorry, I couldn't generate a proper response. Please try rephrasing your question."
            
            logger.info(f"Successfully generated response for user {user_id} (length: {len(response_message.content)})")
            return response_message.content
            
        except Exception as e:
            logger.error(f"Error in run_conversation: {str(e)}")
            return f"Sorry, I encountered an error: {str(e)}"
    
    def _get_conversation_history(self, user_id: str) -> List[Dict]:
        """
        Retrieve conversation history for a user from database.
        If not found, return a default system message.
        """
        # System message to include regardless of history
        system_message = {
            "role": "system", 
            "content": System_prompt
        }
        
        # If we have no repository or db connection, just return the system message
        if not self.conversation_repo or not self.db:
            return [system_message]
        
        # Try to get history from repository
        try:
            history = self.conversation_repo.get_conversation_history(user_id)
            if history and len(history) > 0:
                # Ensure the system message is at the beginning
                if history[0].get("role") != "system":
                    history.insert(0, system_message)
                return history
        except Exception as e:
            logger.error(f"Error retrieving conversation history: {str(e)}")
        
        # Return default if repository failed or no history found
        return [system_message]
    
    def _save_conversation_history(self, user_id: str, history: List[Dict]) -> None:
        """Save conversation history for a user to database."""
        if not self.conversation_repo or not self.db:
            return
        
        try:
            self.conversation_repo.save_conversation_history(user_id, history)
        except Exception as e:
            logger.error(f"Error saving conversation history: {str(e)}")
    
    def _trim_conversation_history(self, history: List[Dict], max_messages: int = 15) -> List[Dict]:
        """
        Trim conversation history to keep only the most recent messages.
        Always keeps the system message and trims before the first user message
        after the first 2 messages in history.
        """
        if not history:
            return []
        
        # Always keep the system message
        system_message = None
        if history and len(history) > 0 and history[0].get("role") == "system":
            system_message = history[0]
            history = history[1:]
        
        # Keep only the most recent messages
        logger.info(f"Length of history: {len(history)}")
        
        # If history is already shorter than max_messages, no need to trim
        if len(history) < max_messages:
            # Add back the system message
            if system_message:
                history.insert(0, system_message)
            return history
            
        # Find the first user message after the first 2 messages
        start_idx = 2  # Start search from the 3rd message
        trim_idx = 0   # Default to beginning of list
        
        if len(history) > start_idx:
            for i in range(start_idx, len(history)):
                if history[i].get("role") == "user":
                    trim_idx = i
                    break
        
        # Trim history before the found user message
        if trim_idx > 0:
            logger.info(f"Trimming history before user message at index {trim_idx}")
            history = history[trim_idx:]
        
        # Add back the system message
        if system_message:
            history.insert(0, system_message)

        logger.info(f"Length of trimmed conversation history: {len(history)}")
        
        return history 
