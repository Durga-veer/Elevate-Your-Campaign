// Data Agent core (pure code): parse, clean, validate, tracking-mismatch checks.
import type { DataIssue, DataReport, Reliability, Row, TrackingCheck } from "../types";
import { runSegmentChecks, type SegmentDataset } from "./segments";
import { normaliseHeader, parseCsv, toIsoDate, toNumber } from "./csv";
import { EvidenceRegistry } from "./evidence";
import { addDays, aggregate, groupBy } from "./metrics";

// Daily (time-series) mode needs these; anything else falls back to segment mode.
const REQUIRED = ["date", "impressions", "clicks", "spend"] as const;
const OPTIONAL = [
  "campaign",
  "platform",
  "audience",
  "creative",
  "reach",
  "frequency",
  "landing_page_views",
  "platform_conversions",
  "website_conversions",
  "revenue",
] as const;

export const RECENT_DAYS = 7;
export const TRACKING_MISMATCH_RATIO = 1.5;

export interface DataAgentResult {
  rows: Row[];
  report: DataReport;
  /** Present in segment mode (no dates). */
  segment?: SegmentDataset;
}

export function runDataChecks(csvText: string): DataAgentResult {
  const ev = new EvidenceRegistry("D");
  const issues: DataIssue[] = [];
  let issueN = 0;
  const issue = (i: Omit<DataIssue, "id">) => issues.push({ ...i, id: `DQ${++issueN}` });

  const table = parseCsv(csvText);
  const header = (table[0] ?? []).map(normaliseHeader);
  const missingRequired = REQUIRED.filter((c) => !header.includes(c));
  const missingOptional = OPTIONAL.filter((c) => !header.includes(c));
  const emptyReport = (): DataReport => ({
    rowCount: 0,
    droppedRows: 0,
    campaigns: [],
    platforms: [],
    dateRange: { start: "", end: "", days: 0 },
    issues,
    trackingChecks: [],
    reliability: "block",
    totals: aggregate([]),
    evidence: ev.items,
    missingColumns: [...missingRequired, ...missingOptional],
    mode: "timeseries",
    detected: [],
  });

  if (table.length < 2) {
    issue({ severity: "block", check: "empty_file", message: "The file has no data rows.", evidenceIds: [] });
    return { rows: [], report: emptyReport() };
  }
  if (missingRequired.length) {
    // Not a daily campaign export: analyse it by segments instead (blocks if that is impossible too).
    return runSegmentChecks(table, missingRequired);
  }
  const hasWebsiteConv = header.includes("website_conversions");
  const hasPlatformConv = header.includes("platform_conversions");
  if (!hasWebsiteConv) {
    issue({
      severity: "warn",
      check: "no_source_of_truth",
      message:
        "No website/backend conversion column. Platform-reported conversions are used as-is and tracking cannot be verified.",
      evidenceIds: [],
    });
  }
  if (!header.includes("revenue"))
    issue({ severity: "warn", check: "no_revenue", message: "No revenue column: ROAS cannot be computed.", evidenceIds: [] });
  if (!header.includes("frequency"))
    issue({ severity: "info", check: "no_frequency", message: "No frequency column: creative-fatigue detection is limited.", evidenceIds: [] });

  const idx = (c: string) => header.indexOf(c);
  const get = (r: string[], c: string) => (idx(c) >= 0 ? r[idx(c)] : undefined);

  const rows: Row[] = [];
  let dropped = 0;
  let impossible = 0;
  const seen = new Set<string>();
  let dupes = 0;

  for (const raw of table.slice(1)) {
    const date = toIsoDate(get(raw, "date") ?? "");
    const impressions = toNumber(get(raw, "impressions"));
    const clicks = toNumber(get(raw, "clicks"));
    const spend = toNumber(get(raw, "spend"));
    const campaign = (get(raw, "campaign") ?? "").trim() || "All campaigns";
    if (!date || impressions === null || clicks === null || spend === null) {
      dropped++;
      continue;
    }
    if (impressions < 0 || clicks < 0 || spend < 0 || clicks > impressions) {
      impossible++;
      dropped++;
      continue;
    }
    const pconv = toNumber(get(raw, "platform_conversions"));
    const wconv = toNumber(get(raw, "website_conversions"));
    const row: Row = {
      date,
      platform: (get(raw, "platform") ?? "").trim() || "Unknown",
      campaign,
      audience: (get(raw, "audience") ?? "").trim() || "All",
      creative: (get(raw, "creative") ?? "").trim() || "Unknown",
      impressions,
      reach: toNumber(get(raw, "reach")) ?? impressions,
      frequency: toNumber(get(raw, "frequency")) ?? 1,
      clicks,
      landing_page_views: toNumber(get(raw, "landing_page_views")) ?? clicks,
      spend,
      platform_conversions: pconv ?? wconv ?? 0,
      website_conversions: hasWebsiteConv ? wconv ?? 0 : pconv ?? 0,
      revenue: toNumber(get(raw, "revenue")) ?? 0,
    };
    const key = [row.date, row.campaign, row.audience, row.creative].join("|");
    if (seen.has(key)) {
      dupes++;
      dropped++;
      continue;
    }
    seen.add(key);
    rows.push(row);
  }

  if (impossible)
    issue({ severity: "warn", check: "impossible_values", message: `${impossible} row(s) had negative values or clicks > impressions and were removed.`, evidenceIds: [] });
  if (dupes) issue({ severity: "info", check: "duplicates", message: `${dupes} duplicate row(s) removed.`, evidenceIds: [] });
  const totalRaw = table.length - 1;
  if (dropped / totalRaw > 0.2)
    issue({ severity: "warn", check: "dropped_rows", message: `${dropped} of ${totalRaw} rows were unusable (>20%). Results may be biased.`, evidenceIds: [] });

  if (!rows.length) {
    issue({ severity: "block", check: "no_valid_rows", message: "No valid rows after cleaning.", evidenceIds: [] });
    return { rows, report: { ...emptyReport(), droppedRows: dropped } };
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  const days = dates.length;
  const daysEv = ev.add({ label: "Days of data in file", metric: "days", value: days, unit: "days", scope: "account" });

  if (days < RECENT_DAYS) {
    issue({ severity: "block", check: "too_few_days", message: `Only ${days} day(s) of data. At least ${RECENT_DAYS} are needed to diagnose trends.`, evidenceIds: [daysEv] });
  } else if (days < RECENT_DAYS * 2) {
    issue({ severity: "warn", check: "short_history", message: `Only ${days} days of data: baseline comparisons are less reliable (14+ recommended).`, evidenceIds: [daysEv] });
  }

  const wrongConv = rows.filter((r) => r.website_conversions > r.clicks).length;
  if (wrongConv)
    issue({ severity: "warn", check: "conv_gt_clicks", message: `${wrongConv} row(s) report more conversions than clicks (view-through or tracking error).`, evidenceIds: [] });

  // Tracking mismatch: platform-reported vs website (source of truth), per campaign.
  const recentStart = addDays(end, -(RECENT_DAYS - 1));
  const trackingChecks: TrackingCheck[] = [];
  if (hasWebsiteConv && hasPlatformConv) {
    for (const [campaign, cRows] of groupBy(rows, (r) => r.campaign)) {
      const base = aggregate(cRows.filter((r) => r.date < recentStart));
      const rec = aggregate(cRows.filter((r) => r.date >= recentStart));
      const status = rec.conversions >= 5 && rec.trackingRatio > TRACKING_MISMATCH_RATIO ? "mismatch" : "ok";
      let startDate: string | undefined;
      if (status === "mismatch") {
        // first day from which the daily ratio stays above threshold
        const byDay = [...groupBy(cRows, (r) => r.date)].sort(([a], [b]) => a.localeCompare(b));
        for (let i = byDay.length - 1; i >= 0; i--) {
          const m = aggregate(byDay[i][1]);
          if (m.conversions > 0 && m.trackingRatio > TRACKING_MISMATCH_RATIO) startDate = byDay[i][0];
          else break;
        }
      }
      // Baseline = before the break started (falls back to the pre-recent window).
      if (startDate) {
        const pre = aggregate(cRows.filter((r) => r.date < (startDate as string)));
        if (pre.conversions > 0) base.trackingRatio = pre.trackingRatio;
      }
      const check: TrackingCheck = {
        campaign,
        platform: cRows[0].platform,
        baselineRatio: base.trackingRatio,
        recentRatio: rec.trackingRatio,
        platformConversionsRecent: rec.platform_conversions,
        websiteConversionsRecent: rec.conversions,
        status,
        startDate,
      };
      trackingChecks.push(check);
      if (status === "mismatch") {
        const e1 = ev.add({ label: `Platform conversions, ${campaign}, last ${RECENT_DAYS} days`, metric: "platform_conversions", value: rec.platform_conversions, unit: "count", scope: campaign, period: "recent" });
        const e2 = ev.add({ label: `Website conversions, ${campaign}, last ${RECENT_DAYS} days`, metric: "website_conversions", value: rec.conversions, unit: "count", scope: campaign, period: "recent" });
        const e3 = ev.add({ label: `Platform / website conversion ratio, ${campaign}, last ${RECENT_DAYS} days`, metric: "tracking_ratio", value: rec.trackingRatio, unit: "x", scope: campaign, period: "recent" });
        const e4 = ev.add({ label: `Platform / website conversion ratio, ${campaign}, before ${startDate ?? "the last 7 days"}`, metric: "tracking_ratio", value: base.trackingRatio, unit: "x", scope: campaign, period: "baseline" });
        issue({
          severity: "warn",
          check: "tracking_mismatch",
          campaign,
          message: `${campaign}: platform reports ${rec.trackingRatio.toFixed(2)}x more conversions than the website${startDate ? ` since ${startDate}` : ""} (baseline ${base.trackingRatio.toFixed(2)}x). Platform CPA/ROAS for this campaign are unreliable; website numbers are used.`,
          evidenceIds: [e1, e2, e3, e4],
        });
      }
    }
  }

  const reliability: Reliability = issues.some((i) => i.severity === "block")
    ? "block"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  return {
    rows,
    report: {
      rowCount: rows.length,
      droppedRows: dropped,
      campaigns: [...new Set(rows.map((r) => r.campaign))],
      platforms: [...new Set(rows.map((r) => r.platform))],
      dateRange: { start, end, days },
      issues,
      trackingChecks,
      reliability,
      totals: aggregate(rows),
      evidence: ev.items,
      missingColumns: [...missingOptional],
      mode: "timeseries",
      detected: (table[0] ?? []).map((orig, i) => ({ role: header[i], column: orig.trim() })).filter((d) => (REQUIRED as readonly string[]).includes(d.role) || (OPTIONAL as readonly string[]).includes(d.role)),
    },
  };
}
