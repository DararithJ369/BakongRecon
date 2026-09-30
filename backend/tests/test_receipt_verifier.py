try:
    import pytest
except ImportError:
    class _MockPytest:
        @staticmethod
        def fixture(fn):
            return fn
    pytest = _MockPytest()

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.transaction import Transaction
from app.models.receipt import Receipt
from app.services.receipt_verifier import store_transaction, verify_receipt


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_store_transaction_idempotent(db_session):
    data = {
        "transaction_id": "TX_TEST_01",
        "customer_name": "Test Customer",
        "amount": 50.0,
        "currency": "USD",
        "bank": "ABA",
    }
    tx1 = store_transaction(db_session, data)
    assert tx1.id is not None
    assert tx1.transaction_id == "TX_TEST_01"

    # Second store should return existing without throwing unique constraint error
    tx2 = store_transaction(db_session, data)
    assert tx1.id == tx2.id
    assert db_session.query(Transaction).count() == 1


def test_verify_receipt_flow(db_session):
    data = {
        "transaction_id": "TX_VERIFY_01",
        "customer_name": "Alice Doe",
        "amount": 25.0,
        "currency": "USD",
        "bank": "ABA",
    }
    store_transaction(db_session, data)

    # 1. First verification with invoice INV-001
    res1 = verify_receipt(db_session, "TX_VERIFY_01", "INV-001")
    assert res1.status == "verified"
    assert res1.receipt is not None
    assert res1.receipt.verification_status == "verified"

    # 2. Re-verifying same invoice should succeed idempotently
    res2 = verify_receipt(db_session, "TX_VERIFY_01", "INV-001")
    assert res2.status == "verified"
    assert res2.receipt.id == res1.receipt.id

    # 3. Verifying same transaction with a DIFFERENT invoice INV-002 must flag duplicate_usage
    res3 = verify_receipt(db_session, "TX_VERIFY_01", "INV-002")
    assert res3.status == "duplicate_usage"
    assert "already claimed by invoice INV-001" in res3.explanation

    # 4. Checking via Telegram without invoice number should indicate already claimed
    res4 = verify_receipt(db_session, "TX_VERIFY_01", "")
    assert res4.status == "duplicate_usage"


def test_verify_receipt_not_found_no_poisoning(db_session):
    # Checking non-existent transaction
    res = verify_receipt(db_session, "TX_UNKNOWN", "INV-999")
    assert res.status == "payment_not_found"
    assert res.receipt is None
    # Ensure no dummy rows are created in receipts table
    assert db_session.query(Receipt).count() == 0
