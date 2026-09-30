from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.analytics import compute_analytics
from app.schemas.analytics import DashboardSummary

router = APIRouter()


@router.get("/dashboard", response_model=DashboardSummary)
def dashboard(db: Session = Depends(get_db)):
    return compute_analytics(db)
