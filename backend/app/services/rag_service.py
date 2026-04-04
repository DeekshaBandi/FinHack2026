from __future__ import annotations

"""RAG service — ChromaDB retrieval + Groq Llama 3 generation. Stub until corpus is ingested."""

import os
from pathlib import Path

from dotenv import load_dotenv

from app.models.schemas import ChatResponse

# Load .env file from backend directory
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

SYSTEM_PROMPT = """You are a senior climate risk analyst at a hedge fund. You provide actionable,
data-driven insights about climate risks to financial portfolios. Ground your answers in TCFD frameworks,
IPCC science, and financial risk management best practices. Be concise and quantitative."""


async def query_rag(message: str, context: str | None = None) -> ChatResponse:
    """Query RAG pipeline. Falls back to direct LLM if ChromaDB not available."""
    import asyncio
    
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        return ChatResponse(
            response="GROQ_API_KEY not found. Please set it in the .env file.",
            sources=["error"],
        )
    
    try:
        from groq import AsyncGroq
        client = AsyncGroq(api_key=api_key)

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        if context:
            messages.append({"role": "system", "content": f"Portfolio context: {context}"})
        messages.append({"role": "user", "content": message})

        # Try ChromaDB retrieval first
        sources = []
        try:
            import chromadb
            from chromadb.utils import embedding_functions
            embedding_fn = embedding_functions.DefaultEmbeddingFunction()
            db_path = os.path.join(os.path.dirname(__file__), "..", "rag", "chroma_db")
            client_db = chromadb.PersistentClient(path=db_path)
            collection = client_db.get_collection("climate_docs", embedding_function=embedding_fn)
            results = collection.query(query_texts=[message], n_results=3, include=["documents", "metadatas"])
            if results["documents"] and results["documents"][0]:
                chunks = results["documents"][0]
                sources = [m.get("source", "unknown") for m in (results["metadatas"][0] if results["metadatas"] else [])]
                rag_context = "\n\n".join(chunks)
                messages.insert(1, {"role": "system", "content": f"Retrieved context:\n{rag_context}"})
        except Exception as e:
            print(f"ChromaDB retrieval error: {e}")
            sources = ["direct_llm_response"]

        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile", messages=messages, max_tokens=1024,
        )
        return ChatResponse(response=response.choices[0].message.content or "", sources=sources)
    except Exception as e:
        import traceback
        print(f"RAG error: {traceback.format_exc()}")
        return ChatResponse(
            response=f"AI service unavailable. Error: {str(e)[:100]}. Please check server logs.",
            sources=["error"],
        )
