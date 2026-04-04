# ClimateVaR — Climate Risk Intelligence Platform

## Quick Start

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m app.rag.ingest        # One-time: ingest RAG corpus into ChromaDB
python -m uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                     # localhost:5173
```

## Architecture

```
finhack2026/
├── frontend/          React + Vite + TypeScript + Tailwind + shadcn/ui
│   └── src/
│       ├── components/   ContagionNetwork, ClimateHeatmap, StressTester, RagChatbot, ExecutiveDashboard
│       ├── pages/        One page per feature, routed via react-router-dom
│       ├── hooks/        useApi (fetch wrapper), usePortfolio (portfolio state)
│       └── lib/          types.ts (shared types), contagion.ts (D3 helpers)
├── backend/           FastAPI (Python 3.11+)
│   └── app/
│       ├── routes/       portfolio, contagion, heatmap, stress_test, chat, dashboard
│       ├── services/     risk_engine, contagion_engine, financial_chain, rag_service, recommendation_engine, market_data, event_monitor
│       ├── models/       schemas.py (Pydantic models for all request/response types)
│       ├── data/         Curated JSON datasets (companies, supply_chain, climate_hazards, scenarios, facility_locations, bea_io_table)
│       └── rag/          ingest.py + corpus/ (PDFs) + chroma_db/ (persistent vector store)
└── CLAUDE.md
```

## Key Files

- `backend/app/services/contagion_engine.py` — BFS cascade propagation through supply chain graph (hero feature)
- `backend/app/services/financial_chain.py` — 7-step deterministic chain: asset damage → revenue disruption → EBITDA compression → debt coverage → credit pressure → equity impact
- `backend/app/services/rag_service.py` — ChromaDB retrieval + Groq Llama 3 generation pipeline
- `frontend/src/components/ContagionNetwork.tsx` — D3.js force-directed graph with animated contagion propagation (hero UI)
- `backend/app/data/companies.json` — 50 companies with financials + climate exposure scores
- `backend/app/data/supply_chain.json` — ~100 directed edges between companies

---

## Tech Stack Reference

### Frontend

**React 19 + Vite + TypeScript**
- Scaffold: `npm create vite@latest frontend -- --template react-ts`
- Dev server: `npm run dev` on port 5173
- Build: `npm run build` → outputs to `dist/`

**Tailwind CSS v4 + shadcn/ui**
- Init shadcn: `npx shadcn@latest init -t vite`
- Add components: `npx shadcn@latest add button card dialog dropdown-menu input sidebar tabs tooltip`
- Config uses `rsc: false` (no server components in Vite)
- Theme: dark mode via `.dark` class on `<html>`
- CSS variables use OKLCh color space: `--background: oklch(0.145 0 0);`
- Path aliases: `@/components`, `@/lib`, `@/hooks`
- shadcn components.json:
  ```json
  {
    "style": "radix-nova",
    "rsc": false,
    "tsx": true,
    "tailwind": {
      "css": "src/index.css",
      "baseColor": "neutral",
      "cssVariables": true
    },
    "aliases": {
      "components": "@/components",
      "utils": "@/lib/utils",
      "ui": "@/components/ui",
      "lib": "@/lib",
      "hooks": "@/hooks"
    },
    "iconLibrary": "lucide"
  }
  ```

**D3.js v7 (Force-Directed Graph)**
- Import: `import * as d3 from "d3"`
- Force simulation setup:
  ```ts
  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(100))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(20))
    .on("tick", ticked);
  ```
- Drag handlers: `dragstarted` sets `d.fx/d.fy`, `dragged` updates them, `dragended` nulls them
- Reheat simulation: `simulation.alphaTarget(0.3).restart()`
- Stop simulation: `simulation.alphaTarget(0); simulation.stop()`
- In React: create simulation in `useEffect`, attach to SVG ref, clean up on unmount with `simulation.stop()`
- Keep node count under 60 for smooth 60fps animation

**React-Leaflet + OpenStreetMap**
- No API key needed
- Tile URL: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- Use `leaflet-heat` for heatmap overlays
- GeoJSON layers for FEMA flood zones

**Recharts**
- Use for bar charts, pie charts, waterfall charts, gauges
- Wrap in `<ResponsiveContainer width="100%" height={300}>`

### Backend

**FastAPI (Python 3.11+)**
- Entry point: `app/main.py`
- CORS setup:
  ```python
  from fastapi.middleware.cors import CORSMiddleware
  app.add_middleware(
      CORSMiddleware,
      allow_origins=["http://localhost:5173"],
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )
  ```
- All routes use `async def`
- Request/response bodies use Pydantic `BaseModel`
- SSE streaming for chat:
  ```python
  from fastapi.sse import EventSourceResponse
  @app.get("/api/chat/stream", response_class=EventSourceResponse)
  async def stream_chat() -> AsyncIterable[ChatChunk]:
      ...
  ```
- Route organization: one file per feature in `app/routes/`, included via `app.include_router(router, prefix="/api/...")`

**ChromaDB (Vector Database)**
- Persistent local storage — no external server:
  ```python
  import chromadb
  client = chromadb.PersistentClient(path="./app/rag/chroma_db")
  collection = client.get_or_create_collection("climate_docs")
  ```
- Ingest: `collection.upsert(ids=[...], documents=[...], embeddings=[...], metadatas=[...])`
- Query: `collection.query(query_embeddings=[...], n_results=5, include=["documents", "metadatas", "distances"])`
- Embeddings: `sentence-transformers` with `all-MiniLM-L6-v2` model (384 dimensions, fast, free)
- Chunk size: ~500 tokens per document chunk
- ChromaDB is NOT process-safe — do not run ingest and server simultaneously

**Groq API (LLM — Free Tier)**
- Model: `llama-3.3-70b-versatile` (free, fast inference)
- Env var: `GROQ_API_KEY` (get free key from console.groq.com)
- Client:
  ```python
  from groq import Groq
  client = Groq(api_key=os.environ["GROQ_API_KEY"])
  response = client.chat.completions.create(
      model="llama-3.3-70b-versatile",
      messages=[...],
      stream=True,
  )
  ```

**yfinance**
- No API key needed
- Fetch prices: `yf.download("AAPL", period="1y")`
- Fetch info: `yf.Ticker("AAPL").info` → market_cap, sector, industry
- Can be slow on first call — cache results in memory dict
- Do NOT call in hot request paths; pre-fetch at startup or use cached data

**Data files** (all in `backend/app/data/`)
- `companies.json` — 50 companies: ticker, name, sector, hq_lat/lng, revenue, ebitda, debt, climate_exposure
- `supply_chain.json` — ~100 directed edges: source, target, weight, relationship_type
- `facility_locations.json` — 3-5 facilities per company with lat/lng
- `climate_hazards.json` — regional hazard probabilities (hurricane, wildfire, flood, drought)
- `bea_io_table.json` — inter-industry dependency weights from BEA
- `scenarios.json` — 6 preset stress test configurations

---

## Environment Variables

```bash
# Required
GROQ_API_KEY=gsk_...              # Free from console.groq.com

# Optional (defaults shown)
BACKEND_PORT=8000
FRONTEND_PORT=5173
CHROMA_DB_PATH=./app/rag/chroma_db
```

---

## Code Style & Policies

### General Rules

- **No dead code.** Delete unused imports, variables, functions. Do not comment out code.
- **No `any` type in TypeScript.** Every variable, parameter, and return type must be explicitly typed.
- **No magic numbers.** Use named constants: `const DECAY_FACTOR = 0.6` not `impact * 0.6`.
- **No console.log in committed code.** Use a proper logger or remove before committing.
- **No TODO/FIXME without a name and date.** `// TODO(alice, 2026-04-03): handle edge case` is OK. `// TODO: fix this` is not.

### TypeScript / React

- **Functional components only.** No class components.
- **Named exports only.** No `export default`. Exception: page components for lazy loading.
- **One component per file.** File name matches component name: `ContagionNetwork.tsx` exports `ContagionNetwork`.
- **Props interface at top of file:**
  ```tsx
  interface ContagionNetworkProps {
    nodes: CompanyNode[];
    edges: ContagionEdge[];
    onTriggerScenario: (scenario: ClimateScenario) => void;
  }
  ```
- **Hooks rules:**
  - Custom hooks go in `src/hooks/` and start with `use`.
  - `useEffect` must have a cleanup function when setting up subscriptions, timers, or D3 simulations.
  - Dependencies arrays must be complete — no eslint-disable for exhaustive-deps.
- **State management:** React state + context only. No Redux, no Zustand. Keep it simple for 24 hours.
- **API calls:** All API calls go through `src/hooks/useApi.ts`. No raw `fetch` in components.
- **Error boundaries:** Wrap each page in an error boundary. A crashing chart should not take down the whole app.
- **Tailwind classes:** Use shadcn/ui semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`), not raw colors (`bg-gray-800`). This keeps the dark theme consistent.
- **Responsive:** Use Tailwind responsive prefixes (`md:`, `lg:`). Dashboard must look good on a projector (1920x1080).

### Python / FastAPI

- **Type hints on every function.** Parameters and return types. Use Pydantic models for complex types.
- **Pydantic models for all API schemas.** Request bodies, response bodies, and internal data structures:
  ```python
  class StressTestRequest(BaseModel):
      scenario_id: str | None = None
      event_type: str
      severity: int = Field(ge=1, le=5)
      target_region: str
  ```
- **Async all routes.** Every route handler is `async def`. Use `httpx.AsyncClient` for external HTTP calls, not `requests`.
- **No global mutable state.** Use dependency injection via FastAPI `Depends()` for shared services.
- **Service layer pattern.** Routes call services, services contain business logic. Routes do NOT contain business logic.
  ```
  route → validates input (Pydantic) → calls service → returns response (Pydantic)
  ```
- **Error handling:** Raise `HTTPException` with specific status codes and messages. No bare `except:` blocks. Catch specific exceptions only.
- **Imports:** Standard library first, third-party second, local third. Separated by blank lines.
  ```python
  import os
  from typing import AsyncIterable

  from fastapi import APIRouter, HTTPException
  from pydantic import BaseModel

  from app.services.risk_engine import calculate_climate_var
  ```

### Data Files (JSON)

- All JSON data files live in `backend/app/data/`.
- Use consistent key naming: `snake_case` for all keys.
- Every company entry must have ALL required fields — no partial records.
- Climate exposure scores are floats between 0.0 and 1.0.
- Supply chain edge weights are floats between 0.0 and 1.0.
- Coordinates use decimal degrees: `{"lat": 25.7617, "lng": -80.1918}`.

### Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| React components | PascalCase | `ContagionNetwork.tsx` |
| React hooks | camelCase with `use` prefix | `usePortfolio.ts` |
| TypeScript types/interfaces | PascalCase | `CompanyNode`, `ClimateScenario` |
| TypeScript variables/functions | camelCase | `calculateClimateVar()` |
| Python files | snake_case | `contagion_engine.py` |
| Python functions/variables | snake_case | `run_stress_test()` |
| Python classes | PascalCase | `StressTestRequest` |
| API routes | kebab-case URLs | `/api/stress-test/run` |
| JSON keys | snake_case | `"climate_exposure"` |
| CSS/Tailwind | kebab-case for custom | `--chart-1`, `bg-card` |
| Constants | UPPER_SNAKE_CASE | `DECAY_FACTOR = 0.6` |

### Git Practices

- **Commit messages:** `<type>: <what changed>` — e.g., `feat: add contagion cascade BFS engine`
- Types: `feat`, `fix`, `data`, `style`, `refactor`, `docs`
- **Branch:** Work on `main` (hackathon — speed over process)
- **Do not commit:** `.env`, `venv/`, `node_modules/`, `chroma_db/`, `__pycache__/`, `.pyc` files

### D3.js Integration Rules (Critical)

- D3 manages its own DOM inside a `<svg>` ref. React does NOT re-render D3 content.
- Pattern: `useRef` for SVG element, `useEffect` for D3 setup, cleanup on unmount.
  ```tsx
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const simulation = d3.forceSimulation(nodes)...;
    // ... bindDOMs
    return () => { simulation.stop(); };
  }, [nodes, edges]);
  ```
- NEVER let React and D3 fight over the same DOM nodes. D3 owns everything inside the SVG.
- Use `d3.transition()` for animations, not CSS transitions on D3-managed elements.
- Contagion animation: step through timeline with `setTimeout` or `requestAnimationFrame`, not D3 transitions chained together.

---

## Gotchas & Warnings

- **ChromaDB must be ingested before the chatbot works.** Run `python -m app.rag.ingest` first. The server will fail on `/api/chat/*` endpoints if the collection is empty.
- **yfinance rate limits.** Don't call it in a loop for 50 tickers on every request. Pre-fetch and cache at startup.
- **Groq free tier limits.** ~30 requests/minute, 6000 tokens/minute. Keep prompts concise. If rate-limited, show a graceful "AI is thinking..." message, not an error.
- **CORS is locked to localhost:5173.** If the Vite port changes (e.g., 5174 because 5173 is in use), update `main.py`.
- **D3 force simulation is CPU-intensive.** Over 60 nodes = janky animation. We use 50 — stay under that.
- **sentence-transformers first load downloads ~90MB model.** Do this during setup, not during demo. Run `python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"` to pre-download.
- **Leaflet CSS must be imported.** Add `import 'leaflet/dist/leaflet.css'` in the component or you get invisible tiles.
- **BEA I/O table is large.** Pre-process to only include the ~15 industries relevant to our 50 companies. Don't ship the full table.
