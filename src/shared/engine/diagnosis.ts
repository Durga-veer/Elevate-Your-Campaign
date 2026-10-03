// Diagnosis Agent core (pure code): period comparison, change-point / z-score
// anomaly detection, rule-based metric tree, audience/budget/opportunity analysis,
// priority scoring, health score and campaign story. The LLM never does this math.
import type {
  BusinessProfile,
  CampaignSummary,
  ChainNode,
  DailyPoint,
  DataReport,
  DiagnosisEngineOutput,
  Finding,
  Metrics,
  Row,
  StoryEvent,
} from "../types";
import { RECENT_DAYS } from "./dataQuality";
import { EvidenceRegistry } from "./evidence";
import { fmtChange, fmtMoney, fmtPct } from "./format";
import { computeHealth } from "./health";
import { addDays, aggregate, groupBy, mean, pctChange, std } from "./metrics";
import { scorePriorities } from "./priority";

// ---- Thresholds (the metric tree). Documented in docs/BLUEPRINT.md ----
export const RULES = {
  fatigue: { ctrDrop: -20, freqRise: 30, freqAbs: 3.5 },
  landing: { cvrDrop: -35, ctrStableBand: 15, lpDrop: -15 },
  auction: { cpmRise: 25, ctrStableBand: 15 },
  waste: { roasFactor: 0.6, cpaFactor: 1.5, minShare: 0.05 },
  opportunity: { cpaFactor: 0.6, maxShare: 0.15, minConversions: 20 },
  minClicksRecent: 100,
  stableBand: 15,
  z: 2,
};

const dir = (chg: number | null, band = RULES.stableBand): ChainNode["direction"] =>
  chg === null || Math.abs(chg) < band ? "stable" : chg > 0 ? "up" : "down";

/** Change point = first day where the 3-day rolling mean stays >= z std devs
 * away from the first-week reference, in the given direction, for 3+ days. */
export function changePoint(daily: DailyPoint[], key: keyof DailyPoint, direction: "up" | "down"): string | undefined {
  const xs = daily.map((d) => Number(d[key]));
  if (xs.length < 12) return undefined;
  const ref = xs.slice(0, 7);
  const m = mean(ref);
  const s = Math.max(std(ref), Math.abs(m) * 0.05, 1e-9);
  const roll = xs.map((_, i) => mean(xs.slice(Math.max(0, i - 2), i + 1)));
  let run = 0;
  for (let i = 7; i < roll.length; i++) {
    const z = (roll[i] - m) / s;
    const hit = direction === "up" ? z > RULES.z : z < -RULES.z;
    run = hit ? run + 1 : 0;
    if (run === 3) return daily[Math.max(0, i - 4)].date; // back off to the onset of the rolling window
  }
  return undefined;
}

function toDaily(rows: Row[]): DailyPoint[] {
  return [...groupBy(rows, (r) => r.date)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rs]) => {
      const m = aggregate(rs);
      return {
        date,
        ctr: m.ctr,
        cvr: m.cvr,
        cpa: m.cpa,
        frequency: m.frequency,
        spend: m.spend,
        conversions: m.conversions,
        platform_conversions: m.platform_conversions,
        roas: m.roas,
        lpRate: m.lpRate,
      };
    });
}

export function runDiagnosisEngine(rows: Row[], data: DataReport, profile: BusinessProfile): DiagnosisEngineOutput {
  const ev = new EvidenceRegistry("E");
  const end = data.dateRange.end;
  const recentStart = addDays(end, -(RECENT_DAYS - 1));
  const baselineEnd = addDays(recentStart, -1);
  const periods = {
    baseline: { start: data.dateRange.start, end: baselineEnd },
    recent: { start: recentStart, end },
  };
  const isRecent = (r: Row) => r.date >= recentStart;

  const account = {
    baseline: aggregate(rows.filter((r) => !isRecent(r))),
    recent: aggregate(rows.filter(isRecent)),
    total: aggregate(rows),
  };

  const campaigns: CampaignSummary[] = [...groupBy(rows, (r) => r.campaign)].map(([campaign, rs]) => {
    const total = aggregate(rs);
    return {
      campaign,
      platform: rs[0].platform,
      audience: [...new Set(rs.map((r) => r.audience))].join(", "),
      creative: [...new Set(rs.map((r) => r.creative))].join(", "),
      baseline: aggregate(rs.filter((r) => !isRecent(r))),
      recent: aggregate(rs.filter(isRecent)),
      total,
      spendShare: account.total.spend ? total.spend / account.total.spend : 0,
      daily: toDaily(rs),
    };
  });

  // Account-level evidence used across findings / health.
  const acc = {
    cpaRecent: ev.add({ label: "Account CPA (website conversions), last 7 days", metric: "cpa", value: account.recent.cpa, unit: "currency", scope: "account", period: "recent" }),
    cpaBase: ev.add({ label: "Account CPA (website conversions), baseline", metric: "cpa", value: account.baseline.cpa, unit: "currency", scope: "account", period: "baseline" }),
    roasRecent: ev.add({ label: "Account ROAS, last 7 days", metric: "roas", value: account.recent.roas, unit: "x", scope: "account", period: "recent" }),
    cvrRecent: ev.add({ label: "Account conversion rate, last 7 days", metric: "cvr", value: account.recent.cvr, unit: "pct", scope: "account", period: "recent" }),
    cvrBase: ev.add({ label: "Account conversion rate, baseline", metric: "cvr", value: account.baseline.cvr, unit: "pct", scope: "account", period: "baseline" }),
    targetCpa: ev.add({ label: "Target CPA (business profile)", metric: "target_cpa", value: profile.targetCpa, unit: "currency", scope: "profile" }),
    targetRoas: ev.add({ label: "Target ROAS (business profile)", metric: "target_roas", value: profile.targetRoas, unit: "x", scope: "profile" }),
    spendRecent: ev.add({ label: "Account spend, last 7 days", metric: "spend", value: account.recent.spend, unit: "currency", scope: "account", period: "recent" }),
  };

  const UNITS: Partial<Record<keyof Metrics, "pct" | "currency" | "ratio" | "x" | "count">> = {
    ctr: "pct", cvr: "pct", lpRate: "pct", cpa: "currency", cpc: "currency", cpm: "currency",
    frequency: "ratio", roas: "x", conversions: "count", spend: "currency", platform_conversions: "count",
  };
  const NAMES: Partial<Record<keyof Metrics, string>> = {
    ctr: "CTR", cvr: "Conversion rate", lpRate: "Landing-page view rate", cpa: "CPA", cpc: "CPC", cpm: "CPM",
    frequency: "Frequency", roas: "ROAS", conversions: "Website conversions", spend: "Spend", platform_conversions: "Platform conversions",
  };

  const PER_DAY: (keyof Metrics)[] = ["conversions", "platform_conversions", "spend", "clicks", "impressions", "revenue"];
  const baselineDays = Math.max(1, data.dateRange.days - RECENT_DAYS);

  /** Adds baseline / recent / change evidence for one campaign metric. */
  const metricEv = (c: CampaignSummary, k: keyof Metrics) => {
    const unit = UNITS[k] ?? "ratio";
    // Volume metrics are compared as daily averages (periods have different lengths).
    const perDay = PER_DAY.includes(k);
    const name = (NAMES[k] ?? k) + (perDay ? " per day" : "");
    const b = perDay ? c.baseline[k] / baselineDays : c.baseline[k];
    const r = perDay ? c.recent[k] / RECENT_DAYS : c.recent[k];
    const chg = pctChange(b, r);
    const base = ev.add({ label: `${name}, ${c.campaign}, baseline (${periods.baseline.start} to ${periods.baseline.end})`, metric: k, value: b, unit, scope: c.campaign, period: "baseline", display: perDay && unit === "count" ? b.toFixed(1) : undefined });
    const recent = ev.add({ label: `${name}, ${c.campaign}, last 7 days`, metric: k, value: r, unit, scope: c.campaign, period: "recent", display: perDay && unit === "count" ? r.toFixed(1) : undefined });
    const change = ev.add({ label: `${name} change, ${c.campaign}, last 7 days vs baseline`, metric: `${k}_change`, value: (chg ?? 0) / 100, display: fmtChange(chg), unit: "pct", scope: c.campaign });
    return { base, recent, change, chg };
  };

  const findings: Finding[] = [];
  const story: StoryEvent[] = [
    { date: data.dateRange.start, title: "Data starts", detail: `${data.campaigns.length} campaigns across ${data.platforms.join(", ")}.`, tone: "neutral" },
  ];
  let fN = 0;
  const nextId = () => `F${++fN}`;
  const explained = new Set<string>(); // campaigns whose CPA rise has a root cause

  const weeklyExcessCost = (c: CampaignSummary) =>
    c.baseline.cpa > 0 && c.recent.cpa > c.baseline.cpa ? (c.recent.cpa - c.baseline.cpa) * c.recent.conversions : 0;

  for (const c of campaigns) {
    if (c.recent.clicks < RULES.minClicksRecent) continue;
    const dCtr = pctChange(c.baseline.ctr, c.recent.ctr);
    const dCvr = pctChange(c.baseline.cvr, c.recent.cvr);
    const dFreq = pctChange(c.baseline.frequency, c.recent.frequency);
    const dCpm = pctChange(c.baseline.cpm, c.recent.cpm);
    const dLp = pctChange(c.baseline.lpRate, c.recent.lpRate);
    const tracking = data.trackingChecks.find((t) => t.campaign === c.campaign);

    // ---- Rule F: creative fatigue. CPA^ <- CPC^ <- CTRv <- Frequency^ (CPM flat, CVR flat)
    if (dCtr !== null && dCtr <= RULES.fatigue.ctrDrop && ((dFreq ?? 0) >= RULES.fatigue.freqRise || c.recent.frequency >= RULES.fatigue.freqAbs)) {
      const cpa = metricEv(c, "cpa"), cpc = metricEv(c, "cpc"), ctr = metricEv(c, "ctr"), fq = metricEv(c, "frequency"), cpm = metricEv(c, "cpm"), cvr = metricEv(c, "cvr");
      const freqStart = changePoint(c.daily, "frequency", "up");
      const ctrStart = changePoint(c.daily, "ctr", "down");
      const signals = [true, (dFreq ?? 0) >= RULES.fatigue.freqRise, dir(dCpm) === "stable", dir(dCvr, 20) === "stable", !!freqStart && !!ctrStart && freqStart <= ctrStart].filter(Boolean).length;
      const cost = weeklyExcessCost(c);
      const costEv = ev.add({ label: `Estimated extra cost vs baseline CPA, ${c.campaign}, last 7 days (estimate)`, metric: "excess_cost", value: cost, unit: "currency", scope: c.campaign });
      const id = nextId();
      findings.push({
        id, type: "creative_fatigue", category: "creative", kind: "problem",
        severity: (cpa.chg ?? 0) > 60 ? "critical" : (cpa.chg ?? 0) > 30 ? "high" : "medium",
        title: `Creative fatigue on ${c.campaign}`,
        campaign: c.campaign, platform: c.platform, ruleId: "R1_CREATIVE_FATIGUE",
        ruleText: "CTR down >=20% while frequency up >=30% (or >=3.5) => the same people keep seeing the same ad; CPC rises because CPM is flat and fewer people click.",
        chain: [
          { metric: "CPA", direction: dir(cpa.chg), changePct: cpa.chg, evidenceId: cpa.change, note: "Cost per conversion went up" },
          { metric: "CPC", direction: dir(cpc.chg), changePct: cpc.chg, evidenceId: cpc.change, note: "Each click got more expensive" },
          { metric: "CPM", direction: dir(cpm.chg), changePct: cpm.chg, evidenceId: cpm.change, note: "Auction price is flat, so it is not competition" },
          { metric: "CVR", direction: dir(cvr.chg, 20), changePct: cvr.chg, evidenceId: cvr.change, note: "Post-click conversion is roughly unchanged" },
          { metric: "CTR", direction: dir(ctr.chg), changePct: ctr.chg, evidenceId: ctr.change, note: "Fewer people click the ad" },
          { metric: "Frequency", direction: dir(fq.chg), changePct: fq.chg, evidenceId: fq.change, note: "Same audience sees the ad more often", isRootCause: true },
        ],
        evidenceIds: [cpa.base, cpa.recent, cpa.change, cpc.change, ctr.base, ctr.recent, ctr.change, fq.base, fq.recent, fq.change, cpm.change, cvr.change, costEv],
        startDate: freqStart ?? ctrStart,
        supportingSignals: signals,
        impact: { weeklyCostEstimate: cost, evidenceId: costEv, note: "Extra spend last 7 days compared with paying the baseline CPA (estimate)." },
      });
      explained.add(c.campaign);
      if (freqStart) story.push({ date: freqStart, title: "Frequency starts climbing", detail: `${c.campaign}: the same audience sees the ad more often.`, findingId: id, tone: "warn" });
      if (ctrStart) story.push({ date: ctrStart, title: "CTR starts falling", detail: `${c.campaign}: ${fmtPct(c.baseline.ctr)} baseline -> ${fmtPct(c.recent.ctr)} last 7 days.`, findingId: id, tone: "bad" });
    }

    // ---- Rule L: landing-page / post-click issue. CPA^ <- CVRv while CTR stable (+ LP view rate v)
    if (dCvr !== null && dCvr <= RULES.landing.cvrDrop && Math.abs(dCtr ?? 0) < RULES.landing.ctrStableBand) {
      const cpa = metricEv(c, "cpa"), cvr = metricEv(c, "cvr"), ctr = metricEv(c, "ctr"), lp = metricEv(c, "lpRate");
      const cvrStart = changePoint(c.daily, "cvr", "down");
      const lpDown = (dLp ?? 0) <= RULES.landing.lpDrop;
      const signals = [true, true, lpDown, tracking?.status !== "mismatch", !!cvrStart].filter(Boolean).length;
      const cost = weeklyExcessCost(c);
      const costEv = ev.add({ label: `Estimated extra cost vs baseline CPA, ${c.campaign}, last 7 days (estimate)`, metric: "excess_cost", value: cost, unit: "currency", scope: c.campaign });
      const id = nextId();
      findings.push({
        id, type: "landing_page_issue", category: "conversion", kind: "problem",
        severity: (dCvr ?? 0) < -60 ? "critical" : "high",
        title: `Post-click / landing-page problem on ${c.campaign}`,
        campaign: c.campaign, platform: c.platform, ruleId: "R2_POST_CLICK",
        ruleText: "Conversion rate down >=35% while CTR is stable (+/-15%) => the ad still attracts clicks, so the break is after the click (landing page, checkout, offer or tracking).",
        chain: [
          { metric: "CPA", direction: dir(cpa.chg), changePct: cpa.chg, evidenceId: cpa.change, note: "Cost per conversion went up" },
          { metric: "CVR", direction: dir(cvr.chg), changePct: cvr.chg, evidenceId: cvr.change, note: "Far fewer clicks turn into purchases" },
          { metric: "CTR", direction: dir(ctr.chg), changePct: ctr.chg, evidenceId: ctr.change, note: "Ad engagement is stable, so the ad is not the problem" },
          { metric: "Landing-page view rate", direction: dir(lp.chg), changePct: lp.chg, evidenceId: lp.change, note: lpDown ? "Fewer clicks even load the page: slow or broken page likely" : "Page loads normally: offer / checkout more likely", isRootCause: true },
        ],
        evidenceIds: [cpa.base, cpa.recent, cpa.change, cvr.base, cvr.recent, cvr.change, ctr.change, lp.base, lp.recent, lp.change, costEv],
        startDate: cvrStart,
        supportingSignals: signals,
        impact: { weeklyCostEstimate: cost, evidenceId: costEv, note: "Extra spend last 7 days compared with paying the baseline CPA (estimate)." },
      });
      explained.add(c.campaign);
      if (cvrStart) story.push({ date: cvrStart, title: "Conversion rate collapses", detail: `${c.campaign}: CTR steady but CVR ${fmtPct(c.baseline.cvr)} -> ${fmtPct(c.recent.cvr)}.`, findingId: id, tone: "bad" });
    }

    // ---- Rule A: auction pressure. CPC^ <- CPM^ with CTR stable
    if (dCpm !== null && dCpm >= RULES.auction.cpmRise && Math.abs(dCtr ?? 0) < RULES.auction.ctrStableBand && !explained.has(c.campaign)) {
      const cpm = metricEv(c, "cpm"), cpc = metricEv(c, "cpc"), ctr = metricEv(c, "ctr");
      const cost = weeklyExcessCost(c);
      const costEv = ev.add({ label: `Estimated extra cost vs baseline CPA, ${c.campaign}, last 7 days (estimate)`, metric: "excess_cost", value: cost, unit: "currency", scope: c.campaign });
      findings.push({
        id: nextId(), type: "auction_pressure", category: "platform", kind: "problem", severity: "medium",
        title: `Rising auction costs on ${c.campaign}`, campaign: c.campaign, platform: c.platform, ruleId: "R4_AUCTION",
        ruleText: "CPM up >=25% with stable CTR => paying more for the same attention (competition / seasonality).",
        chain: [
          { metric: "CPC", direction: dir(cpc.chg), changePct: cpc.chg, evidenceId: cpc.change, note: "Clicks cost more" },
          { metric: "CTR", direction: dir(ctr.chg), changePct: ctr.chg, evidenceId: ctr.change, note: "Ad still engages" },
          { metric: "CPM", direction: dir(cpm.chg), changePct: cpm.chg, evidenceId: cpm.change, note: "Auction price rose", isRootCause: true },
        ],
        evidenceIds: [cpm.base, cpm.recent, cpm.change, cpc.change, ctr.change, costEv],
        supportingSignals: 2,
        impact: { weeklyCostEstimate: cost, evidenceId: costEv, note: "Extra spend vs baseline CPA (estimate)." },
      });
      explained.add(c.campaign);
    }
  }

  // ---- Rule T: tracking break (from Data Agent checks)
  for (const t of data.trackingChecks.filter((t) => t.status === "mismatch")) {
    const c = campaigns.find((x) => x.campaign === t.campaign);
    if (!c) continue;
    const pc = metricEv(c, "platform_conversions");
    const wc = metricEv(c, "conversions");
    const dataIssue = data.issues.find((i) => i.check === "tracking_mismatch" && i.campaign === t.campaign);
    const spendEv = ev.add({ label: `Spend at risk of misallocation, ${c.campaign}, last 7 days`, metric: "spend", value: c.recent.spend, unit: "currency", scope: c.campaign, period: "recent" });
    const platformCpa = c.recent.platform_conversions ? c.recent.spend / c.recent.platform_conversions : 0;
    const pCpaEv = ev.add({ label: `CPA as reported by ${c.platform} (platform conversions), ${c.campaign}, last 7 days`, metric: "platform_cpa", value: platformCpa, unit: "currency", scope: c.campaign, period: "recent" });
    const wCpaEv = ev.add({ label: `CPA using website conversions, ${c.campaign}, last 7 days`, metric: "cpa", value: c.recent.cpa, unit: "currency", scope: c.campaign, period: "recent" });
    const id = nextId();
    const clicksChg = pctChange(c.baseline.clicks / baselineDays, c.recent.clicks / RECENT_DAYS);
    const signals = [true, dir(wc.chg, 20) === "stable", dir(clicksChg, 20) === "stable", !!t.startDate, t.baselineRatio < 1.3].filter(Boolean).length;
    findings.push({
      id, type: "tracking_break", category: "data_quality", kind: "data_warning", severity: "high",
      title: `Tracking mismatch on ${c.campaign}`,
      campaign: c.campaign, platform: c.platform, ruleId: "R3_TRACKING",
      ruleText: "Platform conversions > 1.5x website conversions while website conversions and clicks are stable => platform is over-counting (duplicate pixel/tag, attribution change). Platform-reported CPA/ROAS cannot be trusted.",
      chain: [
        { metric: "Platform-reported CPA", direction: "down", changePct: null, evidenceId: pCpaEv, note: "Platform makes the campaign look cheaper than it is" },
        { metric: "Platform conversions", direction: dir(pc.chg), changePct: pc.chg, evidenceId: pc.change, note: "Platform counts many more conversions" },
        { metric: "Website conversions", direction: dir(wc.chg, 20), changePct: wc.chg, evidenceId: wc.change, note: "Real orders did not change much" },
        { metric: "Tracking (pixel / tag)", direction: "up", changePct: null, evidenceId: dataIssue?.evidenceIds[2], note: "Conversion event is likely firing twice or attribution changed", isRootCause: true },
      ],
      evidenceIds: [...(dataIssue?.evidenceIds ?? []), pc.change, wc.base, wc.recent, wc.change, pCpaEv, wCpaEv, spendEv],
      startDate: t.startDate,
      supportingSignals: signals,
      impact: { weeklyCostEstimate: c.recent.spend, evidenceId: spendEv, note: "Weekly spend whose optimisation signal is corrupted (not money lost directly)." },
      dataCaveat: "Diagnosis for this campaign uses website conversions only.",
    });
    if (t.startDate) story.push({ date: t.startDate, title: "Tracking breaks", detail: `${c.campaign}: platform conversions jump to ${t.recentRatio.toFixed(1)}x website orders.`, findingId: id, tone: "warn" });
  }

  // ---- Rule W: budget waste on campaigns missing goal without another root cause
  for (const c of campaigns) {
    if (explained.has(c.campaign) || c.recent.conversions < 3) continue;
    const share = account.recent.spend ? c.recent.spend / account.recent.spend : 0;
    const roasBad = c.recent.revenue > 0 && c.recent.roas < profile.targetRoas * RULES.waste.roasFactor;
    const cpaBad = profile.goal !== "revenue" && c.recent.cpa > profile.targetCpa * RULES.waste.cpaFactor;
    if (share < RULES.waste.minShare || !(roasBad || cpaBad)) continue;
    const cpa = metricEv(c, "cpa"), roas = metricEv(c, "roas");
    const shareEv = ev.add({ label: `Share of account spend, ${c.campaign}, last 7 days`, metric: "spend_share", value: share, unit: "pct", scope: c.campaign, period: "recent" });
    const excess = Math.max(0, c.recent.spend - c.recent.conversions * profile.targetCpa);
    const costEv = ev.add({ label: `Spend above target-CPA level, ${c.campaign}, last 7 days (estimate)`, metric: "excess_cost", value: excess, unit: "currency", scope: c.campaign });
    findings.push({
      id: nextId(), type: "budget_waste", category: "budget", kind: "problem", severity: "medium",
      title: `${c.campaign} misses the CPA/ROAS goal`,
      campaign: c.campaign, platform: c.platform, ruleId: "R5_BUDGET_WASTE",
      ruleText: "Campaign with >=5% of spend and CPA > 1.5x target or ROAS < 0.6x target, with no other root cause found => budget allocation problem (structurally expensive).",
      chain: [
        { metric: "ROAS vs target", direction: "down", changePct: roas.chg, evidenceId: roas.recent, note: "Revenue per dollar below goal" },
        { metric: "CPA vs target", direction: "up", changePct: cpa.chg, evidenceId: cpa.recent, note: "Each conversion costs more than the target" },
        { metric: "Budget share", direction: "stable", changePct: null, evidenceId: shareEv, note: "Still receives a meaningful share of budget", isRootCause: true },
      ],
      evidenceIds: [cpa.recent, roas.recent, shareEv, costEv, acc.targetCpa, acc.targetRoas],
      supportingSignals: 2 + (roasBad && cpaBad ? 1 : 0),
      impact: { weeklyCostEstimate: excess, evidenceId: costEv, note: "Spend above what target CPA would allow for the same conversions (estimate)." },
    });
  }

  // ---- Rule O: audience opportunity
  const audiences = [...groupBy(rows, (r) => r.audience)].map(([audience, rs]) => ({ audience, rs, m: aggregate(rs), recent: aggregate(rs.filter(isRecent)) }));
  for (const a of audiences) {
    const share = account.total.spend ? a.m.spend / account.total.spend : 0;
    const isBrand = /brand/i.test(a.audience) || rs0(a.rs).some((c) => /brand/i.test(c));
    if (isBrand || a.m.conversions < RULES.opportunity.minConversions || share >= RULES.opportunity.maxShare) continue;
    if (a.m.cpa > account.total.cpa * RULES.opportunity.cpaFactor) continue;
    const campaign = a.rs[0].campaign;
    const cpaEv = ev.add({ label: `CPA, audience "${a.audience}", full period`, metric: "cpa", value: a.m.cpa, unit: "currency", scope: a.audience });
    const accCpaEv = ev.add({ label: "Account CPA, full period", metric: "cpa", value: account.total.cpa, unit: "currency", scope: "account" });
    const shareEv = ev.add({ label: `Share of account spend, audience "${a.audience}", full period`, metric: "spend_share", value: share, unit: "pct", scope: a.audience });
    const convEv = ev.add({ label: `Website conversions, audience "${a.audience}", full period`, metric: "conversions", value: a.m.conversions, unit: "count", scope: a.audience });
    const roasEv = ev.add({ label: `ROAS, audience "${a.audience}", full period`, metric: "roas", value: a.m.roas, unit: "x", scope: a.audience });
    const value = Math.max(0, (account.recent.cpa - a.recent.cpa) * a.recent.conversions);
    const valEv = ev.add({ label: `Weekly saving if one more week of conversions came at this audience's CPA instead of account CPA (estimate, ignores diminishing returns)`, metric: "opportunity_value", value, unit: "currency", scope: a.audience });
    const id = nextId();
    findings.push({
      id, type: "audience_opportunity", category: "audience", kind: "opportunity", severity: "medium",
      title: `Under-funded winner: "${a.audience}"`,
      campaign, platform: a.rs[0].platform, ruleId: "R6_OPPORTUNITY",
      ruleText: "Non-brand audience with CPA <= 0.6x account CPA, >= 20 conversions and < 15% of spend => scale candidate (test budget increase).",
      chain: [
        { metric: "Audience CPA", direction: "down", changePct: pctChange(account.total.cpa, a.m.cpa), evidenceId: cpaEv, note: "Much cheaper conversions than the account average" },
        { metric: "Volume", direction: "stable", changePct: null, evidenceId: convEv, note: "Enough conversions to be meaningful" },
        { metric: "Budget share", direction: "down", changePct: null, evidenceId: shareEv, note: "Gets only a small share of budget", isRootCause: true },
      ],
      evidenceIds: [cpaEv, accCpaEv, shareEv, convEv, roasEv, valEv],
      supportingSignals: 3,
      impact: { weeklyCostEstimate: value, evidenceId: valEv, note: "Potential weekly saving (estimate; returns usually diminish as budget scales)." },
    });
    story.push({ date: data.dateRange.start, title: "Hidden winner", detail: `"${a.audience}" converts at ${fmtMoney(a.m.cpa)} CPA all month with ${(share * 100).toFixed(1)}% of spend.`, findingId: id, tone: "good" });
  }

  // Experiment sizing per finding: days to reach ~100 conversions per arm on a 50/50 split.
  for (const f of findings) {
    const c = campaigns.find((x) => x.campaign === f.campaign);
    const perDay = c ? c.recent.conversions / RECENT_DAYS : 0;
    const days = perDay > 0 ? Math.min(28, Math.max(7, Math.ceil(100 / (perDay / 2)))) : 28;
    f.suggestedTestDays = days;
    f.testDaysEvidenceId = ev.add({ label: `Suggested minimum test length for ${f.campaign} (~100 conversions per arm at current volume)`, metric: "test_days", value: days, unit: "days", scope: f.campaign });
    f.evidenceIds.push(f.testDaysEvidenceId);
  }

  story.push({ date: end, title: "Diagnosis run", detail: `Account CPA ${fmtMoney(account.recent.cpa)} last 7 days vs target ${fmtMoney(profile.targetCpa)}.`, tone: "neutral" });
  story.sort((a, b) => a.date.localeCompare(b.date));

  const evidence = [...data.evidence, ...ev.items];
  const priorities = scorePriorities(findings, profile);
  const health = computeHealth({ account, campaigns, findings, data, profile, accEv: acc });

  return { mode: "timeseries", periods, account, campaigns, findings, evidence, priorities, health, story };
}

function rs0(rows: Row[]): string[] {
  return [...new Set(rows.map((r) => r.campaign))];
}
