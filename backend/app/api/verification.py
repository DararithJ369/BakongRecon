from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.receipt_verifier import verify_receipt
from app.schemas.receipt import ReceiptCreate, VerificationResult

router = APIRouter()


@router.post("/check", response_model=VerificationResult)
def check_receipt(payload: ReceiptCreate, db: Session = Depends(get_db)):
    return verify_receipt(db, payload.transaction_id, payload.invoice_number or "", payload.image_url or "")
