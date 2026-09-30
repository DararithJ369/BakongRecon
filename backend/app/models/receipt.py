import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text
from app.core.database import Base


def _utc_now():
    return datetime.now(timezone.utc)


class Receipt(Base):
    __tablename__ = "receipts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id = Column(String, index=True, nullable=False)
    invoice_number = Column(String)
    image_url = Column(String, nullable=True)
    verification_status = Column(String, default="pending")
    verified_at = Column(DateTime, nullable=True)
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utc_now)

