import asyncio
import logging
from typing import Dict, Any, Optional
from ..services.whatsapp_business_service import WhatsAppBusinessService
from ..db.session import SessionLocal
from .message_cache import MessageCache

logger = logging.getLogger(__name__)

class MessageQueue:
    _instance = None
    _queue = asyncio.Queue()
    _workers = []
    _is_running = False
    _num_workers = 3  # Number of worker tasks to process messages

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(MessageQueue, cls).__new__(cls)
        return cls._instance

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def enqueue_message(self, message: Dict[str, Any]):
        """Add a message to the processing queue."""
        self._queue.put_nowait(message)
        logger.debug(f"Message enqueued - Queue size: {self._queue.qsize()}")

    async def start_workers(self):
        """Start worker tasks to process messages."""
        if not self._is_running:
            self._is_running = True
            for i in range(self._num_workers):
                worker = asyncio.create_task(self._process_messages(i + 1))
                self._workers.append(worker)
            logger.info(f"Started {self._num_workers} message processing workers")

    async def stop_workers(self):
        """Stop all worker tasks."""
        if self._is_running:
            self._is_running = False
            for worker in self._workers:
                worker.cancel()
            self._workers.clear()
            logger.info("Stopped all message processing workers")

    async def _process_messages(self, worker_id: int):
        """Worker task to process messages from the queue."""
        logger.info(f"Worker {worker_id} started")
        
        try:
            # Create a database session for this worker
            db = SessionLocal()
            service = WhatsAppBusinessService(db)
            logger.info(f"Worker {worker_id} created WhatsApp Business service")
            
            while self._is_running:
                try:
                    # Get message from queue with timeout
                    message = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                    
                    try:
                        # Process the message
                        await self._handle_message(message, service, worker_id)
                    finally:
                        # Mark task as done
                        self._queue.task_done()
                        
                except asyncio.TimeoutError:
                    # No message in queue, continue waiting
                    continue
                except Exception as e:
                    logger.error(f"Error processing message in worker {worker_id}: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.error(f"Worker {worker_id} error: {str(e)}")
        finally:
            # Clean up database session
            db.close()
            logger.info(f"Worker {worker_id} stopped")

    async def _handle_message(self, message: Dict[str, Any], service: WhatsAppBusinessService, worker_id: int):
        """Handle a single message from the queue."""
        try:
            # Process WhatsApp Business API webhook format
            await self._process_whatsapp_business_webhook(message, service, worker_id)
                
        except Exception as e:
            logger.error(f"Error handling message in worker {worker_id}: {str(e)}")

    async def _process_whatsapp_business_webhook(self, data: dict, service: WhatsAppBusinessService, worker_id: int):
        """Process WhatsApp Business API webhook format."""
        try:
            logger.info(f"Worker {worker_id} processing WhatsApp Business API webhook")
            
            # Log payload processing in debug mode only
            logger.debug(f"Worker {worker_id} processing payload: {data}")
            
            # Extract entry data
            entries = data.get('entry', [])
            if not entries:
                logger.info("No entries found in webhook data")
                return
            
            for entry in entries:
                # Get changes
                changes = entry.get('changes', [])
                if not changes:
                    continue
                    
                for change in changes:
                    value = change.get('value', {})
                    
                    # Extract metadata
                    metadata = value.get('metadata', {})
                    business_phone_number = metadata.get('display_phone_number')
                    phone_number_id = metadata.get('phone_number_id')
                    
                    logger.debug(f"Business phone: {business_phone_number}, Phone ID: {phone_number_id}")
                    
                    # Process messages
                    messages = value.get('messages', [])
                    if not messages:
                        logger.debug("No messages in webhook data - likely status update")
                        continue
                    
                    for message in messages:
                        await self._process_whatsapp_message(message, value, business_phone_number, service, worker_id)
                        
        except Exception as e:
            logger.error(f"Error processing WhatsApp Business API webhook: {str(e)}")

    async def _process_whatsapp_message(self, message: dict, value: dict, business_phone_number: str, service: WhatsAppBusinessService, worker_id: int):
        """Process individual WhatsApp message."""
        try:
            message_type = message.get('type')
            message_id = message.get('id', '')
            timestamp = message.get('timestamp', '')
            sender_number = message.get('from')
            
            logger.info("------------------------------------")
            logger.info(f"[QUEUE FLOW] Worker {worker_id} processing message - ID: {message_id}, Type: {message_type}, From: {sender_number}")
            logger.info("------------------------------------")
            
            # Only process text messages
            if message_type != 'text':
                logger.info(f"Ignoring non-text message of type: {message_type}")
                return
            
            # Get message text
            text_content = message.get('text', {})
            message_body = text_content.get('body', '')
            
            if not message_body:
                logger.error("No message text found")
                return
            
            # Get contact info
            contacts = value.get('contacts', [])
            profile_name = ''
            if contacts:
                profile = contacts[0].get('profile', {})
                profile_name = profile.get('name', '')
            
            # Validate sender number
            if not sender_number:
                logger.error("No sender number found")
                return
                
            # Format phone number
            formatted_number = "".join(filter(str.isdigit, sender_number))
            
            # Store business phone in cache
            message_cache = MessageCache.get_instance()
            message_cache.set_business_phone(formatted_number, business_phone_number)
            
            logger.info("------------------------------------")
            logger.info(f"[QUEUE FLOW] Message from {formatted_number} (contact: {profile_name}): '{message_body}'")
            logger.info(f"[QUEUE FLOW] Stored business phone {business_phone_number} for user {formatted_number}")
            logger.info("------------------------------------")
            
            # Process the message
            await self._process_message_universal(
                formatted_number, 
                message_body.lower(), 
                message_id, 
                business_phone_number, 
                service, 
                worker_id
            )
            
        except Exception as e:
            logger.error(f"Error processing WhatsApp message: {str(e)}")

    async def _process_message_universal(self, number: str, incoming_msg: str, message_id: str, business_phone_number: str, service: WhatsAppBusinessService, worker_id: int):
        """Universal message processor for WhatsApp Business API."""
        try:
            # Process the message with AI assistant
            logger.info(f"Worker {worker_id} generating response for message ID: {message_id} from user: {number}")
            from ..utils.tools_wrapper_util import get_response_from_gpt, format_response
            
            # Generate and format response
            response = get_response_from_gpt(incoming_msg, number)
            if not response:
                logger.error(f"No response generated for message ID: {message_id}")
                return
                
            formatted_response = format_response(response)
            
            # Validate business phone number
            if not business_phone_number:
                logger.error(f"No business phone number available for message ID: {message_id}")
                return
            
            # Send the response
            resp = service.send_message(number, formatted_response, business_phone_number)
            
            if resp.get('success'):
                logger.info(f"Worker {worker_id} sent response for message ID: {message_id}")
            else:
                logger.error(f"Worker {worker_id} failed to send response for message ID: {message_id}: {resp.get('error', 'Unknown error')}")
                
        except Exception as e:
            logger.error(f"Error in message processing for message ID {message_id}: {str(e)}")

 