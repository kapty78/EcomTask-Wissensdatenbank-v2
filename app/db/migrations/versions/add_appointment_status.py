"""add appointment status

Revision ID: add_appointment_status
Revises: 301b7949e972
Create Date: 2024-03-19 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_appointment_status'
down_revision = '301b7949e972'
branch_labels = None
depends_on = None


def upgrade():
    # Create the enum type
    op.execute("CREATE TYPE appointmentstatus AS ENUM ('booked', 'cancelled', 'completed')")
    
    # Add the status column with a default value of 'booked'
    op.add_column('BookedAppointment',
        sa.Column('status', sa.Enum('booked', 'cancelled', 'completed', name='appointmentstatus'),
                 nullable=False, server_default='booked')
    )


def downgrade():
    # Remove the status column
    op.drop_column('BookedAppointment', 'status')
    
    # Drop the enum type
    op.execute("DROP TYPE appointmentstatus") 