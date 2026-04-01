from ..services.whatsapp_business_service import WhatsAppBusinessService
from ..services.auth_service import AuthService, oauth2_scheme
from ..services.subscription_service import SubscriptionPlanService
from ..services.timeglobe_service import TimeGlobeService
from sqlalchemy.orm import Session
from fastapi import Depends, Request, HTTPException
from ..db.session import get_db
from .config import settings
from fastapi.security import OAuth2PasswordBearer
from typing import Generator
from ..db.session import SessionLocal
from ..repositories.business_repository import BusinessRepository
from ..models.business_model import Business


def get_whatsapp_business_service(db: Session = Depends(get_db)) -> WhatsAppBusinessService:
    return WhatsAppBusinessService(db)


def get_timeglobe_service() -> TimeGlobeService:
    return TimeGlobeService()


def get_business_repository(db: Session = Depends(get_db)) -> BusinessRepository:
    return BusinessRepository(db)


def get_auth_service(
    business_repository: BusinessRepository = Depends(get_business_repository),
    db: Session = Depends(get_db)
) -> AuthService:
    return AuthService(business_repository, db)


def get_current_business(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> Business:
    auth_service = AuthService(BusinessRepository(db), db)
    business = auth_service.get_current_business(token)
    return business


def get_subscription_service(db: Session = Depends(get_db)):
    return SubscriptionPlanService(db)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
