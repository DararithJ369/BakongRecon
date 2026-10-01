import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, Text
from app.core.database import Base


def _utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id = Column(String, unique=True, index=True, nullable=False)
    apv = Column(String, index=True)
    customer_name = Column(String, index=True)
    phone = Column(String)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False)
    bank = Column(String, index=True)
    payment_method = Column(String)
    merchant = Column(String, index=True)
    transaction_time = Column(DateTime)
    telegram_message = Column(Text)
    status = Column(String, default="verified")
    created_at = Column(DateTime, default=_utc_now)

