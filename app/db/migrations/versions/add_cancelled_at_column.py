"""Add cancelled_at column to booked_appointment table

Revision ID: add_cancelled_at_column
Revises: add_appointment_status
Create Date: 2024-03-21

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_cancelled_at_column'
down_revision = 'add_appointment_status'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('booked_appointment', sa.Column('cancelled_at', sa.DateTime(), nullable=True))

def downgrade():
    op.drop_column('booked_appointment', 'cancelled_at') 