import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()
DATA_DIR = Path(__file__).parent.parent / "data"


@router.get("/facilities")
async def get_facilities() -> list[dict]:
    with open(DATA_DIR / "facility_locations.json") as f:
        return json.load(f)


@router.get("/hazards")
async def get_hazards() -> list[dict]:
    with open(DATA_DIR / "climate_hazards.json") as f:
        return json.load(f)
