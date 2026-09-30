from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from app.schemas.transaction import TransactionOut


class PeriodRevenue(BaseModel):
    khr: float = 0.0
    usd: float = 0.0
    total_usd_equiv: float = 0.0
    total_khr_equiv: float = 0.0
    count: int = 0


class RevenueTrends(BaseModel):
    today: PeriodRevenue
    yesterday: PeriodRevenue
    this_week: PeriodRevenue
    this_month: PeriodRevenue
    dod_growth_pct: Optional[float] = None


class PatternInsights(BaseModel):
    peak_hour: Optional[int] = None
    peak_hour_tx_count: int = 0
    peak_hour_desc: str = "No transactions yet"
    dominant_payment_method: str = "N/A"
    avg_ticket_usd: float = 0.0
    avg_ticket_khr: float = 0.0


class BankRevenue(BaseModel):
    bank: str
    amount_khr: float = 0.0
    amount_usd: float = 0.0
    total_usd_equiv: float = 0.0
    tx_count: int = 0
    amount: float = 0.0  # legacy compat


class HourlyRevenue(BaseModel):
    hour: int
    amount_khr: float = 0.0
    amount_usd: float = 0.0
    total_usd_equiv: float = 0.0
    tx_count: int = 0
    amount: float = 0.0  # legacy compat


class TopCustomer(BaseModel):
    name: str
    amount_khr: float = 0.0
    amount_usd: float = 0.0
    total_usd_equiv: float = 0.0
    tx_count: int = 0
    amount: float = 0.0  # legacy compat


class DashboardSummary(BaseModel):
    today_revenue: float
    today_revenue_khr: float
    today_revenue_usd: float
    today_total_usd_equiv: float = 0.0
    total_transactions: int
    average_payment: float
    average_payment_khr: float = 0.0
    average_payment_usd: float = 0.0
    revenue_by_bank: List[BankRevenue]
    revenue_by_hour: List[HourlyRevenue]
    top_customers: List[TopCustomer]
    trends: RevenueTrends
    patterns: PatternInsights
    duplicate_count: int
    pending_verification: int
    latest_transactions: List[TransactionOut]

    model_config = ConfigDict(from_attributes=True)

