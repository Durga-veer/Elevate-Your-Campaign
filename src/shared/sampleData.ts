// Deterministic 30-day multi-platform demo dataset with 3 planted problems
// and 1 hidden opportunity. Same seed => same CSV every time.
//
// Planted:
//  1. Creative fatigue   - "Meta - Prospecting Video": frequency climbs from day 8,
//                          CTR decays from day 12, CPM flat => CPC and CPA rise.
//  2. Tracking break     - "Google - Performance Max": from day 18 platform-reported
//                          conversions ~2.9x website conversions (duplicate firing).
//  3. Landing-page issue - "Google - Search Non-Brand": from day 21 CTR stable but
//                          CVR collapses (~-78%) and landing-page-view rate drops.
//  +  Opportunity        - "Meta - Lookalike Purchasers": CPA far below account CPA,
//                          only ~4% of spend.
import type { BusinessProfile, Row } from "./types";

export const SAMPLE_PROFILE: BusinessProfile = {
  businessName: "Stride Athletics (demo)",
  goal: "purchases",
  productPrice: 90,
  marginPct: 45,
  targetCpa: 35,
  targetRoas: 2.5,
};

export const SAMPLE_DATASET_NAME = "sample_stride_athletics_sep2026.csv";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CampaignSpec {
  platform: string;
  campaign: string;
  audience: string;
  creative: string;
  impressions: number;
  /** "cpm" = spend driven by impressions (social), "cpc" = spend driven by clicks (search) */
  pricing: "cpm" | "cpc";
  cpm?: number;
  cpc?: number;
  ctr: number;
  cvr: number;
  lpRate: number;
  aov: number;
  freq: number;
  trackingRatio: number;
}

const SPECS: CampaignSpec[] = [
  { platform: "Meta", campaign: "Meta - Prospecting Video", audience: "Broad 25-44", creative: "Video A - Unboxing", impressions: 42000, pricing: "cpm", cpm: 13.6, ctr: 0.016, cvr: 0.032, lpRate: 0.82, aov: 90, freq: 1.6, trackingRatio: 1.06 },
  { platform: "Meta", campaign: "Meta - Lookalike Purchasers", audience: "Lookalike 1% Purchasers", creative: "Carousel - Bestsellers", impressions: 7000, pricing: "cpm", cpm: 12, ctr: 0.019, cvr: 0.058, lpRate: 0.85, aov: 92, freq: 1.5, trackingRatio: 1.05 },
  { platform: "Google", campaign: "Google - Search Non-Brand", audience: "Keywords: running shoes", creative: "RSA - Free Shipping", impressions: 18000, pricing: "cpc", cpc: 1.1, ctr: 0.046, cvr: 0.055, lpRate: 0.92, aov: 88, freq: 1.2, trackingRatio: 1.03 },
  { platform: "Google", campaign: "Google - Performance Max", audience: "PMax - All signals", creative: "Asset group - Core", impressions: 30000, pricing: "cpc", cpc: 0.7, ctr: 0.012, cvr: 0.038, lpRate: 0.86, aov: 85, freq: 1.4, trackingRatio: 1.04 },
  { platform: "Google", campaign: "Google - Search Brand", audience: "Keywords: brand terms", creative: "RSA - Brand", impressions: 6000, pricing: "cpc", cpc: 0.9, ctr: 0.09, cvr: 0.06, lpRate: 0.95, aov: 95, freq: 1.3, trackingRatio: 1.02 },
  { platform: "LinkedIn", campaign: "LinkedIn - Corporate Wellness", audience: "Job title: HR & Wellness Managers", creative: "Single image - Team Orders", impressions: 9000, pricing: "cpm", cpm: 38, ctr: 0.0055, cvr: 0.04, lpRate: 0.8, aov: 240, freq: 2.1, trackingRatio: 1.08 },
];

export function generateSampleRows(seed = 2026, startDate = "2026-09-01", days = 30): Row[] {
  const rand = mulberry32(seed);
  const noise = (pct: number) => 1 + (rand() * 2 - 1) * pct;
  const intRound = (x: number) => Math.max(0, Math.floor(x + rand())); // randomized rounding
  const start = new Date(startDate + "T00:00:00Z");
  const rows: Row[] = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(start.getTime() + d * 86400000).toISOString().slice(0, 10);
    const weekend = [0, 6].includes(new Date(date + "T00:00:00Z").getUTCDay());
    for (const s of SPECS) {
      let ctr = s.ctr;
      let cvr = s.cvr;
      let lpRate = s.lpRate;
      let freq = s.freq;
      let trackingRatio = s.trackingRatio;

      // 1. Creative fatigue
      if (s.campaign === "Meta - Prospecting Video") {
        if (d >= 7) freq = s.freq + (d - 7) * 0.19; // 1.6 -> ~5.8
        if (d >= 11) ctr = s.ctr * Math.max(0.42, 1 - 0.034 * (d - 10));
      }
      // 2. Tracking break
      if (s.campaign === "Google - Performance Max" && d >= 17) trackingRatio = 2.9;
      // 3. Landing-page issue
      if (s.campaign === "Google - Search Non-Brand" && d >= 20) {
        cvr = s.cvr * 0.22;
        lpRate = 0.58;
      }

      const impressions = Math.round(s.impressions * noise(0.08) * (weekend ? 0.9 : 1));
      const clicks = intRound(impressions * ctr * noise(0.06));
      const spend =
        s.pricing === "cpm"
          ? (impressions / 1000) * (s.cpm as number) * noise(0.04)
          : clicks * (s.cpc as number) * noise(0.05);
      const lpv = Math.min(clicks, intRound(clicks * lpRate * noise(0.03)));
      const websiteConv = intRound(clicks * cvr * noise(0.15));
      const platformConv = intRound(websiteConv * trackingRatio * noise(0.05));
      const revenue = websiteConv * s.aov * noise(0.08);
      const frequency = +(freq * noise(0.03)).toFixed(2);

      rows.push({
        date,
        platform: s.platform,
        campaign: s.campaign,
        audience: s.audience,
        creative: s.creative,
        impressions,
        reach: Math.round(impressions / Math.max(1, 1 + (frequency - 1) * 0.35)),
        frequency,
        clicks,
        landing_page_views: lpv,
        spend: +spend.toFixed(2),
        platform_conversions: platformConv,
        website_conversions: websiteConv,
        revenue: +revenue.toFixed(2),
      });
    }
  }
  return rows;
}

export const CSV_COLUMNS: (keyof Row)[] = [
  "date",
  "platform",
  "campaign",
  "audience",
  "creative",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "landing_page_views",
  "spend",
  "platform_conversions",
  "website_conversions",
  "revenue",
];

export function rowsToCsv(rows: Row[]): string {
  const esc = (v: unknown) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c])).join(","))].join("\n");
}

export function sampleCsv(): string {
  return rowsToCsv(generateSampleRows());
}
