"""initial

Revision ID: cbcf21921970
Revises: 
Create Date: 2026-07-04 22:11:50.981825

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cbcf21921970'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'merchants',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('merchant_name', sa.String(), nullable=False),
        sa.Column('telegram_chat_id', sa.String(), nullable=True),
        sa.Column('bank_name', sa.String(), nullable=True),
    )

    op.create_table(
        'transactions',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('transaction_id', sa.String(), nullable=False),
        sa.Column('apv', sa.String(), nullable=True),
        sa.Column('customer_name', sa.String(), nullable=True),
        sa.Column('phone', sa.String(), nullable=True),
        sa.Column('amount', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(), nullable=False),
        sa.Column('bank', sa.String(), nullable=True),
        sa.Column('payment_method', sa.String(), nullable=True),
        sa.Column('merchant', sa.String(), nullable=True),
        sa.Column('transaction_time', sa.DateTime(), nullable=True),
        sa.Column('telegram_message', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), server_default='verified', nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index(op.f('ix_transactions_transaction_id'), 'transactions', ['transaction_id'], unique=True)
    op.create_index(op.f('ix_transactions_apv'), 'transactions', ['apv'], unique=False)
    op.create_index(op.f('ix_transactions_customer_name'), 'transactions', ['customer_name'], unique=False)
    op.create_index(op.f('ix_transactions_bank'), 'transactions', ['bank'], unique=False)
    op.create_index(op.f('ix_transactions_merchant'), 'transactions', ['merchant'], unique=False)

    op.create_table(
        'receipts',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('transaction_id', sa.String(), nullable=False),
        sa.Column('invoice_number', sa.String(), nullable=True),
        sa.Column('image_url', sa.String(), nullable=True),
        sa.Column('verification_status', sa.String(), server_default='pending', nullable=True),
        sa.Column('verified_at', sa.DateTime(), nullable=True),
        sa.Column('explanation', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index(op.f('ix_receipts_transaction_id'), 'receipts', ['transaction_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_receipts_transaction_id'), table_name='receipts')
    op.drop_table('receipts')
    op.drop_index(op.f('ix_transactions_merchant'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_bank'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_customer_name'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_apv'), table_name='transactions')
    op.drop_index(op.f('ix_transactions_transaction_id'), table_name='transactions')
    op.drop_table('transactions')
    op.drop_table('merchants')

