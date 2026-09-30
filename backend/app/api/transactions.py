from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionOut

router = APIRouter()


@router.get("", response_model=List[TransactionOut])
def list_transactions(
    q: Optional[str] = None,
    limit: int = 50,
    skip: int = 0,
    db: Session = Depends(get_db)
):
    query = db.query(Transaction)
    if q:
        q = q.strip()
        query = query.filter(
            (Transaction.transaction_id.ilike(f"%{q}%")) |
            (Transaction.customer_name.ilike(f"%{q}%")) |
            (Transaction.apv.ilike(f"%{q}%")) |
            (Transaction.merchant.ilike(f"%{q}%"))
        )
    time_col = func.coalesce(Transaction.transaction_time, Transaction.created_at)
    return query.order_by(time_col.desc()).offset(skip).limit(min(limit, 200)).all()



@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: str, db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.transaction_id == transaction_id.upper()).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx
