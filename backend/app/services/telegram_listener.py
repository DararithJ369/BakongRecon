"""
Telegram listener using Telethon.

Run this as a standalone process to listen for live payment notifications
from authorized Telegram chats and push them to the FastAPI backend.
"""
import os
import requests
from typing import Optional

from app.core.config import TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE

TELETHON_AVAILABLE = False
try:
    from telethon import TelegramClient, events
    TELETHON_AVAILABLE = True
except ImportError:
    pass


BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")


def start_telegram_listener(session_name: str = "bakongrecon_session") -> None:
    """Start a live Telegram client that forwards payment notifications to the backend."""
    if not TELETHON_AVAILABLE:
        raise RuntimeError("Telethon is not installed. Install it with: pip install telethon")

    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        raise RuntimeError("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in the environment")

    client = TelegramClient(session_name, TELEGRAM_API_ID, TELEGRAM_API_HASH)

    @client.on(events.NewMessage())
    async def handler(event):
        text = event.message.message if hasattr(event.message, 'message') else (event.message.text or "")
        if not text:
            return

        # Only forward messages that look like bank notifications
        lower = text.lower()
        if any(k in lower for k in ["paid by", "trx. id", "transaction id", "payway", "bakong", "acleda"]):
            try:
                import httpx
                async with httpx.AsyncClient(timeout=10.0) as http_client:
                    response = await http_client.post(
                        f"{BACKEND_URL}/telegram/messages",
                        json={"text": text},
                    )
                    response.raise_for_status()
                    tx_id = response.json().get('transaction_id')
                    print(f"Forwarded message from {event.sender_id}: {tx_id}")
            except ImportError:
                import asyncio
                import requests
                def _do_post():
                    return requests.post(f"{BACKEND_URL}/telegram/messages", json={"text": text}, timeout=10)
                try:
                    res = await asyncio.to_thread(_do_post)
                    res.raise_for_status()
                    print(f"Forwarded message from {event.sender_id}: {res.json().get('transaction_id')}")
                except Exception as inner_e:
                    print(f"Failed to forward message via fallback: {inner_e}")
            except Exception as e:
                print(f"Failed to forward message: {e}")


    client.start(phone=TELEGRAM_PHONE or None)
    print("Telegram listener started. Press Ctrl+C to stop.")
    client.run_until_disconnected()


if __name__ == "__main__":
    start_telegram_listener()
