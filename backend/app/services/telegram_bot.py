"""
Telegram Bot integration using python-telegram-bot.

Behavior:
- In groups: silently ingests payment notifications ONLY from trusted bot usernames.
- In private chat: replies with confirmations, analytics, and verification results.
"""
import logging

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from app.core.config import TELEGRAM_BOT_TOKEN, TELEGRAM_TRUSTED_BOT_USERNAMES
from app.core.database import SessionLocal
from app.services.analytics import compute_analytics
from app.services.parser import format_amount, parse_telegram_message
from app.services.receipt_verifier import store_transaction, verify_receipt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _is_private_chat(update: Update) -> bool:
    return bool(update.effective_chat and update.effective_chat.type == "private")


def _is_group_chat(update: Update) -> bool:
    return bool(update.effective_chat and update.effective_chat.type in {"group", "supergroup", "channel"})


def _get_sender_username(update: Update) -> str:
    """Return the username of the original sender (handles forwarded messages too)."""
    username = ""
    if update.message:
        if update.message.forward_from and update.message.forward_from.username:
            username = update.message.forward_from.username
        elif update.message.forward_from_chat and update.message.forward_from_chat.username:
            username = update.message.forward_from_chat.username
        elif update.effective_user and update.effective_user.username:
            username = update.effective_user.username
    return (username or "").lower()


def _is_trusted_sender(update: Update) -> bool:
    if not TELEGRAM_TRUSTED_BOT_USERNAMES:
        return True  # No whitelist = trust all
    return _get_sender_username(update) in TELEGRAM_TRUSTED_BOT_USERNAMES


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    await update.message.reply_text(
        "👋 Welcome to BakongRecon Financial Operations!\n\n"
        "Add me to a payment group to auto-capture transactions from trusted bots (I stay silent there).\n"
        "Chat with me here to track revenue, discover operational patterns, and verify customer receipts.\n\n"
        "Commands:\n"
        "📈 /today - today's revenue & DoD trend\n"
        "📊 /revenue - multi-period overview (Today, Yesterday, 7D, Month)\n"
        "🔍 /patterns - peak hours, payment rails & ticket size\n"
        "🏦 /banks - revenue breakdown by bank\n"
        "📋 /stats - operational reconciliation summary\n"
        "✅ /verify <trx_id> - verify a payment receipt"
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    await update.message.reply_text(
        "💡 BakongRecon Bot Guide:\n\n"
        "• In groups: silently logs official payment notifications.\n"
        "• In private chat: gives instant financial intelligence.\n\n"
        "Commands:\n"
        "/today - Today's revenue & trend vs yesterday\n"
        "/revenue - Full period comparison table\n"
        "/patterns - Peak traffic hours & payment habits\n"
        "/banks - Breakdown by bank & currency\n"
        "/stats - Quick summary\n"
        "/verify <trx_id> - Check transaction status"
    )


async def today_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    db = SessionLocal()
    try:
        analytics = compute_analytics(db)
        t = analytics.trends
        trend_str = ""
        if t.dod_growth_pct is not None:
            icon = "📈 +" if t.dod_growth_pct >= 0 else "📉 "
            trend_str = f"\nGrowth: {icon}{t.dod_growth_pct}% vs yesterday"

        reply = (
            f"📅 Today's Revenue\n\n"
            f"• KHR: {format_amount(analytics.today_revenue_khr, 'KHR')}\n"
            f"• USD: {format_amount(analytics.today_revenue_usd, 'USD')}\n"
            f"• Total USD Equiv: ~${analytics.today_total_usd_equiv:,.2f}\n"
            f"• Transactions: {analytics.total_transactions}{trend_str}\n"
            f"• Average Ticket: ~${analytics.average_payment_usd:,.2f}"
        )
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Failed to compute today analytics: {e}")
        await update.message.reply_text("❌ Could not load today's analytics.")
    finally:
        db.close()


async def revenue_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    db = SessionLocal()
    try:
        analytics = compute_analytics(db)
        t = analytics.trends
        dod = f" ({'+' if t.dod_growth_pct >= 0 else ''}{t.dod_growth_pct}%)" if t.dod_growth_pct is not None else ""

        reply = (
            f"📊 Multi-Period Revenue Overview\n\n"
            f"• Today: {format_amount(t.today.khr, 'KHR')} | {format_amount(t.today.usd, 'USD')} ({t.today.count} txs){dod}\n"
            f"• Yesterday: {format_amount(t.yesterday.khr, 'KHR')} | {format_amount(t.yesterday.usd, 'USD')} ({t.yesterday.count} txs)\n"
            f"• Last 7 Days: {format_amount(t.this_week.khr, 'KHR')} | {format_amount(t.this_week.usd, 'USD')} (~${t.this_week.total_usd_equiv:,.2f})\n"
            f"• This Month: {format_amount(t.this_month.khr, 'KHR')} | {format_amount(t.this_month.usd, 'USD')} (~${t.this_month.total_usd_equiv:,.2f})\n\n"
            f"Use /patterns for peak hour and customer insights."
        )
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Failed to compute period revenue: {e}")
        await update.message.reply_text("❌ Could not load revenue trends.")
    finally:
        db.close()


async def patterns_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    db = SessionLocal()
    try:
        analytics = compute_analytics(db)
        p = analytics.patterns
        reply = (
            f"🔍 Operational Pattern Analysis\n\n"
            f"⏰ Peak Traffic Window:\n  {p.peak_hour_desc}\n\n"
            f"💳 Preferred Payment Rail:\n  {p.dominant_payment_method}\n\n"
            f"🎟️ Average Ticket Size:\n"
            f"  • USD: ${p.avg_ticket_usd:,.2f}\n"
            f"  • KHR: {format_amount(p.avg_ticket_khr, 'KHR')}"
        )
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Failed to compute pattern insights: {e}")
        await update.message.reply_text("❌ Could not load pattern analysis.")
    finally:
        db.close()


async def banks_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    db = SessionLocal()
    try:
        analytics = compute_analytics(db)
        lines = ["🏦 Revenue by Bank Rail\n"]
        for b in analytics.revenue_by_bank:
            parts = []
            if b.amount_usd > 0:
                parts.append(format_amount(b.amount_usd, 'USD'))
            if b.amount_khr > 0:
                parts.append(format_amount(b.amount_khr, 'KHR'))
            amt_display = " / ".join(parts) if parts else "$0.00"
            lines.append(f"• {b.bank}: {amt_display} ({b.tx_count} txs)")

        if not analytics.revenue_by_bank:
            lines.append("No transactions recorded yet.")
        await update.message.reply_text("\n".join(lines))
    except Exception as e:
        logger.error(f"Failed to compute bank analytics: {e}")
        await update.message.reply_text("❌ Could not load bank analytics.")
    finally:
        db.close()


async def stats_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    db = SessionLocal()
    try:
        analytics = compute_analytics(db)
        reply = (
            f"📋 BakongRecon Financial Summary\n\n"
            f"• Today Total: ~${analytics.today_total_usd_equiv:,.2f} ({analytics.total_transactions} txs)\n"
            f"• KHR Volume: {format_amount(analytics.today_revenue_khr, 'KHR')}\n"
            f"• USD Volume: {format_amount(analytics.today_revenue_usd, 'USD')}\n"
            f"• Flagged Duplicates: {analytics.duplicate_count}\n"
            f"• Pending Verification: {analytics.pending_verification}"
        )
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Failed to compute summary: {e}")
        await update.message.reply_text("❌ Could not load summary.")
    finally:
        db.close()


async def verify_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_private_chat(update):
        return
    if not context.args:
        await update.message.reply_text("Usage: /verify <transaction_id>")
        return

    transaction_id = context.args[0]
    db = SessionLocal()
    try:
        result = verify_receipt(db, transaction_id, "")
        status_emoji = {"verified": "✅", "duplicate_usage": "🔴", "payment_not_found": "🟡"}.get(
            result.status, "⚠️"
        )
        reply = f"{status_emoji} {result.status.replace('_', ' ').upper()}\n\n{result.explanation}"
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Verification failed: {e}")
        await update.message.reply_text("❌ Verification failed. Please try again.")
    finally:
        db.close()



async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return

    text = update.message.text
    data = parse_telegram_message(text)

    # --- Group mode: silent, only trusted senders ---
    if _is_group_chat(update):
        if not _is_trusted_sender(update):
            logger.info(f"Ignoring message in group from untrusted sender: {_get_sender_username(update)}")
            return
        if not data:
            return
        db = SessionLocal()
        try:
            store_transaction(db, data)
            logger.info(f"Stored transaction {data['transaction_id']} from trusted sender in group")
        except Exception as e:
            logger.error(f"Failed to store group transaction: {e}")
        finally:
            db.close()
        return

    # --- Private mode: reply with analytics ---
    if not data:
        await update.message.reply_text(
            "I'm here to help with payment analytics.\n\n"
            "Send a payment notification, or use:\n"
            "/today, /banks, /stats, /verify <trx_id>"
        )
        return

    db = SessionLocal()
    try:
        tx = store_transaction(db, data)
        reply = (
            f"✅ Payment stored\n\n"
            f"Transaction ID: {tx.transaction_id}\n"
            f"Amount: {format_amount(tx.amount, tx.currency)}\n"
            f"Customer: {tx.customer_name or 'Unknown'}\n"
            f"Bank: {tx.bank or 'Unknown'}\n\n"
            f"Use /verify {tx.transaction_id} to check a receipt."
        )
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Failed to store transaction: {e}")
        await update.message.reply_text("❌ Failed to store transaction. Please try again.")
    finally:
        db.close()


def run_telegram_bot() -> None:
    if not TELEGRAM_BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set. Add it to your .env file.")

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("today", today_command))
    application.add_handler(CommandHandler("revenue", revenue_command))
    application.add_handler(CommandHandler("patterns", patterns_command))
    application.add_handler(CommandHandler("banks", banks_command))
    application.add_handler(CommandHandler("stats", stats_command))
    application.add_handler(CommandHandler("verify", verify_command))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))


    logger.info("Telegram bot started")
    application.run_polling()


if __name__ == "__main__":
    run_telegram_bot()
