from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.parser import parse_telegram_message
from app.services.receipt_verifier import store_transaction
from app.schemas.transaction import TransactionOut

router = APIRouter()


class TelegramMessageIn(BaseModel):
    text: str


@router.post("/messages", response_model=TransactionOut)
def receive_message(message: TelegramMessageIn, db: Session = Depends(get_db)):
    data = parse_telegram_message(message.text)
    if not data:
        raise HTTPException(status_code=400, detail="Could not parse payment notification")
    tx = store_transaction(db, data)
    return TransactionOut.model_validate(tx)



@router.get("/status")
def telegram_status():
    return {"status": "listener_ready", "mode": "api_polling"}
