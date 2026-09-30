import uuid
from sqlalchemy import Column, String
from app.core.database import Base


class Merchant(Base):
    __tablename__ = "merchants"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    merchant_name = Column(String, nullable=False)
    telegram_chat_id = Column(String)
    bank_name = Column(String)
