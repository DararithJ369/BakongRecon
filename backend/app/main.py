from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import APP_NAME, APP_VERSION, PORT, ROOT_DIR
from app.core.database import engine, Base, get_db
from app.api import transactions, analytics, verification, telegram
from app.services.receipt_verifier import store_transaction
from app.models.transaction import Transaction
from app.models.receipt import Receipt



DEMO_CUSTOMERS = [
    ("LY LAISRUN", "*964", "KIM PUTDARARITH"),
    ("SOKHA LIM", "*123", "SOKHA RETAIL"),
    ("DARA SAM", "*456", "DARA TRADING"),
    ("NITA VANH", "*789", "NITA MART"),
    ("VANNAK CHEN", "*321", "VANNAK TELECOM"),
    ("SREY MAO", "*654", "SREY MOBILE"),
    ("KIM PUTDARARITH", "*987", "KIM WHOLESALE"),
    ("PHAN ISP", "*147", "PHAN ISP"),
    ("RATHA RETAIL", "*258", "RATHA RETAIL"),
    ("HENG SHOP", "*369", "HENG SHOP"),
    ("BOPHA TELECOM", "*741", "BOPHA TELECOM"),
    ("CHEA MART", "*852", "CHEA MART"),
    ("HOA RATHA", "*963", "HOA RATHA"),
    ("ROEURN PHANNET", "*159", "ROEURN PHANNET"),
    ("WHOLESALE BUYER", "*357", "WHOLESALE BUYER"),
]

DEMO_BANKS = ["ABA", "ACLEDA", "Bakong"]


def format_demo_amount(amount: float, currency: str) -> str:
    if currency == "KHR":
        return f"៛{amount:,.0f}"
    return f"${amount:,.2f}"


def generate_demo_data(db: Session, count: int = 30):
    db.query(Receipt).delete()
    db.query(Transaction).delete()
    db.commit()

    base_time = datetime.now(timezone.utc).replace(hour=8, minute=0, second=0, microsecond=0, tzinfo=None)

    for i in range(count):
        customer, phone, merchant = DEMO_CUSTOMERS[i % len(DEMO_CUSTOMERS)]
        bank = DEMO_BANKS[i % len(DEMO_BANKS)]
        amount = 10000 + (i * 1500) if bank == "Bakong" else (10 + i * 7)
        currency = "KHR" if bank == "Bakong" else "USD"
        payment_method = "ABA PAY" if bank == "ABA" else bank
        transaction_id = f"TX{8800000000 + i}"
        apv = f"{100000 + i}"
        tx_time = base_time + timedelta(minutes=i * 15)

        message = (
            f"PayWay by {bank}:\n"
            f"{format_demo_amount(amount, currency)} paid by {customer} ({phone})\n"
            f"on {tx_time.strftime('%b %d, %I:%M %p')}\n"
            f"via {payment_method}\n"
            f"at {merchant}.\n"
            f"Trx. ID: {transaction_id}\n"
            f"APV: {apv}"
        )

        store_transaction(db, {
            "transaction_id": transaction_id,
            "apv": apv,
            "customer_name": customer,
            "phone": phone,
            "amount": amount,
            "currency": currency,
            "bank": bank,
            "payment_method": payment_method,
            "merchant": merchant,
            "transaction_time": tx_time,
            "telegram_message": message,
            "status": "verified",
        })


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = Session(bind=engine)
    try:
        if db.query(Transaction).count() == 0:
            generate_demo_data(db, 30)
    finally:
        db.close()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
    app.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
    app.include_router(verification.router, prefix="/verification", tags=["verification"])
    app.include_router(telegram.router, prefix="/telegram", tags=["telegram"])

    frontend_candidates = [
        ROOT_DIR / "frontend",
        Path("/frontend"),
        Path(__file__).resolve().parent.parent.parent / "frontend",
    ]
    frontend_dir = None
    for candidate in frontend_candidates:
        if candidate.is_dir():
            frontend_dir = candidate
            break

    if frontend_dir:
        app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

        @app.get("/")
        async def root():
            return FileResponse(str(frontend_dir / "index.html"))
    else:
        @app.get("/")
        async def root():
            return {"message": f"{APP_NAME} v{APP_VERSION} is running"}

    @app.post("/api/demo/reset")
    def reset_demo(db: Session = Depends(get_db)):
        generate_demo_data(db, 30)
        return {"status": "reset"}

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
