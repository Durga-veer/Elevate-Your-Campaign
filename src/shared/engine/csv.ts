// Minimal RFC-4180-ish CSV parser + header normalisation (no dependencies).

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) out.push(row);
  return out;
}

/** Map common export headers (Meta / Google / LinkedIn) onto our canonical columns. */
const ALIASES: Record<string, string> = {
  day: "date",
  reporting_starts: "date",
  source: "platform",
  network: "platform",
  campaign_name: "campaign",
  ad_set: "audience",
  ad_set_name: "audience",
  ad_group: "audience",
  audience_name: "audience",
  ad: "creative",
  ad_name: "creative",
  creative_name: "creative",
  impr: "impressions",
  link_clicks: "clicks",
  clicks_all: "clicks",
  lp_views: "landing_page_views",
  landing_page_view: "landing_page_views",
  amount_spent: "spend",
  ad_spend: "spend",
  media_cost: "spend",
  amount_spent_usd: "spend",
  cost: "spend",
  conversions: "platform_conversions",
  results: "platform_conversions",
  purchases: "platform_conversions",
  backend_conversions: "website_conversions",
  site_conversions: "website_conversions",
  orders: "website_conversions",
  conversion_value: "revenue",
  purchase_value: "revenue",
  purchases_conversion_value: "revenue",
};

export function normaliseHeader(h: string): string {
  const k = h
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // camelCase -> camel_Case
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return ALIASES[k] ?? k;
}

export function toNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim().replace(/[$€£,%\s]/g, "");
  if (t === "" || t === "-" || t.toLowerCase() === "n/a") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function toIsoDate(v: string): string | null {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
