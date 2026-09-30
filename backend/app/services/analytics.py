from datetime import datetime, timedelta, timezone
from collections import defaultdict
from typing import List, Tuple
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.transaction import Transaction
from app.models.receipt import Receipt
from app.schemas.analytics import (
    BankRevenue,
    HourlyRevenue,
    TopCustomer,
    DashboardSummary,
    PeriodRevenue,
    RevenueTrends,
    PatternInsights,
)
from app.schemas.transaction import TransactionOut
from app.core.config import DEFAULT_EXCHANGE_RATE_KHR_PER_USD, CAMBODIA_TZ_OFFSET_HOURS


def format_amount(amount: float, currency: str) -> str:
    """Format monetary amount according to currency code."""
    if currency.upper() == "KHR":
        return f"៛{amount:,.0f}"
    return f"${amount:,.2f}"


def _get_cambodia_now() -> datetime:
    """Return current naive datetime in Cambodia local time (UTC+7)."""
    utc_now = datetime.now(timezone.utc)
    return utc_now.replace(tzinfo=None) + timedelta(hours=CAMBODIA_TZ_OFFSET_HOURS)


def _get_time_boundaries() -> dict:
    """
    Compute start and end boundaries (in naive UTC/naive DB time)
    for Today, Yesterday, This Week (7 days), and This Month based on Cambodia local day.
    """
    cambodia_now = _get_cambodia_now()
    
    # Start of today in Cambodia
    cambodia_today_start = cambodia_now.replace(hour=0, minute=0, second=0, microsecond=0)
    cambodia_today_end = cambodia_today_start + timedelta(days=1)
    
    # Offset to convert Cambodia naive clock back to UTC naive DB timestamps
    offset = timedelta(hours=CAMBODIA_TZ_OFFSET_HOURS)
    
    today_start = cambodia_today_start - offset
    today_end = cambodia_today_end - offset
    
    yesterday_start = today_start - timedelta(days=1)
    yesterday_end = today_start
    
    week_start = today_start - timedelta(days=6)
    week_end = today_end
    
    cambodia_month_start = cambodia_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_start = cambodia_month_start - offset
    month_end = today_end

    return {
        "today": (today_start, today_end),
        "yesterday": (yesterday_start, yesterday_end),
        "week": (week_start, week_end),
        "month": (month_start, month_end),
    }


def _calc_period_revenue(tx_list: List[Transaction], rate: float = DEFAULT_EXCHANGE_RATE_KHR_PER_USD) -> PeriodRevenue:
    khr = sum(t.amount for t in tx_list if t.currency == "KHR")
    usd = sum(t.amount for t in tx_list if t.currency == "USD")
    total_usd = usd + (khr / rate if rate else 0.0)
    total_khr = khr + (usd * rate)
    return PeriodRevenue(
        khr=round(khr, 2),
        usd=round(usd, 2),
        total_usd_equiv=round(total_usd, 2),
        total_khr_equiv=round(total_khr, 0),
        count=len(tx_list),
    )


def compute_analytics(db: Session) -> DashboardSummary:
    boundaries = _get_time_boundaries()
    rate = DEFAULT_EXCHANGE_RATE_KHR_PER_USD

    # Use coalesce(transaction_time, created_at)
    time_col = func.coalesce(Transaction.transaction_time, Transaction.created_at)

    # 1. Fetch transactions for periods
    today_tx = db.query(Transaction).filter(
        time_col >= boundaries["today"][0],
        time_col < boundaries["today"][1]
    ).all()

    yesterday_tx = db.query(Transaction).filter(
        time_col >= boundaries["yesterday"][0],
        time_col < boundaries["yesterday"][1]
    ).all()

    week_tx = db.query(Transaction).filter(
        time_col >= boundaries["week"][0],
        time_col < boundaries["week"][1]
    ).all()

    month_tx = db.query(Transaction).filter(
        time_col >= boundaries["month"][0],
        time_col < boundaries["month"][1]
    ).all()

    # If database is freshly initialized or today has 0 tx, fall back to all transactions for demo display
    active_tx = today_tx
    if not active_tx and not week_tx:
        all_tx = db.query(Transaction).all()
        if all_tx:
            active_tx = all_tx
            today_tx = all_tx
            week_tx = all_tx
            month_tx = all_tx

    today_rev = _calc_period_revenue(today_tx, rate)
    yesterday_rev = _calc_period_revenue(yesterday_tx, rate)
    week_rev = _calc_period_revenue(week_tx, rate)
    month_rev = _calc_period_revenue(month_tx, rate)

    # DoD Growth %
    dod_growth_pct = None
    if yesterday_rev.total_usd_equiv > 0:
        dod_growth_pct = round(
            ((today_rev.total_usd_equiv - yesterday_rev.total_usd_equiv) / yesterday_rev.total_usd_equiv) * 100,
            1
        )
    elif today_rev.total_usd_equiv > 0 and yesterday_rev.total_usd_equiv == 0:
        dod_growth_pct = 100.0

    trends = RevenueTrends(
        today=today_rev,
        yesterday=yesterday_rev,
        this_week=week_rev,
        this_month=month_rev,
        dod_growth_pct=dod_growth_pct,
    )

    # 2. Pattern Analysis
    # A. Hourly distribution & Peak Hour
    hour_counts = defaultdict(int)
    hour_khr = defaultdict(float)
    hour_usd = defaultdict(float)

    for t in active_tx:
        t_time = t.transaction_time or t.created_at
        if t_time:
            # Shift to Cambodia local hour
            local_hour = (t_time.hour + CAMBODIA_TZ_OFFSET_HOURS) % 24
            hour_counts[local_hour] += 1
            if t.currency == "KHR":
                hour_khr[local_hour] += t.amount
            else:
                hour_usd[local_hour] += t.amount

    peak_hour = None
    peak_count = 0
    if hour_counts:
        peak_hour = max(hour_counts, key=hour_counts.get)
        peak_count = hour_counts[peak_hour]
        next_hour = (peak_hour + 1) % 24
        peak_desc = f"{peak_hour:02d}:00 - {next_hour:02d}:00 ({peak_count} payments)"
    else:
        peak_desc = "No transactions yet"

    # B. Payment Method Share
    method_counts = defaultdict(int)
    for t in active_tx:
        pm = t.payment_method or t.bank or "Other"
        method_counts[pm] += 1

    dominant_method = "N/A"
    if method_counts:
        top_pm = max(method_counts, key=method_counts.get)
        pct = round((method_counts[top_pm] / len(active_tx)) * 100)
        dominant_method = f"{top_pm} ({pct}%)"

    # C. Average Ticket Sizes
    khr_txs = [t.amount for t in active_tx if t.currency == "KHR"]
    usd_txs = [t.amount for t in active_tx if t.currency == "USD"]
    avg_ticket_khr = round(sum(khr_txs) / len(khr_txs), 0) if khr_txs else 0.0
    avg_ticket_usd = round(sum(usd_txs) / len(usd_txs), 2) if usd_txs else 0.0

    patterns = PatternInsights(
        peak_hour=peak_hour,
        peak_hour_tx_count=peak_count,
        peak_hour_desc=peak_desc,
        dominant_payment_method=dominant_method,
        avg_ticket_usd=avg_ticket_usd,
        avg_ticket_khr=avg_ticket_khr,
    )

    # 3. Revenue by Bank
    bank_dict = defaultdict(lambda: {"khr": 0.0, "usd": 0.0, "count": 0})
    for t in active_tx:
        b_name = t.bank or "Other"
        if t.currency == "KHR":
            bank_dict[b_name]["khr"] += t.amount
        else:
            bank_dict[b_name]["usd"] += t.amount
        bank_dict[b_name]["count"] += 1

    revenue_by_bank = []
    for b_name, val in sorted(bank_dict.items(), key=lambda x: (x[1]["usd"] + x[1]["khr"] / rate), reverse=True):
        total_usd = val["usd"] + (val["khr"] / rate)
        revenue_by_bank.append(
            BankRevenue(
                bank=b_name,
                amount_khr=round(val["khr"], 2),
                amount_usd=round(val["usd"], 2),
                total_usd_equiv=round(total_usd, 2),
                tx_count=val["count"],
                amount=round(total_usd, 2),  # legacy compat
            )
        )

    # 4. Revenue by Hour (0 to 23 for clean chart display)
    revenue_by_hour = []
    for h in sorted(hour_counts.keys()):
        h_khr = hour_khr[h]
        h_usd = hour_usd[h]
        h_total = h_usd + (h_khr / rate)
        revenue_by_hour.append(
            HourlyRevenue(
                hour=h,
                amount_khr=round(h_khr, 2),
                amount_usd=round(h_usd, 2),
                total_usd_equiv=round(h_total, 2),
                tx_count=hour_counts[h],
                amount=round(h_total, 2),  # legacy compat
            )
        )

    # 5. Top Customers
    cust_dict = defaultdict(lambda: {"khr": 0.0, "usd": 0.0, "count": 0})
    for t in active_tx:
        c_name = t.customer_name or "Unknown"
        if t.currency == "KHR":
            cust_dict[c_name]["khr"] += t.amount
        else:
            cust_dict[c_name]["usd"] += t.amount
        cust_dict[c_name]["count"] += 1

    top_customers = []
    sorted_custs = sorted(cust_dict.items(), key=lambda x: (x[1]["usd"] + x[1]["khr"] / rate), reverse=True)[:5]
    for c_name, val in sorted_custs:
        total_usd = val["usd"] + (val["khr"] / rate)
        top_customers.append(
            TopCustomer(
                name=c_name,
                amount_khr=round(val["khr"], 2),
                amount_usd=round(val["usd"], 2),
                total_usd_equiv=round(total_usd, 2),
                tx_count=val["count"],
                amount=round(total_usd, 2),  # legacy compat
            )
        )

    # 6. Duplicates & Pending Verification
    duplicate_count = db.query(Receipt).filter(Receipt.verification_status == "duplicate_usage").count()
    pending_count = db.query(Receipt).filter(Receipt.verification_status == "pending").count()

    latest = db.query(Transaction).order_by(time_col.desc()).limit(15).all()

    # Average payment
    avg_payment_usd = round(today_rev.total_usd_equiv / today_rev.count, 2) if today_rev.count else 0.0

    return DashboardSummary(
        today_revenue=today_rev.total_usd_equiv,
        today_revenue_khr=today_rev.khr,
        today_revenue_usd=today_rev.usd,
        today_total_usd_equiv=today_rev.total_usd_equiv,
        total_transactions=today_rev.count,
        average_payment=avg_payment_usd,
        average_payment_khr=avg_ticket_khr,
        average_payment_usd=avg_payment_usd,
        revenue_by_bank=revenue_by_bank,
        revenue_by_hour=revenue_by_hour,
        top_customers=top_customers,
        trends=trends,
        patterns=patterns,
        duplicate_count=duplicate_count,
        pending_verification=pending_count,
        latest_transactions=[TransactionOut.model_validate(t) for t in latest],
    )

