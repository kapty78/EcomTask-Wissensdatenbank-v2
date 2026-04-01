"""
Supabase Repository Module
Provides Supabase-specific database operations
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Union

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..core.supabase_config import get_supabase_session, get_supabase_table
from ..models.business_model import Business
from ..models.customer_model import CustomerModel
from ..models.booked_appointment import BookModel
from ..models.booking_detail import BookingDetail
from ..models.conversation_model import ConversationHistory
from ..models.main_contract import MainContract
from ..models.auftragsverarbeitung_contract import AuftragsverarbeitungContract
from ..models.lastschriftmandat import Lastschriftmandat

logger = logging.getLogger(__name__)

class SupabaseRepository:
    """Repository for Supabase database operations"""
    
    def __init__(self):
        self.table_prefix = ""  # Supabase doesn't need table prefix
    
    def get_session(self) -> Session:
        """Get Supabase database session"""
        return get_supabase_session()
    
    def get_table_client(self, table_name: str):
        """Get Supabase table client"""
        return get_supabase_table(table_name)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _normalize_timestamp(self, value: Optional[datetime]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()

    def _prepare_params(self, data: Dict[str, Any]) -> Dict[str, Any]:
        prepared: Dict[str, Any] = {}
        for key, value in data.items():
            if isinstance(value, datetime):
                prepared[key] = self._normalize_timestamp(value)
            elif isinstance(value, (dict, list)):
                prepared[key] = json.dumps(value)
            else:
                prepared[key] = value
        return prepared

    def _execute(self, query: str, params: Optional[Dict[str, Any]] = None, fetch: str = "none") -> Union[None, int, Any, List[Any]]:
        from ..core.supabase_config import supabase_config

        session = supabase_config.get_session()
        try:
            result = session.execute(text(query), params or {})
            if fetch == "one":
                row = result.fetchone()
                session.commit()
                return row
            if fetch == "all":
                rows = result.fetchall()
                session.commit()
                return rows
            session.commit()
            return result.rowcount
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def _upsert_record(self, table: str, data: Dict[str, Any], conflict_column: str = "id") -> Optional[Any]:
        if not data.get(conflict_column):
            raise ValueError(f"Missing conflict column '{conflict_column}' for upsert into {table}")

        prepared = self._prepare_params(data)
        columns = ", ".join(data.keys())
        placeholders = ", ".join([f":{key}" for key in data.keys()])
        updates = ", ".join([
            f"{col} = EXCLUDED.{col}" for col in data.keys() if col != conflict_column
        ])
        if not updates:
            updates = f"{conflict_column} = EXCLUDED.{conflict_column}"

        query = f"""
            INSERT INTO {table} ({columns})
            VALUES ({placeholders})
            ON CONFLICT ({conflict_column}) DO UPDATE
            SET {updates}
            RETURNING {conflict_column}
        """

        row = self._execute(query, prepared, fetch="one")
        return row[0] if row else None

    def _update_record(self, table: str, key_column: str, key_value: Any, updates: Dict[str, Any]) -> int:
        if not updates:
            return 0

        payload = self._prepare_params({**updates, key_column: key_value})
        set_clause = ", ".join([f"{col} = :{col}" for col in updates.keys()])
        query = f"""
            UPDATE {table}
            SET {set_clause}
            WHERE {key_column} = :{key_column}
        """
        return int(self._execute(query, payload) or 0)
    
    # ============================================================================
    # BUSINESS OPERATIONS
    # ============================================================================

    def sync_business(self, business_data: Dict[str, Any]) -> Optional[str]:
        """Insert or update a business record in Supabase using SQL."""
        allowed_keys = [
            "id",
            "business_name",
            "email",
            "password",
            "phone_number",
            "is_active",
            "created_at",
            "tax_id",
            "street_address",
            "postal_code",
            "city",
            "country",
            "contact_person",
            "client_id",
            "channel_id",
            "api_key",
            "api_endpoint",
            "app_id",
            "waba_status",
            "whatsapp_profile",
            "whatsapp_number",
            "timeglobe_auth_key",
            "customer_cd",
        ]

        payload = {
            key: business_data[key]
            for key in allowed_keys
            if key in business_data and business_data[key] is not None
        }

        if not payload.get("created_at"):
            payload["created_at"] = datetime.now(timezone.utc)

        return self._upsert_record("businesses", payload, conflict_column="id")

    def update_business_fields(self, business_id: str, updates: Dict[str, Any]) -> int:
        """Update specific business fields in Supabase."""
        return self._update_record("businesses", "id", business_id, updates)

    def sync_main_contract(self, contract_data: Dict[str, Any]) -> Optional[str]:
        allowed_keys = (
            "id",
            "business_id",
            "contract_text",
            "signature_image",
            "signature_image_path",
            "pdf_file",
            "file_name",
            "created_at",
            "updated_at",
        )
        payload = {k: contract_data[k] for k in allowed_keys if k in contract_data}
        return self._upsert_record("main_contracts", payload, conflict_column="id")

    def sync_auftragsverarbeitung_contract(self, contract_data: Dict[str, Any]) -> Optional[str]:
        allowed_keys = (
            "id",
            "business_id",
            "contract_text",
            "signature_image",
            "pdf_file",
            "file_name",
            "created_at",
            "updated_at",
        )
        payload = {k: contract_data[k] for k in allowed_keys if k in contract_data}
        return self._upsert_record("auftragsverarbeitung_contracts", payload, conflict_column="id")

    def sync_lastschriftmandat(self, mandate_data: Dict[str, Any]) -> Optional[str]:
        allowed_keys = (
            "id",
            "business_id",
            "pdf_file",
            "file_name",
            "description",
            "created_at",
            "updated_at",
        )
        payload = {k: mandate_data[k] for k in allowed_keys if k in mandate_data}
        return self._upsert_record("lastschriftmandats", payload, conflict_column="id")
    
    def create_business(self, business_data: Dict[str, Any]) -> Optional[Business]:
        """Create a new business in Supabase"""
        try:
            inserted_id = self.sync_business(business_data)
            if inserted_id:
                logger.info(f"Business created in Supabase: {inserted_id}")
            return None
        except Exception as e:
            logger.error(f"Error creating business in Supabase: {e}")
            return None
    
    def get_business_by_email(self, email: str) -> Optional[Business]:
        """Get business by email from Supabase"""
        try:
            table = self.get_table_client("businesses")
            result = table.select("*").eq("email", email).execute()
            
            if result.data:
                return Business(**result.data[0])
            return None
            
        except Exception as e:
            logger.error(f"Error getting business by email from Supabase: {e}")
            return None
    
    def get_business_by_id(self, business_id: str) -> Optional[Business]:
        """Get business by ID from Supabase"""
        try:
            table = self.get_table_client("businesses")
            result = table.select("*").eq("id", business_id).execute()
            
            if result.data:
                return Business(**result.data[0])
            return None
            
        except Exception as e:
            logger.error(f"Error getting business by ID from Supabase: {e}")
            return None
    
    def update_business(self, business_id: str, update_data: Dict[str, Any]) -> bool:
        """Update business in Supabase"""
        try:
            updated = self.update_business_fields(business_id, update_data)
            if updated:
                logger.info(f"Business updated in Supabase: {business_id}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error updating business in Supabase: {e}")
            return False
    
    # ============================================================================
    # CUSTOMER OPERATIONS
    # ============================================================================
    
    def create_customer(self, customer_data: Dict[str, Any]) -> Optional[int]:
        """Create or update a customer in Supabase and return the customer ID."""
        try:
            if "id" not in customer_data:
                raise ValueError("customer_data requires 'id' for Supabase synchronization")

            inserted_id = self._upsert_record(
                "customers",
                customer_data,
                conflict_column="id"
            )

            if inserted_id is not None:
                logger.info(f"Customer created in Supabase: {inserted_id}")
            return inserted_id

        except Exception as e:
            logger.error(f"Error creating customer in Supabase: {e}")
            return None
    
    def get_customer_by_mobile(self, mobile_number: str) -> Optional[CustomerModel]:
        """Get customer by mobile number from Supabase"""
        try:
            table = self.get_table_client("customers")
            result = table.select("*").eq("mobile_number", mobile_number).execute()
            
            if result.data:
                return CustomerModel(**result.data[0])
            return None
            
        except Exception as e:
            logger.error(f"Error getting customer by mobile from Supabase: {e}")
            return None
    
    def get_customer_by_id(self, customer_id: int) -> Optional[CustomerModel]:
        """Get customer by ID from Supabase"""
        try:
            table = self.get_table_client("customers")
            result = table.select("*").eq("id", customer_id).execute()
            
            if result.data:
                return CustomerModel(**result.data[0])
            return None
            
        except Exception as e:
            logger.error(f"Error getting customer by ID from Supabase: {e}")
            return None
    
    def update_customer(self, customer_id: int, update_data: Dict[str, Any]) -> bool:
        """Update customer in Supabase by ID"""
        try:
            table = self.get_table_client("customers")
            result = table.update(update_data).eq("id", customer_id).execute()
            
            if result.data:
                logger.info(f"Customer updated in Supabase: {customer_id}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Error updating customer in Supabase: {e}")
            return False
    
    def update_customer_by_phone(self, mobile_number: str, update_data: Dict[str, Any]) -> bool:
        """Update customer in Supabase by mobile number using SQLAlchemy"""
        try:
            from ..core.supabase_config import supabase_config
            session = supabase_config.get_session()
            
            from sqlalchemy import text
            set_clause = ', '.join([f"{key} = :{key}" for key in update_data.keys()])
            
            query = text(f"""
                UPDATE customers 
                SET {set_clause}
                WHERE mobile_number = :mobile_number
            """)
            
            params = {**update_data, "mobile_number": mobile_number}
            result = session.execute(text(query), params)
            session.commit()
            session.close()
            
            if result.rowcount > 0:
                logger.info(f"Customer updated in Supabase: {mobile_number}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Error updating customer in Supabase: {e}")
            return False
    
    # ============================================================================
    # APPOINTMENT OPERATIONS
    # ============================================================================
    
    def create_appointment(self, appointment_data: Dict[str, Any]) -> Optional[int]:
        """Create or update an appointment in Supabase and return the appointment ID."""
        try:
            if "id" not in appointment_data:
                raise ValueError("appointment_data requires 'id' for Supabase synchronization")

            inserted_id = self._upsert_record(
                "booked_appointments",
                appointment_data,
                conflict_column="id"
            )

            if inserted_id is not None:
                logger.info(f"Appointment created in Supabase: {inserted_id}")
            return inserted_id

        except Exception as e:
            logger.error(f"Error creating appointment in Supabase: {e}")
            return None
    
    def get_appointment_by_id(self, appointment_id: int) -> Optional[BookModel]:
        """Get appointment by ID from Supabase"""
        try:
            table = self.get_table_client("booked_appointments")
            result = table.select("*").eq("id", appointment_id).execute()
            
            if result.data:
                return BookModel(**result.data[0])
            return None
            
        except Exception as e:
            logger.error(f"Error getting appointment by ID from Supabase: {e}")
            return None
    
    def get_appointments_by_customer(self, customer_id: int) -> List[BookModel]:
        """Get appointments by customer ID from Supabase"""
        try:
            table = self.get_table_client("booked_appointments")
            result = table.select("*").eq("customer_id", customer_id).execute()
            
            appointments = []
            if result.data:
                for data in result.data:
                    appointments.append(BookModel(**data))
            
            return appointments
            
        except Exception as e:
            logger.error(f"Error getting appointments by customer from Supabase: {e}")
            return []
    
    def update_appointment(self, appointment_id: int, update_data: Dict[str, Any]) -> bool:
        """Update appointment in Supabase"""
        try:
            table = self.get_table_client("booked_appointments")
            result = table.update(update_data).eq("id", appointment_id).execute()
            
            if result.data:
                logger.info(f"Appointment updated in Supabase: {appointment_id}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Error updating appointment in Supabase: {e}")
            return False
    
    def cancel_appointment(self, order_id: int, cancelled_at: str) -> bool:
        """Cancel an appointment in Supabase using SQLAlchemy"""
        try:
            from ..core.supabase_config import supabase_config
            session = supabase_config.get_session()
            
            # Use SQLAlchemy to update
            from sqlalchemy import text
            query = text("""
                UPDATE booked_appointments 
                SET status = :status, cancelled_at = :cancelled_at 
                WHERE order_id = :order_id
            """)
            
            result = session.execute(query, {
                "status": "cancelled",
                "cancelled_at": cancelled_at,
                "order_id": order_id
            })
            session.commit()
            session.close()
            
            if result.rowcount > 0:
                logger.info(f"Appointment cancelled in Supabase: order_id={order_id}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Error cancelling appointment in Supabase: {e}")
            return False
    
    # ============================================================================
    # BOOKING DETAIL OPERATIONS
    # ============================================================================
    
    def create_booking_detail(self, booking_detail_data: Dict[str, Any]) -> Optional[BookingDetail]:
        """Create a new booking detail in Supabase"""
        try:
            allowed_keys = [
                "id",
                "begin_ts",
                "duration_millis",
                "employee_id",
                "item_no",
                "item_nm",
                "book_id",
                "created_at",
            ]

            payload = {
                key: booking_detail_data[key]
                for key in allowed_keys
                if key in booking_detail_data and booking_detail_data[key] is not None
            }

            if not payload.get("created_at"):
                payload["created_at"] = datetime.now(timezone.utc)

            inserted_id = self._upsert_record("booking_details", payload, conflict_column="id")
            if inserted_id:
                logger.info(f"Booking detail created in Supabase: {inserted_id}")
            return None
        except Exception as e:
            logger.error(f"Error creating booking detail in Supabase: {e}")
            return None
    
    def get_booking_details_by_appointment(self, appointment_id: int) -> List[BookingDetail]:
        """Get booking details by appointment ID from Supabase"""
        try:
            table = self.get_table_client("booking_details")
            result = table.select("*").eq("book_id", appointment_id).execute()
            
            details = []
            if result.data:
                for data in result.data:
                    details.append(BookingDetail(**data))
            
            return details
            
        except Exception as e:
            logger.error(f"Error getting booking details by appointment from Supabase: {e}")
            return []
    
    # ============================================================================
    # CONVERSATION OPERATIONS
    # ============================================================================
    
    def create_conversation(self, conversation_data: Dict[str, Any]) -> Optional[ConversationHistory]:
        """Create a new conversation in Supabase"""
        try:
            success = self.sync_conversation_history(
                conversation_data.get("mobile_number"),
                conversation_data.get("messages", [])
            )
            if success:
                logger.info("Conversation created in Supabase via sync")
            return None
        except Exception as e:
            logger.error(f"Error creating conversation in Supabase: {e}")
            return None
    
    def get_conversation_by_mobile(self, mobile_number: str) -> Optional[ConversationHistory]:
        """Get conversation by mobile number from Supabase"""
        try:
            table = self.get_table_client("conversation_history")
            result = table.select("*").eq("mobile_number", mobile_number).execute()
            
            if result.data:
                return ConversationHistory(**result.data[0])
            return None
            
        except Exception as e:
            logger.error(f"Error getting conversation by mobile from Supabase: {e}")
            return None
    
    def update_conversation(self, conversation_id: int, update_data: Dict[str, Any]) -> bool:
        """Update conversation in Supabase"""
        try:
            updated = self._update_record("conversation_history", "id", conversation_id, update_data)
            if updated:
                logger.info(f"Conversation updated in Supabase: {conversation_id}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error updating conversation in Supabase: {e}")
            return False

    def sync_conversation_history(self, mobile_number: str, messages: List[Dict[str, Any]]) -> bool:
        """Upsert conversation history by mobile number."""
        if not mobile_number:
            return False

        messages_json = json.dumps(messages or [])
        now_utc = self._normalize_timestamp(datetime.now(timezone.utc))

        existing = self._execute(
            "SELECT id FROM conversation_history WHERE mobile_number = :mobile_number LIMIT 1",
            {"mobile_number": mobile_number},
            fetch="one"
        )

        if existing:
            query = """
                UPDATE conversation_history
                SET messages = CAST(:messages AS jsonb),
                    updated_at = :updated_at
                WHERE id = :id
            """
            params = {
                "messages": messages_json,
                "updated_at": now_utc,
                "id": existing[0],
            }
            self._execute(query, params)
            return True

        insert_query = """
            INSERT INTO conversation_history (mobile_number, messages, created_at, updated_at)
            VALUES (:mobile_number, CAST(:messages AS jsonb), :created_at, :updated_at)
            RETURNING id
        """
        params = {
            "mobile_number": mobile_number,
            "messages": messages_json,
            "created_at": now_utc,
            "updated_at": now_utc,
        }
        row = self._execute(insert_query, params, fetch="one")
        return bool(row)

    def delete_conversation_history(self, mobile_number: str) -> int:
        """Delete conversation history by mobile number."""
        return int(
            self._execute(
                "DELETE FROM conversation_history WHERE mobile_number = :mobile_number",
                {"mobile_number": mobile_number}
            )
            or 0
        )

    # ============================================================================
    # RESET TOKEN OPERATIONS
    # ============================================================================

    def create_reset_token(self, token_data: Dict[str, Any]) -> Optional[str]:
        """Insert a password reset token into Supabase."""
        required_keys = ["id", "token", "business_id", "created_at", "expires_at", "used_at"]
        payload = {
            key: token_data[key]
            for key in required_keys
            if key in token_data and token_data[key] is not None
        }

        if not payload.get("created_at"):
            payload["created_at"] = datetime.now(timezone.utc)

        if not payload.get("expires_at") and token_data.get("created_at"):
            payload["expires_at"] = token_data["created_at"]

        inserted = self._upsert_record("reset_tokens", payload, conflict_column="id")
        return inserted

    def mark_reset_token_used(self, token: str, used_at: datetime) -> int:
        """Mark a reset token as used."""
        return int(
            self._execute(
            """
            UPDATE reset_tokens
            SET used_at = :used_at
            WHERE token = :token
        """,
            {
                "used_at": self._normalize_timestamp(used_at),
                "token": token,
            }
        ) or 0)

    def delete_expired_reset_tokens(self, cutoff: datetime) -> int:
        """Delete expired reset tokens."""
        return int(
            self._execute(
            "DELETE FROM reset_tokens WHERE expires_at < :cutoff",
            {"cutoff": self._normalize_timestamp(cutoff)}
        ) or 0)

    def delete_reset_token(self, token_id: str) -> int:
        """Delete a reset token by ID."""
        return int(
            self._execute(
                "DELETE FROM reset_tokens WHERE id = :id",
                {"id": token_id}
            )
            or 0
        )
    
    # ============================================================================
    # UTILITY OPERATIONS
    # ============================================================================
    
    def execute_raw_query(self, query: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Execute raw SQL query in Supabase"""
        try:
            with self.get_session() as session:
                if params:
                    result = session.execute(text(query), params)
                else:
                    result = session.execute(text(query))
                session.commit()
                
                # Convert result to list of dictionaries
                columns = result.keys()
                rows = result.fetchall()
                return [dict(zip(columns, row)) for row in rows]
                
        except Exception as e:
            logger.error(f"Error executing raw query in Supabase: {e}")
            return []
    
    def test_connection(self) -> bool:
        """Test Supabase connection"""
        try:
            table = self.get_table_client("businesses")
            result = table.select("id").limit(1).execute()
            return True
        except Exception as e:
            logger.error(f"Supabase connection test failed: {e}")
            return False
    
    def get_table_info(self, table_name: str) -> Dict[str, Any]:
        """Get table information from Supabase"""
        try:
            with self.get_session() as session:
                # Get table structure
                query = """
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = :table_name
                ORDER BY ordinal_position
                """
                result = session.execute(text(query), {"table_name": table_name})
                session.commit()
                
                columns = []
                for row in result:
                    columns.append({
                        "name": row[0],
                        "type": row[1],
                        "nullable": row[2] == "YES",
                        "default": row[3]
                    })
                
                return {
                    "table_name": table_name,
                    "columns": columns
                }
                
        except Exception as e:
            logger.error(f"Error getting table info from Supabase: {e}")
            return {"error": str(e)}

# Global Supabase repository instance
supabase_repository = SupabaseRepository()

def get_supabase_repository() -> SupabaseRepository:
    """Get Supabase repository instance"""
    return supabase_repository
