import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import L from "leaflet";
import {
  Circle,
  CircleMarker,
  LayerGroup,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMapEvents,
} from "react-leaflet";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const API_BASE = "http://localhost:8000/api";
const HAZARD_EVENT_RADIUS_M = 160_934;
const LIVE_REFRESH_MS = 120_000;
const EONET_MARKER_RADIUS_PX = 10;
const MAX_IMPACT_RADIUS_M = 320_000;
const IMPACT_CYCLE_MS = 1600;
const TICK_INTERVAL_MS = 40;
const ILLUSTRATIVE_STRESS_DAYS = 5;

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
  };
  historical_scenarios: HistoricalScenario[];
  predictive_scenarios: Record<string, PredictiveScenarioBlock>;
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

interface RecCardModel {
  id: string;
  title: string;
  subtitle: string;
  kind: "proactive" | "now";
  fredChartKey?: "wti" | "henry_hub_gas";
  detailBullets: string[];
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

function eonetProximity01(
  lat: number,
  lng: number,
  toggles: Record<HazardId, boolean>,
  hazardMap: Record<string, string>,
  eonetEvents: EonetEvent[],
): number {
  const pos: [number, number] = [lat, lng];
  const cats = activeEonetCategories(toggles, hazardMap);
  let best = 0;
  for (const ev of eonetEvents) {
    if (!cats.has(ev.eonet_category)) {
      continue;
    }
    const d = distanceMeters(pos, [ev.lat, ev.lng]);
    const t = 1 - Math.min(1, d / HAZARD_EVENT_RADIUS_M);
    if (t > best) {
      best = t;
    }
  }
  return best;
}

function facilityIconHtml(
  ticker: string,
  facilityName: string,
  hurricaneFootprint01: number,
  eonetProx01: number,
): string {
  const base = TICKER_COLOR[ticker.toUpperCase()] ?? "#94a3b8";
  const stress = Math.min(1, Math.max(hurricaneFootprint01, eonetProx01 * 0.92));
  const fill = mixToRed(base, stress);
  const short = ticker.toUpperCase();
  const glowPx = 10 + eonetProx01 * 26 + hurricaneFootprint01 * 14;
  const glowAlpha = 0.28 + eonetProx01 * 0.45 + hurricaneFootprint01 * 0.2;
  const glow = `0 0 ${glowPx}px rgba(251,191,36,${glowAlpha})`;
  const border = stress > 0.45 ? "2px solid rgba(254,243,199,0.95)" : "2px solid rgba(255,255,255,0.85)";
  const scale = 1 + Math.min(0.22, stress * 0.28);
  return `<div style="transform:scale(${scale});width:40px;height:40px;border-radius:9999px;border:${border};background:${fill};color:#fff;font:700 11px system-ui;display:flex;align-items:center;justify-content:center;box-shadow:${glow}, 0 0 12px rgba(0,0,0,0.25);" title="${facilityName}">${short}</div>`;
}

function facilityLeafletIcon(
  ticker: string,
  facilityName: string,
  hurricaneFootprint01: number,
  eonetProx01: number,
): L.DivIcon {
  return L.divIcon({
    className: "heatmap-facility-icon",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: facilityIconHtml(ticker, facilityName, hurricaneFootprint01, eonetProx01),
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

function buildHoldingWhyLines(
  p: PortfolioPosition,
  live: LiveHeatmapResponse,
  facilities: FacilityRow[],
  impactCenter: [number, number] | null,
  impactRadiusM: number,
  showHurricane: boolean,
  filteredEonet: EonetEvent[],
): string[] {
  const lines: string[] = [];
  const dir = p.direction.toLowerCase() === "short" ? -1 : 1;
  lines.push(
    `yfinance last ${formatPrice(p.quote.price)} vs prior ${formatPrice(p.quote.previous_close)} → ${p.quote.change_pct_1d == null ? "n/a" : `${p.quote.change_pct_1d >= 0 ? "+" : ""}${p.quote.change_pct_1d.toFixed(2)}%`} (direction ${dir > 0 ? "long" : "short"}, $${p.notional_musd}M notional).`,
  );
  if (p.estimated_pnl_1d_musd != null) {
    lines.push(`Est. 1d book P&L from this line: ${formatMoneyM(p.estimated_pnl_1d_musd)}.`);
  }
  const wtiCh = live.fred.series.wti?.change_pct;
  if (p.symbol === "CL=F" && wtiCh != null && live.fred.series.wti) {
    const w = live.fred.series.wti;
    lines.push(`FRED WTI (${w.fred_id}) ${wtiCh >= 0 ? "+" : ""}${wtiCh.toFixed(2)}% vs prior observation.`);
  }
  const gasCh = live.fred.series.henry_hub_gas?.change_pct;
  if (p.symbol === "NG=F" && gasCh != null && live.fred.series.henry_hub_gas) {
    const g = live.fred.series.henry_hub_gas;
    lines.push(`Henry Hub (${g.fred_id}) ${gasCh >= 0 ? "+" : ""}${gasCh.toFixed(2)}% — short leg loses when gas rallies.`);
  }
  if (EQUITY_TICKERS.has(p.symbol.toUpperCase())) {
    const fp =
      showHurricane && impactCenter
        ? weightedFootprintInImpactZone(p.symbol, facilities, impactCenter, impactRadiusM)
        : 0;
    const facs = facilities.filter((f) => f.ticker.toUpperCase() === p.symbol.toUpperCase());
    lines.push(
      `Footprint: ${facs.length} mapped sites; ${(fp * 100).toFixed(0)}% of ticker asset weights inside the current hurricane impact disk (when layer is on).`,
    );
  }
  const posFac = facilities.find((f) => f.ticker.toUpperCase() === p.symbol.toUpperCase());
  if (posFac) {
    const near = nearestItems(posFac.lat, posFac.lng, filteredEonet, (e) => [e.lat, e.lng], 2);
    if (near.length > 0) {
      lines.push(`Nearest EONET hazard to a site: “${near[0].item.title.slice(0, 56)}…” (~${near[0].km.toFixed(0)} km, ${near[0].item.eonet_category}).`);
    }
  }
  return lines;
}

function FredMiniChart({
  data,
  color,
  name,
}: {
  data: { date: string; value: number }[];
  color: string;
  name: string;
}): ReactElement {
  const chartData = data.slice(-24).map((row) => ({
    t: row.date.slice(5),
    v: row.value,
  }));
  if (chartData.length === 0) {
    return <p className="text-sm text-white/50">No series points.</p>;
  }
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} width={44} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8 }}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Line type="monotone" dataKey="v" name={name} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CreditSpreadBars({ ig, hy }: { ig: number; hy: number }): ReactElement {
  const max = Math.max(ig, hy, 1);
  return (
    <div className="mt-2 space-y-2">
      <div>
        <div className="flex justify-between text-xs text-white/55">
          <span>IG OAS</span>
          <span>{ig.toFixed(1)} bp</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-sky-400/80" style={{ width: `${(ig / max) * 100}%` }} />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs text-white/55">
          <span>HY OAS</span>
          <span>{hy.toFixed(1)} bp</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-rose-400/80" style={{ width: `${(hy / max) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function MapClickHandler({
  onInspect,
}: {
  onInspect: (lat: number, lng: number) => void;
}): null {
  useMapEvents({
    click(e) {
      onInspect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function buildRecCards(
  live: LiveHeatmapResponse | null,
  predictiveBlock: PredictiveScenarioBlock | undefined,
  selectedScenarioId: string,
  showHurricane: boolean,
): { proactive: RecCardModel[]; now: RecCardModel[] } {
  if (!live) {
    return { proactive: [], now: [] };
  }
  const proactive: RecCardModel[] = [];
  if (predictiveBlock) {
    proactive.push({
      id: "scen",
      title: "Scenario replay",
      subtitle: predictiveBlock.label,
      kind: "proactive",
      detailBullets: [
        `Modeled ±7 calendar days around ${predictiveBlock.anchor_date}: total book ≈ ${formatMoneyM(predictiveBlock.portfolio_pnl_musd)}.`,
        `Worst single-name contributors are visible in the holdings table (Predictive lens).`,
        `Use this as a hedge-sizing anchor, not a forecast of tomorrow’s price.`,
      ],
    });
  } else {
    proactive.push({
      id: "scen-pick",
      title: "Pick a stress replay",
      subtitle: "Switch to Predictive lens",
      kind: "proactive",
      detailBullets: [`Choose Harvey, Uri, Ian, or Camp Fire to load historical window returns from yfinance.`],
    });
  }
  const wti = live.fred.series.wti;
  const gas = live.fred.series.henry_hub_gas;
  if (wti && gas && wti.change_pct != null && gas.change_pct != null && Math.abs(wti.change_pct - gas.change_pct) > 1.2) {
    proactive.push({
      id: "div",
      title: "Commodity divergence",
      subtitle: "CL=F vs NG=F hedge check",
      kind: "proactive",
      detailBullets: [
        `WTI moved ${wti.change_pct >= 0 ? "+" : ""}${wti.change_pct.toFixed(2)}% while Henry Hub moved ${gas.change_pct >= 0 ? "+" : ""}${gas.change_pct.toFixed(2)}% vs prior FRED prints.`,
        `If the book was designed for correlated energy shocks, widening spot vs gas cracks can leave one leg under-hedged.`,
        `Consider resizing NG=F short vs CL=F long if this divergence persists several sessions.`,
      ],
    });
  }
  proactive.push({
    id: "eonet-book",
    title: "Hazard density vs book",
    subtitle: "EONET + footprint",
    kind: "proactive",
    detailBullets: [
      `You have ${live.eonet.events.length} mapped EONET events in the loaded window — wildfire/flood clusters near VLO/NRG/EGP/ALL concentrations deserve a quarterly review.`,
      `Enable relevant layers and watch facility halos: stronger glow = closer to active hazard centroids.`,
    ],
  });
  if (selectedScenarioId === "ian_2022" || selectedScenarioId === "harvey_2017") {
    proactive.push({
      id: "storm-season",
      title: "Named storm focus",
      subtitle: "Gulf / Florida",
      kind: "proactive",
      detailBullets: [
        `ALL (cat exposure) and Gulf-heavy sites (VLO, NRG) dominate gap risk around landfall narratives.`,
        `Pair equity gamma with credit: watch HY OAS if guidance cuts follow major events.`,
      ],
    });
  }

  const now: RecCardModel[] = [];
  if (wti?.change_pct != null) {
    now.push({
      id: "wti-now",
      title: "WTI (FRED)",
      subtitle: `${wti.change_pct >= 0 ? "+" : ""}${wti.change_pct.toFixed(2)}% vs prior obs`,
      kind: "now",
      fredChartKey: "wti",
      detailBullets: [
        `Latest FRED observation vs the prior non-null point (not intraday).`,
        `Directly feeds the “why” on CL=F through spot linkage.`,
        `Source: ${wti.source_url}`,
      ],
    });
  }
  if (gas?.change_pct != null) {
    now.push({
      id: "gas-now",
      title: "Henry Hub (FRED)",
      subtitle: `${gas.change_pct >= 0 ? "+" : ""}${gas.change_pct.toFixed(2)}% vs prior obs`,
      kind: "now",
      fredChartKey: "henry_hub_gas",
      detailBullets: [
        `Short NG=F loses when cash gas rips; long utilities can partially offset but beta differs.`,
        `Source: ${gas.source_url}`,
      ],
    });
  }
  const ig = live.fred.series.ig_spread;
  const hy = live.fred.series.hy_spread;
  if (ig?.latest != null && hy?.latest != null) {
    now.push({
      id: "credit-now",
      title: "Credit spreads",
      subtitle: `IG ${ig.latest.toFixed(1)} bp · HY ${hy.latest.toFixed(1)} bp`,
      kind: "now",
      detailBullets: [
        `Option-adjusted spreads from FRED — wider HY often coincides with de-risking in cyclical equities.`,
        `Compare levels day-over-day using the bar view in this card.`,
      ],
    });
  }
  now.push({
    id: "hur-now",
    title: "Hurricane animator",
    subtitle: showHurricane ? "HURDAT2 + pulse on" : "Layer off",
    kind: "now",
    detailBullets: [
      showHurricane
        ? `NOAA best-track eye advances near the Gulf with an expanding impact radius; facility color blends toward red by weighted footprint inside the disk.`
        : `Turn the hurricane layer on to stress footprint overlap against historical tracks.`,
      `Playback starts near Gulf approach (not mid-Atlantic) for faster land-relevant context.`,
    ],
  });
  return { proactive, now };
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
  const [mapInspect, setMapInspect] = useState<{ lat: number; lng: number } | null>(null);
  const [recDetail, setRecDetail] = useState<RecCardModel | null>(null);
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
  const impactRadiusM = impactPhase01 * MAX_IMPACT_RADIUS_M;
  const simulationDateUtc = playbackTrack[Math.min(stormLegIndex, Math.max(0, playbackTrack.length - 1))]?.date_utc;

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

  const holdingWhy = useMemo(() => {
    if (!holdingPosition || !live) {
      return [];
    }
    return buildHoldingWhyLines(
      holdingPosition,
      live,
      facilities,
      impactCenter,
      impactRadiusM,
      showHurricaneTrack,
      filteredEonet,
    );
  }, [holdingPosition, live, facilities, impactCenter, impactRadiusM, showHurricaneTrack, filteredEonet]);

  const mapInspectNearest = useMemo(() => {
    if (!mapInspect || !live) {
      return { facilities: [] as Array<{ item: FacilityRow; km: number }>, eonet: [] as Array<{ item: EonetEvent; km: number }> };
    }
    const { lat, lng } = mapInspect;
    return {
      facilities: nearestItems(lat, lng, facilities, (f) => [f.lat, f.lng], 6),
      eonet: nearestItems(lat, lng, live.eonet.events, (e) => [e.lat, e.lng], 8),
    };
  }, [mapInspect, live, facilities]);

  const { proactive: proactiveCards, now: nowCards } = useMemo(
    () => buildRecCards(live, predictiveBlock, selectedScenarioId, showHurricaneTrack),
    [live, predictiveBlock, selectedScenarioId, showHurricaneTrack],
  );

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

  const totalChangeLabel = viewMode === "predictive" ? "Scenario book Δ (±7d window)" : "Book Δ (1d, marks)";

  const facilityPosition = facilityDialog ? positionByTicker(facilityDialog.ticker) : undefined;

  const facilityDetailLines = useMemo(() => {
    if (!facilityDialog || !live) {
      return [];
    }
    const t = facilityDialog.ticker.toUpperCase();
    const lines: string[] = [];
    const pos = positionByTicker(facilityDialog.ticker);
    if (pos) {
      lines.push(
        `Live quote (${pos.symbol}): last ${formatPrice(pos.quote.price)}, prior ${formatPrice(pos.quote.previous_close)}, session move ${pos.quote.change_pct_1d == null ? "n/a" : `${pos.quote.change_pct_1d >= 0 ? "+" : ""}${pos.quote.change_pct_1d.toFixed(2)}%`}.`,
      );
      if (pos.quote.change_pct_1d != null) {
        const dir = pos.direction.toLowerCase() === "short" ? -1 : 1;
        const hypoPct = pos.quote.change_pct_1d * ILLUSTRATIVE_STRESS_DAYS;
        const hypoUsd = (pos.notional_musd * hypoPct * dir) / 100;
        lines.push(
          `Illustrative only: if today’s % move repeated roughly ${ILLUSTRATIVE_STRESS_DAYS} sessions, direction-adjusted P&L ≈ ${formatMoneyM(hypoUsd)} on $${pos.notional_musd}M notional (not a forecast).`,
        );
      }
    } else {
      lines.push(`No yfinance row for ${t} in this demo book.`);
    }
    const scen = live.predictive_scenarios[selectedScenarioId];
    if (scen && scen.by_symbol[t] != null) {
      lines.push(
        `Historical replay (${scen.label}): yfinance window P&L on this notional ≈ ${formatMoneyM(scen.by_symbol[t] ?? 0)} (±7d around ${scen.anchor_date}).`,
      );
    }
    const inDisk =
      showHurricaneTrack && impactCenter
        ? distanceMeters([facilityDialog.lat, facilityDialog.lng], impactCenter) <= impactRadiusM
        : false;
    lines.push(
      inDisk
        ? `This site is inside the current expanding hurricane impact disk (illustrative physical overlap).`
        : `This site is outside the current impact disk radius (still check EONET halos for wildfire/flood/etc.).`,
    );
    const near = nearestItems(facilityDialog.lat, facilityDialog.lng, filteredEonet, (e) => [e.lat, e.lng], 4);
    near.forEach(({ item, km }) => {
      lines.push(`EONET: ${item.eonet_category} — “${item.title.slice(0, 48)}…” ~${km.toFixed(0)} km${item.date ? ` (${item.date})` : ""}.`);
    });
    lines.push(`Mapped weight for this facility: ${(facilityDialog.asset_value_pct * 100).toFixed(0)}% of ${t} mix in demo data.`);
    return lines;
  }, [
    facilityDialog,
    live,
    positionByTicker,
    selectedScenarioId,
    showHurricaneTrack,
    impactCenter,
    impactRadiusM,
    filteredEonet,
  ]);

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
              Right now
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
            HURDAT2 + pulse
          </label>
          <select
            value={selectedStormId}
            onChange={(e) => setSelectedStormId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white outline-none"
            disabled={!live?.hurricanes.storms.length}
          >
            {(live?.hurricanes.storms ?? []).map((s) => (
              <option key={s.id} value={s.id} className="bg-slate-900">
                {s.name} · {s.points.length} pts
              </option>
            ))}
          </select>
          {live?.hurricanes.error ? (
            <p className="mt-1 text-[10px] text-red-300/90">HURDAT: {live.hurricanes.error}</p>
          ) : (
            <a
              href={live?.hurricanes.source_url}
              className="mt-1 inline-block text-[10px] text-amber-300/80 underline"
              target="_blank"
              rel="noreferrer"
            >
              NHC HURDAT2 →
            </a>
          )}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-300/80">Proactive</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {proactiveCards.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setRecDetail(c)}
                className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 to-black/30 p-3 text-left transition hover:border-emerald-400/35"
              >
                <p className="text-sm font-semibold text-emerald-100/95">{c.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-white/55">{c.subtitle}</p>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-emerald-400/70">Tap for chart + detail</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-sky-300/80">Right now</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {nowCards.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setRecDetail(c)}
                className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-950/35 to-black/30 p-3 text-left transition hover:border-sky-400/35"
              >
                <p className="text-sm font-semibold text-sky-100/95">{c.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-white/55">{c.subtitle}</p>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-sky-400/70">Tap for chart + detail</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">Holdings (yfinance)</p>
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
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2 text-right">Notional</th>
                <th className="px-4 py-2 text-right">Last</th>
                <th className="px-4 py-2 text-right">Prev close</th>
                <th className="px-4 py-2 text-right">1d %</th>
                <th className="px-4 py-2 text-right">Est 1d $</th>
              </tr>
            </thead>
            <tbody>
              {live?.portfolio.positions.map((p) => (
                <tr
                  key={p.symbol}
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() => setHoldingDialogSymbol(p.symbol)}
                >
                  <td className="px-4 py-2.5 font-semibold text-white">{p.symbol}</td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-white/70">{p.name}</td>
                  <td className="px-4 py-2.5 text-white/50">{p.asset_class}</td>
                  <td className="px-4 py-2.5 text-right text-white/80">
                    {p.direction === "short" ? "−" : ""}
                    {formatMoneyM(p.notional_musd)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-white">{formatPrice(p.quote.price)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-white/60">{formatPrice(p.quote.previous_close)}</td>
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
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${
                      p.estimated_pnl_1d_musd == null
                        ? "text-white/40"
                        : p.estimated_pnl_1d_musd >= 0
                          ? "text-emerald-300"
                          : "text-red-300"
                    }`}
                  >
                    {p.estimated_pnl_1d_musd == null ? "—" : formatMoneyM(p.estimated_pnl_1d_musd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[10px] text-white/35">Click a row for narrative “why”. Click a facility pin on the map for site-level equity impact.</p>
      </div>

      <details className="shrink-0 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/80 backdrop-blur-md open:bg-black/45">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
          Map layers (EONET) — select / deselect all
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enableAllHazards}
            className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={deselectAllHazards}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
          >
            Deselect all
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {HAZARDS.map((h) => (
            <label key={h.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-amber-400"
                checked={hazardToggles[h.id]}
                onChange={() => setHazardToggles((prev) => ({ ...prev, [h.id]: !prev[h.id] }))}
              />
              <span>
                {h.icon} {h.label}
              </span>
            </label>
          ))}
        </div>
      </details>

      {live && live.errors.length > 0 ? (
        <div className="shrink-0 rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
          Partial data: {live.errors.join(" · ")}
        </div>
      ) : null}

      <div className="relative min-h-[min(58vh,720px)] flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-wrap justify-between gap-2 p-3">
          <div className="rounded-lg border border-white/10 bg-black/65 px-3 py-2 text-xs text-white/80 backdrop-blur-md">
            Impact radius ≈ {showHurricaneTrack ? `${Math.round(impactRadiusM / 1000)} km` : "off"} · EONET visible:{" "}
            {filteredEonet.length}
          </div>
          <div className="rounded-lg border border-white/10 bg-black/65 px-3 py-2 text-right text-xs text-white/80 backdrop-blur-md">
            <span className="block text-[10px] uppercase tracking-wider text-white/40">Feed timestamp</span>
            {live ? new Date(live.as_of_utc).toLocaleString() : "—"}
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
          className="h-full min-h-[min(58vh,720px)] w-full"
          zoomControl={false}
        >
          <MapClickHandler
            onInspect={(lat, lng) => {
              setMapInspect({ lat, lng });
            }}
          />
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {showHurricaneTrack && fullTrackLatLngs.length > 1 ? (
            <LayerGroup>
              <Polyline
                positions={fullTrackLatLngs}
                pathOptions={{ color: "#f97316", weight: 2, opacity: 0.2, dashArray: "8 10" }}
              />
              <Polyline
                positions={playbackLatLngs.slice(0, stormLegIndex + 1)}
                pathOptions={{ color: "#fbbf24", weight: 3, opacity: 0.95 }}
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
                  fillOpacity: 0.08 + impactPhase01 * 0.12,
                  weight: 2,
                  dashArray: "6 8",
                }}
              />
              <Marker position={impactCenter} icon={stormEyeIcon()} />
            </LayerGroup>
          ) : null}

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

          {facilities.map((f) => {
            const fp =
              showHurricaneTrack && impactCenter
                ? weightedFootprintInImpactZone(f.ticker, facilities, impactCenter, impactRadiusM)
                : 0;
            const eonetProx = eonetProximity01(f.lat, f.lng, hazardToggles, hazardMap, live?.eonet.events ?? []);
            return (
              <Marker
                key={`${f.ticker}-${f.facility_name}`}
                position={[f.lat, f.lng]}
                icon={facilityLeafletIcon(f.ticker, f.facility_name, fp, eonetProx)}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) {
                      L.DomEvent.stopPropagation(e.originalEvent);
                    }
                    setFacilityDialog(f);
                  },
                }}
              >
                <Popup>
                  <div className="min-w-[200px] space-y-2 text-slate-900">
                    <p className="font-semibold">
                      {f.ticker} · {f.facility_name}
                    </p>
                    <p className="text-xs">Open the detail panel for yfinance + expected equity impact.</p>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-slate-900 px-2 py-1.5 text-sm text-white"
                      onClick={() => setFacilityDialog(f)}
                    >
                      Facility detail →
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      <Dialog open={holdingDialogSymbol != null} onOpenChange={(o) => !o && setHoldingDialogSymbol(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[85vh] overflow-y-auto border border-white/10 bg-slate-950 text-white sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-white">{holdingPosition?.symbol} — book line</DialogTitle>
            <DialogDescription className="text-white/55">
              {holdingPosition?.name} · {holdingPosition?.direction.toUpperCase()}{" "}
              {holdingPosition ? formatMoneyM(holdingPosition.notional_musd) : ""} · Last{" "}
              {formatPrice(holdingPosition?.quote.price ?? null)} · Prev {formatPrice(holdingPosition?.quote.previous_close ?? null)}
            </DialogDescription>
          </DialogHeader>
          <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
            {holdingWhy.map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-4 w-full rounded-lg border border-amber-400/30 bg-amber-500/10 py-2 text-sm text-amber-100"
            onClick={() => {
              if (holdingPosition) {
                onOpenStressTest(holdingPosition.symbol);
              }
            }}
          >
            Run stress test for {holdingPosition?.symbol}
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={facilityDialog != null} onOpenChange={(o) => !o && setFacilityDialog(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[85vh] overflow-y-auto border border-white/10 bg-slate-950 text-white sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-white">
              {facilityDialog?.ticker} · {facilityDialog?.facility_name}
            </DialogTitle>
            <DialogDescription className="text-white/55">
              Site-level view — expected equity / book impact (illustrative)
              {facilityPosition
                ? ` · Last ${formatPrice(facilityPosition.quote.price)} · 1d ${facilityPosition.quote.change_pct_1d == null ? "—" : `${facilityPosition.quote.change_pct_1d >= 0 ? "+" : ""}${facilityPosition.quote.change_pct_1d.toFixed(2)}%`}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm text-white/82">
            {facilityDetailLines.map((line, idx) => (
              <li key={idx} className="border-l-2 border-amber-400/40 pl-3">
                {line}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-4 w-full rounded-lg border border-white/15 bg-white/10 py-2 text-sm text-white"
            onClick={() => facilityDialog && onOpenStressTest(facilityDialog.ticker)}
          >
            Stress test {facilityDialog?.ticker}
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={mapInspect != null} onOpenChange={(o) => !o && setMapInspect(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[85vh] overflow-y-auto border border-white/10 bg-slate-950 text-white sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-white">Map location</DialogTitle>
            <DialogDescription className="text-white/55">
              {mapInspect ? `${mapInspect.lat.toFixed(4)}°, ${mapInspect.lng.toFixed(4)}°` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Nearest facilities</p>
              <ul className="mt-2 space-y-1 text-white/75">
                {mapInspectNearest.facilities.map(({ item, km }) => (
                  <li key={`${item.ticker}-${item.facility_name}`}>
                    <span className="text-white">{item.ticker}</span> · {item.facility_name}{" "}
                    <span className="text-white/45">({km.toFixed(1)} km)</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Nearest EONET events</p>
              <ul className="mt-2 space-y-2 text-white/75">
                {mapInspectNearest.eonet.map(({ item, km }) => (
                  <li key={`${item.id}-${item.eonet_category}`}>
                    <span className="text-white/90">{item.title.slice(0, 72)}</span>
                    <span className="block text-xs text-white/45">
                      {item.eonet_category} · {km.toFixed(1)} km
                      {item.date ? ` · ${item.date}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={recDetail != null} onOpenChange={(o) => !o && setRecDetail(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[90vh] overflow-y-auto border border-white/10 bg-slate-950 text-white sm:max-w-lg"
        >
          {recDetail ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">{recDetail.title}</DialogTitle>
                <DialogDescription className="text-white/55">{recDetail.subtitle}</DialogDescription>
              </DialogHeader>
              {recDetail.fredChartKey && live?.fred.series[recDetail.fredChartKey]?.series?.length ? (
                <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2">
                  <FredMiniChart
                    data={live.fred.series[recDetail.fredChartKey].series}
                    color={recDetail.fredChartKey === "wti" ? "#fbbf24" : "#38bdf8"}
                    name={recDetail.fredChartKey === "wti" ? "WTI" : "Henry Hub"}
                  />
                </div>
              ) : null}
              {recDetail.id === "credit-now" && live?.fred.series.ig_spread?.latest != null && live.fred.series.hy_spread?.latest != null ? (
                <CreditSpreadBars ig={live.fred.series.ig_spread.latest} hy={live.fred.series.hy_spread.latest} />
              ) : null}
              <ul className="mt-4 space-y-2 text-sm text-white/80">
                {recDetail.detailBullets.map((b, i) => (
                  <li key={i} className="border-l-2 border-white/20 pl-3">
                    {b}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
