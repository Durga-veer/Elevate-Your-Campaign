// Segment mode (pure code): for uploads without a daily time series, e.g. one row per
// customer or per campaign. Detects column roles, compares segments with significance
// tests, finds conversion drivers (converters vs non-converters) and produces the same
// DiagnosisEngineOutput shape as the time-series engine, so agents, Critic and UI all work.
import type {
  BusinessProfile,
  CampaignSummary,
  ChainNode,
  DataIssue,
  DataReport,
  DiagnosisEngineOutput,
  Finding,
  Health,
  HealthComponent,
  Metrics,
  Reliability,
  SegmentComparison,
  StoryEvent,
} from "../types";
import { normaliseHeader, toNumber } from "./csv";
import type { DataAgentResult } from "./dataQuality";
import { EvidenceRegistry } from "./evidence";
import { fmtMoney, fmtNum, fmtPct } from "./format";
import { HEALTH_WEIGHTS } from "./health";
import { mean, std } from "./metrics";
import { scorePriorities } from "./priority";

export const SEGMENT_RULES = { z: 2.58, minRelDiff: 0.02, minSegmentRows: 30, minShare: 0.01, maxLevels: 30, driverD: 0.1, maxDrivers: 4 };

const ROLE_KEYS = {
  spend: ["spend", "ad_spend", "adspend", "cost", "amount_spent", "media_cost", "total_spend", "budget"],
  conversions: ["conversion", "conversions", "platform_conversions", "website_conversions", "converted", "is_converted", "purchases", "purchase", "orders", "leads", "results"],
  revenue: ["revenue", "sales", "conversion_value", "purchase_value", "sales_value"],
  clicks: ["clicks"],
  impressions: ["impressions"],
  ctr: ["click_through_rate", "ctr"],
  cvr: ["conversion_rate", "cvr"],
} as const;
type Role = keyof typeof ROLE_KEYS;

interface Dimension {
  name: string; // display name
  values: string[]; // per row
}
interface Feature {
  name: string;
  values: (number | null)[];
}

export interface SegmentDataset {
  n: number;
  dims: Dimension[];
  mainDim: string;
  measures: Partial<Record<Role, (number | null)[]>>;
  measureNames: Partial<Record<Role, string>>;
  convBinary: boolean;
  features: Feature[];
}

const pretty = (col: string) => col.trim().replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");

function ageBand(a: number): string {
  if (a < 25) return "18-24";
  if (a < 35) return "25-34";
  if (a < 45) return "35-44";
  if (a < 55) return "45-54";
  if (a < 65) return "55-64";
  return "65+";
}

function quartileBands(vals: number[]): (v: number) => string {
  const s = [...vals].sort((a, b) => a - b);
  const q = [0.25, 0.5, 0.75].map((p) => s[Math.floor(p * (s.length - 1))]);
  const k = (x: number) => (Math.abs(x) >= 1000 ? `${Math.round(x / 1000)}k` : fmtNum(x));
  const labels = [`Q1 (<${k(q[0])})`, `Q2 (${k(q[0])}-${k(q[1])})`, `Q3 (${k(q[1])}-${k(q[2])})`, `Q4 (>${k(q[2])})`];
  return (v) => labels[v < q[0] ? 0 : v < q[1] ? 1 : v < q[2] ? 2 : 3];
}

export function runSegmentChecks(table: string[][], missingDaily: readonly string[]): DataAgentResult {
  const ev = new EvidenceRegistry("D");
  const issues: DataIssue[] = [];
  let issueN = 0;
  const issue = (i: Omit<DataIssue, "id">) => issues.push({ ...i, id: `DQ${++issueN}` });
  const headerOrig = table[0] ?? [];
  const keys = headerOrig.map(normaliseHeader);
  const body = table.slice(1).filter((r) => r.length >= Math.max(1, headerOrig.length - 1));
  const n = body.length;
  const detected: { role: string; column: string }[] = [];

  const col = (i: number) => body.map((r) => r[i] ?? "");
  const roleCol: Partial<Record<Role, number>> = {};
  for (const role of Object.keys(ROLE_KEYS) as Role[]) {
    const i = keys.findIndex((k) => (ROLE_KEYS[role] as readonly string[]).includes(k));
    if (i >= 0) roleCol[role] = i;
  }
  const used = new Set(Object.values(roleCol));

  const dims: Dimension[] = [];
  const features: Feature[] = [];
  const ignored: string[] = [];
  const placeholders: string[] = [];
  for (let i = 0; i < headerOrig.length; i++) {
    const name = pretty(headerOrig[i]);
    const key = keys[i];
    const raw = col(i);
    const nums = raw.map((v) => toNumber(v));
    const numericShare = nums.filter((x) => x !== null).length / Math.max(1, n);
    const uniq = new Set(raw.map((v) => v.trim())).size;
    const isId = /(^|_)id$/.test(key) || key === "id" || (numericShare > 0.95 && uniq === n && /id|number|no$/.test(key));
    if (isId) {
      ignored.push(`${headerOrig[i]} (identifier)`);
      continue;
    }
    if (uniq <= 1) {
      placeholders.push(headerOrig[i]);
      continue;
    }
    if (numericShare > 0.95) {
      const vals = nums.filter((x): x is number => x !== null);
      if (key === "age" || key.endsWith("_age")) {
        dims.push({ name: `${name} band`, values: nums.map((x) => (x === null ? "Unknown" : ageBand(x))) });
        detected.push({ role: "dimension (banded)", column: headerOrig[i] });
      } else if (/income|salary|revenue_band/.test(key)) {
        const band = quartileBands(vals);
        dims.push({ name: `${name} band`, values: nums.map((x) => (x === null ? "Unknown" : band(x))) });
        detected.push({ role: "dimension (quartiles)", column: headerOrig[i] });
      }
      if (!used.has(i)) features.push({ name, values: nums });
      continue;
    }
    if (/^date$|^day$|date|time/.test(key)) {
      ignored.push(`${headerOrig[i]} (date without impressions/clicks)`);
      continue;
    }
    if (uniq <= SEGMENT_RULES.maxLevels) {
      dims.push({ name, values: raw.map((v) => v.trim() || "Unknown") });
      detected.push({ role: "dimension", column: headerOrig[i] });
    } else ignored.push(`${headerOrig[i]} (${uniq} distinct text values)`);
  }

  const measures: SegmentDataset["measures"] = {};
  const measureNames: SegmentDataset["measureNames"] = {};
  for (const [role, i] of Object.entries(roleCol) as [Role, number][]) {
    measures[role] = col(i).map((v) => toNumber(v));
    measureNames[role] = headerOrig[i];
    detected.push({ role, column: headerOrig[i] });
  }
  const conv = measures.conversions;
  const convBinary = !!conv && conv.every((x) => x === null || x === 0 || x === 1);

  const report: DataReport = {
    rowCount: n,
    droppedRows: 0,
    campaigns: [],
    platforms: [],
    dateRange: { start: "", end: "", days: 0 },
    issues,
    trackingChecks: [],
    reliability: "warn",
    totals: emptyMetrics(),
    evidence: ev.items,
    missingColumns: [...missingDaily],
    mode: "segment",
    detected,
  };

  const hasOutcome = !!(measures.conversions || measures.spend || measures.revenue || measures.cvr);
  if (n < SEGMENT_RULES.minSegmentRows || !dims.length || !hasOutcome) {
    issue({
      severity: "block",
      check: "unrecognised_structure",
      message:
        n < SEGMENT_RULES.minSegmentRows
          ? `Only ${n} rows: at least ${SEGMENT_RULES.minSegmentRows} are needed.`
          : `Could not find a usable structure. Upload either a daily export (columns: date, impressions, clicks, spend; plus campaign, conversions, revenue) or a segment file with at least one category column (channel, campaign, audience...) and a spend or conversion column. Daily-export columns not found: ${missingDaily.join(", ")}. ${!dims.length ? "No category columns found." : ""} ${!hasOutcome ? "No spend / conversion / revenue column found." : ""}`,
      evidenceIds: [],
    });
    report.reliability = "block";
    return { rows: [], report };
  }

  issue({
    severity: "warn",
    check: "no_time_dimension",
    message: `No daily time series (daily-export columns not found: ${missingDaily.join(", ")}). Trend and anomaly checks (creative fatigue, tracking breaks, sudden drops) are not possible. Running segment comparison${convBinary ? " and conversion-driver analysis" : ""} instead.`,
    evidenceIds: [],
  });
  if (placeholders.length)
    issue({ severity: "info", check: "constant_columns", message: `Column(s) with a single value everywhere (masked or placeholder, ignored): ${placeholders.join(", ")}.`, evidenceIds: [] });
  if (ignored.length) issue({ severity: "info", check: "ignored_columns", message: `Ignored: ${ignored.join("; ")}.`, evidenceIds: [] });
  const missingCells = Object.values(measures).reduce((a, arr) => a + arr!.filter((x) => x === null).length, 0);
  if (missingCells > 0)
    issue({ severity: missingCells / n > 0.05 ? "warn" : "info", check: "missing_values", message: `${missingCells} missing or non-numeric value(s) in measure columns (skipped in calculations).`, evidenceIds: [] });
  if (convBinary) {
    const rate = conv!.filter((x) => x === 1).length / n;
    const rEv = ev.add({ label: `Share of rows with ${measureNames.conversions} = 1`, metric: "conversion_rate", value: rate, unit: "pct", scope: "dataset" });
    if (rate > 0.8 || rate < 0.02)
      issue({ severity: "info", check: "imbalanced_outcome", message: `${fmtPct(rate, 1)} of rows converted. Differences between segments will be small in absolute terms; significance tests are used to separate real gaps from noise.`, evidenceIds: [rEv] });
  }

  const mainDim = (dims.find((d) => /channel|campaign|platform|source/i.test(d.name)) ?? dims[0]).name;
  const main = dims.find((d) => d.name === mainDim)!;
  report.campaigns = [...new Set(main.values)];
  const platformDim = dims.find((d) => /platform|channel|source|network/i.test(d.name));
  report.platforms = platformDim ? [...new Set(platformDim.values)] : [];
  const segment: SegmentDataset = { n, dims, mainDim, measures, measureNames, convBinary, features };
  report.totals = toMetrics(stats(segment, allIdx(n)));
  report.reliability = issues.some((i) => i.severity === "block") ? "block" : ("warn" as Reliability);
  return { rows: [], report, segment };
}

// ---------------- statistics ----------------

const allIdx = (n: number) => Array.from({ length: n }, (_, i) => i);
const sumOf = (arr: (number | null)[] | undefined, idx: number[]) => (arr ? idx.reduce((a, i) => a + (arr[i] ?? 0), 0) : 0);
const avgOf = (arr: (number | null)[] | undefined, idx: number[]) => {
  if (!arr) return null;
  const xs = idx.map((i) => arr[i]).filter((x): x is number => x !== null);
  return xs.length ? mean(xs) : null;
};

interface Stats {
  n: number;
  spend: number;
  conversions: number;
  revenue: number;
  clicks: number;
  impressions: number;
  /** conversions per row (binary) or per click; falls back to average conversion-rate column */
  rate: number | null;
  rateBase: number; // denominator used for the significance test
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
}

function stats(d: SegmentDataset, idx: number[]): Stats {
  const m = d.measures;
  const spend = sumOf(m.spend, idx);
  const conversions = sumOf(m.conversions, idx);
  const revenue = sumOf(m.revenue, idx);
  const clicks = sumOf(m.clicks, idx);
  const impressions = sumOf(m.impressions, idx);
  let rate: number | null = null;
  let rateBase = 0;
  if (m.conversions && d.convBinary) {
    rate = conversions / idx.length;
    rateBase = idx.length;
  } else if (m.conversions && clicks > 0) {
    rate = conversions / clicks;
    rateBase = clicks;
  } else if (m.cvr) {
    rate = avgOf(m.cvr, idx);
    rateBase = 0;
  }
  const ctr = m.ctr ? avgOf(m.ctr, idx) : impressions > 0 ? clicks / impressions : null;
  return {
    n: idx.length,
    spend,
    conversions,
    revenue,
    clicks,
    impressions,
    rate,
    rateBase,
    cpa: m.spend && m.conversions && conversions > 0 ? spend / conversions : null,
    roas: m.spend && m.revenue && spend > 0 ? revenue / spend : null,
    ctr,
  };
}

function emptyMetrics(): Metrics {
  return { impressions: 0, reach: 0, clicks: 0, landing_page_views: 0, spend: 0, conversions: 0, platform_conversions: 0, revenue: 0, frequency: 0, ctr: 0, cpc: 0, cpm: 0, cvr: 0, cpa: 0, roas: 0, lpRate: 0, trackingRatio: 0 };
}
function toMetrics(s: Stats): Metrics {
  return {
    ...emptyMetrics(),
    impressions: s.impressions,
    reach: s.impressions,
    clicks: s.clicks,
    landing_page_views: s.clicks,
    spend: s.spend,
    conversions: s.conversions,
    platform_conversions: s.conversions,
    revenue: s.revenue,
    ctr: s.ctr ?? 0,
    cpc: s.clicks ? s.spend / s.clicks : 0,
    cpm: s.impressions ? (s.spend * 1000) / s.impressions : 0,
    cvr: s.rate ?? 0,
    cpa: s.cpa ?? 0,
    roas: s.roas ?? 0,
    lpRate: 1,
    trackingRatio: 1,
  };
}

/** Two-proportion z-test of segment vs the rest. */
function zTest(a: Stats, rest: Stats): number | null {
  if (a.rate === null || rest.rate === null || !a.rateBase || !rest.rateBase) return null;
  const p = (a.rate * a.rateBase + rest.rate * rest.rateBase) / (a.rateBase + rest.rateBase);
  const se = Math.sqrt(p * (1 - p) * (1 / a.rateBase + 1 / rest.rateBase));
  return se > 0 ? (a.rate - rest.rate) / se : null;
}

// ---------------- engine ----------------

export function runSegmentEngine(d: SegmentDataset, data: DataReport, profile: BusinessProfile): DiagnosisEngineOutput {
  const ev = new EvidenceRegistry("E");
  const all = stats(d, allIdx(d.n));
  const hasRate = all.rate !== null;
  const hasCpa = all.cpa !== null;
  const rateLabel = d.convBinary ? "Conversion rate (share of rows converted)" : "Conversion rate";

  const acc = {
    rate: hasRate ? ev.add({ label: `${rateLabel}, all ${fmtNum(d.n)} rows`, metric: "conversion_rate", value: all.rate!, unit: "pct", scope: "dataset" }) : "",
    cpa: hasCpa ? ev.add({ label: `Cost per conversion (${d.measureNames.spend} / ${d.measureNames.conversions}), all rows`, metric: "cpa", value: all.cpa!, unit: "currency", scope: "dataset" }) : "",
    roas: all.roas !== null ? ev.add({ label: "ROAS, all rows", metric: "roas", value: all.roas, unit: "x", scope: "dataset" }) : "",
    spend: d.measures.spend ? ev.add({ label: `Total ${d.measureNames.spend}`, metric: "spend", value: all.spend, unit: "currency", scope: "dataset" }) : "",
    rows: ev.add({ label: "Rows analysed", metric: "rows", value: d.n, unit: "count", scope: "dataset" }),
    targetCpa: ev.add({ label: "Target CPA (business profile)", metric: "target_cpa", value: profile.targetCpa, unit: "currency", scope: "profile" }),
    targetRoas: ev.add({ label: "Target ROAS (business profile)", metric: "target_roas", value: profile.targetRoas, unit: "x", scope: "profile" }),
  };

  const findings: Finding[] = [];
  const story: StoryEvent[] = [{ date: "", title: "Dataset loaded", detail: `${fmtNum(d.n)} rows, ${d.dims.length} segment dimensions (${d.dims.map((x) => x.name).join(", ")}). No dates: segment analysis.`, tone: "neutral" }];
  let fN = 0;
  const nextId = () => `F${++fN}`;
  const testDays = 14;

  const comparison = (dim: Dimension, groups: { label: string; s: Stats }[], highlight: string): SegmentComparison => ({
    dimension: dim.name,
    value: highlight,
    metric: hasRate ? "conversion_rate" : "cpa",
    rows: groups
      .map((g) => ({
        label: g.label,
        n: g.s.n,
        value: hasRate ? g.s.rate ?? 0 : g.s.cpa ?? 0,
        display: hasRate ? fmtPct(g.s.rate ?? 0, 1) : fmtMoney(g.s.cpa ?? 0, 0),
        highlight: g.label === highlight,
      }))
      .sort((a, b) => b.value - a.value),
  });

  for (const dim of d.dims) {
    const levels = [...new Set(dim.values)];
    if (levels.length < 2) continue;
    const groups = levels
      .map((label) => {
        const idx: number[] = [];
        dim.values.forEach((v, i) => v === label && idx.push(i));
        const restIdx: number[] = [];
        dim.values.forEach((v, i) => v !== label && restIdx.push(i));
        const s = stats(d, idx);
        const rest = stats(d, restIdx);
        return { label, s, rest, z: zTest(s, rest) };
      })
      .filter((g) => g.s.n >= Math.max(SEGMENT_RULES.minSegmentRows, d.n * SEGMENT_RULES.minShare));
    if (groups.length < 2) continue;

    const rel = (g: (typeof groups)[number]) => (hasRate && all.rate ? (g.s.rate! - all.rate) / all.rate : hasCpa && g.s.cpa ? -(g.s.cpa - all.cpa!) / all.cpa! : 0);
    const significant = (g: (typeof groups)[number]) => (g.z !== null ? Math.abs(g.z) >= SEGMENT_RULES.z : Math.abs(rel(g)) >= 0.15);
    const best = [...groups].sort((a, b) => (b.z ?? rel(b) * 100) - (a.z ?? rel(a) * 100))[0];
    const worst = [...groups].sort((a, b) => (a.z ?? rel(a) * 100) - (b.z ?? rel(b) * 100))[0];

    const addEv = (g: (typeof groups)[number]) => {
      const scope = `${dim.name} = ${g.label}`;
      return {
        rate: hasRate ? ev.add({ label: `${rateLabel}, ${scope} (${fmtNum(g.s.n)} rows)`, metric: "conversion_rate", value: g.s.rate!, unit: "pct", scope }) : undefined,
        restRate: hasRate ? ev.add({ label: `${rateLabel}, all other ${dim.name} values`, metric: "conversion_rate", value: g.rest.rate!, unit: "pct", scope: `${dim.name} != ${g.label}` }) : undefined,
        diff: ev.add({ label: `Relative difference vs dataset average, ${scope}`, metric: "rel_diff", value: rel(g), unit: "pct", scope, display: `${rel(g) > 0 ? "+" : ""}${(rel(g) * 100).toFixed(1)}%` }),
        z: g.z !== null ? ev.add({ label: `Significance (z-score) of the conversion-rate gap, ${scope} vs rest`, metric: "z", value: g.z, unit: "ratio", scope }) : undefined,
        cpa: g.s.cpa !== null ? ev.add({ label: `Cost per conversion, ${scope}`, metric: "cpa", value: g.s.cpa, unit: "currency", scope }) : undefined,
        share: d.measures.spend ? ev.add({ label: `Share of total ${d.measureNames.spend}, ${scope}`, metric: "spend_share", value: all.spend ? g.s.spend / all.spend : 0, unit: "pct", scope }) : undefined,
        ctr: g.s.ctr !== null && all.ctr !== null ? ev.add({ label: `Average CTR, ${scope}`, metric: "ctr", value: g.s.ctr, unit: "pct", scope }) : undefined,
      };
    };
    const ids = (o: Record<string, string | undefined>) => Object.values(o).filter((x): x is string => !!x);

    // ---- Problem: significantly worse segment
    if (significant(worst) && rel(worst) <= -SEGMENT_RULES.minRelDiff) {
      const e = addEv(worst);
      const ctrRel = worst.s.ctr !== null && all.ctr ? (worst.s.ctr - all.ctr) / all.ctr : null;
      const postClick = ctrRel !== null && ctrRel > -0.03; // engages as well as others but converts less
      const excess = all.cpa && worst.s.cpa ? Math.max(0, worst.s.spend - worst.s.conversions * all.cpa) : 0;
      const costEv = ev.add({ label: `Spend above dataset-average cost per conversion, ${dim.name} = ${worst.label} (estimate)`, metric: "excess_cost", value: excess, unit: "currency", scope: `${dim.name} = ${worst.label}` });
      const chain: ChainNode[] = [
        ...(e.cpa ? [{ metric: "Cost per conversion", direction: "up" as const, changePct: all.cpa && worst.s.cpa ? ((worst.s.cpa - all.cpa) / all.cpa) * 100 : null, evidenceId: e.cpa, note: "Each conversion costs more than average" }] : []),
        { metric: "Conversion rate", direction: "down", changePct: rel(worst) * 100, evidenceId: e.rate ?? e.diff, note: `Converts less than the other ${dim.name} values` },
        ...(ctrRel !== null ? [{ metric: "CTR", direction: (Math.abs(ctrRel) < 0.03 ? "stable" : ctrRel > 0 ? "up" : "down") as ChainNode["direction"], changePct: ctrRel * 100, evidenceId: e.ctr, note: postClick ? "Engagement is not worse, so the gap is after the click" : "Also engages less" }] : []),
        { metric: postClick ? "Post-click experience / offer fit" : `${dim.name} fit (message / targeting)`, direction: "down", changePct: null, evidenceId: e.z ?? e.diff, note: postClick ? "Landing page, offer or follow-up does not suit this segment" : "Message or targeting suits this segment less", isRootCause: true },
      ];
      const signals = [true, (worst.z ?? 0) <= -4, !!e.cpa && (worst.s.cpa ?? 0) > (all.cpa ?? 0), worst.s.n >= 200, groups.length >= 3].filter(Boolean).length;
      const id = nextId();
      findings.push({
        id, type: "segment_underperformer", category: /age|gender|income|segment|audience/i.test(dim.name) ? "audience" : "budget", kind: "problem",
        severity: rel(worst) <= -0.1 ? "high" : "medium",
        title: `${dim.name} "${worst.label}" converts below average`,
        campaign: `${dim.name}: ${worst.label}`, platform: dim.name, ruleId: "S1_SEGMENT_UNDERPERFORMER",
        ruleText: `Segment conversion rate significantly below the rest (two-proportion z-test, |z| >= ${SEGMENT_RULES.z}, i.e. p < 0.01) and at least ${SEGMENT_RULES.minRelDiff * 100}% below the dataset average.`,
        chain, evidenceIds: [...ids(e), costEv, acc.rate, acc.cpa].filter(Boolean),
        supportingSignals: signals,
        impact: { weeklyCostEstimate: excess, evidenceId: costEv, note: "Spend above what the dataset-average cost per conversion would need for the same conversions (estimate).", unitLabel: "over the dataset" },
        dataCaveat: "No dates in the data: this is a comparison between segments, not a change over time.",
        segment: comparison(dim, groups, worst.label),
      });
      story.push({ date: "", title: `Weak segment: ${dim.name} = ${worst.label}`, detail: `${e.rate ? fmtPct(worst.s.rate!, 1) : ""} conversion vs ${fmtPct(worst.rest.rate ?? 0, 1)} for other ${dim.name} values.`, findingId: id, tone: "bad" });
    }

    // ---- Opportunity: significantly better segment that does not cost more
    if (best !== worst && significant(best) && rel(best) >= SEGMENT_RULES.minRelDiff && (!hasCpa || (best.s.cpa ?? Infinity) <= all.cpa!)) {
      const e = addEv(best);
      const value = all.cpa && best.s.cpa ? Math.max(0, (all.cpa - best.s.cpa) * best.s.conversions) : 0;
      const valEv = ev.add({ label: `Cost advantage vs dataset-average cost per conversion, ${dim.name} = ${best.label} (estimate)`, metric: "opportunity_value", value, unit: "currency", scope: `${dim.name} = ${best.label}` });
      const signals = [true, (best.z ?? 0) >= 4, !!e.cpa, best.s.n >= 200, groups.length >= 3].filter(Boolean).length;
      const id = nextId();
      findings.push({
        id, type: "segment_opportunity", category: "audience", kind: "opportunity", severity: "medium",
        title: `Scale ${dim.name} "${best.label}"`,
        campaign: `${dim.name}: ${best.label}`, platform: dim.name, ruleId: "S2_SEGMENT_OPPORTUNITY",
        ruleText: `Segment conversion rate significantly above the rest (|z| >= ${SEGMENT_RULES.z}) with cost per conversion at or below the dataset average => candidate to receive more budget.`,
        chain: [
          { metric: "Conversion rate", direction: "up", changePct: rel(best) * 100, evidenceId: e.rate ?? e.diff, note: `Converts better than other ${dim.name} values` },
          ...(e.cpa ? [{ metric: "Cost per conversion", direction: "down" as const, changePct: all.cpa && best.s.cpa ? ((best.s.cpa - all.cpa) / all.cpa) * 100 : null, evidenceId: e.cpa, note: "Cheaper conversions" }] : []),
          { metric: "Budget share", direction: "stable", changePct: null, evidenceId: e.share ?? e.diff, note: "Could receive more budget", isRootCause: true },
        ],
        evidenceIds: [...ids(e), valEv, acc.rate, acc.cpa].filter(Boolean),
        supportingSignals: signals,
        impact: { weeklyCostEstimate: value, evidenceId: valEv, note: "How much less this segment's conversions cost vs the average (estimate; returns usually diminish when scaling).", unitLabel: "over the dataset" },
        dataCaveat: "No dates in the data: validate with a budget test before scaling.",
        segment: comparison(dim, groups, best.label),
      });
      story.push({ date: "", title: `Strong segment: ${dim.name} = ${best.label}`, detail: `${fmtPct(best.s.rate ?? 0, 1)} conversion vs ${fmtPct(best.rest.rate ?? 0, 1)} for the rest.`, findingId: id, tone: "good" });
    }
  }

  // ---- Conversion drivers (row-level data with a 0/1 conversion column)
  if (d.convBinary && d.measures.conversions) {
    const conv = d.measures.conversions;
    const yes = allIdx(d.n).filter((i) => conv[i] === 1);
    const no = allIdx(d.n).filter((i) => conv[i] === 0);
    if (yes.length >= 30 && no.length >= 30) {
      const drivers = d.features
        .map((f) => {
          const a = yes.map((i) => f.values[i]).filter((x): x is number => x !== null);
          const b = no.map((i) => f.values[i]).filter((x): x is number => x !== null);
          const pooled = Math.sqrt(((a.length - 1) * std(a) ** 2 + (b.length - 1) * std(b) ** 2) / Math.max(1, a.length + b.length - 2));
          return { f, ma: mean(a), mb: mean(b), dd: pooled > 0 ? (mean(a) - mean(b)) / pooled : 0 };
        })
        .filter((x) => Math.abs(x.dd) >= SEGMENT_RULES.driverD)
        .sort((x, y) => Math.abs(y.dd) - Math.abs(x.dd))
        .slice(0, SEGMENT_RULES.maxDrivers);
      if (drivers.length) {
        const evIds: string[] = [];
        const chain: ChainNode[] = drivers.map((x, k) => {
          const ea = ev.add({ label: `Average ${x.f.name}, converted rows`, metric: "driver_mean", value: x.ma, unit: "ratio", scope: "converted", display: fmtNum(x.ma, 2) });
          const eb = ev.add({ label: `Average ${x.f.name}, non-converted rows`, metric: "driver_mean", value: x.mb, unit: "ratio", scope: "not converted", display: fmtNum(x.mb, 2) });
          const ed = ev.add({ label: `Effect size (Cohen's d) of ${x.f.name}, converted vs not`, metric: "effect_size", value: x.dd, unit: "ratio", scope: "dataset" });
          evIds.push(ea, eb, ed);
          return { metric: x.f.name, direction: x.dd > 0 ? "up" : "down", changePct: x.mb ? ((x.ma - x.mb) / Math.abs(x.mb)) * 100 : null, evidenceId: ed, note: `Converters: ${fmtNum(x.ma, 2)} vs ${fmtNum(x.mb, 2)} (d = ${x.dd.toFixed(2)})`, isRootCause: k === 0 };
        });
        const id = nextId();
        const zeroEv = ev.add({ label: "Direct cost impact of driver insight (not measurable)", metric: "excess_cost", value: 0, unit: "currency", scope: "dataset" });
        findings.push({
          id, type: "conversion_drivers", category: "conversion", kind: "opportunity", severity: "medium",
          title: `What converters do differently: ${drivers.map((x) => x.f.name).join(", ")}`,
          campaign: "All rows", platform: "Behaviour", ruleId: "S3_CONVERSION_DRIVERS",
          ruleText: `Numeric columns compared between converted and non-converted rows; effect size (Cohen's d) >= ${SEGMENT_RULES.driverD} reported (0.2 = small, 0.5 = medium, 0.8 = large). Correlation, not proven causation.`,
          chain,
          evidenceIds: [...evIds, zeroEv],
          supportingSignals: Math.min(5, 1 + drivers.filter((x) => Math.abs(x.dd) >= 0.2).length + (yes.length >= 200 && no.length >= 200 ? 1 : 0)),
          impact: { weeklyCostEstimate: 0, evidenceId: zeroEv, note: "Insight for targeting and nurturing; no direct cost estimate.", unitLabel: "over the dataset" },
          dataCaveat: "These are correlations between behaviour and conversion, not proof that changing them causes conversions.",
          segment: {
            dimension: "Converted vs not",
            value: drivers[0].f.name,
            metric: "effect_size",
            rows: drivers.map((x) => ({ label: x.f.name, n: d.n, value: Math.abs(x.dd), display: `d = ${x.dd.toFixed(2)}`, highlight: true })),
          },
        });
        story.push({ date: "", title: "Conversion drivers", detail: `Converters differ most on ${drivers.map((x) => x.f.name).join(", ")}.`, findingId: id, tone: "good" });
      } else story.push({ date: "", title: "No strong behavioural driver", detail: "No numeric column differs meaningfully between converted and non-converted rows.", tone: "neutral" });
    }
  }

  for (const f of findings) {
    f.suggestedTestDays = testDays;
    f.testDaysEvidenceId = ev.add({ label: `Suggested minimum test length for ${f.campaign} (default: the data has no daily volume)`, metric: "test_days", value: testDays, unit: "days", scope: f.campaign });
    f.evidenceIds.push(f.testDaysEvidenceId);
  }
  story.push({ date: "", title: "Diagnosis run", detail: `${findings.length} finding(s) from segment comparison.`, tone: "neutral" });

  // Campaign-like summaries from the main dimension (used by Ask + metrics views).
  const main = d.dims.find((x) => x.name === d.mainDim)!;
  const campaigns: CampaignSummary[] = [...new Set(main.values)].map((label) => {
    const idx: number[] = [];
    main.values.forEach((v, i) => v === label && idx.push(i));
    const m = toMetrics(stats(d, idx));
    return { campaign: label, platform: d.mainDim, audience: "", creative: "", baseline: m, recent: m, total: m, spendShare: all.spend ? m.spend / all.spend : 0, daily: [] };
  });

  const total = toMetrics(all);
  const priorities = scorePriorities(findings, profile);
  const health = segmentHealth(findings, data, profile, all, acc, d);
  const noPeriod = { start: "", end: "" };
  return { mode: "segment", periods: { baseline: noPeriod, recent: noPeriod }, account: { baseline: total, recent: total, total }, campaigns, findings, evidence: [...data.evidence, ...ev.items], priorities, health, story };
}

function segmentHealth(
  findings: Finding[],
  data: DataReport,
  profile: BusinessProfile,
  all: Stats,
  acc: { cpa: string; roas: string; rate: string; targetCpa: string; targetRoas: string },
  d: SegmentDataset,
): Health {
  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  const probs = findings.filter((f) => f.type === "segment_underperformer");
  const opps = findings.filter((f) => f.type === "segment_opportunity");
  const cpaScore = all.cpa ? Math.min(100, (100 * profile.targetCpa) / all.cpa) : null;
  const roasScore = all.roas !== null ? Math.min(100, (100 * all.roas) / profile.targetRoas) : null;
  const goalParts = [cpaScore, roasScore].filter((x): x is number => x !== null);
  const profileOff = all.cpa !== null && (all.cpa > profile.targetCpa * 20 || all.cpa < profile.targetCpa / 20);
  const goal: HealthComponent = {
    key: "goal", label: "Goal", score: clamp(goalParts.length ? mean(goalParts) : 50), measurable: goalParts.length > 0,
    reasons: [
      all.cpa !== null ? `Cost per conversion ${fmtMoney(all.cpa)} vs target ${fmtMoney(profile.targetCpa)}.` : "No spend + conversion columns: CPA not measurable.",
      all.roas !== null ? `ROAS ${all.roas.toFixed(2)}x vs target ${profile.targetRoas.toFixed(2)}x.` : "No revenue column: ROAS not measurable.",
      ...(profileOff ? ["Your target CPA looks far from this data's scale. Update the Business profile so the Goal score is meaningful."] : []),
    ],
    evidenceIds: [acc.cpa, acc.roas, acc.targetCpa, acc.targetRoas].filter(Boolean),
  };
  const wasteSpend = probs.reduce((a, f) => a + f.impact.weeklyCostEstimate, 0);
  const budget: HealthComponent = {
    key: "budget", label: "Budget", measurable: !!d.measures.spend,
    score: clamp(d.measures.spend && all.spend ? 100 - (wasteSpend / all.spend) * 400 - probs.length * 5 : 50),
    reasons: d.measures.spend ? [`${probs.length} under-performing segment(s); spend above average-CPA level: ${fmtMoney(wasteSpend, 0)} (estimate).`] : ["No spend column."],
    evidenceIds: probs.map((f) => f.impact.evidenceId),
  };
  const creative: HealthComponent = { key: "creative", label: "Creative", score: 0, measurable: false, reasons: ["Not measurable: the data has no creative / ad-level or daily columns."], evidenceIds: [] };
  const audience: HealthComponent = {
    key: "audience", label: "Audience", score: clamp(92 - probs.length * 10 - opps.length * 6),
    reasons: [`${probs.length} segment(s) convert significantly below average; ${opps.length} significantly above (untapped upside).`],
    evidenceIds: [...probs, ...opps].flatMap((f) => f.evidenceIds.slice(0, 2)),
  };
  const conversion: HealthComponent = {
    key: "conversion", label: "Conversion", measurable: all.rate !== null,
    score: clamp(90 - probs.filter((f) => f.chain.some((c) => c.isRootCause && c.metric.startsWith("Post-click"))).length * 20 - probs.length * 5),
    reasons: [all.rate !== null ? `Overall conversion rate ${fmtPct(all.rate, 1)}. No trend available (no dates).` : "No conversion column."],
    evidenceIds: [acc.rate].filter(Boolean),
  };
  const warns = data.issues.filter((i) => i.severity === "warn").length;
  const dq: HealthComponent = {
    key: "data_quality", label: "Data Quality", score: clamp(100 - warns * 15 - data.issues.filter((i) => i.severity === "info").length * 3),
    reasons: [`${data.rowCount} rows, segment mode (no time series).`, ...data.issues.filter((i) => i.severity !== "info").map((i) => i.message)],
    evidenceIds: data.issues.flatMap((i) => i.evidenceIds),
  };
  const components = [goal, budget, creative, audience, conversion, dq];
  const scored = components.filter((c) => c.measurable !== false);
  const wsum = scored.reduce((a, c) => a + HEALTH_WEIGHTS[c.key], 0);
  const overall = clamp(scored.reduce((a, c) => a + c.score * HEALTH_WEIGHTS[c.key], 0) / Math.max(0.01, wsum));
  return { overall, components };
}
