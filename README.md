# ClimateVaR: Climate Risk Intelligence Platform

Built for FinHack 2026.

ClimateVaR shows how a climate disaster can hurt a hedge fund portfolio, including the hidden damage that spreads through supply chains. Pick a scenario like a Gulf Coast hurricane or a Texas grid failure, and the platform traces how it hits companies directly, spreads to their suppliers and customers, and ends up in your P&L.

## Features

- **Contagion network**: An animated D3 graph of 54 companies and 100+ supply chain links. Shows a climate shock spreading from the companies hit first to everyone connected to them.
- **Climate risk heatmap**: A Leaflet map of 75 company facilities plotted against 18 hazard zones (hurricanes, wildfires, floods, drought).
- **Corporate stress tester**: Runs a company through a 7-step financial chain: asset damage, revenue loss, cost spike, EBITDA drop, debt coverage, credit pressure, and finally the hit to the stock price.
- **Portfolio dashboard**: Climate Value at Risk for a long/short portfolio, hedge effectiveness, hidden concentration risk, and suggested hedging and rebalancing moves.
- **RAG advisor**: A chatbot that answers climate risk questions using a document library (company profiles, hurricane risk, carbon tax scenarios, TCFD framework). Uses ChromaDB for retrieval and Llama 3.3 70B through Groq.

## Scenarios

- Category 5 Hurricane, Gulf Coast
- Mega Wildfire Season, California
- Severe Multi-Year Drought, Midwest
- Carbon Tax at $100/ton, Nationwide
- Sea Level Rise Acceleration, All Coasts
- Compound Event, Texas Grid Failure

## How contagion works

The engine builds one graph from three kinds of links:

1. Direct supplier and customer relationships
2. Industry-to-industry flows from the BEA Input-Output tables
3. Companies with facilities in the same hazard zone

It then spreads the shock outward from the starting companies using BFS, with the impact getting weaker at each step.

## Tech stack

| Part | Tools |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui |
| Charts and maps | D3.js, Recharts, React-Leaflet, Three.js |
| Backend | FastAPI, Pydantic, Python 3.11+ |
| AI / RAG | ChromaDB, all-MiniLM-L6-v2 embeddings, Groq (Llama 3.3 70B) |
| Data | Curated JSON datasets, BEA Input-Output table, yfinance |

## Project layout

```
backend/
  app/
    routes/     API endpoints (portfolio, contagion, heatmap, stress test, chat, dashboard)
    services/   risk engine, contagion engine, financial chain, RAG, recommendations
    data/       companies, supply chain, hazards, scenarios, facilities, BEA table
    rag/        document corpus + ingest script
frontend/
  src/
    components/ contagion network, heatmap, stress tester, dashboard, RAG advisor
    pages/      landing page + main dashboard
```

## Running it locally

**1. Backend**

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `backend/.env` file with your Groq API key:

```
GROQ_API_KEY=your_key_here
```

Then load the documents and start the server:

```bash
python -m app.rag.ingest        # only needed once
python -m uvicorn app.main:app --reload --port 8000
```

**2. Frontend** (in a new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Note

All company and scenario data is curated for demo purposes. This is a hackathon prototype, not investment advice.
