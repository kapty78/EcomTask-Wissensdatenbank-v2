"""fix waba_status column type

Revision ID: fix_waba_status_column_type
Revises: add_reset_tokens_table
Create Date: 2025-10-10 03:40:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'fix_waba_status_column_type'
down_revision = 'add_reset_tokens_table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Change waba_status from VARCHAR(9) to VARCHAR (unlimited length)
    # This fixes the SQLite datatype mismatch error
    op.alter_column('businesses', 'waba_status',
                    existing_type=sa.VARCHAR(9),
                    type_=sa.VARCHAR(),
                    existing_nullable=True)


def downgrade() -> None:
    # Revert back to VARCHAR(9) if needed
    op.alter_column('businesses', 'waba_status',
                    existing_type=sa.VARCHAR(),
                    type_=sa.VARCHAR(9),
                    existing_nullable=True)
