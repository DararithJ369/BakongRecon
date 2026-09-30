import re
from datetime import datetime, timezone
from typing import Optional


def parse_telegram_message(text: str) -> Optional[dict]:
    """
    Parse a Cambodian bank payment notification from Telegram.
    Supports ABA PAY, ABA KHQR, PayWay by ABA, Bakong, and ACLEDA formats.
    """
    text = text.strip()
    if not text:
        return None

    lower_text = text.lower()

    # 1. Bank and Payment Method Detection
    if "aba khqr" in lower_text or "khqr" in lower_text:
        bank = "ABA"
        payment_method = "ABA KHQR"
    elif "bakong" in lower_text:
        bank = "Bakong"
        payment_method = "Bakong"
    elif "acleda" in lower_text:
        bank = "ACLEDA"
        payment_method = "ACLEDA"
    elif "wing" in lower_text:
        bank = "Wing"
        payment_method = "Wing"
    elif "payway" in lower_text or "aba pay" in lower_text or "aba" in lower_text:
        bank = "ABA"
        payment_method = "ABA PAY"
    else:
        bank = "Bank"
        payment_method = "Bank Transfer"

    # 2. Amount and Currency Detection (Tied directly to currency symbol or code)
    amount = 0.0
    currency = "USD"

    # Match symbol adjacent to amount: e.g. ៛100 or $50.00
    sym_match = re.search(r"([៛$])\s*([\d,]+(?:\.\d+)?)", text)
    if sym_match:
        symbol = sym_match.group(1)
        raw_val = sym_match.group(2).replace(",", "")
        try:
            amount = float(raw_val)
        except ValueError:
            amount = 0.0
        currency = "KHR" if symbol == "៛" else "USD"
    else:
        # Match code: e.g. 10,000 KHR or USD 25.50
        code_match = re.search(r"(?:(KHR|USD)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(KHR|USD))", text, re.IGNORECASE)
        if code_match:
            raw_cur = code_match.group(1) or code_match.group(4)
            raw_val = code_match.group(2) or code_match.group(3)
            try:
                amount = float(raw_val.replace(",", ""))
            except ValueError:
                amount = 0.0
            currency = raw_cur.upper()
        else:
            # Fallback to number preceding "paid by"
            pb_match = re.search(r"([\d,]+(?:\.\d+)?)\s+paid by", text, re.IGNORECASE)
            if pb_match:
                try:
                    amount = float(pb_match.group(1).replace(",", ""))
                except ValueError:
                    amount = 0.0
                currency = "KHR" if "៛" in text or "KHR" in text.upper() else "USD"

    # 3. Customer Name and Masked Phone
    # Look for "paid by <name> (*phone)"
    cust_match = re.search(
        r"paid by\s+(.+?)(?:\s*\(\*(\d+)\))?(?:\s*(?:\r?\n|\b(?:on|via|at|Trx|Transaction|APV|Ref|Reference)\b|$))",
        text,
        re.IGNORECASE,
    )
    if cust_match:
        customer_name = cust_match.group(1).strip()
        phone = f"*{cust_match.group(2)}" if cust_match.group(2) else ""
    else:
        # Alternative "from <customer>"
        from_match = re.search(r"from\s+(.+?)(?:\s*\(\*(\d+)\))?(?:\s*(?:\r?\n|\b(?:on|via|at|to|Trx|Ref)\b|$))", text, re.IGNORECASE)
        if from_match:
            customer_name = from_match.group(1).strip()
            phone = f"*{from_match.group(2)}" if from_match.group(2) else ""
        else:
            customer_name = "Unknown"
            phone = ""

    # Clean punctuation if trailing comma/dot left
    customer_name = re.sub(r"[,.]+$", "", customer_name).strip()

    # 4. Merchant
    merchant = ""
    merchant_match = re.search(
        r"\bat\s+([^.\r\n]+?)(?:\s*\.|\s+\b(?:Trx|Transaction|APV|Ref|Reference)\b|\r?\n|$)",
        text,
        re.IGNORECASE,
    )
    if merchant_match:
        merchant = merchant_match.group(1).strip()
    else:
        to_match = re.search(r"\bto\s+([^.\r\n]+?)(?:\s*\.|\s+\b(?:Trx|Transaction|APV|Ref|Reference)\b|\r?\n|$)", text, re.IGNORECASE)
        if to_match:
            merchant = to_match.group(1).strip()

    # 5. Transaction ID
    transaction_id = ""
    trx_match = re.search(r"(?:trx\.?\s*id|transaction\s*id)\s*[:#]?\s*([A-Za-z0-9_-]+)", text, re.IGNORECASE)
    if trx_match:
        transaction_id = trx_match.group(1).strip().upper()
    else:
        khqr_match = re.search(r"KHQR[-\s]*\d{8}[-\s]*[A-Za-z0-9]", text, re.IGNORECASE)
        if khqr_match:
            transaction_id = khqr_match.group(0).replace(" ", "").upper()
        else:
            ft_match = re.search(r"\b\d*FT[A-Za-z0-9]+\b", text, re.IGNORECASE)
            if ft_match:
                transaction_id = ft_match.group(0).upper()
            else:
                ref_match = re.search(r"(?:ref(?:erence)?)\s*(?:#|no\.?|id)?\s*[:#]?\s*([A-Za-z0-9_-]+)", text, re.IGNORECASE)
                if ref_match:
                    transaction_id = ref_match.group(1).strip().upper()

    # 6. APV Code
    apv_match = re.search(r"APV\s*[:#]?\s*([A-Za-z0-9]+)", text, re.IGNORECASE)
    apv = apv_match.group(1).strip() if apv_match else ""

    # 7. Date / Time
    now_utc = datetime.now(timezone.utc)
    transaction_time = now_utc
    dt_match = re.search(
        r"on\s+([A-Za-z]{3}\s+\d{1,2},?\s+\d{1,2}:\d{2}\s*(?:AM|PM))",
        text,
        re.IGNORECASE,
    )
    if dt_match:
        try:
            dt_str = re.sub(r"\s+", " ", dt_match.group(1).replace(",", "").strip())
            transaction_time = datetime.strptime(
                f"{now_utc.year} {dt_str}", "%Y %b %d %I:%M %p"
            )
        except ValueError:
            pass
    else:
        # Full date format e.g. Jul 04, 2026 02:14 PM
        dt_full_match = re.search(
            r"([A-Za-z]{3}\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM))",
            text,
            re.IGNORECASE,
        )
        if dt_full_match:
            try:
                dt_str = re.sub(r"\s+", " ", dt_full_match.group(1).replace(",", "").strip())
                transaction_time = datetime.strptime(dt_str, "%b %d %Y %I:%M %p")
            except ValueError:
                pass

    if not transaction_id:
        return None

    return {
        "transaction_id": transaction_id,
        "apv": apv,
        "customer_name": customer_name,
        "phone": phone,
        "amount": amount,
        "currency": currency,
        "bank": bank,
        "payment_method": payment_method,
        "merchant": merchant,
        "transaction_time": transaction_time,
        "telegram_message": text,
    }


def format_amount(amount: float, currency: str) -> str:
    """Format monetary amount according to currency code."""
    if currency.upper() == "KHR":
        return f"៛{amount:,.0f}"
    return f"${amount:,.2f}"

