from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class TransactionBase(BaseModel):
    transaction_id: str
    apv: Optional[str] = None
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    amount: float
    currency: str
    bank: Optional[str] = None
    payment_method: Optional[str] = None
    merchant: Optional[str] = None
    transaction_time: Optional[datetime] = None


class TransactionCreate(TransactionBase):
    telegram_message: Optional[str] = None


class TransactionOut(TransactionBase):
    id: str
    status: str
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

