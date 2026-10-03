// Campaign health score: 6 explainable components (0-100), each with reasons + evidence.
import type { BusinessProfile, CampaignSummary, DataReport, Finding, Health, HealthComponent, Metrics } from "../types";
import { fmtMoney, fmtPct } from "./format";
import { pctChange } from "./metrics";

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

export const HEALTH_WEIGHTS = { goal: 0.25, budget: 0.15, creative: 0.15, audience: 0.1, conversion: 0.2, data_quality: 0.15 };

interface Input {
  account: { baseline: Metrics; recent: Metrics; total: Metrics };
  campaigns: CampaignSummary[];
  findings: Finding[];
  data: DataReport;
  profile: BusinessProfile;
  accEv: { cpaRecent: string; cpaBase: string; roasRecent: string; cvrRecent: string; cvrBase: string; targetCpa: string; targetRoas: string };
}

export function computeHealth({ account, campaigns, findings, data, profile, accEv }: Input): Health {
  const r = account.recent;
  const byType = (t: Finding["type"]) => findings.filter((f) => f.type === t);

  // Goal
  const cpaScore = r.cpa > 0 ? (100 * profile.targetCpa) / r.cpa : 50;
  const roasScore = r.revenue > 0 ? (100 * r.roas) / profile.targetRoas : cpaScore;
  const cpaTrend = pctChange(account.baseline.cpa, r.cpa) ?? 0;
  const goal: HealthComponent = {
    key: "goal",
    label: "Goal",
    // Hitting target today is not "healthy" if CPA is climbing fast: penalise the trend.
    score: clamp((Math.min(100, cpaScore) + Math.min(100, roasScore)) / 2 - Math.max(0, cpaTrend) * 0.6),
    reasons: [
      `Last-7-day CPA ${fmtMoney(r.cpa)} vs target ${fmtMoney(profile.targetCpa)}.`,
      `Account CPA ${fmtMoney(account.baseline.cpa)} baseline -> ${fmtMoney(r.cpa)} last 7 days.`,
      r.revenue > 0 ? `Last-7-day ROAS ${r.roas.toFixed(2)}x vs target ${profile.targetRoas.toFixed(2)}x.` : "No revenue data: ROAS not scored.",
    ],
    evidenceIds: [accEv.cpaRecent, accEv.cpaBase, accEv.targetCpa, accEv.roasRecent, accEv.targetRoas],
  };

  // Budget: share of recent spend in campaigns above 1.3x target CPA
  const overspend = campaigns.filter((c) => c.recent.conversions > 0 && c.recent.cpa > profile.targetCpa * 1.3);
  const badShare = r.spend ? overspend.reduce((a, c) => a + c.recent.spend, 0) / r.spend : 0;
  const budget: HealthComponent = {
    key: "budget",
    label: "Budget",
    score: clamp(100 * (1 - badShare)),
    reasons: [
      `${fmtPct(badShare, 1)} of last-7-day spend went to campaigns with CPA above 1.3x target.`,
      ...overspend.map((c) => `${c.campaign}: CPA ${fmtMoney(c.recent.cpa)}.`),
    ],
    evidenceIds: [accEv.targetCpa],
  };

  // Creative
  const fatigue = byType("creative_fatigue");
  const avgFreq = r.frequency;
  const creative: HealthComponent = {
    key: "creative",
    label: "Creative",
    score: clamp(100 - fatigue.length * 35 - (avgFreq > 3 ? 10 : 0)),
    reasons: [
      fatigue.length ? `${fatigue.length} campaign(s) show creative fatigue (CTR falling as frequency rises).` : "No creative fatigue detected.",
      `Account average frequency last 7 days: ${avgFreq.toFixed(2)}.`,
    ],
    evidenceIds: fatigue.flatMap((f) => f.evidenceIds.slice(0, 3)),
  };

  // Audience
  const opp = byType("audience_opportunity");
  const waste = byType("budget_waste");
  const audience: HealthComponent = {
    key: "audience",
    label: "Audience",
    score: clamp(90 - opp.length * 12 - waste.length * 12),
    reasons: [
      opp.length ? `${opp.length} high-performing audience(s) are under-funded (untapped upside).` : "No under-funded winning audience found.",
      waste.length ? `${waste.length} campaign(s) miss the goal without a fixable root cause.` : "No structurally expensive audience found.",
    ],
    evidenceIds: [...opp, ...waste].flatMap((f) => f.evidenceIds.slice(0, 2)),
  };

  // Conversion
  const dCvr = pctChange(account.baseline.cvr, r.cvr) ?? 0;
  const lp = byType("landing_page_issue");
  const conversion: HealthComponent = {
    key: "conversion",
    label: "Conversion",
    score: clamp(100 + Math.min(0, dCvr) * 1.0 - lp.length * 25),
    reasons: [
      `Account conversion rate ${fmtPct(account.baseline.cvr)} baseline -> ${fmtPct(r.cvr)} last 7 days.`,
      lp.length ? `${lp.length} campaign(s) with a post-click / landing-page problem.` : "No post-click problems detected.",
    ],
    evidenceIds: [accEv.cvrBase, accEv.cvrRecent, ...lp.flatMap((f) => f.evidenceIds.slice(3, 6))],
  };

  // Data quality
  const mismatches = data.trackingChecks.filter((t) => t.status === "mismatch").length;
  const warns = data.issues.filter((i) => i.severity === "warn" && i.check !== "tracking_mismatch").length;
  const blocks = data.issues.filter((i) => i.severity === "block").length;
  const dq: HealthComponent = {
    key: "data_quality",
    label: "Data Quality",
    score: clamp(100 - mismatches * 30 - warns * 10 - blocks * 50),
    reasons: [
      mismatches ? `${mismatches} campaign(s) where platform conversions disagree with website conversions.` : "Platform and website conversions agree.",
      `${data.rowCount} valid rows, ${data.droppedRows} dropped, ${data.dateRange.days} days.`,
      ...data.issues.filter((i) => i.severity !== "info" && i.check !== "tracking_mismatch").map((i) => i.message),
    ],
    evidenceIds: data.issues.flatMap((i) => i.evidenceIds),
  };

  const components = [goal, budget, creative, audience, conversion, dq];
  const overall = clamp(components.reduce((a, c) => a + c.score * HEALTH_WEIGHTS[c.key], 0));
  return { overall, components };
}
