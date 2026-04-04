import json
from pathlib import Path

from fastapi import APIRouter

from app.services.risk_engine import DEFAULT_PORTFOLIO, calculate_climate_var

router = APIRouter()
DATA_DIR = Path(__file__).parent.parent / "data"


@router.get("/default")
async def get_default_portfolio() -> dict:
    return {"holdings": DEFAULT_PORTFOLIO}


@router.get("/companies")
async def get_companies() -> list[dict]:
    with open(DATA_DIR / "companies.json") as f:
        return json.load(f)


@router.get("/climate-var")
async def get_climate_var() -> dict:
    return calculate_climate_var()
