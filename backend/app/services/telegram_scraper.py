"""
Telegram historical scraper using Telethon.

Connects as a Telegram user and reads past messages from a target group,
extracting payment notifications from trusted bot usernames and storing them
in the database.
"""
import asyncio
import logging
import os
from typing import List, Optional

from app.core.config import (
    TELEGRAM_API_ID,
    TELEGRAM_API_HASH,
    TELEGRAM_PHONE,
    TELEGRAM_TRUSTED_BOT_USERNAMES,
)
from app.core.database import SessionLocal
from app.services.parser import parse_telegram_message
from app.services.receipt_verifier import store_transaction

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELETHON_AVAILABLE = False
try:
    from telethon import TelegramClient
    from telethon.tl.types import User, Channel
    TELETHON_AVAILABLE = True
except ImportError:
    pass


TARGET_GROUP = os.environ.get("TELEGRAM_CHAT_ID", "")
SESSION_NAME = os.environ.get("TELETHON_SESSION_NAME", "bakongrecon_scraper")


def _trusted_usernames() -> List[str]:
    return TELEGRAM_TRUSTED_BOT_USERNAMES or []


async def scrape_historical_messages(
    group_identifier: Optional[str] = None,
    limit: int = 1000,
) -> None:
    """Scrape historical payment notifications from a Telegram group."""
    if not TELETHON_AVAILABLE:
        raise RuntimeError("Telethon is not installed. Run: pip install telethon")

    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        raise RuntimeError("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in backend/.env")

    group = group_identifier or TARGET_GROUP
    if not group:
        raise RuntimeError(
            "Set TELEGRAM_CHAT_ID in backend/.env to the group username or ID to scrape"
        )

    # Telegram IDs may be numeric (e.g., -1004339029215). Convert those to int.
    try:
        group = int(group)
    except ValueError:
        pass

    trusted = _trusted_usernames()
    if not trusted:
        logger.warning("No trusted bot usernames configured. Scraping all messages that look like payments.")

    client = TelegramClient(SESSION_NAME, int(TELEGRAM_API_ID), TELEGRAM_API_HASH)
    await client.start(phone=TELEGRAM_PHONE or None)

    try:
        entity = await client.get_entity(group)
        logger.info(f"Scraping messages from {getattr(entity, 'title', group)}")

        stored = 0
        skipped = 0
        db = SessionLocal()
        try:
            async for message in client.iter_messages(entity, limit=limit):
                if not message or not message.text:
                    continue

                sender = await message.get_sender()
                sender_username = ""
                if isinstance(sender, User):
                    sender_username = (sender.username or "").lower()
                elif isinstance(sender, Channel):
                    sender_username = (sender.username or "").lower()

                if trusted and sender_username not in trusted:
                    skipped += 1
                    continue

                data = parse_telegram_message(message.text)
                if not data:
                    continue

                try:
                    store_transaction(db, data)
                    stored += 1
                    logger.info(f"Stored {data['transaction_id']} from @{sender_username}")
                except Exception as e:
                    logger.error(f"Failed to store {data['transaction_id']}: {e}")
                    db.rollback()
        finally:
            db.close()

        logger.info(f"Scraping complete. Stored {stored} transactions, skipped {skipped}.")

    finally:
        await client.disconnect()


def run_scraper() -> None:
    """Entry point for the historical scraper."""
    asyncio.run(scrape_historical_messages())


if __name__ == "__main__":
    run_scraper()
