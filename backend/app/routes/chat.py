from fastapi import APIRouter

from app.models.schemas import ChatRequest, ChatResponse
from app.services.rag_service import query_rag

router = APIRouter()


@router.post("/query")
async def chat_query(request: ChatRequest) -> ChatResponse:
    return await query_rag(request.message, request.context)
