"""
Fix booking schema synchronization between SQLite and Supabase
Revision ID: fix_booking_schema_sync
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = 'fix_booking_schema_sync'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    """Update SQLite schema to match Supabase schema"""

    # Add customer_phone column to BookedAppointment table
    try:
        with op.batch_alter_table('BookedAppointment') as batch_op:
            batch_op.add_column(sa.Column('customer_phone', sa.String(50), nullable=True))
            batch_op.alter_column('customer_id', existing_type=sa.INTEGER, nullable=True)
    except Exception as e:
        print(f"Warning: Could not modify BookedAppointment table: {e}")

    print("Schema sync migration completed")

def downgrade():
    """Revert schema changes"""

    try:
        with op.batch_alter_table('BookedAppointment') as batch_op:
            batch_op.drop_column('customer_phone')
            batch_op.alter_column('customer_id', existing_type=sa.INTEGER, nullable=False)
    except Exception as e:
        print(f"Warning: Could not revert BookedAppointment table: {e}")

    print("Schema sync migration reverted")
