try:
    import pytest
except ImportError:
    class _MockPytest:
        @staticmethod
        def fixture(fn):
            return fn
    pytest = _MockPytest()

from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.transaction import Transaction
from app.services.analytics import compute_analytics, _calc_period_revenue
from app.core.config import CAMBODIA_TZ_OFFSET_HOURS


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


def test_calc_period_revenue_multi_currency():
    tx1 = Transaction(amount=10.0, currency="USD")
    tx2 = Transaction(amount=20.0, currency="USD")
    tx3 = Transaction(amount=41000.0, currency="KHR")  # equal to $10 at 4100 rate

    period = _calc_period_revenue([tx1, tx2, tx3], rate=4100.0)
    assert period.usd == 30.0
    assert period.khr == 41000.0
    assert period.total_usd_equiv == 40.0
    assert period.count == 3


def test_compute_analytics_trends_and_patterns(db_session):
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    # Today transaction (simulated in local Cambodia day)
    t1 = Transaction(
        transaction_id="TX_AN_1",
        customer_name="Alice",
        amount=50.0,
        currency="USD",
        bank="ABA",
        payment_method="ABA PAY",
        transaction_time=now_utc,
        created_at=now_utc,
    )
    t2 = Transaction(
        transaction_id="TX_AN_2",
        customer_name="Bob",
        amount=82000.0,
        currency="KHR",
        bank="Bakong",
        payment_method="Bakong",
        transaction_time=now_utc,
        created_at=now_utc,
    )
    # Yesterday transaction
    yest_utc = now_utc - timedelta(days=1)
    t3 = Transaction(
        transaction_id="TX_AN_3",
        customer_name="Alice",
        amount=30.0,
        currency="USD",
        bank="ABA",
        payment_method="ABA PAY",
        transaction_time=yest_utc,
        created_at=yest_utc,
    )

    db_session.add_all([t1, t2, t3])
    db_session.commit()

    analytics = compute_analytics(db_session)
    assert analytics.trends is not None
    assert analytics.patterns is not None

    # Check trends
    today_t = analytics.trends.today
    assert today_t.usd == 50.0
    assert today_t.khr == 82000.0
    assert today_t.total_usd_equiv == 70.0  # 50 + (82000 / 4100) = 70

    yest_t = analytics.trends.yesterday
    assert yest_t.usd == 30.0

    # DoD growth from $30 to $70: +133.3%
    assert analytics.trends.dod_growth_pct == 133.3

    # Check patterns
    assert analytics.patterns.dominant_payment_method is not None
    assert analytics.patterns.avg_ticket_usd == 50.0
    assert analytics.patterns.avg_ticket_khr == 82000.0

    # Check bank breakdown
    banks = {b.bank: b for b in analytics.revenue_by_bank}
    assert "ABA" in banks
    assert "Bakong" in banks
    assert banks["ABA"].amount_usd == 50.0
    assert banks["Bakong"].amount_khr == 82000.0
