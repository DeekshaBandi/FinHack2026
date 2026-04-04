from fastapi import APIRouter

from app.models.schemas import ContagionResponse, ContagionSimulateRequest
from app.services.contagion_engine import get_full_network

router = APIRouter()


@router.get("/network")
async def get_network() -> ContagionResponse:
    return get_full_network()


@router.post("/simulate")
async def simulate_contagion(request: ContagionSimulateRequest) -> ContagionResponse:
    return get_full_network(
        epicenter_tickers=request.epicenter_tickers,
        event_type=request.event_type,
        severity=request.severity,
    )
