from .base import Base

from .business_model import Business, WABAStatus
from .business_subscription import BusinessSubscription
from .subscription_plan import SubscriptionPlan
from .booking_detail import BookingDetail
from .booked_appointment import BookModel
from .customer_model import CustomerModel
from .conversation_model import ConversationHistory
from .main_contract import MainContract
from .auftragsverarbeitung_contract import AuftragsverarbeitungContract
from .lastschriftmandat import Lastschriftmandat
from .reset_token import ResetToken


# This file imports all models to ensure they are registered with SQLAlchemy
__all__ = [
    'Base',
    'Business',
    'WABAStatus',
    'BusinessSubscription',
    'SubscriptionPlan',
    'BookingDetail',
    'BookModel',
    'CustomerModel',
    'ConversationHistory',
    'MainContract',
    'AuftragsverarbeitungContract',
    'Lastschriftmandat',
    'ResetToken'
] 