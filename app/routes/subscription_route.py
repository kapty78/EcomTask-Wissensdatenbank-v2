import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from ..services.subscription_service import SubscriptionPlanService
from ..schemas.subscription_plan import (
    SubscriptionPlanCreate,
    SubscriptionPlanUpdate,
    SubscriptionPlanResponse,
)
from ..schemas.auth import Business
from ..core.dependencies import get_subscription_service, get_current_business

# Configure logger
from ..logger import main_logger  # Ensure logger setup exists

router = APIRouter()


@router.post("/create", response_model=SubscriptionPlanResponse)
def create_subscription(
    plan_data: SubscriptionPlanCreate,
    current_business: Business = Depends(get_current_business),
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Creates a new subscription plan."""
    main_logger.info(f"Business {current_business.id} is creating a new subscription plan.")
    try:
        plan = service.create_plan(plan_data)
        main_logger.info(f"Subscription plan '{plan.name}' created successfully.")
        return plan
    except Exception as e:
        main_logger.error(f"Failed to create subscription plan: {e}")
        raise HTTPException(
            status_code=400, detail="Failed to create subscription plan"
        )


@router.post("/{subscription_id}")
def subscribe_user(
    subscription_id: int,
    current_business: Business = Depends(get_current_business),
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Subscribes the current user to a subscription plan."""
    main_logger.info(
        f"Business {current_business.id} is subscribing to plan {subscription_id}."
    )
    return service.subscribe_user(current_business.id, subscription_id)


@router.get("/")
def get_user_subscriptions(
    current_business: Business = Depends(get_current_business),
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Retrieves all subscriptions for the current user."""
    main_logger.info(f"Fetching subscriptions for user {current_business.id}.")
    return service.get_user_subscriptions(current_business.id)


@router.delete("/{subscription_id}")
def cancel_subscription(
    subscription_id: int,
    current_business: Business = Depends(get_current_business),
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Cancels a user's subscription."""
    main_logger.info(
        f"Business {current_business.id} is canceling subscription {subscription_id}."
    )
    return service.cancel_subscription(current_business.id, subscription_id)


@router.get("/{plan_id}", response_model=SubscriptionPlanResponse)
def get_subscription_by_id(
    plan_id: int,
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Fetches a specific subscription plan by its ID."""
    main_logger.info(f"Fetching subscription plan {plan_id}.")
    plan = service.get_plan_by_id(plan_id)
    if not plan:
        main_logger.warning(f"Subscription plan {plan_id} not found.")
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    return plan


@router.get("/", response_model=List[SubscriptionPlanResponse])
def get_all_subscriptions(
    current_business: Business = Depends(get_current_business),
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Retrieves all available subscription plans."""
    main_logger.info(f"Business {current_business.id} is fetching all subscription plans.")
    return service.get_all_plans()


@router.put("/{plan_id}", response_model=SubscriptionPlanResponse)
def update_subscription(
    plan_id: int,
    plan_data: SubscriptionPlanUpdate,
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Updates a specific subscription plan."""
    main_logger.info(f"Updating subscription plan {plan_id}.")
    updated_plan = service.update_plan(plan_id, plan_data)
    if not updated_plan:
        main_logger.warning(f"Subscription plan {plan_id} not found for update.")
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    main_logger.info(f"Subscription plan {plan_id} updated successfully.")
    return updated_plan


@router.delete("/{plan_id}", response_model=dict)
def delete_subscription(
    plan_id: int,
    service: SubscriptionPlanService = Depends(get_subscription_service),
):
    """Deletes a subscription plan."""
    main_logger.info(f"Deleting subscription plan {plan_id}.")
    deleted = service.delete_plan(plan_id)
    if not deleted:
        main_logger.warning(
            f"Failed to delete subscription plan {plan_id} (not found)."
        )
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    main_logger.info(f"Subscription plan {plan_id} deleted successfully.")
    return {"message": "Subscription plan deleted successfully"}
