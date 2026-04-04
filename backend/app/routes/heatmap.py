import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query

from app.services.heatmap_datasets import build_live_heatmap_payload

router = APIRouter()
DATA_DIR = Path(__file__).parent.parent / "data"


@router.get("/facilities")
async def get_facilities(
    tickers: Optional[str] = Query(
        default=None,
        description="Comma-separated tickers to filter (e.g. VLO,NRG,EGP,ALL)",
    ),
) -> list[dict]:
    with open(DATA_DIR / "facility_locations.json", encoding="utf-8") as f:
        rows: list[dict] = json.load(f)
    if not tickers:
        return rows
    want = {t.strip().upper() for t in tickers.split(",") if t.strip()}
    return [r for r in rows if str(r.get("ticker", "")).upper() in want]


@router.get("/hazards")
async def get_hazards() -> list[dict]:
    with open(DATA_DIR / "climate_hazards.json", encoding="utf-8") as f:
        return json.load(f)


@router.get("/live")
async def get_live_heatmap() -> dict:
    """NOAA HURDAT2 (cached), NASA EONET, FRED CSV, and yfinance — built on each request."""
    return await build_live_heatmap_payload()
