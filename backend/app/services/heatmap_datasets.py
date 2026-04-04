from __future__ import annotations
"""
Fetch and cache external climate / market datasets for the Risk Heatmap.

Sources (HTTP):
  - NOAA NHC HURDAT2 — Atlantic hurricane best tracks (e.g. Harvey, Ian) for map replay
  - NASA EONET API — wildfires, floods, drought, severe storms, temp extremes, snow (points + polygons)
  - FRED CSV exports — WTI, Henry Hub gas, IG/HY option-adjusted spreads
  - yfinance — equity/continuous futures quotes and historical windows for scenario P&L
"""

import asyncio
import csv
import io
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import yfinance as yf

from app.services.heatmap_risk_intel import (
    build_diversification_fiction,
    build_mispricing_by_scenario,
    compute_all_scenario_dual_returns,
    load_facility_rows,
    live_risk_score_for_position,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CACHE_DIR = DATA_DIR / "cache"

HURDAT2_URL = "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2023-051124.txt"
DEFAULT_HURRICANE_STORM_IDS = ("AL092017", "AL092022")

EONET_EVENTS_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
# EONET often returns 503 for generic Python clients; identify the app explicitly.
HTTP_HEADERS = {
    "User-Agent": "FinHack2026-ClimateVaR/1.0 (+https://github.com; heatmap@eonet.gsfc.nasa.gov)",
    "Accept": "application/json",
}

FRED_SERIES = {
    "wti": "DCOILWTICO",
    "henry_hub_gas": "DHHNGSP",
    "ig_spread": "BAMLC0A1CAAAEY",
    "hy_spread": "BAMLH0A0HYM2",
}

# Sidebar hazard id -> EONET category id (NASA)
HAZARD_EONET_CATEGORY: dict[str, str] = {
    "tornado": "severeStorms",
    "wildfire": "wildfires",
    "drought": "drought",
    "heatwave": "tempExtremes",
    "flood": "floods",
    "freeze": "snow",
}

_STORM_HEADER_RE = re.compile(r"^([A-Z]{2}\d{6}),\s*")


def _parse_hurdat_lat_lon(lat_raw: str, lon_raw: str) -> tuple[float, float] | None:
    lat_raw = lat_raw.strip().upper()
    lon_raw = lon_raw.strip().upper()
    if len(lat_raw) < 2 or len(lon_raw) < 2:
        return None
    lat_dir = lat_raw[-1]
    lon_dir = lon_raw[-1]
    if lat_dir not in "NS" or lon_dir not in "EW":
        return None
    try:
        lat = float(lat_raw[:-1]) * (1 if lat_dir == "N" else -1)
        lon = float(lon_raw[:-1]) * (-1 if lon_dir == "W" else 1)
    except ValueError:
        return None
    return lat, lon


def parse_hurdat_storms(raw_text: str, wanted_ids: tuple[str, ...]) -> dict[str, list[dict[str, Any]]]:
    wanted = set(wanted_ids)
    lines = raw_text.splitlines()
    out: dict[str, list[dict[str, Any]]] = {sid: [] for sid in wanted}
    current: str | None = None

    for line in lines:
        line = line.strip()
        if not line:
            continue
        m = _STORM_HEADER_RE.match(line)
        if m:
            sid = m.group(1)
            current = sid if sid in wanted else None
            continue
        if current is None:
            continue
        parts = [p.strip() for p in line.split(",")]
        if not parts or not parts[0].isdigit() or len(parts) < 6:
            continue
        parsed = _parse_hurdat_lat_lon(parts[4], parts[5])
        if parsed:
            lat, lon = parsed
            date_utc = ""
            dr = parts[0]
            if len(dr) == 8 and dr.isdigit():
                date_utc = f"{dr[:4]}-{dr[4:6]}-{dr[6:8]}"
            out[current].append({"lat": lat, "lng": lon, "date_utc": date_utc})
    return out


async def _download_text_cached(url: str, cache_name: str, max_age_hours: int) -> str:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / cache_name
    if path.is_file():
        age = datetime.now(timezone.utc).timestamp() - path.stat().st_mtime
        if age < max_age_hours * 3600:
            return path.read_text(encoding="utf-8", errors="replace")
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True, headers=HTTP_HEADERS) as client:
        response = await client.get(url)
        response.raise_for_status()
        text = response.text
    path.write_text(text, encoding="utf-8")
    return text


async def load_hurricane_tracks(storm_ids: tuple[str, ...] = DEFAULT_HURRICANE_STORM_IDS) -> dict[str, Any]:
    try:
        raw = await _download_text_cached(HURDAT2_URL, "hurdat2_atlantic.txt", max_age_hours=168)
        tracks = parse_hurdat_storms(raw, storm_ids)
        meta = [
            {
                "id": sid,
                "name": "Harvey" if sid == "AL092017" else "Ian" if sid == "AL092022" else sid,
                "points": tracks.get(sid, []) or [],
            }
            for sid in storm_ids
        ]
        return {"storms": meta, "source_url": HURDAT2_URL}
    except Exception as exc:
        shells = [
            {"id": sid, "name": "Harvey" if sid == "AL092017" else "Ian" if sid == "AL092022" else sid, "points": []}
            for sid in storm_ids
        ]
        return {"storms": shells, "source_url": HURDAT2_URL, "error": str(exc)}


HISTORICAL_SCENARIOS: list[dict[str, str]] = [
    {
        "id": "harvey_2017",
        "label": "Hurricane Harvey — Aug 2017",
        "anchor_date": "2017-08-25",
        "hazard": "hurricane",
    },
    {
        "id": "uri_2021",
        "label": "Winter Storm Uri — Feb 2021",
        "anchor_date": "2021-02-15",
        "hazard": "freeze",
    },
    {
        "id": "ian_2022",
        "label": "Hurricane Ian — Sep 2022",
        "anchor_date": "2022-09-28",
        "hazard": "hurricane",
    },
    {
        "id": "camp_fire_2018",
        "label": "Camp Fire / CA wildfires — Nov 2018",
        "anchor_date": "2018-11-08",
        "hazard": "wildfire",
    },
]

CARBON_SCENARIO: dict[str, str] = {
    "id": "carbon_tax_100",
    "label": "Carbon Tax $100/ton",
    "anchor_date": "2030-01-15",
    "hazard": "carbon",
}

HEATMAP_SCENARIOS: list[dict[str, str]] = [*HISTORICAL_SCENARIOS, CARBON_SCENARIO]


def _ring_centroid(ring: list[Any]) -> tuple[float, float] | None:
    if not ring:
        return None
    lons: list[float] = []
    lats: list[float] = []
    for pt in ring:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            try:
                lons.append(float(pt[0]))
                lats.append(float(pt[1]))
            except (TypeError, ValueError):
                continue
    if not lats:
        return None
    return sum(lats) / len(lats), sum(lons) / len(lons)


def _eonet_coords_to_latlng(coords: Any, gtype: str) -> tuple[float, float] | None:
    """GeoJSON uses [lon, lat]. Returns (lat, lng)."""
    if gtype == "Point" and isinstance(coords, list) and len(coords) >= 2:
        try:
            return float(coords[1]), float(coords[0])
        except (TypeError, ValueError):
            return None
    if gtype == "MultiPoint" and isinstance(coords, list) and coords:
        return _eonet_coords_to_latlng(coords[0], "Point")
    if gtype == "LineString" and isinstance(coords, list) and coords:
        return _eonet_coords_to_latlng(coords[0], "Point")
    if gtype == "MultiLineString" and isinstance(coords, list) and coords and coords[0]:
        return _eonet_coords_to_latlng(coords[0], "LineString")
    if gtype == "Polygon" and isinstance(coords, list) and coords:
        exterior = coords[0] if coords[0] else None
        if exterior:
            c = _ring_centroid(exterior)
            if c:
                return c[0], c[1]
    if gtype == "MultiPolygon" and isinstance(coords, list) and coords and coords[0]:
        first = coords[0]
        if isinstance(first, list) and first:
            return _eonet_coords_to_latlng(first, "Polygon")
    return None


def _eonet_geometry_to_latlng(geom: dict[str, Any]) -> tuple[float, float] | None:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not gtype or coords is None:
        return None
    if not isinstance(gtype, str):
        return None
    return _eonet_coords_to_latlng(coords, gtype)


def _eonet_event_position(ev: dict[str, Any]) -> tuple[float, float] | None:
    """First drawable position from EONET event geometry list (Point, Polygon, etc.)."""
    for g in ev.get("geometry") or []:
        if not isinstance(g, dict):
            continue
        pos = _eonet_geometry_to_latlng(g)
        if pos:
            return pos
    return None


def _parse_fred_csv(csv_text: str) -> dict[str, Any]:
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    if len(rows) < 3:
        return {"latest": None, "change_pct": None, "series": []}
    # Row 0: headers, data starts ~row 1 with observation_date,value
    data_rows = [r for r in rows[1:] if len(r) >= 2 and r[1] and r[1] != "."]
    if not data_rows:
        return {"latest": None, "change_pct": None, "series": []}

    def to_float(s: str) -> float | None:
        try:
            return float(s)
        except ValueError:
            return None

    tail = data_rows[-30:]
    series = [{"date": r[0], "value": to_float(r[1])} for r in tail if to_float(r[1]) is not None]
    last = to_float(data_rows[-1][1])
    prev = None
    for r in reversed(data_rows[:-1]):
        v = to_float(r[1])
        if v is not None:
            prev = v
            break
    change_pct = None
    if last is not None and prev is not None and prev != 0:
        change_pct = (last / prev - 1.0) * 100.0
    return {"latest": last, "prior": prev, "change_pct": change_pct, "series": series}


async def fetch_fred_bundle() -> dict[str, Any]:
    out: dict[str, Any] = {"series": {}, "errors": []}
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True, headers=HTTP_HEADERS) as client:
        for key, series_id in FRED_SERIES.items():
            url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
            try:
                response = await client.get(url)
                response.raise_for_status()
                out["series"][key] = {
                    "fred_id": series_id,
                    "source_url": url,
                    **_parse_fred_csv(response.text),
                }
            except Exception as exc:
                out["errors"].append(f"fred:{key}:{exc}")
                out["series"][key] = {"fred_id": series_id, "source_url": url, "latest": None, "series": []}
    return out


async def fetch_eonet_by_categories(
    category_ids: list[str],
    days: int = 3650,
    limit: int = 120,
) -> dict[str, Any]:
    """Fetch NASA EONET events per category. Polygons/lines get a centroid/start point."""
    seen_cat: set[str] = set()
    events_out: list[dict[str, Any]] = []
    errors: list[str] = []
    dedupe_keys: set[tuple[str, str]] = set()

    async with httpx.AsyncClient(timeout=60.0, headers=HTTP_HEADERS) as client:
        for cat in category_ids:
            if cat in seen_cat:
                continue
            seen_cat.add(cat)
            # Default EONET feed is open events only — most layers look empty. Include closed events for map density.
            url = f"{EONET_EVENTS_URL}?category={cat}&days={days}&limit={limit}&status=all"
            try:
                payload: dict[str, Any] | None = None
                for attempt in range(4):
                    try:
                        response = await client.get(url)
                        response.raise_for_status()
                        payload = response.json()
                        break
                    except httpx.HTTPStatusError as exc:
                        if exc.response.status_code == 503 and attempt < 3:
                            await asyncio.sleep(0.8 * (2**attempt))
                            continue
                        raise
                if payload is None:
                    raise RuntimeError("EONET request did not return JSON")
                for ev in payload.get("events", []):
                    pos = _eonet_event_position(ev)
                    if pos is None:
                        continue
                    lat, lng = pos
                    eid = str(ev.get("id", ""))
                    key = (eid, cat)
                    if key in dedupe_keys:
                        continue
                    dedupe_keys.add(key)
                    gdate = None
                    for g in ev.get("geometry") or []:
                        if isinstance(g, dict) and g.get("date"):
                            gdate = g.get("date")
                            break
                    cats = [c.get("id", "") for c in ev.get("categories", [])]
                    events_out.append(
                        {
                            "id": eid,
                            "title": ev.get("title", ""),
                            "categories": cats,
                            "lat": lat,
                            "lng": lng,
                            "date": gdate,
                            "eonet_category": cat,
                        }
                    )
            except Exception as exc:
                errors.append(f"eonet:{cat}:{exc}")
            await asyncio.sleep(0.35)

    by_cat: dict[str, int] = {}
    for row in events_out:
        c = row.get("eonet_category", "")
        by_cat[c] = by_cat.get(c, 0) + 1

    return {
        "events": events_out,
        "source_url": EONET_EVENTS_URL,
        "errors": errors,
        "days_requested": days,
        "count_by_category": by_cat,
    }


def _yf_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for sym in symbols:
        try:
            t = yf.Ticker(sym)
            hist = t.history(period="5d", auto_adjust=True)
            if hist is None or hist.empty or "Close" not in hist.columns:
                result[sym] = {"price": None, "previous_close": None, "change_pct_1d": None}
                continue
            closes = hist["Close"].dropna()
            if closes.empty:
                result[sym] = {"price": None, "previous_close": None, "change_pct_1d": None}
                continue
            last = float(closes.iloc[-1])
            prev_close = float(closes.iloc[-2]) if len(closes) > 1 else last
            chg = None
            if prev_close:
                chg = (last / prev_close - 1.0) * 100.0
            result[sym] = {
                "price": last,
                "previous_close": prev_close,
                "change_pct_1d": chg,
            }
        except Exception:
            result[sym] = {"price": None, "previous_close": None, "change_pct_1d": None}
    return result


async def fetch_yfinance_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    return await asyncio.to_thread(_yf_quotes, symbols)


def load_heatmap_portfolio() -> dict[str, Any]:
    path = DATA_DIR / "heatmap_portfolio.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _live_pnl_breakdown(position_rows: list[dict[str, Any]]) -> tuple[dict[str, float], dict[str, float]]:
    """Sum signed 1d P&L by asset_class and by position direction (long vs short legs)."""
    by_asset: dict[str, float] = {}
    by_side = {"long": 0.0, "short": 0.0}
    for row in position_rows:
        pnl = row.get("estimated_pnl_1d_musd")
        if pnl is None:
            continue
        v = float(pnl)
        ac = str(row.get("asset_class", "other")).lower()
        by_asset[ac] = by_asset.get(ac, 0.0) + v
        side = str(row.get("direction", "long")).lower()
        key = "long" if side == "long" else "short"
        by_side[key] = by_side[key] + v
    return by_asset, by_side


def _scenario_pnl_breakdown(
    positions: list[dict[str, Any]],
    by_symbol: dict[str, float | None],
) -> tuple[dict[str, float], dict[str, float]]:
    by_asset: dict[str, float] = {}
    by_side = {"long": 0.0, "short": 0.0}
    for p in positions:
        sym = p["symbol"]
        raw = by_symbol.get(sym)
        if raw is None:
            continue
        v = float(raw)
        ac = str(p.get("asset_class", "other")).lower()
        by_asset[ac] = by_asset.get(ac, 0.0) + v
        side = str(p.get("direction", "long")).lower()
        key = "long" if side == "long" else "short"
        by_side[key] = by_side[key] + v
    return by_asset, by_side


def _client_safe_errors(errors: list[str]) -> list[str]:
    out: list[str] = []
    for e in errors:
        el = e.lower()
        if "eonet" in el or "503" in el or "nasa" in el:
            continue
        out.append(e)
    return out


async def build_live_heatmap_payload() -> dict[str, Any]:
    portfolio = load_heatmap_portfolio()
    positions: list[dict[str, Any]] = portfolio.get("positions", [])
    symbols = [p["symbol"] for p in positions]
    facility_rows = load_facility_rows()

    fred_task = fetch_fred_bundle()

    eonet_categories = sorted(set(HAZARD_EONET_CATEGORY.values()))
    # EONET applies ~10y lookback for sparse categories (drought, snow); shorter windows return empty.
    eonet_task = fetch_eonet_by_categories(eonet_categories, days=3650, limit=120)

    quotes_task = fetch_yfinance_quotes(symbols)
    scenarios_task = asyncio.to_thread(
        compute_all_scenario_dual_returns,
        symbols,
        HEATMAP_SCENARIOS,
    )
    hur_task = load_hurricane_tracks(DEFAULT_HURRICANE_STORM_IDS)

    fred, eonet, quotes, scenario_dual, hur = await asyncio.gather(
        fred_task,
        eonet_task,
        quotes_task,
        scenarios_task,
        hur_task,
    )
    scenario_returns, scenario_event_returns = scenario_dual

    errors: list[str] = []
    if isinstance(hur, dict) and hur.get("error"):
        errors.append(f"hurdat:{hur['error']}")
    errors.extend(fred.get("errors", []))
    errors.extend(eonet.get("errors", []))

    now = datetime.now(timezone.utc).isoformat()

    # Live portfolio P&L (1d) in $M
    live_pnl_musd = 0.0
    position_rows: list[dict[str, Any]] = []
    for p in positions:
        sym = p["symbol"]
        n = float(p["notional_musd"])
        direction = 1.0 if p.get("direction", "long").lower() == "long" else -1.0
        q = quotes.get(sym, {})
        chg = q.get("change_pct_1d")
        pnl = None
        if chg is not None:
            pnl = n * (chg / 100.0) * direction
            live_pnl_musd += pnl
        position_rows.append(
            {
                **p,
                "quote": q,
                "estimated_pnl_1d_musd": pnl,
                "risk_score_0_100": live_risk_score_for_position({**p, "quote": q}, facility_rows),
            }
        )

    by_asset_live, by_side_live = _live_pnl_breakdown(position_rows)

    # Predictive: per-scenario portfolio impact using historical window returns (incl. hardcoded carbon)
    predictive: dict[str, Any] = {}
    for sc in HEATMAP_SCENARIOS:
        aid = sc["id"]
        per_sym = scenario_returns.get(aid, {})
        total = 0.0
        breakdown: dict[str, float | None] = {}
        for p in positions:
            sym = p["symbol"]
            direction = 1.0 if p.get("direction", "long").lower() == "long" else -1.0
            r = per_sym.get(sym)
            if r is None:
                breakdown[sym] = None
                continue
            contrib = float(p["notional_musd"]) * r * direction
            breakdown[sym] = contrib
            total += contrib
        by_asset_scen, by_side_scen = _scenario_pnl_breakdown(positions, breakdown)
        predictive[aid] = {
            "label": sc["label"],
            "hazard": sc["hazard"],
            "anchor_date": sc["anchor_date"],
            "portfolio_pnl_musd": total,
            "by_symbol": breakdown,
            "pnl_by_asset_class_musd": {k: round(v, 4) for k, v in by_asset_scen.items()},
            "pnl_by_side_musd": {k: round(v, 4) for k, v in by_side_scen.items()},
        }

    mispricing_detector = build_mispricing_by_scenario(
        positions,
        HEATMAP_SCENARIOS,
        scenario_event_returns,
        facility_rows,
    )
    diversification_fiction = build_diversification_fiction()

    return {
        "as_of_utc": now,
        "data_sources": {
            "hurdat2": hur.get("source_url", HURDAT2_URL),
            "eonet": EONET_EVENTS_URL,
            "fred": "https://fred.stlouisfed.org/",
            "market": "yfinance",
        },
        "hazard_eonet_category_map": HAZARD_EONET_CATEGORY,
        "hurricanes": hur,
        "fred": fred,
        "eonet": {
            "events": eonet["events"],
            "source_url": eonet["source_url"],
            "days_requested": eonet.get("days_requested", 3650),
            "count_by_category": eonet.get("count_by_category", {}),
        },
        "portfolio": {
            "label": portfolio.get("label", ""),
            "positions": position_rows,
            "total_notional_musd": sum(float(p["notional_musd"]) for p in positions),
            "live_pnl_1d_musd": live_pnl_musd,
            "live_pnl_1d_by_asset_class_musd": {k: round(v, 4) for k, v in by_asset_live.items()},
            "live_pnl_1d_by_side_musd": {k: round(v, 4) for k, v in by_side_live.items()},
        },
        "historical_scenarios": HEATMAP_SCENARIOS,
        "predictive_scenarios": predictive,
        "mispricing_detector": mispricing_detector,
        "diversification_fiction": diversification_fiction,
        "errors": _client_safe_errors(errors),
    }
