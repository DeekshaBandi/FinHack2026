from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import portfolio, contagion, heatmap, stress_test, chat, dashboard

app = FastAPI(
    title="ClimateVaR API",
    description="Climate Risk Intelligence Platform for Hedge Funds",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(portfolio.router, prefix="/api/portfolio", tags=["portfolio"])
app.include_router(contagion.router, prefix="/api/contagion", tags=["contagion"])
app.include_router(heatmap.router, prefix="/api/heatmap", tags=["heatmap"])
app.include_router(stress_test.router, prefix="/api/stress-test", tags=["stress-test"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
