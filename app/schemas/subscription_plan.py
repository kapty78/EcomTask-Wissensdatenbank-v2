from pydantic import BaseModel
from typing import Optional


class SubscriptionPlanBase(BaseModel):
    name: str
    price: float
    duration_in_days: int
    trial_days: Optional[int] = 0
    is_active: Optional[bool] = True


class SubscriptionPlanCreate(SubscriptionPlanBase):
    pass


class SubscriptionPlanUpdate(BaseModel):
    price: Optional[float]
    duration_in_days: Optional[int]
    trial_days: Optional[int]
    is_active: Optional[bool]


class SubscriptionPlanResponse(SubscriptionPlanBase):
    id: int

    class Config:
        from_attributes = True
