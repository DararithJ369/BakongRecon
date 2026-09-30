import os
from pathlib import Path
from dotenv import load_dotenv

# Project paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ROOT_DIR = BASE_DIR.parent

# Load .env from backend directory or project root
load_dotenv(BASE_DIR / ".env")
load_dotenv(ROOT_DIR / ".env")

# Server
try:
    PORT = int(os.environ.get("PORT", 3000))
except (ValueError, TypeError):
    PORT = 3000

# Database
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{BASE_DIR}/bakongrecon.db" if not (BASE_DIR / "bakongops.db").exists() else f"sqlite:///{BASE_DIR}/bakongops.db"
)

# Telegram Bot (python-telegram-bot)
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

# Trusted Telegram bot usernames to scrape from in groups (comma-separated, without @)
_TELEGRAM_TRUSTED_BOTS = os.environ.get("TELEGRAM_TRUSTED_BOT_USERNAME", "")
TELEGRAM_TRUSTED_BOT_USERNAMES = [
    u.strip().lstrip("@").lower()
    for u in _TELEGRAM_TRUSTED_BOTS.split(",")
    if u.strip()
]

# Telegram (Telethon) - optional live client
_raw_api_id = os.environ.get("TELEGRAM_API_ID", "")
try:
    TELEGRAM_API_ID = int(_raw_api_id) if _raw_api_id and _raw_api_id.isdigit() else 0
except (ValueError, TypeError):
    TELEGRAM_API_ID = 0

TELEGRAM_API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
TELEGRAM_PHONE = os.environ.get("TELEGRAM_PHONE", "")

# Financial & Timezone Configuration
DEFAULT_EXCHANGE_RATE_KHR_PER_USD = float(os.environ.get("EXCHANGE_RATE_KHR_PER_USD", 4100.0))
CAMBODIA_TZ_OFFSET_HOURS = 7

# Application
APP_NAME = "BakongRecon"
APP_VERSION = "1.0.0"

