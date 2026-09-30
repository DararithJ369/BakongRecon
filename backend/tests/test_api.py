try:
    import pytest
except ImportError:
    class _MockPytest:
        @staticmethod
        def fixture(fn):
            return fn
    pytest = _MockPytest()

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import create_app
from app.models.transaction import Transaction

# Test DB in memory with StaticPool to share state across connections
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
Base.metadata.create_all(bind=test_engine)



def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    app = create_app()
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c


def test_telegram_message_ingestion_api(client):
    from datetime import datetime
    today_str = datetime.now().strftime('%b %d, %I:%M %p')
    msg = (
        f"PayWay by ABA:\n"
        f"៛25,000 paid by SOKHA LIM (*123)\n"
        f"on {today_str}\n"
        f"via ABA PAY\n"
        f"at SOKHA RETAIL.\n"
        f"Trx. ID: TX_API_001\n"
        f"APV: 112233"
    )
    resp = client.post("/telegram/messages", json={"text": msg})
    assert resp.status_code == 200
    data = resp.json()
    assert data["transaction_id"] == "TX_API_001"
    assert data["amount"] == 25000.0
    assert data["currency"] == "KHR"



def test_transactions_list_and_search_api(client):
    from datetime import datetime
    today_str = datetime.now().strftime('%b %d, %I:%M %p')
    msg = (
        f"PayWay by ABA:\n"
        f"៛15,000 paid by DARA SAM (*456)\n"
        f"on {today_str}\n"
        f"via ABA PAY\n"
        f"at DARA TRADING.\n"
        f"Trx. ID: TX_SEARCH_001\n"
        f"APV: 998877"
    )
    client.post("/telegram/messages", json={"text": msg})

    # Fetch list
    resp = client.get("/transactions?limit=10&skip=0")
    assert resp.status_code == 200
    txs = resp.json()
    assert isinstance(txs, list)
    assert len(txs) >= 1

    # Search
    search_resp = client.get("/transactions?q=TX_SEARCH_001")
    assert search_resp.status_code == 200
    search_data = search_resp.json()
    assert len(search_data) == 1
    assert search_data[0]["transaction_id"] == "TX_SEARCH_001"


def test_verification_api(client):
    from datetime import datetime
    today_str = datetime.now().strftime('%b %d, %I:%M %p')
    msg = (
        f"PayWay by ABA:\n"
        f"$10.00 paid by NITA VANH (*789)\n"
        f"on {today_str}\n"
        f"via ABA PAY\n"
        f"at NITA MART.\n"
        f"Trx. ID: TX_VERIFY_API_001\n"
        f"APV: 554433"
    )
    client.post("/telegram/messages", json={"text": msg})

    # Verify existing transaction
    resp = client.post("/verification/check", json={
        "transaction_id": "TX_VERIFY_API_001",
        "invoice_number": "INV-API-01"
    })
    assert resp.status_code == 200
    result = resp.json()
    assert result["status"] == "verified"
    assert result["transaction"]["transaction_id"] == "TX_VERIFY_API_001"

    # Second invoice verification should flag duplicate
    resp2 = client.post("/verification/check", json={
        "transaction_id": "TX_VERIFY_API_001",
        "invoice_number": "INV-API-02"
    })
    assert resp2.status_code == 200
    result2 = resp2.json()
    assert result2["status"] == "duplicate_usage"


def test_dashboard_analytics_api(client):
    from datetime import datetime
    today_str = datetime.now().strftime('%b %d, %I:%M %p')
    msg = (
        f"PayWay by ABA:\n"
        f"៛30,000 paid by SOKHA LIM (*123)\n"
        f"on {today_str}\n"
        f"via ABA PAY\n"
        f"at SOKHA RETAIL.\n"
        f"Trx. ID: TX_DASH_001\n"
        f"APV: 112233"
    )
    client.post("/telegram/messages", json={"text": msg})

    resp = client.get("/analytics/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    assert "trends" in data
    assert "patterns" in data
    assert "revenue_by_bank" in data
    assert "top_customers" in data
    assert data["trends"]["today"]["khr"] >= 30000.0

