import type { Metrics, Row } from "../types";

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

export function aggregate(rows: Row[]): Metrics {
  let impressions = 0,
    reach = 0,
    clicks = 0,
    lpv = 0,
    spend = 0,
    conversions = 0,
    pconv = 0,
    revenue = 0,
    freqWeighted = 0;
  for (const r of rows) {
    impressions += r.impressions;
    reach += r.reach;
    clicks += r.clicks;
    lpv += r.landing_page_views;
    spend += r.spend;
    conversions += r.website_conversions;
    pconv += r.platform_conversions;
    revenue += r.revenue;
    freqWeighted += r.frequency * r.impressions;
  }
  return {
    impressions,
    reach,
    clicks,
    landing_page_views: lpv,
    spend,
    conversions,
    platform_conversions: pconv,
    revenue,
    frequency: safeDiv(freqWeighted, impressions),
    ctr: safeDiv(clicks, impressions),
    cpc: safeDiv(spend, clicks),
    cpm: safeDiv(spend * 1000, impressions),
    cvr: safeDiv(conversions, clicks),
    cpa: safeDiv(spend, conversions),
    roas: safeDiv(revenue, spend),
    lpRate: safeDiv(lpv, clicks),
    trackingRatio: safeDiv(pconv, conversions),
  };
}

/** Percent change, or null when the baseline is zero. */
export function pctChange(baseline: number, recent: number): number | null {
  if (!baseline) return null;
  return ((recent - baseline) / baseline) * 100;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function addDays(iso: string, n: number): string {
  return new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}
