#!/usr/bin/env python3
"""
Test script to verify booking storage functionality
"""
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.core.database_manager import db_manager
from app.repositories.timeglobe_repository import TimeGlobeRepository
from app.db.session import get_db
from app.models.appointment_status import AppointmentStatus

def test_booking_storage():
    """Test booking storage in SQLite (Supabase not configured)"""
    print("🧪 Testing booking storage functionality...")

    try:
        # Test database connections
        connections = db_manager.test_connections()
        print(f"📊 Database connections: {connections}")

        if not connections.get("sqlite", False):
            print("❌ SQLite connection failed")
            return False

        # Create a test booking
        db = next(get_db())
        repo = TimeGlobeRepository(db)

        # Test data
        import time
        order_id = int(time.time())  # Use timestamp as unique order ID
        test_booking = {
            "orderId": order_id,
            "siteCd": "TEST_SITE",
            "mobileNumber": "+49123456789",
            "business_phone_number": "+49987654321",
            "positions": [
                {
                    "beginTs": "2025-01-15T10:00:00.000Z",
                    "durationMillis": 3600000,
                    "employeeId": 1,
                    "itemNo": 100,
                    "itemNm": "Test Service"
                }
            ]
        }

        print(f"💾 Attempting to save booking: {test_booking['orderId']}")

        # Save the booking
        appointment = repo.save_book_appointment(
            test_booking,
            test_booking["mobileNumber"],
            test_booking["business_phone_number"]
        )

        if appointment:
            print(f"✅ Booking saved successfully: ID {appointment.id}")
            print(f"   - Order ID: {appointment.order_id}")
            print(f"   - Customer Phone: {appointment.customer_phone}")
            print(f"   - Business Phone: {appointment.business_phone_number}")
            print(f"   - Status: {appointment.status}")

            # Test cancellation
            print(f"🗑️  Testing cancellation for order_id: {order_id}")
            cancelled = repo.cancel_appointment(order_id)

            if cancelled:
                print("✅ Booking cancelled successfully")
                print(f"   - New status: {appointment.status}")
                print(f"   - Cancelled at: {appointment.cancelled_at}")
            else:
                print("❌ Booking cancellation failed")

            return True
        else:
            print("❌ Booking save failed")
            return False

    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_booking_storage()
    print(f"\n{'🎉 Test completed successfully!' if success else '💥 Test failed!'}")
    sys.exit(0 if success else 1)
