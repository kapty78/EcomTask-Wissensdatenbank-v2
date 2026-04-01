"""Supabase Sync Service
Keeps the local SQLite database and Supabase PostgreSQL in sync.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
import base64
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Type

from sqlalchemy.orm import Session

from ..db.session import SessionLocal
from ..models.booked_appointment import BookModel
from ..models.booking_detail import BookingDetail
from ..models.business_model import Business
from ..models.conversation_model import ConversationHistory
from ..models.main_contract import MainContract
from ..models.auftragsverarbeitung_contract import AuftragsverarbeitungContract
from ..models.lastschriftmandat import Lastschriftmandat
from ..models.reset_token import ResetToken
from ..models.appointment_status import AppointmentStatus
from ..repositories.supabase_repository import supabase_repository

logger = logging.getLogger(__name__)


@dataclass
class TableSyncConfig:
    name: str
    model: Type[Any]
    primary_key: str
    fields: Tuple[str, ...]
    datetime_naive_fields: Tuple[str, ...] = field(default_factory=tuple)
    datetime_timezone_fields: Tuple[str, ...] = field(default_factory=tuple)
    json_fields: Tuple[str, ...] = field(default_factory=tuple)
    enum_fields: Dict[str, Type[Any]] = field(default_factory=dict)
    remote_upsert: Optional[Callable[[Dict[str, Any]], Optional[Any]]] = None
    remote_delete: Optional[Callable[[Any], Any]] = None
    binary_fields: Tuple[str, ...] = field(default_factory=tuple)


class SupabaseSyncService:
    """Service that keeps SQLite and Supabase data in sync."""

    def __init__(self) -> None:
        self.table_configs: List[TableSyncConfig] = [
            TableSyncConfig(
                name="businesses",
                model=Business,
                primary_key="id",
                fields=(
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
                ),
                datetime_naive_fields=("created_at",),
                json_fields=("whatsapp_profile",),
                remote_upsert=self._upsert_business_remote,
            ),
            TableSyncConfig(
                name="booked_appointments",
                model=BookModel,
                primary_key="id",
                fields=(
                    "id",
                    "order_id",
                    "site_cd",
                    "business_id",
                    "customer_phone",
                    "business_phone_number",
                    "created_at",
                    "status",
                    "cancelled_at",
                ),
                datetime_naive_fields=("created_at", "cancelled_at"),
                enum_fields={"status": AppointmentStatus},
                remote_upsert=self._upsert_appointment_remote,
            ),
            TableSyncConfig(
                name="booking_details",
                model=BookingDetail,
                primary_key="id",
                fields=(
                    "id",
                    "begin_ts",
                    "duration_millis",
                    "employee_id",
                    "item_no",
                    "item_nm",
                    "book_id",
                    "created_at",
                ),
                datetime_naive_fields=("begin_ts", "created_at"),
                remote_upsert=self._upsert_booking_detail_remote,
            ),
            TableSyncConfig(
                name="conversation_history",
                model=ConversationHistory,
                primary_key="id",
                fields=("id", "mobile_number", "messages", "created_at", "updated_at"),
                json_fields=("messages",),
                datetime_timezone_fields=("created_at", "updated_at"),
                remote_upsert=self._upsert_conversation_remote,
            ),
            TableSyncConfig(
                name="reset_tokens",
                model=ResetToken,
                primary_key="id",
                fields=("id", "token", "business_id", "created_at", "expires_at", "used_at"),
                datetime_naive_fields=("created_at", "expires_at", "used_at"),
                remote_upsert=self._upsert_reset_token_remote,
                remote_delete=self._delete_reset_token_remote,
            ),
            TableSyncConfig(
                name="main_contracts",
                model=MainContract,
                primary_key="id",
                fields=(
                    "id",
                    "business_id",
                    "contract_text",
                    "signature_image",
                    "signature_image_path",
                    "pdf_file",
                    "file_name",
                    "created_at",
                    "updated_at",
                ),
                datetime_timezone_fields=("created_at", "updated_at"),
                binary_fields=("pdf_file",),
                remote_upsert=self._upsert_main_contract_remote,
            ),
            TableSyncConfig(
                name="auftragsverarbeitung_contracts",
                model=AuftragsverarbeitungContract,
                primary_key="id",
                fields=(
                    "id",
                    "business_id",
                    "contract_text",
                    "signature_image",
                    "pdf_file",
                    "file_name",
                    "created_at",
                    "updated_at",
                ),
                datetime_timezone_fields=("created_at", "updated_at"),
                binary_fields=("pdf_file",),
                remote_upsert=self._upsert_auftrags_contract_remote,
            ),
            TableSyncConfig(
                name="lastschriftmandats",
                model=Lastschriftmandat,
                primary_key="id",
                fields=(
                    "id",
                    "business_id",
                    "pdf_file",
                    "file_name",
                    "description",
                    "created_at",
                    "updated_at",
                ),
                datetime_timezone_fields=("created_at", "updated_at"),
                binary_fields=("pdf_file",),
                remote_upsert=self._upsert_lastschriftmandat_remote,
            ),
        ]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def sync_all(self) -> Dict[str, Dict[str, int]]:
        """Synchronise all configured tables.

        Returns:
            Dict[str, Dict[str, int]]: Summary with counts of actions per table.
        """

        summary: Dict[str, Dict[str, int]] = {}

        with SessionLocal() as session:
            for config in self.table_configs:
                summary[config.name] = self._sync_table(session, config)
                session.commit()

        return summary

    def sync_table(self, table_name: str) -> Dict[str, int]:
        """Synchronise a single table by its configured name."""

        config = next((cfg for cfg in self.table_configs if cfg.name == table_name), None)
        if not config:
            raise ValueError(f"Unknown table: {table_name}")

        with SessionLocal() as session:
            result = self._sync_table(session, config)
            session.commit()
            return result

    # ------------------------------------------------------------------
    # Table sync logic
    # ------------------------------------------------------------------

    def _sync_table(self, session: Session, config: TableSyncConfig) -> Dict[str, int]:
        stats = {
            "local_upserts": 0,
            "remote_upserts": 0,
            "remote_updates": 0,
            "local_updates": 0,
        }

        logger.info(f"Syncing table '{config.name}'")

        local_objs = session.query(config.model).all()
        local_map = {
            self._stringify_key(getattr(obj, config.primary_key)): obj
            for obj in local_objs
        }
        local_normalized = {
            key: self._normalize_record(self._serialize_local(obj, config), config)
            for key, obj in local_map.items()
        }

        remote_rows = supabase_repository.execute_raw_query(
            f"SELECT {', '.join(config.fields)} FROM {config.name}"
        )
        remote_map = {
            self._stringify_key(row[config.primary_key]): row for row in remote_rows
        }
        remote_normalized = {
            key: self._normalize_record(row, config) for key, row in remote_map.items()
        }

        # Mirror changes from Supabase to local
        for key, remote_row in remote_map.items():
            local_obj = local_map.get(key)
            if local_obj is None:
                self._apply_remote_to_local(session, config, remote_row)
                stats["local_upserts"] += 1
                continue

            if remote_normalized[key] != local_normalized.get(key):
                self._apply_remote_to_local(session, config, remote_row, local_obj)
                stats["local_updates"] += 1

        session.flush()

        # Mirror missing local records to Supabase (keep both in sync)
        for key, local_obj in local_map.items():
            if key not in remote_map:
                if self._apply_local_to_remote(config, local_obj):
                    stats["remote_upserts"] += 1
            else:
                if remote_normalized[key] != local_normalized[key]:
                    if self._apply_local_to_remote(config, local_obj):
                        stats["remote_updates"] += 1

        return stats

    # ------------------------------------------------------------------
    # Apply changes helpers
    # ------------------------------------------------------------------

    def _apply_remote_to_local(
        self,
        session: Session,
        config: TableSyncConfig,
        remote_row: Dict[str, Any],
        existing_obj: Optional[Any] = None,
    ) -> None:
        pk_value = remote_row[config.primary_key]
        obj = existing_obj or session.get(config.model, pk_value)
        if obj is None:
            obj = config.model()
            setattr(obj, config.primary_key, pk_value)
            session.add(obj)

        for field in config.fields:
            if field == config.primary_key:
                continue
            value = remote_row.get(field)
            converted = self._convert_remote_value(config, field, value)
            setattr(obj, field, converted)

    def _apply_local_to_remote(self, config: TableSyncConfig, obj: Any) -> bool:
        if not config.remote_upsert:
            logger.debug(f"Skipping remote sync for {config.name} (no upsert handler)")
            return False

        payload = self._serialize_local(obj, config)
        prepared = {
            field: self._convert_local_to_remote(config, field, value)
            for field, value in payload.items()
        }

        try:
            result = config.remote_upsert(prepared)
            return True if result is not False else False
        except Exception as exc:
            logger.warning("Failed to sync %s record %s to Supabase: %s", config.name, prepared.get(config.primary_key), exc)
            return False

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------

    def _serialize_local(self, obj: Any, config: TableSyncConfig) -> Dict[str, Any]:
        data = {}
        for field in config.fields:
            value = getattr(obj, field, None)
            if isinstance(value, AppointmentStatus):
                data[field] = value.value
            else:
                data[field] = value
        return data

    def _convert_remote_value(
        self, config: TableSyncConfig, field: str, value: Any
    ) -> Any:
        if value is None:
            return None

        if isinstance(value, Decimal):
            if value % 1 == 0:
                return int(value)
            return float(value)

        if isinstance(value, uuid.UUID):
            return str(value)

        if field in config.binary_fields and value is not None:
            if isinstance(value, (memoryview, bytes, bytearray)):
                return bytes(value)
            return value

        if field in config.json_fields and isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                logger.warning("Failed to decode JSON for field %s", field)
                return value

        if field in config.enum_fields:
            enum_cls = config.enum_fields[field]
            if isinstance(value, enum_cls):
                return value
            return enum_cls(value)

        if field in config.datetime_naive_fields:
            if isinstance(value, str):
                value = datetime.fromisoformat(value)
            if isinstance(value, datetime) and value.tzinfo is not None:
                return value.astimezone(timezone.utc).replace(tzinfo=None)
            return value

        if field in config.datetime_timezone_fields:
            if isinstance(value, str):
                value = datetime.fromisoformat(value)
            if isinstance(value, datetime):
                if value.tzinfo is None:
                    return value.replace(tzinfo=timezone.utc)
                return value.astimezone(timezone.utc)
            return value

        return value

    def _convert_local_to_remote(
        self, config: TableSyncConfig, field: str, value: Any
    ) -> Any:
        if value is None:
            return None

        if field in config.enum_fields and isinstance(value, AppointmentStatus):
            return value.value

        if field in config.binary_fields and value is not None:
            if isinstance(value, memoryview):
                return value.tobytes()
            if isinstance(value, bytearray):
                return bytes(value)
            return value

        if field in config.datetime_naive_fields:
            if isinstance(value, datetime):
                if value.tzinfo is None:
                    return value.replace(tzinfo=timezone.utc)
                return value.astimezone(timezone.utc)

        if field in config.datetime_timezone_fields:
            if isinstance(value, datetime):
                if value.tzinfo is None:
                    return value.replace(tzinfo=timezone.utc)
                return value.astimezone(timezone.utc)

        return value

    def _normalize_record(
        self, data: Dict[str, Any], config: TableSyncConfig
    ) -> Dict[str, Any]:
        normalized: Dict[str, Any] = {}
        for field in config.fields:
            value = data.get(field)
            normalized[field] = self._normalize_value(value)
        return normalized

    def _normalize_value(self, value: Any) -> Any:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            else:
                value = value.astimezone(timezone.utc)
            return value.isoformat()
        if isinstance(value, AppointmentStatus):
            return value.value
        if isinstance(value, Decimal):
            if value % 1 == 0:
                return int(value)
            return float(value)
        if isinstance(value, uuid.UUID):
            return str(value)
        if isinstance(value, (memoryview, bytes, bytearray)):
            return base64.b64encode(bytes(value)).decode("ascii")
        if isinstance(value, (list, dict)):
            return json.dumps(value, sort_keys=True)
        return value

    def _stringify_key(self, value: Any) -> str:
        return str(value)

    # ------------------------------------------------------------------
    # Remote upsert handlers
    # ------------------------------------------------------------------

    def _upsert_business_remote(self, payload: Dict[str, Any]) -> Optional[str]:
        return supabase_repository.sync_business(payload)

    def _upsert_appointment_remote(self, payload: Dict[str, Any]) -> Optional[int]:
        return supabase_repository.create_appointment(payload)

    def _upsert_booking_detail_remote(self, payload: Dict[str, Any]) -> Optional[int]:
        return supabase_repository.create_booking_detail(payload)

    def _upsert_conversation_remote(self, payload: Dict[str, Any]) -> Optional[bool]:
        mobile_number = payload.get("mobile_number")
        messages = payload.get("messages") or []
        if not mobile_number:
            return False
        return supabase_repository.sync_conversation_history(mobile_number, messages)

    def _upsert_main_contract_remote(self, payload: Dict[str, Any]) -> Optional[str]:
        return supabase_repository.sync_main_contract(payload)

    def _upsert_auftrags_contract_remote(self, payload: Dict[str, Any]) -> Optional[str]:
        return supabase_repository.sync_auftragsverarbeitung_contract(payload)

    def _upsert_lastschriftmandat_remote(self, payload: Dict[str, Any]) -> Optional[str]:
        return supabase_repository.sync_lastschriftmandat(payload)

    def _upsert_reset_token_remote(self, payload: Dict[str, Any]) -> Optional[str]:
        return supabase_repository.create_reset_token(payload)

    def _delete_reset_token_remote(self, token_id: str) -> int:
        return supabase_repository.delete_reset_token(token_id)


supabase_sync_service = SupabaseSyncService()
