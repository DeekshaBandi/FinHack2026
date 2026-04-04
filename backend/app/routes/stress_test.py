import json
from pathlib import Path

from fastapi import APIRouter

from app.models.schemas import StressTestRequest, StressTestResponse
from app.services.risk_engine import run_portfolio_stress_test
from app.services.recommendation_engine import generate_recommendations

router = APIRouter()
DATA_DIR = Path(__file__).parent.parent / "data"


@router.get("/scenarios")
async def list_scenarios() -> list[dict]:
    with open(DATA_DIR / "scenarios.json") as f:
        return json.load(f)


@router.post("/run")
async def run_stress_test(request: StressTestRequest) -> StressTestResponse:
    return run_portfolio_stress_test(request)


@router.post("/recommendations")
async def get_recommendations(request: StressTestRequest) -> dict:
    result = run_portfolio_stress_test(request)
    recs = generate_recommendations(result)
    return {"stress_result": result, "recommendations": recs}
