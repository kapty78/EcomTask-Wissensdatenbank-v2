import logging
from typing import Optional, Dict, Any

from sqlalchemy.orm import Session

from ..models.business_model import Business
from ..schemas.auth import BusinessCreate
from ..utils.cache import cached, cache_invalidate
from ..utils.security_util import get_password_hash

logger = logging.getLogger(__name__)


class BusinessRepository:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # Supabase helpers
    # ------------------------------------------------------------------

    def _supabase_enabled(self) -> bool:
        try:
            from ..core.database_manager import db_manager

            return db_manager.storage_mode.value in ["supabase", "dual"]
        except Exception:
            return False

    def _business_to_dict(self, business: Business) -> Dict[str, Any]:
        return {
            "id": business.id,
            "business_name": business.business_name,
            "email": business.email,
            "password": business.password,
            "phone_number": business.phone_number,
            "is_active": business.is_active,
            "created_at": business.created_at,
            "tax_id": business.tax_id,
            "street_address": business.street_address,
            "postal_code": business.postal_code,
            "city": business.city,
            "country": business.country,
            "contact_person": business.contact_person,
            "client_id": business.client_id,
            "channel_id": business.channel_id,
            "api_key": business.api_key,
            "api_endpoint": business.api_endpoint,
            "app_id": business.app_id,
            "waba_status": business.waba_status,
            "whatsapp_profile": business.whatsapp_profile,
            "whatsapp_number": business.whatsapp_number,
            "timeglobe_auth_key": business.timeglobe_auth_key,
            "customer_cd": business.customer_cd,
        }

    def _sync_business_to_supabase(self, business: Optional[Business]) -> None:
        if not business or not self._supabase_enabled():
            return
        try:
            from ..repositories.supabase_repository import supabase_repository

            supabase_repository.sync_business(self._business_to_dict(business))
        except Exception as exc:
            logger.warning(
                f"Failed to sync business {getattr(business, 'id', 'unknown')} to Supabase: {exc}"
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @cached(ttl=300, key_prefix="business")  # Cache for 5 minutes
    def get_by_email(self, email: str) -> Optional[Business]:
        return self.db.query(Business).filter(Business.email == email).first()

    @cached(ttl=300, key_prefix="business")  # Cache for 5 minutes
    def get_by_id(self, business_id: str) -> Optional[Business]:
        return self.db.query(Business).filter(Business.id == business_id).first()

    @cache_invalidate("business:*")  # Invalidate all business cache
    def create(self, business_data: BusinessCreate) -> Business:
        hashed_password = get_password_hash(business_data.password)
        db_business = Business(
            business_name=business_data.business_name,
            email=business_data.email,
            password=hashed_password,
            phone_number=business_data.phone_number,
            timeglobe_auth_key=business_data.timeglobe_auth_key,
        )
        self.db.add(db_business)
        self.db.commit()
        self.db.refresh(db_business)
        self._sync_business_to_supabase(db_business)
        return db_business

    @cache_invalidate("business:*")  # Invalidate all business cache
    def update_password(self, business_id: str, new_password: str) -> None:
        hashed_password = get_password_hash(new_password)
        self.db.query(Business).filter(Business.id == business_id).update(
            {"password": hashed_password}
        )
        self.db.commit()
        business = self.db.query(Business).filter(Business.id == business_id).first()
        self._sync_business_to_supabase(business)

    def create_business(
        self,
        business_name: str,
        email: str,
        password: str,
        phone_number: str = None,
        timeglobe_auth_key: str = None,
        customer_cd: str = None,
    ) -> Business:
        """Create a business with explicit field values."""

        hashed_password = get_password_hash(password)
        db_business = Business(
            business_name=business_name,
            email=email,
            password=hashed_password,
            phone_number=phone_number,
            timeglobe_auth_key=timeglobe_auth_key,
            customer_cd=customer_cd,
        )
        self.db.add(db_business)
        self.db.commit()
        self.db.refresh(db_business)
        self._sync_business_to_supabase(db_business)
        return db_business

    def update(self, business_id: str, data: Dict[str, Any]) -> None:
        """Update business record with supplied fields."""

        self.db.query(Business).filter(Business.id == business_id).update(data)
        self.db.commit()
        business = self.db.query(Business).filter(Business.id == business_id).first()
        self._sync_business_to_supabase(business)

    def update_business_info(self, business_id: str, data: Dict[str, Any]) -> Optional[Business]:
        """Update business information and return the updated instance."""

        business = self.db.query(Business).filter(Business.id == business_id).first()
        if not business:
            return None

        for key, value in data.items():
            if hasattr(business, key) and value is not None:
                setattr(business, key, value)

        self.db.commit()
        self.db.refresh(business)
        self._sync_business_to_supabase(business)
        return business

    def delete_business_info(self, business_id: str, fields: list) -> Optional[Business]:
        """Clear specific business information fields."""

        business = self.db.query(Business).filter(Business.id == business_id).first()
        if not business:
            return None

        for field in fields:
            if hasattr(business, field):
                setattr(business, field, None)

        self.db.commit()
        self.db.refresh(business)
        self._sync_business_to_supabase(business)
        return business
