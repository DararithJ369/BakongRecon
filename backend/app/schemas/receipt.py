from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict
from app.schemas.transaction import TransactionOut


class ReceiptCreate(BaseModel):
    transaction_id: str
    invoice_number: Optional[str] = ""
    image_url: Optional[str] = ""


class ReceiptOut(BaseModel):
    id: str
    transaction_id: str
    invoice_number: Optional[str] = None
    verification_status: str
    explanation: Optional[str] = None
    verified_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)



class VerificationResult(BaseModel):
    transaction_id: str
    status: str
    explanation: str
    receipt: Optional[ReceiptOut] = None
    transaction: Optional[TransactionOut] = None
