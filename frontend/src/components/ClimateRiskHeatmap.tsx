import "leaflet/dist/leaflet.css";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import L from "leaflet";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  Circle,
  CircleMarker,
  LayerGroup,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const API_BASE = "http://localhost:8000/api";
const LIVE_REFRESH_MS = 120_000;
const EONET_MARKER_RADIUS_PX = 10;
/** Fixed hurricane impact disk on the map (does not pulse with replay phase). */
const HURRICANE_DISK_RADIUS_M = 320_000;
const STORM_OVERLAY_MAX_EQ_PCT = 2.75;
const IMPACT_CYCLE_MS = 1600;
const TICK_INTERVAL_MS = 40;
const LIVE_ALPHA_HIGHLIGHT_PP = 1.5;
/** Max single-name channel shock (%) when climate β=100 and pulse=100%; not cone overlap. */
const LIVE_CHANNEL_MAX_SHOCK_PCT = 4.0;
const FACILITY_DISK_KEY_SEP = "\u001f";
/** Influence radius (m) around each EONET point by hazard type (demo weighting). */
const HAZARD_INFLUENCE_RADIUS_M: Record<HazardId, number> = {
  tornado: 220_000,
  wildfire: 380_000,
  drought: 520_000,
  heatwave: 480_000,
  flood: 300_000,
  freeze: 260_000,
};
/** Blend weights for combining hurricane disk proximity with EONET hazards (same order of magnitude). */
const HURRICANE_BLEND_WEIGHT = 0.38;
const HAZARD_BLEND_WEIGHT: Record<HazardId, number> = {
  tornado: 0.11,
  wildfire: 0.16,
  drought: 0.07,
  heatwave: 0.08,
  flood: 0.13,
  freeze: 0.09,
};
/** Max conditional loss rate (% of slice) at full hazard blend and climate β = 100% — drives site expected loss. */
const FACILITY_MAX_LOSS_PCT_ON_SLICE = 4.5;
const HURRICANE_DISK_FILL_OPACITY = 0.14;
/** Reference book size ($M) for rescaling site loss to institutional notionals in narrative. */
const INSTITUTIONAL_REFERENCE_NOTIONAL_MUSD = 100;
const REC_SIGNAL_THRESHOLD_PP = 3;

export interface ClimateRiskHeatmapProps {
  onOpenStressTest: (ticker?: string) => void;
}

type HazardId = "tornado" | "wildfire" | "drought" | "heatwave" | "flood" | "freeze";

type ViewMode = "live" | "predictive";

interface LiveQuote {
  price: number | null;
  previous_close: number | null;
  change_pct_1d: number | null;
}

interface PortfolioPosition {
  symbol: string;
  name: string;
  asset_class: string;
  notional_musd: number;
  direction: string;
  quote: LiveQuote;
  estimated_pnl_1d_musd: number | null;
  risk_score_0_100?: number;
}

interface MispricingRow {
  symbol: string;
  name: string;
  direction: string;
  asset_class: string;
  predicted_position_return_pct: number;
  actual_position_return_pct: number | null;
  underlying_actual_return_pct?: number | null;
  gap_pct: number | null;
  signal: string;
  risk_score_0_100: number;
  narrative: string;
}

interface MispricingDetectorPayload {
  methodology: string;
  event_window: string;
  by_scenario: Record<
    string,
    {
      label: string;
      hazard: string;
      anchor_date: string;
      rows: MispricingRow[];
      actions?: string[];
    }
  >;
}

interface HurdatPoint {
  lat: number;
  lng: number;
  date_utc?: string;
}

interface HurricaneStorm {
  id: string;
  name: string;
  points: HurdatPoint[] | number[][];
}

interface EonetEvent {
  id: string;
  title: string;
  lat: number;
  lng: number;
  eonet_category: string;
  categories: string[];
  date?: string;
}

interface HistoricalScenario {
  id: string;
  label: string;
  anchor_date: string;
  hazard: string;
}

interface PredictiveScenarioBlock {
  label: string;
  hazard: string;
  anchor_date: string;
  portfolio_pnl_musd: number;
  by_symbol: Record<string, number | null>;
  pnl_by_asset_class_musd?: Record<string, number>;
  pnl_by_side_musd?: { long: number; short: number };
}

interface LiveHeatmapResponse {
  as_of_utc: string;
  data_sources: Record<string, string>;
  hazard_eonet_category_map: Record<string, string>;
  hurricanes: {
    storms: HurricaneStorm[];
    source_url: string;
    error?: string;
  };
  fred: {
    series: Record<
      string,
      {
        fred_id: string;
        source_url: string;
        latest: number | null;
        change_pct: number | null;
        series: { date: string; value: number }[];
      }
    >;
    errors: string[];
  };
  eonet: {
    events: EonetEvent[];
    source_url: string;
    days_requested?: number;
    count_by_category?: Record<string, number>;
  };
  portfolio: {
    label: string;
    positions: PortfolioPosition[];
    total_notional_musd: number;
    live_pnl_1d_musd: number;
    live_pnl_1d_by_asset_class_musd?: Record<string, number>;
    live_pnl_1d_by_side_musd?: { long: number; short: number };
  };
  historical_scenarios: HistoricalScenario[];
  predictive_scenarios: Record<string, PredictiveScenarioBlock>;
  mispricing_detector?: MispricingDetectorPayload;
  errors: string[];
}

interface FacilityRow {
  ticker: string;
  facility_name: string;
  lat: number;
  lng: number;
  region: string;
  asset_value_pct: number;
}

interface FacilityRiskSnapshot {
  facilityKey: string;
  facility: FacilityRow;
  hurricaneProximity01: number;
  hazardStressById: Record<HazardId, number>;
  blend01: number;
  breakdownParts: string[];
  expectedLossMusd: number;
  distToEyeKm: number;
  inHurricaneDisk: boolean;
}

const MAP_CENTER: [number, number] = [32, -96];
const INITIAL_ZOOM = 5;

const HAZARDS: { id: HazardId; label: string; icon: string; color: string }[] = [
  { id: "tornado", label: "Severe storms (EONET)", icon: "🌪️", color: "#fb923c" },
  { id: "wildfire", label: "Wildfire", icon: "🔥", color: "#ef4444" },
  { id: "drought", label: "Drought", icon: "☀️", color: "#eab308" },
  { id: "heatwave", label: "Temperature extremes", icon: "🌡️", color: "#f43f5e" },
  { id: "flood", label: "Floods", icon: "🌊", color: "#3b82f6" },
  { id: "freeze", label: "Snow / ice", icon: "❄️", color: "#818cf8" },
];

const TICKER_COLOR: Record<string, string> = {
  VLO: "#3b82f6",
  NRG: "#a855f7",
  EGP: "#22c55e",
  ALL: "#f97316",
};

const DEFAULT_TOGGLES: Record<HazardId, boolean> = {
  tornado: true,
  wildfire: true,
  drought: true,
  heatwave: true,
  flood: true,
  freeze: true,
};

const EQUITY_TICKERS = new Set(["VLO", "NRG", "EGP", "ALL"]);

function normalizeHurdatPoint(p: HurdatPoint | number[]): HurdatPoint {
  if (Array.isArray(p)) {
    return { lat: p[0], lng: p[1], date_utc: undefined };
  }
  return { lat: p.lat, lng: p.lng, date_utc: p.date_utc };
}

function findGulfApproachIndex(pts: HurdatPoint[]): number {
  const gulf = pts.findIndex((p) => p.lng >= -99 && p.lat >= 22 && p.lat <= 32);
  if (gulf >= 0) {
    return Math.max(0, gulf - 2);
  }
  const wider = pts.findIndex((p) => p.lng >= -105 && p.lat >= 24);
  if (wider >= 0) {
    return Math.max(0, wider - 3);
  }
  return Math.max(0, Math.floor(pts.length * 0.52));
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function mixToRed(baseHex: string, stress01: number): string {
  const t = Math.min(1, Math.max(0, stress01));
  if (t < 0.02) {
    return baseHex;
  }
  const base = hexToRgb(baseHex);
  const tr = 239;
  const tg = 68;
  const tb = 68;
  const r = Math.round(base.r * (1 - t) + tr * t);
  const g = Math.round(base.g * (1 - t) + tg * t);
  const b = Math.round(base.b * (1 - t) + tb * t);
  return `rgb(${r},${g},${b})`;
}

function weightedFootprintInImpactZone(
  ticker: string,
  facilities: FacilityRow[],
  center: [number, number],
  radiusM: number,
): number {
  const mine = facilities.filter((f) => f.ticker.toUpperCase() === ticker.toUpperCase());
  if (mine.length === 0) {
    return 0;
  }
  let wIn = 0;
  let wTot = 0;
  for (const f of mine) {
    wTot += f.asset_value_pct;
    if (distanceMeters([f.lat, f.lng], center) <= radiusM) {
      wIn += f.asset_value_pct;
    }
  }
  return wTot > 0 ? wIn / wTot : 0;
}

/** Footprint within storm disk using only Gulf Coast mapped sites (for sleeve copy). */
function weightedFootprintInImpactZoneGulfOnly(
  ticker: string,
  facilities: FacilityRow[],
  center: [number, number],
  radiusM: number,
): number {
  const mine = facilities.filter(
    (f) => f.ticker.toUpperCase() === ticker.toUpperCase() && f.region === "gulf_coast",
  );
  if (mine.length === 0) {
    return 0;
  }
  let wIn = 0;
  let wTot = 0;
  for (const f of mine) {
    wTot += f.asset_value_pct;
    if (distanceMeters([f.lat, f.lng], center) <= radiusM) {
      wIn += f.asset_value_pct;
    }
  }
  return wTot > 0 ? wIn / wTot : 0;
}

function hurricaneProximity01Smooth(
  lat: number,
  lng: number,
  center: [number, number] | null,
  radiusM: number,
  layerOn: boolean,
): number {
  if (!layerOn || !center || radiusM <= 0) {
    return 0;
  }
  const d = distanceMeters([lat, lng], center);
  if (d >= radiusM) {
    return 0;
  }
  return 1 - d / radiusM;
}

function eonetCategoryProximity01(
  lat: number,
  lng: number,
  category: string,
  radiusM: number,
  events: EonetEvent[],
): number {
  const pos: [number, number] = [lat, lng];
  let best = 0;
  for (const ev of events) {
    if (ev.eonet_category !== category) {
      continue;
    }
    const t = 1 - Math.min(1, distanceMeters(pos, [ev.lat, ev.lng]) / radiusM);
    if (t > best) {
      best = t;
    }
  }
  return best;
}

function facilityBookSliceMusd(f: FacilityRow, live: LiveHeatmapResponse | null): number {
  if (!live) {
    return 0;
  }
  const pos = live.portfolio.positions.find((p) => p.symbol === f.ticker);
  if (!pos) {
    return 0;
  }
  return pos.notional_musd * f.asset_value_pct;
}

/** Single-event expected loss ($M) on the facility slice from book exposure × hazard blend × climate β. */
function facilityExpectedLossFromBlend(sliceMusd: number, blend01: number, pos: PortfolioPosition | undefined): number {
  if (!pos || sliceMusd <= 0 || blend01 <= 0) {
    return 0;
  }
  const risk01 = Math.min(1, Math.max(0, (pos.risk_score_0_100 ?? 50) / 100));
  const shock = (FACILITY_MAX_LOSS_PCT_ON_SLICE / 100) * blend01 * risk01;
  const isShort = pos.direction.toLowerCase() === "short";
  return sliceMusd * shock * (isShort ? 1 : -1);
}

type DominantHazardKind = HazardId | "hurricane";

function dominantHazardAtSnap(snap: FacilityRiskSnapshot, hurricaneLayerOn: boolean): {
  kind: DominantHazardKind;
  shortLabel: string;
  pct: number;
} {
  let best: { kind: DominantHazardKind; shortLabel: string; pct: number } = {
    kind: "wildfire",
    shortLabel: "wildfire",
    pct: 0,
  };
  if (hurricaneLayerOn) {
    const hp = Math.round(snap.hurricaneProximity01 * 100);
    if (hp > best.pct) {
      best = { kind: "hurricane", shortLabel: "hurricane field", pct: hp };
    }
  }
  for (const h of HAZARDS) {
    const p = Math.round((snap.hazardStressById[h.id] ?? 0) * 100);
    if (p > best.pct) {
      best = { kind: h.id, shortLabel: h.label.split("(")[0].trim().toLowerCase(), pct: p };
    }
  }
  return best;
}

function isPolicyFacility(f: FacilityRow): boolean {
  return f.facility_name.toLowerCase().includes("policy concentration");
}

/** Mispricing row for an equity ticker, or CL=F / NG=F proxy for VLO / NRG. */
function mispricingRowForFacilityTicker(rows: MispricingRow[], facilityTicker: string): MispricingRow | null {
  const u = facilityTicker.toUpperCase();
  const direct = rows.find((r) => r.symbol.toUpperCase() === u);
  if (direct) {
    return direct;
  }
  if (u === "VLO") {
    return rows.find((r) => r.symbol === "CL=F") ?? null;
  }
  if (u === "NRG") {
    return rows.find((r) => r.symbol === "NG=F") ?? null;
  }
  return null;
}

interface WhyMispricingSlot {
  id: string;
  title: string;
  body: string;
}

function buildWhySlotsForFacility(params: {
  snap: FacilityRiskSnapshot;
  row: MispricingRow | null;
  tradeSymbol: string;
  session: number | null | undefined;
  hurricaneOn: boolean;
}): WhyMispricingSlot[] {
  const { snap, row, tradeSymbol, session, hurricaneOn } = params;
  const dom = dominantHazardAtSnap(snap, hurricaneOn);
  const facTicker = snap.facility.ticker.toUpperCase();
  const sessionText =
    session == null || Number.isNaN(session) ? "thin or unavailable on the print" : `${formatPct1d(session)} today`;
  const keyPrefix = snap.facilityKey;

  let slot1: string;
  if (row && row.gap_pct != null) {
    const gapText = formatPct1d(row.gap_pct);
    slot1 = `Session is ${sessionText} on ${tradeSymbol} while the scenario still implies a different path (gap ${gapText}). ${mispricingSignalLabel(row.signal)} — flows and quarter-to-quarter reporting often absorb slow-moving physical risk until losses or guidance force recognition.`;
  } else if (row) {
    slot1 = `Session is ${sessionText} on ${tradeSymbol}. ${mispricingSignalLabel(row.signal)} — the sleeve still disagrees with the tape; gap isn’t numeric on this row, so lean on predicted vs actual in WHAT.`;
  } else {
    slot1 = `At ${snap.facility.facility_name}, exposure runs through ${facTicker} while the tape is ${sessionText}. There’s no ${facTicker} row in the mispricing sleeve — use CL=F, NG=F, or a peer line in WHAT to proxy the model–market wedge.`;
  }

  const slot2 = `${snap.facility.facility_name} maps ~${dom.pct}% ${dom.shortLabel} with current map toggles. That ties ${tradeSymbol} to this pin through real assets in the loss path — outages, cost pressure, and forward cash flows the model can stress before the market fully agrees.`;

  const slot3 =
    "The model loses if hedges and insurance net out the shock, the hazard plume misses operated assets, regulation or balance-sheet buffers absorb the hit, or another driver (macro, M&A, idiosyncratic news) dominates the next move so this climate leg never prints in price.";

  const slot4 = whyLagThesisLine(facTicker, snap, dom, sessionText);

  return [
    { id: `${keyPrefix}-why-1`, title: "Why hasn't the market priced this in yet?", body: slot1 },
    { id: `${keyPrefix}-why-2`, title: "What is the mechanism connecting this facility to the stock price?", body: slot2 },
    { id: `${keyPrefix}-why-3`, title: "What would have to happen for the model to be wrong?", body: slot3 },
    { id: `${keyPrefix}-why-4`, title: "The lag you're watching", body: slot4 },
  ];
}

function whyLagThesisLine(
  anchorTicker: string,
  snap: FacilityRiskSnapshot | null,
  dom: { kind: DominantHazardKind; shortLabel: string; pct: number },
  sessionText: string,
): string {
  const site = snap?.facility.facility_name ?? "the flagship mapped site";
  const t = anchorTicker.toUpperCase();
  const utilLike = t === "EGP" || t === "NEE" || t === "DUK" || t === "SO";
  const insurer = t === "ALL" || t === "TRV" || t === "AIG";
  const refiner = ["VLO", "MPC", "PSX", "LYB", "XOM", "CVX", "DOW"].includes(t);

  if (utilLike && dom.kind === "wildfire") {
    return `${t} has ~${dom.pct}% wildfire intensity at ${site}, but the tape is ${sessionText}. Wildfire and vegetation risk are easy to underprice in utilities because damage accrues slowly and often clears in a later earnings cycle — that lag is the wedge between what the model stresses and what today's price reflects.`;
  }
  if (insurer && (dom.kind === "hurricane" || dom.kind === "flood" || dom.kind === "wildfire")) {
    return `${site} loads ~${dom.pct}% ${dom.shortLabel} while ${t} is ${sessionText}. Cat exposure can sit inside reserves until events renew or loss emergence forces a rerate; the market may be fading slow-burn climate until the balance sheet proves otherwise.`;
  }
  if (refiner && dom.kind === "hurricane") {
    return `${site} sits at ~${dom.pct}% hurricane-field stress while ${t} is ${sessionText}. Gulf disruptions feed margins on a lag; product markets can look orderly while the scenario prices a longer operational hit path.`;
  }
  return `${site} shows ~${dom.pct}% ${dom.shortLabel} in the active map stack while ${t} is ${sessionText}. Physical legs often diverge from price when hedges, insurance, or macro cross-currents mute climate until operating metrics or headlines catch up.`;
}

function weightedDisasterBlend01(
  hurricane01: number,
  hazardStressById: Record<HazardId, number>,
  toggles: Record<HazardId, boolean>,
  hazardMap: Record<string, string>,
  hurricaneLayerOn: boolean,
): number {
  let num = 0;
  let den = 0;
  if (hurricaneLayerOn) {
    num += HURRICANE_BLEND_WEIGHT * hurricane01;
    den += HURRICANE_BLEND_WEIGHT;
  }
  (Object.keys(HAZARD_BLEND_WEIGHT) as HazardId[]).forEach((h) => {
    if (!toggles[h]) {
      return;
    }
    if (!hazardMap[h]) {
      return;
    }
    const w = HAZARD_BLEND_WEIGHT[h];
    num += w * (hazardStressById[h] ?? 0);
    den += w;
  });
  if (den <= 0) {
    return 0;
  }
  return Math.min(1, num / den);
}

function buildHazardStressById(
  lat: number,
  lng: number,
  toggles: Record<HazardId, boolean>,
  hazardMap: Record<string, string>,
  events: EonetEvent[],
): Record<HazardId, number> {
  const out: Record<HazardId, number> = {
    tornado: 0,
    wildfire: 0,
    drought: 0,
    heatwave: 0,
    flood: 0,
    freeze: 0,
  };
  (Object.keys(out) as HazardId[]).forEach((h) => {
    if (!toggles[h]) {
      return;
    }
    const cat = hazardMap[h];
    if (!cat) {
      return;
    }
    out[h] = eonetCategoryProximity01(lat, lng, cat, HAZARD_INFLUENCE_RADIUS_M[h], events);
  });
  return out;
}

function facilityIconHtml(ticker: string, facilityName: string, disasterBlend01: number): string {
  const base = TICKER_COLOR[ticker.toUpperCase()] ?? "#94a3b8";
  const stress = Math.min(1, Math.max(0, disasterBlend01));
  const fill = mixToRed(base, stress);
  const short = ticker.toUpperCase();
  const glowPx = 10 + disasterBlend01 * 40;
  const glowAlpha = 0.28 + disasterBlend01 * 0.45;
  const glow = `0 0 ${glowPx}px rgba(251,191,36,${glowAlpha})`;
  const border = stress > 0.45 ? "2px solid rgba(254,243,199,0.95)" : "2px solid rgba(255,255,255,0.85)";
  const innerScale = 1 + Math.min(0.18, stress * 0.24);
  const safeTitle = facilityName.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<div class="heatmap-facility-hit" style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;" title="${safeTitle}">
    <div style="transform:scale(${innerScale});width:40px;height:40px;border-radius:9999px;border:${border};background:${fill};color:#fff;font:700 11px system-ui;display:flex;align-items:center;justify-content:center;box-shadow:${glow}, 0 0 12px rgba(0,0,0,0.25);pointer-events:auto;">${short}</div>
  </div>`;
}

function facilityLeafletIcon(ticker: string, facilityName: string, disasterBlend01: number): L.DivIcon {
  return L.divIcon({
    className: "heatmap-facility-icon",
    iconSize: [56, 56],
    iconAnchor: [28, 28],
    html: facilityIconHtml(ticker, facilityName, disasterBlend01),
  });
}

function stormEyeIcon(): L.DivIcon {
  return L.divIcon({
    className: "storm-eye-icon",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;border-radius:9999px;background:#fbbf24;border:2px solid #fff;box-shadow:0 0 14px rgba(251,191,36,0.9);"></div>`,
  });
}

function activeEonetCategories(toggles: Record<HazardId, boolean>, map: Record<string, string>): Set<string> {
  const s = new Set<string>();
  (Object.keys(toggles) as HazardId[]).forEach((h) => {
    if (toggles[h]) {
      const c = map[h];
      if (c) {
        s.add(c);
      }
    }
  });
  return s;
}

function formatMoneyM(value: number, digits = 2): string {
  const sign = value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toFixed(digits)}M`;
}

function formatLossMagnitudeMusd(musd: number): string {
  const a = Math.abs(musd);
  if (a >= 0.995) {
    return formatMoneyM(a);
  }
  const k = Math.round(a * 1000);
  return `$${k.toLocaleString("en-US")}K`;
}

function pnlToneClass(v: number): string {
  if (v > 0.0005) {
    return "text-emerald-300";
  }
  if (v < -0.0005) {
    return "text-red-300";
  }
  return "text-white/75";
}

function formatPct1d(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) {
    return "—";
  }
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function mispricingSignalClass(signal: string): string {
  if (signal === "risk_underpriced") {
    return "border-amber-400/40 bg-amber-500/15 text-amber-100";
  }
  if (signal === "risk_over_shoot") {
    return "border-sky-400/35 bg-sky-500/12 text-sky-100";
  }
  if (signal === "fairly_priced") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  }
  if (signal === "no_data") {
    return "border-white/15 bg-white/5 text-white/50";
  }
  return "border-white/20 bg-white/8 text-white/70";
}

function mispricingSignalLabel(signal: string): string {
  if (signal === "risk_underpriced") {
    return "Market missed this";
  }
  if (signal === "risk_over_shoot") {
    return "Market overreacted";
  }
  if (signal === "fairly_priced") {
    return "Priced in";
  }
  if (signal === "no_data") {
    return "No data";
  }
  return signal.replace(/_/g, " ");
}

function mispricingGapEvidenceBody(row: MispricingRow): string {
  const pred = formatPct1d(row.predicted_position_return_pct);
  const gapPart = row.gap_pct != null ? ` — gap ${formatPct1d(row.gap_pct)}` : "";
  const isShort = row.direction.toLowerCase() === "short";
  if (isShort) {
    return `Model predicted ${pred}. Market missed it${gapPart}. Your short benefits if repricing happens — but if the market corrects upward first, the short gets squeezed before it pays off. Watch for a squeeze trigger before full thesis plays out.`;
  }
  return `Model predicted ${pred}. The tape hasn't matched that shape yet${gapPart}. If you're long, you keep convexity if risk reprices — but you can give back if the market digests the shock first. Watch drift vs the scenario window before adding size.`;
}

function clfTapeModelDivergenceBody(
  clfRow: MispricingRow,
  positionBySym: Map<string, PortfolioPosition>,
  impactPhase01: number,
  useLiveStormChannel: boolean,
): string | null {
  const p = positionBySym.get("CL=F");
  const session = p?.quote.change_pct_1d;
  if (session == null || Number.isNaN(session)) {
    return null;
  }
  const predicted = useLiveStormChannel
    ? livePredictedPositionReturnPct(clfRow.risk_score_0_100, clfRow.direction, impactPhase01)
    : clfRow.predicted_position_return_pct;
  if (Number.isNaN(predicted)) {
    return null;
  }
  const div = session - predicted;
  const modelLabel = useLiveStormChannel ? "Storm channel implies" : "Scenario model implies";
  return `Tape is ${formatPct1d(session)} today. ${modelLabel} ${formatPct1d(predicted)}. That's a ${div.toFixed(1)}% divergence — the market is moving opposite to what physical exposure suggests. If you're long, this is the gap to watch. Either the model is wrong or the market hasn't reacted yet.`;
}

function tradeIdeaForRow(row: MispricingRow, conePct: number): { title: string; body: string } {
  const sym = row.symbol;
  const long = row.direction.toLowerCase() !== "short";
  if (row.signal === "risk_underpriced") {
    if (long) {
      if (conePct >= 40) {
        return {
          title: `Trim or hedge ${sym}`,
          body: `Storm overlap is high (~${conePct}%) and the model still sees more risk than today’s move. Consider a smaller long, options, or a paired hedge—not investment advice.`,
        };
      }
      if (conePct >= 15) {
        return {
          title: `Review long in ${sym}`,
          body: `Physical footprint is meaningful (~${conePct}%) while the tape looks complacent vs the scenario. Consider sizing down or adding protection.`,
        };
      }
      return {
        title: `Watch long ${sym}`,
        body: `Scenario vs market disagree; overlap is modest (~${conePct}%). Check the table for size—optional defensive tweak if you’re uneasy on the name.`,
      };
    }
    return {
      title: `Tighten short ${sym}`,
      body: `If risk reprices, shorts can get squeezed. Consider covering part of the short or using tighter risk controls.`,
    };
  }
  if (row.signal === "risk_over_shoot") {
    if (long) {
      return {
        title: `Avoid panic-selling ${sym}`,
        body: `Price moved more than the model implied. Re-check the thesis before cutting; this can be noise around a stress window.`,
      };
    }
    return {
      title: `Lock in short gains?`,
      body: `The tape overshot the model in your favor on ${sym}. Consider trimming the short or trailing a stop instead of pressing.`,
    };
  }
  if (row.signal === "fairly_priced") {
    return {
      title: `Hold ${sym} for now`,
      body: `Scenario and tape line up enough—no strong sell/buy nudge from this demo model.`,
    };
  }
  return {
    title: `Monitor ${sym}`,
    body: `Not enough signal for a firm action—watch updates in the table and on the map.`,
  };
}

function footprintPctForMispricingRow(
  symbol: string,
  facilities: FacilityRow[],
  center: [number, number] | null,
  radiusM: number,
  showStorm: boolean,
): number {
  if (!showStorm || !center || radiusM <= 0) {
    return 0;
  }
  const u = symbol.toUpperCase();
  if (u === "CL=F") {
    return weightedFootprintInImpactZone("VLO", facilities, center, radiusM);
  }
  if (u === "NG=F") {
    return weightedFootprintInImpactZone("NRG", facilities, center, radiusM);
  }
  return weightedFootprintInImpactZone(symbol, facilities, center, radiusM);
}

function facilityDiskKey(f: FacilityRow): string {
  return `${f.ticker.toUpperCase()}${FACILITY_DISK_KEY_SEP}${f.facility_name}`;
}

function computeFacilityRiskSnapshots(
  facilityRows: FacilityRow[],
  live: LiveHeatmapResponse | null,
  impactCenter: [number, number] | null,
  hurricaneRadiusM: number,
  hurricaneLayerOn: boolean,
  toggles: Record<HazardId, boolean>,
  map: Record<string, string>,
): FacilityRiskSnapshot[] {
  if (!live) {
    return [];
  }
  const events = live.eonet.events ?? [];
  return [...facilityRows]
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.facility_name.localeCompare(b.facility_name))
    .map((f) => {
      const facilityKey = facilityDiskKey(f);
      const hurricaneProximity01 = hurricaneProximity01Smooth(f.lat, f.lng, impactCenter, hurricaneRadiusM, hurricaneLayerOn);
      const hazardStressById = buildHazardStressById(f.lat, f.lng, toggles, map, events);
      const blend01 = weightedDisasterBlend01(hurricaneProximity01, hazardStressById, toggles, map, hurricaneLayerOn);
      const slice = facilityBookSliceMusd(f, live);
      const pos = live.portfolio.positions.find((p) => p.symbol === f.ticker);
      const expectedLossMusd = facilityExpectedLossFromBlend(slice, blend01, pos);
      const distToEyeKm =
        impactCenter && hurricaneLayerOn && hurricaneRadiusM > 0
          ? distanceMeters([f.lat, f.lng], impactCenter) / 1000
          : 0;
      const inHurricaneDisk = hurricaneProximity01 > 0;
      const breakdownParts: string[] = [];
      if (hurricaneLayerOn && hurricaneRadiusM > 0) {
        breakdownParts.push(`Hurricane field ${(hurricaneProximity01 * 100).toFixed(0)}%`);
      }
      HAZARDS.forEach((h) => {
        if (!toggles[h.id]) {
          return;
        }
        const s = hazardStressById[h.id];
        if (s < 0.04) {
          return;
        }
        breakdownParts.push(`${h.label.split("(")[0].trim()} ${(s * 100).toFixed(0)}%`);
      });
      return {
        facilityKey,
        facility: f,
        hurricaneProximity01,
        hazardStressById,
        blend01,
        breakdownParts,
        expectedLossMusd,
        distToEyeKm,
        inHurricaneDisk,
      };
    });
}

/**
 * Live “WHAT” prediction: climate β × storm pulse intensity × direction.
 * Intensity is the replay impact phase (0–1), not geographic cone overlap.
 */
function livePredictedPositionReturnPct(
  risk0_100: number | undefined,
  direction: string,
  intensity01: number,
): number {
  const risk01 = Math.min(1, Math.max(0, (risk0_100 ?? 50) / 100));
  const phase = Math.min(1, Math.max(0, intensity01));
  const isShort = direction.toLowerCase() === "short";
  const magnitude = LIVE_CHANNEL_MAX_SHOCK_PCT * risk01 * phase;
  return isShort ? magnitude : -magnitude;
}

interface LiveStormBridge {
  stormActive: boolean;
  radiusKm: number;
  phasePct: number;
  sitesInDisk: number;
  topConeSymbol: string;
  topConePct: number;
  topGulfSymbol: string;
  topGulfPct: number;
  stormOverlayMusd: number;
  worstLiveAlpha: { symbol: string; liveAlpha: number; predicted: number; session: number } | null;
}

function computeLiveStormBridge(
  live: LiveHeatmapResponse | null,
  mispricingBlock: { rows: MispricingRow[] } | null,
  positionBySym: Map<string, PortfolioPosition>,
  facilities: FacilityRow[],
  impactCenter: [number, number] | null,
  impactRadiusM: number,
  impactPhase01: number,
  showHurricaneTrack: boolean,
): LiveStormBridge {
  const stormActive = Boolean(showHurricaneTrack && impactCenter != null);
  const radiusKm = Math.round(impactRadiusM / 1000);
  const phasePct = Math.round(impactPhase01 * 100);
  let sitesInDisk = 0;
  if (stormActive && impactCenter) {
    for (const f of facilities) {
      if (distanceMeters([f.lat, f.lng], impactCenter) <= impactRadiusM) {
        sitesInDisk += 1;
      }
    }
  }
  let topConeSymbol = "—";
  let topConePct = 0;
  let topGulfSymbol = "—";
  let topGulfPct = 0;
  if (stormActive && impactCenter && live?.portfolio.positions.length) {
    for (const p of live.portfolio.positions) {
      const fp = stormFootprintForPosition(p, facilities, impactCenter, impactRadiusM);
      const pct = Math.round(fp * 100);
      if (pct > topConePct) {
        topConePct = pct;
        topConeSymbol = p.symbol;
      }
      const gfp = stormFootprintGulfOnlyForPosition(p, facilities, impactCenter, impactRadiusM);
      const gpct = Math.round(gfp * 100);
      if (gpct > topGulfPct) {
        topGulfPct = gpct;
        topGulfSymbol = p.symbol;
      }
    }
  }
  let stormOverlayMusd = 0;
  if (live && stormActive && impactCenter) {
    for (const p of live.portfolio.positions) {
      const fp = stormFootprintForPosition(p, facilities, impactCenter, impactRadiusM);
      stormOverlayMusd += stormIncrementalMusd(p, fp, impactPhase01);
    }
  }
  let worstLiveAlpha: LiveStormBridge["worstLiveAlpha"] = null;
  if (mispricingBlock?.rows.length && stormActive) {
    for (const row of mispricingBlock.rows) {
      const pos = positionBySym.get(row.symbol);
      const session = pos?.quote.change_pct_1d;
      if (session == null || Number.isNaN(session)) {
        continue;
      }
      const predictedLive = livePredictedPositionReturnPct(
        row.risk_score_0_100,
        row.direction,
        impactPhase01,
      );
      const liveAlpha = predictedLive - session;
      if (
        worstLiveAlpha == null ||
        Math.abs(liveAlpha) > Math.abs(worstLiveAlpha.liveAlpha)
      ) {
        worstLiveAlpha = {
          symbol: row.symbol,
          liveAlpha,
          predicted: predictedLive,
          session,
        };
      }
    }
  }
  return {
    stormActive,
    radiusKm,
    phasePct,
    sitesInDisk,
    topConeSymbol,
    topConePct,
    topGulfSymbol,
    topGulfPct,
    stormOverlayMusd,
    worstLiveAlpha,
  };
}

interface PctBarRow {
  label: string;
  pct: number | null;
}

function PctMoveComparisonChart(props: { rows: PctBarRow[]; height?: number }): ReactElement {
  const { rows, height = 168 } = props;
  const data = rows
    .filter((r): r is { label: string; pct: number } => r.pct != null && !Number.isNaN(r.pct))
    .map((r) => ({ label: r.label, pct: r.pct }));
  if (data.length === 0) {
    return <p className="text-xs text-white/45">Not enough numeric fields to chart.</p>;
  }
  const maxAbs = Math.max(5, ...data.map((d) => Math.abs(d.pct)));
  const domain: [number, number] = [-maxAbs, maxAbs];
  return (
    <div className="mt-3 w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <XAxis type="number" domain={domain} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} stroke="rgba(255,255,255,0.2)" />
          <YAxis
            type="category"
            dataKey="label"
            width={88}
            tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
          />
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
          <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((entry) => (
              <Cell
                key={entry.label}
                fill={entry.pct >= 0 ? "rgba(52,211,153,0.85)" : "rgba(248,113,113,0.88)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ConeFillBar(props: { pct: number; label: string }): ReactElement {
  const t = Math.min(100, Math.max(0, props.pct));
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{props.label}</p>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-600/90 to-rose-500/90 transition-[width] duration-150"
          style={{ width: `${t}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-white/60">{t}% of weighted book in live storm disk</p>
    </div>
  );
}

function sleevePnL(live: LiveHeatmapResponse, assetClass: string): number {
  return live.portfolio.live_pnl_1d_by_asset_class_musd?.[assetClass] ?? 0;
}

function stormFootprintForPosition(
  p: PortfolioPosition,
  facilities: FacilityRow[],
  center: [number, number],
  radiusM: number,
): number {
  if (p.asset_class === "equity") {
    return weightedFootprintInImpactZone(p.symbol, facilities, center, radiusM);
  }
  if (p.symbol === "CL=F") {
    return weightedFootprintInImpactZone("VLO", facilities, center, radiusM);
  }
  if (p.symbol === "NG=F") {
    return weightedFootprintInImpactZone("NRG", facilities, center, radiusM);
  }
  return 0;
}

function stormFootprintGulfOnlyForPosition(
  p: PortfolioPosition,
  facilities: FacilityRow[],
  center: [number, number],
  radiusM: number,
): number {
  if (p.asset_class === "equity") {
    return weightedFootprintInImpactZoneGulfOnly(p.symbol, facilities, center, radiusM);
  }
  if (p.symbol === "CL=F") {
    return weightedFootprintInImpactZoneGulfOnly("VLO", facilities, center, radiusM);
  }
  if (p.symbol === "NG=F") {
    return weightedFootprintInImpactZoneGulfOnly("NRG", facilities, center, radiusM);
  }
  return 0;
}

function stormIncrementalMusd(
  p: PortfolioPosition,
  footprint01: number,
  phase01: number,
): number {
  if (footprint01 <= 0 || phase01 <= 0) {
    return 0;
  }
  if (p.asset_class === "equity") {
    const dir = p.direction.toLowerCase() === "short" ? -1 : 1;
    return -p.notional_musd * (STORM_OVERLAY_MAX_EQ_PCT / 100) * footprint01 * phase01 * dir;
  }
  if (p.symbol === "CL=F") {
    const dir = p.direction.toLowerCase() === "short" ? -1 : 1;
    return p.notional_musd * 0.55 * (1.8 / 100) * footprint01 * phase01 * dir;
  }
  if (p.symbol === "NG=F") {
    const dir = p.direction.toLowerCase() === "short" ? -1 : 1;
    return -p.notional_musd * 0.75 * (2.2 / 100) * footprint01 * phase01 * dir;
  }
  return 0;
}

function displayLiveEstMusd(
  p: PortfolioPosition,
  base: number | null,
  facilities: FacilityRow[],
  center: [number, number] | null,
  radiusM: number,
  phase01: number,
  showHurricane: boolean,
): { text: string; tone: string } {
  if (!showHurricane || !center) {
    return {
      text: base == null ? "—" : formatMoneyM(base),
      tone:
        base == null
          ? "text-white/40"
          : base >= 0
            ? "text-emerald-300"
            : "text-red-300",
    };
  }
  const fp = stormFootprintForPosition(p, facilities, center, radiusM);
  const inc = stormIncrementalMusd(p, fp, phase01);
  const total = (base ?? 0) + inc;
  return {
    text: base == null && inc === 0 ? "—" : formatMoneyM(total),
    tone: total >= 0 ? "text-emerald-300" : "text-red-300",
  };
}

function formatPrice(n: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) {
    return "—";
  }
  if (n >= 1000) {
    return n.toFixed(1);
  }
  return n.toFixed(digits);
}

function nearestItems<T>(
  lat: number,
  lng: number,
  items: T[],
  getLatLng: (item: T) => [number, number],
  limit: number,
): Array<{ item: T; km: number }> {
  const scored = items.map((item) => ({
    item,
    km: distanceMeters([lat, lng], getLatLng(item)) / 1000,
  }));
  scored.sort((a, b) => a.km - b.km);
  return scored.slice(0, limit);
}

export function ClimateRiskHeatmap({ onOpenStressTest }: ClimateRiskHeatmapProps): ReactElement {
  const [live, setLive] = useState<LiveHeatmapResponse | null>(null);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hazardToggles, setHazardToggles] = useState<Record<HazardId, boolean>>(DEFAULT_TOGGLES);
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("harvey_2017");
  const [showHurricaneTrack, setShowHurricaneTrack] = useState(true);
  const [selectedStormId, setSelectedStormId] = useState<string>("AL092017");
  const [stormLegIndex, setStormLegIndex] = useState(0);
  const [impactPhase01, setImpactPhase01] = useState(0);
  const [holdingDialogSymbol, setHoldingDialogSymbol] = useState<string | null>(null);
  const [facilityDialog, setFacilityDialog] = useState<FacilityRow | null>(null);
  const [partialDataDismissed, setPartialDataDismissed] = useState(false);
  const cycleRef = useRef({ leg: 0, cycleStart: Date.now() });

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [liveRes, facRes] = await Promise.all([
        fetch(`${API_BASE}/heatmap/live`),
        fetch(`${API_BASE}/heatmap/facilities?tickers=VLO,NRG,EGP,ALL`),
      ]);
      if (!liveRes.ok) {
        throw new Error(`Live data ${liveRes.status}`);
      }
      if (!facRes.ok) {
        throw new Error(`Facilities ${facRes.status}`);
      }
      const liveJson = (await liveRes.json()) as LiveHeatmapResponse;
      const facJson = (await facRes.json()) as FacilityRow[];
      setLive(liveJson);
      setFacilities(facJson);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load heatmap data");
    }
  }, []);

  useEffect(() => {
    void loadData();
    const id = window.setInterval(() => void loadData(), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    setPartialDataDismissed(false);
  }, [live?.as_of_utc]);

  useEffect(() => {
    if (selectedScenarioId === "ian_2022") {
      setSelectedStormId("AL092022");
    } else if (selectedScenarioId === "harvey_2017") {
      setSelectedStormId("AL092017");
    }
  }, [selectedScenarioId]);

  const hazardMap = live?.hazard_eonet_category_map ?? {};

  const filteredEonet = useMemo(() => {
    if (!live) {
      return [];
    }
    const cats = activeEonetCategories(hazardToggles, hazardMap);
    if (cats.size === 0) {
      return [];
    }
    return live.eonet.events.filter((e) => cats.has(e.eonet_category));
  }, [live, hazardToggles, hazardMap]);

  const predictiveBlock = live?.predictive_scenarios[selectedScenarioId];

  const mispricingScenarioBlock = useMemo(() => {
    if (!live?.mispricing_detector?.by_scenario) {
      return null;
    }
    return live.mispricing_detector.by_scenario[selectedScenarioId] ?? null;
  }, [live, selectedScenarioId]);

  const worstGapRow = useMemo((): MispricingRow | null => {
    if (!mispricingScenarioBlock?.rows?.length) {
      return null;
    }
    let best: MispricingRow | null = null;
    let bestAbs = -1;
    for (const r of mispricingScenarioBlock.rows) {
      if (r.gap_pct == null) {
        continue;
      }
      const a = Math.abs(r.gap_pct);
      if (a > bestAbs) {
        bestAbs = a;
        best = r;
      }
    }
    return best;
  }, [mispricingScenarioBlock]);

  const positionQuoteBySymbol = useMemo(() => {
    const m = new Map<string, PortfolioPosition>();
    if (!live?.portfolio.positions) {
      return m;
    }
    for (const p of live.portfolio.positions) {
      m.set(p.symbol, p);
    }
    return m;
  }, [live]);

  const selectedStorm = useMemo(() => {
    if (!live?.hurricanes.storms.length) {
      return null;
    }
    return live.hurricanes.storms.find((s) => s.id === selectedStormId) ?? live.hurricanes.storms[0];
  }, [live, selectedStormId]);

  const fullTrackNormalized = useMemo((): HurdatPoint[] => {
    if (!selectedStorm?.points?.length) {
      return [];
    }
    return selectedStorm.points.map((p) => normalizeHurdatPoint(p as HurdatPoint | number[]));
  }, [selectedStorm]);

  const playbackStartIndex = useMemo(() => findGulfApproachIndex(fullTrackNormalized), [fullTrackNormalized]);

  const playbackTrack = useMemo(
    () => fullTrackNormalized.slice(playbackStartIndex),
    [fullTrackNormalized, playbackStartIndex],
  );

  const fullTrackLatLngs: [number, number][] = useMemo(
    () => fullTrackNormalized.map((p) => [p.lat, p.lng]),
    [fullTrackNormalized],
  );

  const playbackLatLngs: [number, number][] = useMemo(
    () => playbackTrack.map((p) => [p.lat, p.lng]),
    [playbackTrack],
  );

  useEffect(() => {
    cycleRef.current = { leg: 0, cycleStart: Date.now() };
    setStormLegIndex(0);
    setImpactPhase01(0);
  }, [selectedStormId, showHurricaneTrack, playbackLatLngs.length]);

  useEffect(() => {
    if (!showHurricaneTrack || playbackLatLngs.length === 0) {
      setImpactPhase01(0);
      return;
    }
    const iv = window.setInterval(() => {
      const now = Date.now();
      let { cycleStart, leg } = cycleRef.current;
      let elapsed = now - cycleStart;
      if (elapsed >= IMPACT_CYCLE_MS) {
        cycleStart = now;
        elapsed = 0;
        leg = (leg + 1) % playbackLatLngs.length;
        cycleRef.current = { cycleStart, leg };
        setStormLegIndex(leg);
      }
      setImpactPhase01(Math.min(1, elapsed / IMPACT_CYCLE_MS));
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(iv);
  }, [showHurricaneTrack, playbackLatLngs.length]);

  const impactCenter: [number, number] | null =
    showHurricaneTrack && playbackLatLngs.length > 0
      ? playbackLatLngs[Math.min(stormLegIndex, playbackLatLngs.length - 1)]
      : null;
  const impactRadiusM =
    showHurricaneTrack && impactCenter != null && playbackLatLngs.length > 0 ? HURRICANE_DISK_RADIUS_M : 0;
  const simulationDateUtc = playbackTrack[Math.min(stormLegIndex, Math.max(0, playbackTrack.length - 1))]?.date_utc;

  const facilityRiskSnapshots = useMemo(
    () =>
      computeFacilityRiskSnapshots(
        facilities,
        live,
        impactCenter,
        impactRadiusM,
        Boolean(showHurricaneTrack && impactCenter != null && impactRadiusM > 0),
        hazardToggles,
        hazardMap,
      ),
    [facilities, live, impactCenter, impactRadiusM, showHurricaneTrack, hazardToggles, hazardMap],
  );

  const facilityRiskByKey = useMemo(() => {
    const m = new Map<string, FacilityRiskSnapshot>();
    for (const s of facilityRiskSnapshots) {
      m.set(s.facilityKey, s);
    }
    return m;
  }, [facilityRiskSnapshots]);

  const whyGrouped = useMemo(() => {
    type WhyLocationBlock = { facilityKey: string; facilityName: string; ticker: string; slots: WhyMispricingSlot[] };
    type WhyGroupedSection =
      | { kind: "policy"; locations: WhyLocationBlock[] }
      | { kind: "company"; ticker: string; displayName: string; locations: WhyLocationBlock[] };

    if (!live) {
      return [] as WhyGroupedSection[];
    }
    const rows = mispricingScenarioBlock?.rows ?? [];
    const hurricaneOn = Boolean(showHurricaneTrack && impactCenter != null && impactRadiusM > 0);

    const blockForSnap = (snap: FacilityRiskSnapshot): WhyLocationBlock => {
      const ticker = snap.facility.ticker;
      const row = mispricingRowForFacilityTicker(rows, ticker);
      const tradeSymbol = row?.symbol ?? ticker;
      const pos = positionQuoteBySymbol.get(tradeSymbol);
      const session = pos?.quote.change_pct_1d;
      return {
        facilityKey: snap.facilityKey,
        facilityName: snap.facility.facility_name,
        ticker,
        slots: buildWhySlotsForFacility({ snap, row, tradeSymbol, session, hurricaneOn }),
      };
    };

    const out: WhyGroupedSection[] = [];
    const policySnaps = facilityRiskSnapshots.filter((s) => isPolicyFacility(s.facility));
    if (policySnaps.length > 0) {
      out.push({
        kind: "policy",
        locations: [...policySnaps]
          .sort((a, b) => a.facility.facility_name.localeCompare(b.facility.facility_name))
          .map(blockForSnap),
      });
    }

    const companySnaps = facilityRiskSnapshots.filter((s) => !isPolicyFacility(s.facility));
    const byTicker = new Map<string, FacilityRiskSnapshot[]>();
    for (const s of companySnaps) {
      const t = s.facility.ticker.toUpperCase();
      if (!byTicker.has(t)) {
        byTicker.set(t, []);
      }
      byTicker.get(t)!.push(s);
    }
    for (const [ticker, snaps] of [...byTicker.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const displayName = live.portfolio.positions.find((p) => p.symbol === ticker)?.name ?? ticker;
      const sorted = [...snaps].sort((a, b) => a.facility.facility_name.localeCompare(b.facility.facility_name));
      out.push({ kind: "company", ticker, displayName, locations: sorted.map(blockForSnap) });
    }
    return out;
  }, [
    live,
    mispricingScenarioBlock,
    facilityRiskSnapshots,
    positionQuoteBySymbol,
    showHurricaneTrack,
    impactCenter,
    impactRadiusM,
  ]);

  const liveStormBridge = useMemo(
    () =>
      computeLiveStormBridge(
        live,
        mispricingScenarioBlock,
        positionQuoteBySymbol,
        facilities,
        impactCenter,
        impactRadiusM,
        impactPhase01,
        showHurricaneTrack,
      ),
    [
      live,
      mispricingScenarioBlock,
      positionQuoteBySymbol,
      facilities,
      impactCenter,
      impactRadiusM,
      impactPhase01,
      showHurricaneTrack,
    ],
  );

  const mispricingRowsByAssetClass = useMemo(() => {
    if (!mispricingScenarioBlock?.rows?.length) {
      return [] as { assetClass: string; rows: MispricingRow[] }[];
    }
    const m = new Map<string, MispricingRow[]>();
    for (const r of mispricingScenarioBlock.rows) {
      const k = (r.asset_class ?? "").trim() || "Other";
      if (!m.has(k)) {
        m.set(k, []);
      }
      m.get(k)!.push(r);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        const ca = Math.round(
          footprintPctForMispricingRow(a.symbol, facilities, impactCenter, impactRadiusM, showHurricaneTrack) * 100,
        );
        const cb = Math.round(
          footprintPctForMispricingRow(b.symbol, facilities, impactCenter, impactRadiusM, showHurricaneTrack) * 100,
        );
        if (cb !== ca) {
          return cb - ca;
        }
        return Math.abs(b.gap_pct ?? 0) - Math.abs(a.gap_pct ?? 0);
      });
    }
    return [...m.entries()]
      .map(([assetClass, rows]) => ({ assetClass, rows }))
      .sort((a, b) => a.assetClass.localeCompare(b.assetClass));
  }, [mispricingScenarioBlock, facilities, impactCenter, impactRadiusM, showHurricaneTrack]);

  const holdingsByAssetClass = useMemo(() => {
    if (!live?.portfolio.positions.length) {
      return [] as { assetClass: string; positions: PortfolioPosition[] }[];
    }
    const m = new Map<string, PortfolioPosition[]>();
    for (const p of live.portfolio.positions) {
      const k = (p.asset_class ?? "").trim() || "Other";
      if (!m.has(k)) {
        m.set(k, []);
      }
      m.get(k)!.push(p);
    }
    for (const list of m.values()) {
      list.sort((a, b) => b.notional_musd - a.notional_musd);
    }
    return [...m.entries()]
      .map(([assetClass, positions]) => ({ assetClass, positions }))
      .sort((a, b) => a.assetClass.localeCompare(b.assetClass));
  }, [live]);

  type RecCard = { id: string; title: string; body: string; accent: "amber" | "teal" | "violet" | "slate" };

  const recommendationIntel = useMemo(() => {
    if (!live) {
      return { summaryLine: "", cards: [] as RecCard[] };
    }
    const rows = mispricingScenarioBlock?.rows ?? [];
    const stormOn = showHurricaneTrack && liveStormBridge.stormActive;

    const squeezeRow =
      rows.find((r) => r.symbol === "NG=F" && r.gap_pct != null) ??
      [...rows]
        .filter((r) => r.direction.toLowerCase() === "short" && r.signal === "risk_underpriced" && r.gap_pct != null)
        .sort((a, b) => Math.abs(b.gap_pct ?? 0) - Math.abs(a.gap_pct ?? 0))[0] ??
      worstGapRow ??
      [...rows].sort((a, b) => Math.abs(b.gap_pct ?? 0) - Math.abs(a.gap_pct ?? 0))[0] ??
      null;

    const conePctSqueeze =
      squeezeRow != null
        ? Math.round(
            footprintPctForMispricingRow(squeezeRow.symbol, facilities, impactCenter, impactRadiusM, showHurricaneTrack) * 100,
          )
        : 0;
    const squeezeIdea = squeezeRow ? tradeIdeaForRow(squeezeRow, conePctSqueeze) : null;

    const clfRow = rows.find((r) => r.symbol === "CL=F");
    const clfBody =
      clfRow != null ? clfTapeModelDivergenceBody(clfRow, positionQuoteBySymbol, impactPhase01, stormOn) : null;

    const hot = [...facilityRiskSnapshots].sort((a, b) => Math.abs(b.expectedLossMusd) - Math.abs(a.expectedLossMusd))[0];

    let slot4Body = "Map facilities and book lines to rank hazard concentration.";
    let slot4Title = "Highest Hazard Concentration";
    if (hot) {
      const tk = hot.facility.ticker.toUpperCase();
      slot4Title = `Highest Hazard Concentration — ${tk}`;
      const posHot = positionQuoteBySymbol.get(hot.facility.ticker);
      const hurP = Math.round(hot.hurricaneProximity01 * 100);
      const wfP = Math.round((hot.hazardStressById.wildfire ?? 0) * 100);
      const blendP = Math.round(hot.blend01 * 100);
      const refSlice =
        posHot != null ? INSTITUTIONAL_REFERENCE_NOTIONAL_MUSD * hot.facility.asset_value_pct : 0;
      const elRef =
        posHot != null ? facilityExpectedLossFromBlend(refSlice, hot.blend01, posHot) : 0;
      const bookNote =
        live.portfolio.total_notional_musd > 0
          ? `Gross book notional here is ${formatMoneyM(live.portfolio.total_notional_musd)}. `
          : "";
      slot4Body = `${hot.facility.facility_name} carries ${hurP}% hurricane field exposure and ${wfP}% wildfire intensity — highest blended hazard in the mapped book at ${blendP}%. Expected loss on this slice is ${formatLossMagnitudeMusd(hot.expectedLossMusd)}. ${bookNote}At $${INSTITUTIONAL_REFERENCE_NOTIONAL_MUSD}M ${tk} notional this site alone implies ~${formatLossMagnitudeMusd(Math.abs(elRef))} single-event loss before hedges.`;
    }

    const e1 = stormOn && liveStormBridge.sitesInDisk > 0;
    const e2 = squeezeRow?.gap_pct != null && Math.abs(squeezeRow.gap_pct) >= REC_SIGNAL_THRESHOLD_PP;
    const e3 = (() => {
      if (!clfRow) {
        return false;
      }
      const p = positionQuoteBySymbol.get("CL=F");
      const session = p?.quote.change_pct_1d;
      if (session == null || Number.isNaN(session)) {
        return false;
      }
      const predicted = stormOn
        ? livePredictedPositionReturnPct(clfRow.risk_score_0_100, clfRow.direction, impactPhase01)
        : clfRow.predicted_position_return_pct;
      if (Number.isNaN(predicted)) {
        return false;
      }
      return Math.abs(session - predicted) >= REC_SIGNAL_THRESHOLD_PP;
    })();
    const e4 = hot != null && hot.blend01 >= 0.12;
    const elevatedCount = [e1, e2, e3, e4].filter(Boolean).length;

    type UItem = { text: string; score: number };
    const urgencies: UItem[] = [];
    if (clfRow && e3) {
      const p = positionQuoteBySymbol.get("CL=F");
      const session = p?.quote.change_pct_1d;
      if (session != null && !Number.isNaN(session)) {
        const predicted = stormOn
          ? livePredictedPositionReturnPct(clfRow.risk_score_0_100, clfRow.direction, impactPhase01)
          : clfRow.predicted_position_return_pct;
        if (!Number.isNaN(predicted)) {
          const div = session - predicted;
          urgencies.push({ text: `CL=F divergence (${div.toFixed(1)}%)`, score: Math.abs(div) });
        }
      }
    }
    if (squeezeRow?.gap_pct != null && e2) {
      urgencies.push({
        text: `${squeezeRow.symbol} squeeze risk (gap ${formatPct1d(squeezeRow.gap_pct)})`,
        score: Math.abs(squeezeRow.gap_pct),
      });
    }
    urgencies.sort((a, b) => b.score - a.score);
    const topU = urgencies.slice(0, 2);
    const summaryLine =
      elevatedCount === 0
        ? "No elevated signals across the four lenses."
        : topU.length === 0
          ? `${elevatedCount} of 4 signals elevated.`
          : `${elevatedCount} of 4 signals elevated · Highest urgency: ${topU.map((u) => u.text).join(" and ")}`;

    const slot1Body = stormOn
      ? `${liveStormBridge.sitesInDisk} facilities inside cone · ${liveStormBridge.topGulfSymbol} ${liveStormBridge.topGulfPct}% of weighted Gulf book exposed · Storm overlay ${formatMoneyM(liveStormBridge.stormOverlayMusd)}. Pulse at ${liveStormBridge.phasePct}% — peak impact window.`
      : `Storm layer off — toggle Animate storm track to size cone exposure, Gulf footprint, and pulse-scaled overlay on the book.`;

    const slot2Body =
      squeezeRow && squeezeRow.gap_pct != null
        ? mispricingGapEvidenceBody(squeezeRow)
        : "No mispricing row with a usable gap in this sleeve.";

    const slot3Body =
      clfBody ??
      (clfRow
        ? "CL=F session or model leg missing — check the live quote and scenario table."
        : "No CL=F row in the mispricing sleeve.");

    const cards: RecCard[] = [
      {
        id: "rec-storm",
        title: "Storm Exposure Summary",
        accent: stormOn ? "amber" : "slate",
        body: slot1Body,
      },
      {
        id: "rec-gap",
        title: squeezeIdea?.title ?? "Scenario vs tape",
        accent: "violet",
        body: slot2Body,
      },
      {
        id: "rec-live",
        title: "Tape vs Model Divergence — CL=F",
        accent: "teal",
        body: slot3Body,
      },
      {
        id: "rec-hot",
        title: slot4Title,
        accent: "slate",
        body: slot4Body,
      },
    ];

    return { summaryLine, cards };
  }, [
    live,
    showHurricaneTrack,
    liveStormBridge.stormActive,
    liveStormBridge.sitesInDisk,
    liveStormBridge.stormOverlayMusd,
    liveStormBridge.phasePct,
    liveStormBridge.topGulfSymbol,
    liveStormBridge.topGulfPct,
    mispricingScenarioBlock,
    worstGapRow,
    facilities,
    impactCenter,
    impactRadiusM,
    facilityRiskSnapshots,
    positionQuoteBySymbol,
    impactPhase01,
  ]);

  const holdingPosition = useMemo(() => {
    if (!live || !holdingDialogSymbol) {
      return null;
    }
    return live.portfolio.positions.find((p) => p.symbol === holdingDialogSymbol) ?? null;
  }, [live, holdingDialogSymbol]);

  const positionByTicker = useCallback(
    (ticker: string): PortfolioPosition | undefined => live?.portfolio.positions.find((p) => p.symbol === ticker),
    [live],
  );

  const holdingDialogBrief = useMemo(() => {
    if (!holdingPosition || !live) {
      return [] as string[];
    }
    const out: string[] = [];
    if (holdingPosition.estimated_pnl_1d_musd != null) {
      out.push(`Rough 1d P&L on this line: ${formatMoneyM(holdingPosition.estimated_pnl_1d_musd)} (demo).`);
    }
    const mp = mispricingScenarioBlock?.rows.find((r) => r.symbol === holdingPosition.symbol);
    if (mp?.gap_pct != null) {
      out.push(`${mispricingSignalLabel(mp.signal)} — gap ${formatPct1d(mp.gap_pct)} vs the scenario window.`);
    }
    if (showHurricaneTrack && impactCenter && EQUITY_TICKERS.has(holdingPosition.symbol.toUpperCase())) {
      const fp = Math.round(stormFootprintForPosition(holdingPosition, facilities, impactCenter, impactRadiusM) * 100);
      if (fp > 0) {
        out.push(`Mapped footprint in the storm disk: ~${fp}% of this line.`);
      }
    }
    return out.slice(0, 4);
  }, [
    holdingPosition,
    live,
    mispricingScenarioBlock,
    showHurricaneTrack,
    impactCenter,
    impactRadiusM,
    facilities,
  ]);

  const enableAllHazards = () => {
    const next = { ...hazardToggles };
    (Object.keys(next) as HazardId[]).forEach((k) => {
      next[k] = true;
    });
    setHazardToggles(next);
  };

  const deselectAllHazards = () => {
    const next = { ...hazardToggles };
    (Object.keys(next) as HazardId[]).forEach((k) => {
      next[k] = false;
    });
    setHazardToggles(next);
  };

  const totalChangeDisplay =
    viewMode === "predictive" && predictiveBlock
      ? formatMoneyM(predictiveBlock.portfolio_pnl_musd)
      : live
        ? formatMoneyM(live.portfolio.live_pnl_1d_musd)
        : "—";

  const totalChangeLabel = viewMode === "predictive" ? "Portfolio book Δ (scenario ±7d)" : "Portfolio book Δ (live 1d)";

  const facilityPosition = facilityDialog ? positionByTicker(facilityDialog.ticker) : undefined;

  const facilityMpRowForDialog = useMemo(() => {
    if (!facilityDialog || !mispricingScenarioBlock) {
      return null;
    }
    const u = facilityDialog.ticker.toUpperCase();
    return mispricingScenarioBlock.rows.find((r) => r.symbol.toUpperCase() === u) ?? null;
  }, [facilityDialog, mispricingScenarioBlock]);

  const holdingMpRowForDialog = useMemo(() => {
    if (!holdingPosition || !mispricingScenarioBlock) {
      return null;
    }
    return mispricingScenarioBlock.rows.find((r) => r.symbol === holdingPosition.symbol) ?? null;
  }, [holdingPosition, mispricingScenarioBlock]);

  const facilityTickerConePct = useMemo(() => {
    if (!facilityDialog) {
      return 0;
    }
    return Math.round(
      footprintPctForMispricingRow(facilityDialog.ticker, facilities, impactCenter, impactRadiusM, showHurricaneTrack) * 100,
    );
  }, [facilityDialog, facilities, impactCenter, impactRadiusM, showHurricaneTrack]);

  const facilityDialogTradeIdea = useMemo(() => {
    if (!facilityMpRowForDialog) {
      return null;
    }
    return tradeIdeaForRow(facilityMpRowForDialog, facilityTickerConePct);
  }, [facilityMpRowForDialog, facilityTickerConePct]);

  const facilityDialogFacts = useMemo(() => {
    if (!facilityDialog || !live) {
      return [] as { label: string; value: string }[];
    }
    const snap = facilityRiskByKey.get(facilityDiskKey(facilityDialog));
    const inDisk =
      showHurricaneTrack && impactCenter
        ? distanceMeters([facilityDialog.lat, facilityDialog.lng], impactCenter) <= impactRadiusM
        : false;
    const distKm =
      showHurricaneTrack && impactCenter
        ? `${(distanceMeters([facilityDialog.lat, facilityDialog.lng], impactCenter) / 1000).toFixed(0)} km`
        : "—";
    const facts: { label: string; value: string }[] = [
      {
        label: "Expected loss",
        value: snap ? formatLossMagnitudeMusd(snap.expectedLossMusd) : "—",
      },
      { label: "Blended hazard intensity", value: snap ? `${(snap.blend01 * 100).toFixed(0)}%` : "—" },
      {
        label: "Hazard mix",
        value: snap?.breakdownParts.length ? snap.breakdownParts.slice(0, 4).join(" · ") : "—",
      },
      { label: "Weight in ticker mix", value: `${(facilityDialog.asset_value_pct * 100).toFixed(0)}%` },
      {
        label: "Inside storm disk",
        value: inDisk ? "Yes" : showHurricaneTrack ? "No" : "Layer off",
      },
      { label: "Distance to replay eye", value: distKm },
    ];
    const near = nearestItems(facilityDialog.lat, facilityDialog.lng, filteredEonet, (e) => [e.lat, e.lng], 1);
    if (near.length > 0) {
      facts.push({
        label: "Nearest hazard (feed)",
        value: `${near[0].km.toFixed(0)} km`,
      });
    }
    return facts;
  }, [facilityDialog, live, facilityRiskByKey, showHurricaneTrack, impactCenter, impactRadiusM, filteredEonet]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6">
      {loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-200">
          {loadError}
          <button type="button" className="mt-3 block text-amber-300 underline" onClick={() => void loadData()}>
            Retry
          </button>
        </div>
      ) : null}

      {live && live.errors.length > 0 && !partialDataDismissed ? (
        <div className="sticky top-0 z-50 flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-950/85 px-3 py-2 text-xs text-amber-50 shadow-lg backdrop-blur-md">
          <p className="min-w-0 flex-1 leading-snug">
            <span className="font-semibold text-amber-200">Partial data · </span>
            {live.errors.join(" · ")}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-md border border-amber-400/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200 hover:bg-amber-500/15"
            onClick={() => setPartialDataDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-amber-400/25 bg-gradient-to-br from-amber-500/10 to-transparent p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/70">{totalChangeLabel}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{totalChangeDisplay}</p>
          <p className="mt-1 text-xs text-white/45">{live ? `Marks as of ${live.as_of_utc}` : "Loading…"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/45 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Gross notional</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {live ? formatMoneyM(live.portfolio.total_notional_musd) : "—"}
          </p>
          <p className="mt-1 text-xs text-white/50">{live?.portfolio.label ?? ""}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/45 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Lens</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setViewMode("live")}
              className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium ${
                viewMode === "live"
                  ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                  : "border-white/10 bg-white/5 text-white/55"
              }`}
            >
              Live
            </button>
            <button
              type="button"
              onClick={() => setViewMode("predictive")}
              className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium ${
                viewMode === "predictive"
                  ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                  : "border-white/10 bg-white/5 text-white/55"
              }`}
            >
              Predictive
            </button>
          </div>
          {viewMode === "predictive" ? (
            <select
              value={selectedScenarioId}
              onChange={(e) => setSelectedScenarioId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white outline-none"
            >
              {(live?.historical_scenarios ?? []).map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900">
                  {s.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="rounded-xl border border-white/10 bg-black/45 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Hurricane (NOAA)</p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-400"
              checked={showHurricaneTrack}
              onChange={() => setShowHurricaneTrack((v) => !v)}
            />
            Animate storm track
          </label>
          <select
            value={selectedStormId}
            onChange={(e) => setSelectedStormId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white outline-none"
            disabled={!live?.hurricanes.storms.length}
          >
            {(live?.hurricanes.storms ?? []).map((s) => (
              <option key={s.id} value={s.id} className="bg-slate-900">
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-1.5 shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-teal-200/75">WHERE</p>
        <div className="relative min-h-[min(72vh,820px)] flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-wrap items-start justify-between gap-2 p-3">
          <div className="max-w-[min(100%,22rem)] rounded-lg border border-white/10 bg-black/65 px-3 py-2 text-left text-xs text-white/80 backdrop-blur-md">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">Live link</span>
            <span className="mt-1 block leading-snug">
              Disk {liveStormBridge.stormActive ? `${liveStormBridge.radiusKm} km` : "off"} · pulse {liveStormBridge.phasePct}% ·{" "}
              {liveStormBridge.sitesInDisk} sites · top overlap {liveStormBridge.topConeSymbol} {liveStormBridge.topConePct}% ·
              overlay {formatMoneyM(liveStormBridge.stormOverlayMusd)}
            </span>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/65 px-3 py-2 text-right text-xs text-white/80 backdrop-blur-md">
            <span className="block text-[10px] uppercase tracking-wider text-white/40">Feed timestamp</span>
            {live ? new Date(live.as_of_utc).toLocaleString() : "—"}
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-24 left-2 z-[600] flex max-h-[min(42vh,320px)] w-[min(220px,calc(100%-1rem))] flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/75 p-2.5 text-xs text-white/90 shadow-lg backdrop-blur-md sm:left-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/70">Layers</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={enableAllHazards}
              className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] text-white hover:bg-white/15"
            >
              All
            </button>
            <button
              type="button"
              onClick={deselectAllHazards}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/80 hover:bg-white/10"
            >
              None
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {HAZARDS.map((h) => (
              <label
                key={h.id}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 transition hover:bg-white/10"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 accent-amber-400"
                  checked={hazardToggles[h.id]}
                  onChange={() => setHazardToggles((prev) => ({ ...prev, [h.id]: !prev[h.id] }))}
                />
                <span className="leading-tight">
                  {h.icon} <span className="text-[11px]">{h.label}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] flex justify-center p-3">
          <div className="rounded-lg border border-amber-400/25 bg-black/75 px-4 py-2 text-center text-xs text-amber-50 backdrop-blur-md">
            {showHurricaneTrack && simulationDateUtc ? (
              <>
                <span className="font-semibold text-amber-200">HURDAT simulation date · </span>
                {simulationDateUtc}
              </>
            ) : (
              <span className="text-white/50">Hurricane layer off — no storm date on map</span>
            )}
          </div>
        </div>

        <MapContainer
          center={MAP_CENTER}
          zoom={INITIAL_ZOOM}
          scrollWheelZoom
          className="h-full min-h-[min(72vh,820px)] w-full"
          zoomControl={false}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {showHurricaneTrack && fullTrackLatLngs.length > 1 ? (
            <LayerGroup>
              <Polyline
                positions={fullTrackLatLngs}
                pathOptions={{
                  color: "#f97316",
                  weight: 2,
                  opacity: 0.2,
                  dashArray: "8 10",
                  interactive: false,
                }}
              />
              <Polyline
                positions={playbackLatLngs.slice(0, stormLegIndex + 1)}
                pathOptions={{
                  color: "#fbbf24",
                  weight: 3,
                  opacity: 0.95,
                  interactive: false,
                }}
              />
            </LayerGroup>
          ) : null}

          {showHurricaneTrack && impactCenter ? (
            <LayerGroup>
              <Circle
                center={impactCenter}
                radius={impactRadiusM}
                pathOptions={{
                  color: "#fb7185",
                  fillColor: "#ef4444",
                  fillOpacity: HURRICANE_DISK_FILL_OPACITY,
                  weight: 2,
                  dashArray: "6 8",
                  interactive: false,
                }}
              />
              <Marker position={impactCenter} icon={stormEyeIcon()} interactive={false} />
            </LayerGroup>
          ) : null}

          <Pane name="heatmap-eonet" style={{ zIndex: 430 }}>
            <LayerGroup>
              {filteredEonet.map((ev) => (
                <CircleMarker
                  key={`${ev.id}-${ev.eonet_category}`}
                  center={[ev.lat, ev.lng]}
                  radius={EONET_MARKER_RADIUS_PX}
                  pathOptions={{
                    color: "#ffffff",
                    weight: 2,
                    fillColor: HAZARDS.find((h) => hazardMap[h.id] === ev.eonet_category)?.color ?? "#94a3b8",
                    fillOpacity: 0.9,
                  }}
                >
                  <Popup>
                    <div className="max-w-xs text-slate-900">
                      <p className="font-semibold">{ev.title}</p>
                      <p className="text-xs">{ev.eonet_category}</p>
                      {ev.date ? <p className="text-xs opacity-70">{ev.date}</p> : null}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          </Pane>

          <Pane name="heatmap-facility-gfx" style={{ zIndex: 710 }}>
            {facilities.map((f) => {
              const snap = facilityRiskByKey.get(facilityDiskKey(f));
              const blend = snap?.blend01 ?? 0;
              return (
                <Marker
                  key={`gfx-${f.ticker}-${f.facility_name}`}
                  position={[f.lat, f.lng]}
                  icon={facilityLeafletIcon(f.ticker, f.facility_name, blend)}
                  interactive={false}
                />
              );
            })}
          </Pane>

          <Pane name="heatmap-facility-hit" style={{ zIndex: 760 }}>
            {facilities.map((f) => {
              const snap = facilityRiskByKey.get(facilityDiskKey(f));
              const blend = snap?.blend01 ?? 0;
              const fp =
                showHurricaneTrack && impactCenter
                  ? weightedFootprintInImpactZone(f.ticker, facilities, impactCenter, impactRadiusM)
                  : 0;
              const openFacility = (): void => {
                setFacilityDialog(f);
              };
              return (
                <CircleMarker
                  key={`hit-${f.ticker}-${f.facility_name}`}
                  center={[f.lat, f.lng]}
                  radius={32}
                  pathOptions={{
                    weight: 0,
                    opacity: 0,
                    fillColor: "#ffffff",
                    fillOpacity: 0.015,
                  }}
                  eventHandlers={{
                    click: openFacility,
                  }}
                >
                  <Popup className="clima-risk-popup">
                    <div className="min-w-[200px] space-y-3 text-white">
                      <div>
                        <p className="text-lg font-bold tracking-tight">{f.ticker}</p>
                        <p className="text-sm text-white/80">{f.facility_name}</p>
                      </div>
                      <dl className="space-y-1.5 text-xs">
                        <div className="flex justify-between gap-3">
                          <dt className="text-white/45">Blended hazard</dt>
                          <dd className="font-mono text-white/90">{(blend * 100).toFixed(0)}%</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-white/45">Expected loss</dt>
                          <dd className={`font-mono ${pnlToneClass(snap?.expectedLossMusd ?? 0)}`}>
                            {snap ? formatLossMagnitudeMusd(snap.expectedLossMusd) : "—"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-white/45">Storm footprint</dt>
                          <dd className="font-mono text-white/90">
                            {showHurricaneTrack && impactCenter ? `${Math.round(fp * 100)}%` : "—"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-white/45">Site weight</dt>
                          <dd className="font-mono text-white/90">{(f.asset_value_pct * 100).toFixed(0)}%</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className="w-full rounded-lg bg-amber-500/25 px-2 py-2 text-sm font-medium text-amber-50 hover:bg-amber-500/35"
                        onClick={openFacility}
                      >
                        Open summary
                      </button>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </Pane>
        </MapContainer>
        </div>
      </div>

      {live?.mispricing_detector && mispricingScenarioBlock ? (
        <div className="shrink-0 rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-950/35 to-black/50 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
            WHAT — What is the financial impact?
          </p>
          <p className="mt-1 text-[11px] leading-snug text-white/45">
            Scenario model vs what markets did today. Rows are grouped by sleeve; within each group, higher storm overlap is listed first.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300/90">Market Pricing Gap</p>
              <p className="mt-1 text-base font-semibold text-white">Where the market is getting it wrong, right now</p>
            </div>
            <div className="flex shrink-0 flex-col gap-1 sm:items-end">
              <label htmlFor="mispricing-scenario" className="text-[10px] uppercase tracking-wider text-white/40">
                Scenario
              </label>
              <select
                id="mispricing-scenario"
                value={selectedScenarioId}
                onChange={(e) => setSelectedScenarioId(e.target.value)}
                className="w-full min-w-[200px] rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs text-white outline-none sm:w-auto"
              >
                {(live.historical_scenarios ?? []).map((s) => (
                  <option key={s.id} value={s.id} className="bg-slate-900">
                    {s.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-violet-200/60">
                Replay window:{" "}
                {selectedScenarioId === "carbon_tax_100"
                  ? "hardcoded policy shock (demo)"
                  : `${live.mispricing_detector.event_window} (yfinance)`}
              </p>
            </div>
          </div>
          {worstGapRow && worstGapRow.gap_pct != null ? (
            <p className="mt-4 text-sm font-semibold leading-snug text-white">
              {selectedScenarioId === "carbon_tax_100"
                ? mispricingScenarioBlock.label
                : (selectedStorm?.name ?? mispricingScenarioBlock.label)}{" "}
              replay: model predicted {worstGapRow.symbol} would move{" "}
              {formatPct1d(worstGapRow.predicted_position_return_pct)} — market moved{" "}
              {formatPct1d(worstGapRow.actual_position_return_pct)}. Gap = {formatPct1d(worstGapRow.gap_pct)} (
              {mispricingSignalLabel(worstGapRow.signal)}).
            </p>
          ) : null}
          {liveStormBridge.worstLiveAlpha ? (
            <p className="mt-2 text-xs font-medium leading-snug text-amber-200/95">
              Biggest session vs model skew: {liveStormBridge.worstLiveAlpha.symbol} — today{" "}
              {formatPct1d(liveStormBridge.worstLiveAlpha.session)} vs channel {formatPct1d(liveStormBridge.worstLiveAlpha.predicted)} (
              {formatPct1d(liveStormBridge.worstLiveAlpha.liveAlpha)}).
            </p>
          ) : null}
          <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[1040px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-black/40 text-[10px] uppercase tracking-wider text-white/45">
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Sleeve</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2 text-right">Scenario model</th>
                  <th className="px-3 py-2 text-right">Storm overlap</th>
                  <th className="px-3 py-2 text-right">Market (window)</th>
                  <th className="px-3 py-2 text-right">Today vs channel</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                  <th className="px-3 py-2">Signal</th>
                  <th className="px-3 py-2 text-right">Climate β</th>
                </tr>
              </thead>
              <tbody>
                {mispricingRowsByAssetClass.map(({ assetClass, rows: groupRows }) => (
                  <Fragment key={assetClass}>
                    <tr className="bg-white/[0.06]">
                      <td colSpan={10} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-violet-200/85">
                        {assetClass}
                      </td>
                    </tr>
                    {groupRows.map((row) => {
                      const posQ = positionQuoteBySymbol.get(row.symbol);
                      const liveCh = posQ?.quote.change_pct_1d;
                      const livePredNow = liveStormBridge.stormActive
                        ? livePredictedPositionReturnPct(row.risk_score_0_100, row.direction, impactPhase01)
                        : null;
                      const liveAlpha =
                        liveCh == null || Number.isNaN(liveCh) || livePredNow == null
                          ? null
                          : livePredNow - liveCh;
                      const liveAlphaStrong = liveAlpha != null && Math.abs(liveAlpha) > LIVE_ALPHA_HIGHLIGHT_PP;
                      const conePct = Math.round(
                        footprintPctForMispricingRow(row.symbol, facilities, impactCenter, impactRadiusM, showHurricaneTrack) * 100,
                      );
                      const coneStrong = liveStormBridge.stormActive && conePct >= 35;
                      return (
                        <tr key={row.symbol} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-3 py-2 font-semibold text-white">{row.symbol}</td>
                          <td className="px-3 py-2 text-white/55">{row.asset_class}</td>
                          <td className="px-3 py-2 text-white/55">{row.direction}</td>
                          <td className={`px-3 py-2 text-right font-mono ${pnlToneClass(row.predicted_position_return_pct)}`}>
                            {formatPct1d(row.predicted_position_return_pct)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              !liveStormBridge.stormActive ? "text-white/40" : coneStrong ? "font-semibold text-rose-200" : "text-white/75"
                            }`}
                          >
                            {!liveStormBridge.stormActive ? "—" : `${conePct}%`}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              row.actual_position_return_pct == null ? "text-white/40" : pnlToneClass(row.actual_position_return_pct)
                            }`}
                          >
                            {formatPct1d(row.actual_position_return_pct)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              liveAlpha == null ? "text-white/40" : liveAlphaStrong ? "font-semibold text-amber-300" : pnlToneClass(liveAlpha)
                            }`}
                          >
                            {liveAlpha == null ? "—" : formatPct1d(liveAlpha)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              row.gap_pct == null ? "text-white/40" : pnlToneClass(row.gap_pct)
                            }`}
                          >
                            {row.gap_pct == null ? "—" : formatPct1d(row.gap_pct)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium ${mispricingSignalClass(row.signal)}`}
                            >
                              {mispricingSignalLabel(row.signal)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-white/80">{row.risk_score_0_100}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {live ? (
        <div className="shrink-0 space-y-3">
          <div className="rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-950/40 to-black/50 p-4 backdrop-blur-md">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-teal-200/80">WHY</p>
            <div className="mt-3 max-h-[min(56vh,40rem)] space-y-8 overflow-y-auto overflow-x-hidden pr-1">
              {whyGrouped.length === 0 ? (
                <p className="text-xs text-white/70">Load live data and facilities to populate model–market narratives by site.</p>
              ) : (
                whyGrouped.map((section) =>
                  section.kind === "policy" ? (
                    <section key="why-policy">
                      <p className="text-xs font-semibold uppercase tracking-wider text-teal-100/90">Policy lines</p>
                      <div className="mt-3 space-y-6">
                        {section.locations.map((loc) => (
                          <div key={loc.facilityKey}>
                            <p className="text-sm font-semibold text-teal-100">{loc.facilityName}</p>
                            <p className="text-[11px] font-mono text-teal-200/75">{loc.ticker}</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {loc.slots.map((slot) => (
                                <div key={slot.id} className="rounded-lg border border-teal-500/20 bg-black/45 p-3 text-left">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-100/90">{slot.title}</p>
                                  <p className="mt-2 text-xs leading-relaxed text-white/88">{slot.body}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : (
                    <section key={`why-co-${section.ticker}`}>
                      <p className="text-sm font-semibold text-white">
                        {section.displayName}{" "}
                        <span className="font-mono text-xs font-normal text-teal-200/80">({section.ticker})</span>
                      </p>
                      <div className="mt-4 space-y-6">
                        {section.locations.map((loc) => (
                          <div key={loc.facilityKey}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-teal-100/85">{loc.facilityName}</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {loc.slots.map((slot) => (
                                <div key={slot.id} className="rounded-lg border border-teal-500/20 bg-black/45 p-3 text-left">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-100/90">{slot.title}</p>
                                  <p className="mt-2 text-xs leading-relaxed text-white/88">{slot.body}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ),
                )
              )}
            </div>
          </div>

          {recommendationIntel.cards.length > 0 ? (
            <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-950/35 to-black/40 p-4 backdrop-blur-md">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200/80">Recommendations</p>
              <p className="mt-3 text-sm font-medium leading-snug text-amber-50/95">{recommendationIntel.summaryLine}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {recommendationIntel.cards.map((card) => {
                  const ring =
                    card.accent === "amber"
                      ? "border-amber-400/35 bg-amber-500/10"
                      : card.accent === "teal"
                        ? "border-teal-400/30 bg-teal-500/10"
                        : card.accent === "violet"
                          ? "border-violet-400/35 bg-violet-500/10"
                          : "border-white/15 bg-white/5";
                  return (
                    <div key={card.id} className={`rounded-lg border p-3 text-left ${ring}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-100/85">{card.title}</p>
                      <p className="mt-2 text-xs leading-relaxed text-white/90">{card.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {live ? (
        <div className="shrink-0 rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-950/25 to-black/40 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/80">Book anatomy — hedge fund view</p>
          <p className="mt-1 text-xs text-white/45">
            {viewMode === "live"
              ? "Signed P&L in $M: equities vs commodities; long vs short legs (same net as headline book Δ)."
              : `${predictiveBlock?.label ?? "Scenario"} — sleeve totals from scenario replay (±7d yfinance or hardcoded carbon).`}
          </p>
          {viewMode === "live" ? (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Equity sleeve</p>
                <p className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(sleevePnL(live, "equity"))}`}>
                  {formatMoneyM(sleevePnL(live, "equity"))}
                </p>
                <p className="text-[10px] text-white/35">VLO · NRG · EGP · ALL</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Commodity sleeve</p>
                <p className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(sleevePnL(live, "commodity"))}`}>
                  {formatMoneyM(sleevePnL(live, "commodity"))}
                </p>
                <p className="text-[10px] text-white/35">CL=F · NG=F</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Long legs (net)</p>
                <p
                  className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(live.portfolio.live_pnl_1d_by_side_musd?.long ?? 0)}`}
                >
                  {formatMoneyM(live.portfolio.live_pnl_1d_by_side_musd?.long ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Short legs (net)</p>
                <p
                  className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(live.portfolio.live_pnl_1d_by_side_musd?.short ?? 0)}`}
                >
                  {formatMoneyM(live.portfolio.live_pnl_1d_by_side_musd?.short ?? 0)}
                </p>
              </div>
            </div>
          ) : predictiveBlock ? (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Equity sleeve</p>
                <p
                  className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(predictiveBlock.pnl_by_asset_class_musd?.equity ?? 0)}`}
                >
                  {formatMoneyM(predictiveBlock.pnl_by_asset_class_musd?.equity ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Commodity sleeve</p>
                <p
                  className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(predictiveBlock.pnl_by_asset_class_musd?.commodity ?? 0)}`}
                >
                  {formatMoneyM(predictiveBlock.pnl_by_asset_class_musd?.commodity ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Long legs</p>
                <p
                  className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(predictiveBlock.pnl_by_side_musd?.long ?? 0)}`}
                >
                  {formatMoneyM(predictiveBlock.pnl_by_side_musd?.long ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">Short legs</p>
                <p
                  className={`mt-1 font-mono text-lg font-semibold ${pnlToneClass(predictiveBlock.pnl_by_side_musd?.short ?? 0)}`}
                >
                  {formatMoneyM(predictiveBlock.pnl_by_side_musd?.short ?? 0)}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Holdings</p>
            <p className="mt-0.5 text-[10px] text-white/35">Grouped by sleeve (largest notionals first). Tap a row for a quick read.</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenStressTest()}
            className="text-xs text-amber-200/90 underline-offset-2 hover:underline"
          >
            Full stress test →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/40">
                <th className="px-4 py-2">Symbol</th>
                <th className="px-4 py-2">Side</th>
                <th className="px-4 py-2 text-right">Notional</th>
                <th className="px-4 py-2 text-right">Climate β</th>
                <th className="px-4 py-2 text-right">Storm overlap</th>
                <th className="px-4 py-2 text-right">Today</th>
                <th className="px-4 py-2 text-right">Est $</th>
              </tr>
            </thead>
            <tbody>
              {holdingsByAssetClass.map(({ assetClass, positions }) => (
                <Fragment key={assetClass}>
                  <tr className="bg-white/[0.06]">
                    <td colSpan={7} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-200/75">
                      {assetClass}
                    </td>
                  </tr>
                  {positions.map((p) => {
                    const est = displayLiveEstMusd(
                      p,
                      p.estimated_pnl_1d_musd,
                      facilities,
                      impactCenter,
                      impactRadiusM,
                      impactPhase01,
                      showHurricaneTrack,
                    );
                    const coneLive =
                      liveStormBridge.stormActive && impactCenter != null
                        ? Math.round(stormFootprintForPosition(p, facilities, impactCenter, impactRadiusM) * 100)
                        : null;
                    return (
                      <tr
                        key={p.symbol}
                        className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                        onClick={() => setHoldingDialogSymbol(p.symbol)}
                      >
                        <td className="px-4 py-2.5 font-semibold text-white">{p.symbol}</td>
                        <td className="px-4 py-2.5 text-white/50 capitalize">{p.direction}</td>
                        <td className="px-4 py-2.5 text-right text-white/80">
                          {p.direction === "short" ? "−" : ""}
                          {formatMoneyM(p.notional_musd)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-violet-200/90">{p.risk_score_0_100 ?? "—"}</td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono text-xs ${
                            coneLive == null ? "text-white/40" : coneLive >= 35 ? "font-semibold text-rose-200" : "text-white/70"
                          }`}
                        >
                          {coneLive == null ? "—" : `${coneLive}%`}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono ${
                            p.quote.change_pct_1d == null
                              ? "text-white/40"
                              : p.quote.change_pct_1d >= 0
                                ? "text-emerald-300"
                                : "text-red-300"
                          }`}
                        >
                          {p.quote.change_pct_1d == null ? "—" : `${p.quote.change_pct_1d >= 0 ? "+" : ""}${p.quote.change_pct_1d.toFixed(2)}%`}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium transition-colors duration-150 ${est.tone}`}>{est.text}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={holdingDialogSymbol != null} onOpenChange={(o) => !o && setHoldingDialogSymbol(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[85vh] overflow-y-auto border border-white/10 bg-slate-950 text-white sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold tracking-tight text-white">{holdingPosition?.symbol}</DialogTitle>
            <DialogDescription className="text-sm text-white/60">
              {holdingPosition?.name}
            </DialogDescription>
          </DialogHeader>
          {holdingPosition ? (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">
                <dt className="text-white/45">Side</dt>
                <dd className="text-right font-medium capitalize text-white">{holdingPosition.direction}</dd>
                <dt className="text-white/45">Size</dt>
                <dd className="text-right font-mono text-white">
                  {holdingPosition.direction === "short" ? "−" : ""}
                  {formatMoneyM(holdingPosition.notional_musd)}
                </dd>
                <dt className="text-white/45">Last price</dt>
                <dd className="text-right font-mono text-white">{formatPrice(holdingPosition.quote.price)}</dd>
                <dt className="text-white/45">Today</dt>
                <dd className="text-right font-mono text-white">
                  {holdingPosition.quote.change_pct_1d == null
                    ? "—"
                    : `${holdingPosition.quote.change_pct_1d >= 0 ? "+" : ""}${holdingPosition.quote.change_pct_1d.toFixed(2)}%`}
                </dd>
              </dl>
              {holdingDialogBrief.length > 0 ? (
                <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-white/75">
                  {holdingDialogBrief.map((line, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="text-amber-300/90">·</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 rounded-lg border border-white/10 bg-black/35 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/90">Model vs market</p>
                <PctMoveComparisonChart
                  height={140}
                  rows={[
                    {
                      label: liveStormBridge.stormActive ? "Live channel" : "Scenario model",
                      pct: liveStormBridge.stormActive
                        ? livePredictedPositionReturnPct(
                            holdingPosition.risk_score_0_100,
                            holdingPosition.direction,
                            impactPhase01,
                          )
                        : holdingMpRowForDialog?.predicted_position_return_pct ?? null,
                    },
                    { label: "Replay window", pct: holdingMpRowForDialog?.actual_position_return_pct ?? null },
                    { label: "Today", pct: holdingPosition.quote.change_pct_1d },
                  ]}
                />
                {liveStormBridge.stormActive && impactCenter != null ? (
                  <ConeFillBar
                    label="Footprint in storm disk"
                    pct={Math.round(
                      stormFootprintForPosition(holdingPosition, facilities, impactCenter, impactRadiusM) * 100,
                    )}
                  />
                ) : null}
              </div>
            </>
          ) : null}
          <button
            type="button"
            className="mt-4 w-full rounded-lg border border-amber-400/30 bg-amber-500/10 py-2.5 text-sm font-medium text-amber-100"
            onClick={() => {
              if (holdingPosition) {
                onOpenStressTest(holdingPosition.symbol);
              }
            }}
          >
            Stress test {holdingPosition?.symbol}
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={facilityDialog != null} onOpenChange={(o) => !o && setFacilityDialog(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[85vh] overflow-y-auto border border-white/10 bg-slate-950 text-white sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold tracking-tight text-white">{facilityDialog?.facility_name}</DialogTitle>
            <DialogDescription className="text-sm text-white/60">{facilityDialog?.ticker} · mapped site</DialogDescription>
          </DialogHeader>
          {facilityDialogFacts.length > 0 ? (
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 rounded-lg border border-white/10 bg-black/40 p-3 text-sm">
              {facilityDialogFacts.map((row) => (
                <Fragment key={row.label}>
                  <dt className="text-white/45">{row.label}</dt>
                  <dd className="text-right font-mono text-white/90">{row.value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}
          {facilityPosition ? (
            <p className="mt-3 text-xs text-white/55">
              Book line: last {formatPrice(facilityPosition.quote.price)} · today{" "}
              {facilityPosition.quote.change_pct_1d == null
                ? "—"
                : `${facilityPosition.quote.change_pct_1d >= 0 ? "+" : ""}${facilityPosition.quote.change_pct_1d.toFixed(2)}%`}
            </p>
          ) : null}
          {facilityDialogTradeIdea ? (
            <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/90">Idea (not advice)</p>
              <p className="mt-1 text-sm font-semibold text-amber-50">{facilityDialogTradeIdea.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/85">{facilityDialogTradeIdea.body}</p>
            </div>
          ) : null}
          {facilityPosition || facilityMpRowForDialog ? (
            <div className="mt-4 rounded-lg border border-white/10 bg-black/35 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/90">Model vs market</p>
              <PctMoveComparisonChart
                height={132}
                rows={[
                  {
                    label: liveStormBridge.stormActive && facilityPosition ? "Live channel" : "Scenario model",
                    pct:
                      liveStormBridge.stormActive && facilityPosition
                        ? livePredictedPositionReturnPct(
                            facilityPosition.risk_score_0_100,
                            facilityPosition.direction,
                            impactPhase01,
                          )
                        : facilityMpRowForDialog?.predicted_position_return_pct ?? null,
                  },
                  { label: "Replay window", pct: facilityMpRowForDialog?.actual_position_return_pct ?? null },
                  { label: "Today", pct: facilityPosition?.quote.change_pct_1d ?? null },
                ]}
              />
              {liveStormBridge.stormActive ? (
                <ConeFillBar label="Ticker footprint in storm disk" pct={facilityTickerConePct} />
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-4 w-full rounded-lg border border-amber-400/35 bg-amber-500/15 py-2.5 text-sm font-medium text-amber-50"
            onClick={() => facilityDialog && onOpenStressTest(facilityDialog.ticker)}
          >
            Stress test {facilityDialog?.ticker}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
