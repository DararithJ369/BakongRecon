from datetime import datetime, timezone
from sqlalchemy.orm import Session
from typing import Optional

from app.models.transaction import Transaction
from app.models.receipt import Receipt
from app.schemas.receipt import VerificationResult, ReceiptOut
from app.schemas.transaction import TransactionOut
from app.services.parser import format_amount


def store_transaction(db: Session, data: dict) -> Transaction:
    existing = db.query(Transaction).filter(Transaction.transaction_id == data["transaction_id"]).first()
    if existing:
        return existing

    tx = Transaction(**data)
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return tx


def verify_receipt(
    db: Session,
    transaction_id: str,
    invoice_number: str = "",
    image_url: str = ""
) -> VerificationResult:
    transaction_id = transaction_id.strip().upper()
    invoice_number = (invoice_number or "").strip()
    image_url = (image_url or "").strip()

    transaction = db.query(Transaction).filter(Transaction.transaction_id == transaction_id).first()

    if transaction is None:
        explanation = (
            f"No matching bank transaction was found for {transaction_id}. "
            "The payment may still be processing or the reference number may be incorrect."
        )
        return VerificationResult(
            transaction_id=transaction_id,
            status="payment_not_found",
            explanation=explanation,
            receipt=None,
            transaction=None,
        )

    # Check for existing verified receipts linked to this transaction
    verified_receipts = (
        db.query(Receipt)
        .filter(
            Receipt.transaction_id == transaction_id,
            Receipt.verification_status == "verified"
        )
        .all()
    )

    receipt = None
    if verified_receipts:
        # Case A: Invoice provided
        if invoice_number:
            same_invoice = next((r for r in verified_receipts if r.invoice_number == invoice_number), None)
            if same_invoice:
                # Idempotent re-verification of the same invoice
                status = "verified"
                explanation = (
                    f"Payment verified. Transaction {transaction_id} is linked to invoice {invoice_number} "
                    f"for {format_amount(transaction.amount, transaction.currency)} from {transaction.customer_name} via {transaction.bank}."
                )
                receipt = same_invoice
            else:
                other_inv = verified_receipts[0].invoice_number or "another invoice"
                status = "duplicate_usage"
                explanation = (
                    f"Transaction {transaction_id} was already claimed by invoice {other_inv}. "
                    "Possible duplicate payment slip submission."
                )
        else:
            # Case B: No invoice number provided (e.g., Telegram bot lookup)
            claimed_with_inv = next((r for r in verified_receipts if r.invoice_number), None)
            if claimed_with_inv:
                status = "duplicate_usage"
                explanation = (
                    f"Transaction {transaction_id} has already been claimed by invoice {claimed_with_inv.invoice_number}."
                )
                receipt = claimed_with_inv
            else:
                status = "verified"
                explanation = (
                    f"Payment verified. Transaction {transaction_id} matches {format_amount(transaction.amount, transaction.currency)} "
                    f"from {transaction.customer_name} via {transaction.bank}."
                )
                receipt = verified_receipts[0]
    else:
        status = "verified"
        explanation = (
            f"Payment verified. Transaction {transaction_id} matches {format_amount(transaction.amount, transaction.currency)} "
            f"from {transaction.customer_name} via {transaction.bank}."
        )

    # If new verification or new duplicate usage attempt with invoice, save record
    if receipt is None:
        receipt = Receipt(
            transaction_id=transaction_id,
            invoice_number=invoice_number,
            image_url=image_url,
            verification_status=status,
            explanation=explanation,
            verified_at=datetime.now(timezone.utc) if status == "verified" else None,
        )
        db.add(receipt)
        db.commit()
        db.refresh(receipt)

    return VerificationResult(
        transaction_id=transaction_id,
        status=status,
        explanation=explanation,
        receipt=ReceiptOut.model_validate(receipt) if receipt else None,
        transaction=TransactionOut.model_validate(transaction) if transaction else None,
    )

