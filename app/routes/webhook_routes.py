from fastapi import APIRouter, Request, Depends, HTTPException, status
from ..services.whatsapp_business_service import WhatsAppBusinessService
from ..models.business_model import Business
import logging
import time
import re
from ..db.session import get_db
from ..repositories.conversation_repository import ConversationRepository
from ..core.dependencies import (
    get_whatsapp_business_service,
    get_current_business,
)
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from app.utils.message_queue import MessageQueue
from app.utils.message_cache import MessageCache
from app.utils.tools_wrapper_util import get_response_from_gpt, format_response
from openai import OpenAI
from ..core.config import settings
# RENDER DISK INTEGRATION: Storage-Funktionen für persistente Logs
from ..utils.storage import append_log, save_json
from datetime import datetime

router = APIRouter()


def clean_api_key(api_key: str) -> str:
    """
    Comprehensive API key cleaning function to handle all edge cases.
    
    Handles:
    - Leading/trailing whitespace (spaces, tabs, newlines)
    - All types of quotes (single, double, backticks)
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
    # \s matches [ \t\n\r\f\v] and unicode whitespace
    api_key = api_key.strip()
    
    # Step 4: Remove zero-width characters (zero-width space, zero-width joiner, etc.)
    # These are invisible but can cause issues
    zero_width_chars = [
        '\u200b',  # Zero-width space
        '\u200c',  # Zero-width non-joiner
        '\u200d',  # Zero-width joiner
        '\ufeff',  # Zero-width no-break space (BOM)
        '\u2060',  # Word joiner
    ]
    for char in zero_width_chars:
        api_key = api_key.replace(char, '')
    
    # Step 5: Remove control characters (except normal characters)
    # Keep only printable ASCII and valid key characters
    api_key = ''.join(char for char in api_key if char.isprintable() or char == ' ')
    
    # Step 6: Remove quotes (all types) from beginning and end
    # Handle nested quotes by repeatedly stripping until no more quotes
    quote_chars = ['"', "'", '`', '"', '"', ''', ''']  # Include unicode quotes
    
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
    
    # Step 8: Remove any internal line breaks that might have been missed
    api_key = re.sub(r'[\r\n\t]+', '', api_key)
    
    # Step 9: Collapse multiple spaces into single space (shouldn't be in API keys anyway)
    # But if somehow present, normalize them
    api_key = re.sub(r' +', ' ', api_key)
    
    # Step 10: Final safety trim
    api_key = api_key.strip()
    
    return api_key

@router.get("/webhook")
async def verify_webhook(
    request: Request,
    whatsapp_service: WhatsAppBusinessService = Depends(get_whatsapp_business_service)
):
    """
    Webhook verification endpoint for WhatsApp Business API.
    Facebook/Meta calls this endpoint to verify your webhook.
    """
    try:
        # Get query parameters
        mode = request.query_params.get("hub.mode")
        token = request.query_params.get("hub.verify_token")
        challenge = request.query_params.get("hub.challenge")
        
        logging.info(f"Webhook verification request - Mode: {mode}, Token: {token}")
        
        # Check if this is a webhook verification request
        if mode == "subscribe" and token and challenge:
            # Verify the token using the WhatsApp Business service
            verified_challenge = whatsapp_service.verify_webhook(token, challenge)
            logging.info("Webhook verification successful")
            return int(verified_challenge)
        else:
            logging.error("Webhook verification failed - missing parameters")
            raise HTTPException(status_code=403, detail="Webhook verification failed")
            
    except Exception as e:
        logging.error(f"Error in webhook verification: {str(e)}")
        raise HTTPException(status_code=403, detail="Webhook verification failed")

@router.post("/webhook")
async def whatsapp_webhook(
    request: Request,
):
    """
    Main webhook endpoint for receiving WhatsApp messages via Meta's WhatsApp Business API.
    
    RENDER DISK INTEGRATION:
    - Loggt alle eingehenden Nachrichten im persistenten Speicher
    - Speichert Webhook-Daten als JSON für Debugging
    """
    start_time = time.time()
    
    try:
        # Parse incoming JSON payload
        data = await request.json()
        
        # Log webhook receipt time
        receipt_time = time.time()
        time_to_parse = (receipt_time - start_time) * 1000
        logging.info(f"Webhook received - parsing took {time_to_parse:.2f}ms")
        
        # ==============================================================================
        # RENDER DISK INTEGRATION: Persistentes Logging von WhatsApp-Nachrichten
        # ==============================================================================
        
        # Log in persistentem Speicher
        webhook_log_msg = f"📱 WhatsApp Webhook empfangen - {datetime.now().isoformat()} - Parse-Zeit: {time_to_parse:.2f}ms"
        append_log(webhook_log_msg, "whatsapp_webhooks.log")
        
        # Speichere Webhook-Daten als JSON (optional für Debugging)
        # Nur bei wichtigen Nachrichten speichern, um Speicherplatz zu sparen
        if data.get('entry', [{}])[0].get('changes', [{}])[0].get('value', {}).get('messages'):
            webhook_filename = f"webhook_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            save_json(data, webhook_filename, subdir="cache/webhooks")
            logging.debug(f"Webhook-Daten gespeichert: {webhook_filename}")
        
        # ==============================================================================
        
        # Only log payload in debug mode
        logging.debug(f"Webhook payload: {data}")
        
        # Add message to the processing queue
        message_queue = MessageQueue.get_instance()
        message_queue.enqueue_message(data)
        
        # Calculate response time
        response_time = time.time()
        time_gap = (response_time - start_time) * 1000  # Convert to milliseconds
        logging.debug(f"Webhook response time: {time_gap:.2f}ms")
        
        # Return success immediately before any processing
        return JSONResponse(content={"status": "success"}, status_code=200)
    except Exception as e:
        # Calculate error response time
        error_time = time.time()
        time_gap = (error_time - start_time) * 1000  # Convert to milliseconds
        logging.error(f"Error in webhook handler: {str(e)} - Response time: {time_gap:.2f}ms")
        
        # RENDER DISK INTEGRATION: Log Fehler persistent
        error_msg = f"❌ Webhook-Fehler - {datetime.now().isoformat()} - {str(e)} - Response: {time_gap:.2f}ms"
        append_log(error_msg, "errors.log")
        
        # Still return 200 to prevent WhatsApp from retrying
        return JSONResponse(content={"status": "success"}, status_code=200)

async def process_webhook_data(data: dict, service):
    """Process the webhook data in the background."""
    start_process_time = time.time()
    
    try:
        # Process WhatsApp Business API webhook format
        await process_whatsapp_business_webhook(data, service)
            
    except Exception as e:
        # Log error with timing information
        error_time = time.time()
        total_duration = (error_time - start_process_time) * 1000  # milliseconds
        logging.error(f"Error processing webhook data after {total_duration:.2f}ms: {str(e)}")

async def process_whatsapp_business_webhook(data: dict, service):
    """Process WhatsApp Business API webhook format."""
    start_process_time = time.time()
    
    try:
        logging.info(f"Processing WhatsApp Business API webhook")
        logging.info(f"Webhook payload: {data}")
        
        # Handle both entry-based format and direct field format
        if 'entry' in data:
            # Standard webhook format with entry array
            entries = data.get('entry', [])
            if not entries:
                logging.info("No entries found in webhook data")
                return
            
            for entry in entries:
                # Get changes
                changes = entry.get('changes', [])
                if not changes:
                    continue
                    
                for change in changes:
                    value = change.get('value', {})
                    await process_webhook_value(value, service)
                    
        elif 'field' in data and data.get('field') == 'messages':
            # Direct field format (like your example)
            value = data.get('value', {})
            await process_webhook_value(value, service)
        else:
            logging.warning(f"Unknown webhook format: {data}")
                    
    except Exception as e:
        logging.error(f"Error processing WhatsApp Business API webhook: {str(e)}")

async def process_webhook_value(value: dict, service):
    """Process the value part of webhook data."""
    try:
        # Extract metadata
        metadata = value.get('metadata', {})
        business_phone_number = metadata.get('display_phone_number')
        phone_number_id = metadata.get('phone_number_id')
        
        logging.info("------------------------------------")
        logging.info(f"[WEBHOOK FLOW] Received webhook with Business phone: {business_phone_number}, Phone ID: {phone_number_id}")
        logging.info("------------------------------------")
        
        # Process messages
        messages = value.get('messages', [])
        if not messages:
            logging.info("No messages in webhook data")
            return
        
        for message in messages:
            await process_whatsapp_message(message, value, business_phone_number, service)
            
    except Exception as e:
        logging.error(f"Error processing webhook value: {str(e)}")

async def process_whatsapp_message(message: dict, value: dict, business_phone_number: str, service):
    """Process individual WhatsApp message."""
    try:
        message_type = message.get('type')
        message_id = message.get('id', '')
        timestamp = message.get('timestamp', '')
        sender_number = message.get('from')
        
        logging.info("------------------------------------")
        logging.info(f"[WEBHOOK FLOW] Processing message - ID: {message_id}, Type: {message_type}, From: {sender_number}")
        logging.info("------------------------------------")
        
        # Only process text messages
        if message_type != 'text':
            logging.info(f"Ignoring non-text message of type: {message_type}")
            return
        
        # Get message text
        text_content = message.get('text', {})
        message_body = text_content.get('body', '')
        
        if not message_body:
            logging.error("No message text found")
            return
        
        # Get contact info
        contacts = value.get('contacts', [])
        profile_name = ''
        if contacts:
            profile = contacts[0].get('profile', {})
            profile_name = profile.get('name', '')
        
        # Format phone number
        if not sender_number:
            logging.error("No sender number found")
            return
            
        formatted_number = "".join(filter(str.isdigit, sender_number))
        
        # Check for duplicate messages
        message_cache = MessageCache.get_instance()
        if message_cache.is_processed(message_id):
            logging.info("------------------------------------")
            logging.warning(f"[WEBHOOK FLOW] DUPLICATE MESSAGE DETECTED - Skipping message ID: {message_id}")
            logging.info("------------------------------------")
            return
        
        # Mark as processed
        message_cache.mark_as_processed(message_id)
        message_cache.set_business_phone(formatted_number, business_phone_number)
        
        logging.info("------------------------------------")
        logging.info(f"[WEBHOOK FLOW] Message from {formatted_number} (contact: {profile_name}): '{message_body}'")
        logging.info(f"[WEBHOOK FLOW] Successfully stored business phone {business_phone_number} for user {formatted_number}")
        logging.info("------------------------------------")
        
        # Process the message with business phone number
        await process_message_universal(formatted_number, message_body.lower(), message_id, service, business_phone_number)
        
    except Exception as e:
        logging.error(f"Error processing WhatsApp message: {str(e)}")

async def process_message_universal(number: str, incoming_msg: str, message_id: str, service, business_phone_number: str = None):
    """Universal message processor for WhatsApp Business API."""
    start_process_time = time.time()
    try:
        # Process the message with your AI assistant
        logging.info(f"Generating response for message ID: {message_id} from user: {number}")
        gpt_start_time = time.time()
        response = get_response_from_gpt(incoming_msg, number)
        
        gpt_end_time = time.time()
        gpt_duration = (gpt_end_time - gpt_start_time) * 1000  # milliseconds
        logging.info(f"⏱️ GPT response generation took {gpt_duration:.2f}ms for message ID: {message_id}")
        
        if response:
            # Format the response
            formatted_response = format_response(response)
            
            # Use provided business phone or get from cache
            business_phone = business_phone_number
            if not business_phone:
                message_cache = MessageCache.get_instance()
                business_phone = message_cache.get_business_phone(number)
            
            if not business_phone:
                logging.error(f"No business phone number found for user {number}")
                return
            
            logging.info(f"Sending response to {number} via business phone {business_phone}")
            
            # Send the response using WhatsApp Business API service
            resp = service.send_message(number, formatted_response, business_phone)
            
            # Total processing time
            end_time = time.time()
            total_duration = (end_time - start_process_time) * 1000  # milliseconds
            logging.info(f"⏱️ Total message processing time: {total_duration:.2f}ms for message ID: {message_id}")
        else:
            logging.error(f"No response generated for message ID: {message_id}")
            
    except Exception as e:
        logging.error(f"Error in message processing for message ID {message_id}: {str(e)}")

@router.get("/verify-openai-key", status_code=status.HTTP_200_OK)
async def verify_openai_api_key():
    """
    🔑 Verify OpenAI API Key
    
    This endpoint checks if the OpenAI API key configured in the environment
    is valid by making a test request to OpenAI's API.
    
    Returns:
        - status: "valid" or "invalid"
        - message: Description of the result
        - details: Additional information about the key and test
    """
    try:
        # Get API key from settings (same way as ChatAgent)
        api_key = settings.OPENAI_API_KEY
        
        if not api_key:
            return JSONResponse(
                content={
                    "status": "invalid",
                    "message": "OpenAI API key is not configured",
                    "details": {
                        "configured": False,
                        "key_length": 0,
                        "error": "OPENAI_API_KEY environment variable is not set"
                    }
                },
                status_code=200
            )
        
        # Store original key info before cleaning
        original_key = api_key
        
        # Check key format and characteristics (before cleaning)
        key_issues = {
            "has_whitespace": api_key != api_key.strip(),
            "has_quotes": any(api_key.startswith(q) or api_key.endswith(q) for q in ['"', "'", '`', '"', '"']),
            "has_line_breaks": '\n' in api_key or '\r' in api_key,
            "has_tabs": '\t' in api_key,
            "has_bom": api_key.startswith('\ufeff'),
            "has_zero_width_chars": any(c in api_key for c in ['\u200b', '\u200c', '\u200d', '\u2060']),
            "has_escaped_quotes": '\\"' in api_key or "\\'" in api_key,
        }
        
        # Clean the key using comprehensive cleaning function
        clean_key = clean_api_key(api_key)
        
        # Key info after cleaning
        key_info = {
            "configured": True,
            "original_length": len(original_key),
            "cleaned_length": len(clean_key),
            "starts_with": clean_key[:10] if len(clean_key) >= 10 else clean_key,
            "ends_with": clean_key[-10:] if len(clean_key) >= 10 else "",
            "issues_found": key_issues,
            "was_modified": original_key != clean_key,
        }
        
        # Test the API key with OpenAI
        logging.info("Testing OpenAI API key...")
        try:
            client = OpenAI(api_key=clean_key)
            
            # Make a minimal test request
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "test"}],
                max_tokens=5
            )
            
            # If we got here, the key is valid
            test_response = response.choices[0].message.content
            
            # Generate warnings based on issues found
            warnings = []
            if key_info["was_modified"]:
                issues_list = [k.replace('has_', '').replace('_', ' ') for k, v in key_issues.items() if v]
                if issues_list:
                    warnings.append(f"Key was cleaned. Issues found: {', '.join(issues_list)}")
                    warnings.append("Consider updating the environment variable to remove these issues")
            
            return JSONResponse(
                content={
                    "status": "valid",
                    "message": "✅ OpenAI API key is valid and working" + (" (after cleaning)" if key_info["was_modified"] else ""),
                    "details": {
                        **key_info,
                        "test_successful": True,
                        "test_response": test_response,
                        "model_used": "gpt-4o-mini",
                        "warnings": warnings if warnings else None
                    }
                },
                status_code=200
            )
            
        except Exception as openai_error:
            error_message = str(openai_error)
            
            # Check if it's an authentication error
            if "401" in error_message or "Incorrect API key" in error_message:
                return JSONResponse(
                    content={
                        "status": "invalid",
                        "message": "❌ OpenAI API key is invalid or incorrect",
                        "details": {
                            **key_info,
                            "test_successful": False,
                            "error": error_message,
                            "suggestion": "Check if the API key is correct in your environment variables"
                        }
                    },
                    status_code=200
                )
            else:
                # Other OpenAI errors (rate limit, etc.)
                return JSONResponse(
                    content={
                        "status": "error",
                        "message": f"⚠️ Error testing API key: {error_message}",
                        "details": {
                            **key_info,
                            "test_successful": False,
                            "error": error_message
                        }
                    },
                    status_code=200
                )
                
    except Exception as e:
        logging.error(f"Error in verify_openai_api_key: {str(e)}")
        return JSONResponse(
            content={
                "status": "error",
                "message": f"Server error: {str(e)}",
                "details": {
                    "error": str(e)
                }
            },
            status_code=500
        )

@router.delete("/clear-chat-history/{mobile_number}", status_code=status.HTTP_200_OK, response_class=JSONResponse)
async def clear_chat_history(
    mobile_number: str,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business),
):
    """Clear the conversation history for a user"""
    try:
        conversation_repo = ConversationRepository(db)
        success = conversation_repo.delete_conversation_history(mobile_number)
        
        if success:
            return JSONResponse(
                content={"status": "success", "message": f"Chat history cleared for {mobile_number}"},
                status_code=200,
            )
        else:
            return JSONResponse(
                content={"status": "success", "message": "No chat history found to clear"},
                status_code=200,
            )
    except Exception as e:
        logging.error(f"Error clearing chat history: {str(e)}")
        return JSONResponse(
            content={"status": "error", "message": str(e)},
            status_code=500,
        )
