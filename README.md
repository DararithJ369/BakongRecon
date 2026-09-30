# BakongRecon

Anti-fraud tracking, payment verification, and financial operations platform for Cambodian Bakong and bank payments. Automatically listens to official bank payment notifications from Telegram, extracts transaction details, stores them in a centralized database, verifies customer receipts, and generates real-time revenue analytics.

## Tech Stack

- **Backend:** FastAPI + SQLAlchemy + Alembic + Uvicorn
- **Database:** PostgreSQL (production / Docker) / SQLite (local development default)
- **Telegram:** python-telegram-bot (live bot interactions) + Telethon (user client / scraper)
- **Frontend:** Vanilla JS dashboard served directly from `frontend/`

## Quick Start

### 1. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure environment (optional)

```bash
cp .env.example .env
# Edit .env to set DATABASE_URL for PostgreSQL or keep the SQLite default
```

### 3. Run database migrations

```bash
python -m alembic -c alembic.ini upgrade head
```

### 4. Start the server

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
```

Open `http://localhost:3000` in your browser.

## Running Tests

An automated test suite covering message parsing, idempotency, duplicate verification protection, and analytics calculation is included:

```bash
cd backend
python run_tests.py
```

Or using `pytest`:

```bash
pytest
```

## Telegram Bot

Set `TELEGRAM_BOT_TOKEN` in `backend/.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_TRUSTED_BOT_USERNAME=paywaybyaba_bot
```

### Behavior

- **In groups:** The bot stays silent and automatically stores payment notifications originating from the trusted bot username(s). No spam or noise in customer/merchant groups.
- **In private chat:** The bot responds to operational commands, provides financial analytics, and checks receipt authenticity.

### Commands (private chat)

- `/today` — Today's revenue & DoD growth trend
- `/revenue` — Multi-period overview (Today, Yesterday, 7D, Month)
- `/patterns` — Peak traffic windows, dominant payment rails & ticket size
- `/banks` — Revenue breakdown by bank rail
- `/stats` — Operational summary & integrity status
- `/verify <transaction_id>` — Verify a payment receipt

Run the bot locally:

```bash
cd backend
python -m app.services.telegram_bot
```

Or run via Docker Compose (included in the stack).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Web dashboard UI |
| GET | `/transactions?q={query}` | List and search transactions by ID, APV, customer, or merchant |
| GET | `/transactions/{transaction_id}` | Get transaction details by ID |
| POST | `/telegram/messages` | Ingest a Telegram bank payment notification |
| GET | `/telegram/status` | Ingestion listener status |
| POST | `/verification/check` | Verify a receipt by transaction ID & invoice number |
| GET | `/analytics/dashboard` | Dashboard metrics, periods, patterns, and hourly chart data |
| POST | `/api/demo/reset` | Reset demo dataset (30 seeded records) |

## Sample Telegram Notification

```text
PayWay by ABA:
៛100 paid by LY LAISRUN (*964)
on Jul 04, 02:14 PM
via ABA PAY
at KIM PUTDARARITH.
Trx. ID: 178314927151090
APV: 444368
```

## Historical Scraping (Telethon)

Telegram bot accounts cannot read messages posted before they joined. To scrape historical payment notifications from a group, use the Telethon user scraper:

1. Add your Telegram API credentials to `backend/.env`:

```env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=your_phone_number
TELEGRAM_CHAT_ID=your_group_username_or_id
```

2. Run the scraper:

**Locally (simplest for first-time interactive login):**
```bash
cd backend
python -m app.services.telegram_scraper
```

**Via Docker (interactive):**
```bash
docker compose run --rm -it telegram-scraper
```

On first run, Telegram sends a verification login code to your phone. The scraper then reads messages from the group, parses notifications from trusted bank bots, and stores them in the database.

## Docker (optional)

Ensure Docker Desktop is running, then execute from the project root:

```bash
# Build and start the full stack (PostgreSQL, backend, bot)
docker compose up --build -d

# View backend logs
docker compose logs -f backend

# Stop everything
docker compose down
```

The dashboard will be available at `http://localhost:3000`.

## Project Structure

```text
.
├── backend/
│   ├── alembic/              # Database migration scripts
│   ├── app/
│   │   ├── api/              # FastAPI route endpoints
│   │   ├── core/             # Configuration and database engine
│   │   ├── models/           # SQLAlchemy ORM models
│   │   ├── schemas/          # Pydantic validation schemas
│   │   ├── services/         # Parsers, verifier, analytics, bot
│   │   └── main.py           # FastAPI application factory
│   ├── tests/                # Automated test suite
│   ├── Dockerfile            # Backend container specification
│   ├── alembic.ini           # Alembic migration configuration
│   ├── requirements.txt      # Python dependencies
│   └── run_tests.py          # Standalone test runner
├── frontend/                 # Web dashboard (HTML, CSS, JS)
├── docker-compose.yml        # Multi-container orchestration
└── README.md
```
