// Priority Engine (deterministic): impact, urgency, confidence, effort, goal relevance.
import type { BusinessProfile, Finding, FindingType, PriorityScore } from "../types";

export const PRIORITY_WEIGHTS = { impact: 0.35, urgency: 0.2, confidence: 0.2, effort: 0.1, goalRelevance: 0.15 };

const EFFORT: Record<FindingType, number> = {
  creative_fatigue: 0.35, // new creative needed
  landing_page_issue: 0.4, // fix / roll back page
  tracking_break: 0.3, // fix tag
  auction_pressure: 0.5,
  budget_waste: 0.15, // budget change
  audience_opportunity: 0.1, // budget change
  goal_gap: 0.5,
  segment_underperformer: 0.3, // shift budget / adapt message for one segment
  segment_opportunity: 0.15, // budget test
  conversion_drivers: 0.45, // targeting + nurturing changes
};

const GOAL_RELEVANCE: Record<string, Partial<Record<FindingType, number>>> = {
  purchases: { segment_underperformer: 0.85, segment_opportunity: 0.8, conversion_drivers: 0.6, landing_page_issue: 1, creative_fatigue: 0.85, tracking_break: 0.9, budget_waste: 0.8, audience_opportunity: 0.75, auction_pressure: 0.6 },
  leads: { segment_underperformer: 0.85, segment_opportunity: 0.8, conversion_drivers: 0.6, landing_page_issue: 1, creative_fatigue: 0.85, tracking_break: 0.9, budget_waste: 0.8, audience_opportunity: 0.75, auction_pressure: 0.6 },
  revenue: { segment_underperformer: 0.8, segment_opportunity: 0.85, conversion_drivers: 0.55, landing_page_issue: 0.9, creative_fatigue: 0.75, tracking_break: 0.95, budget_waste: 0.9, audience_opportunity: 0.85, auction_pressure: 0.6 },
};

export function scorePriorities(findings: Finding[], profile: BusinessProfile): PriorityScore[] {
  const maxCost = Math.max(1, ...findings.map((f) => f.impact.weeklyCostEstimate));
  const scores = findings.map((f) => {
    const impact = Math.max(0.1, f.impact.weeklyCostEstimate / maxCost);
    const urgency =
      f.kind === "data_warning" ? 0.85 : f.kind === "opportunity" ? 0.4 : f.severity === "critical" ? 1 : f.severity === "high" ? 0.8 : 0.5;
    const confidence = Math.min(1, f.supportingSignals / 5);
    const effort = EFFORT[f.type] ?? 0.5;
    const goalRelevance = GOAL_RELEVANCE[profile.goal]?.[f.type] ?? 0.6;
    const w = PRIORITY_WEIGHTS;
    const total = 100 * (w.impact * impact + w.urgency * urgency + w.confidence * confidence + w.effort * (1 - effort) + w.goalRelevance * goalRelevance);
    return { findingId: f.id, impact, urgency, confidence, effort, goalRelevance, total: Math.round(total), rank: 0 };
  });
  scores.sort((a, b) => b.total - a.total);
  scores.forEach((s, i) => (s.rank = i + 1));
  return scores;
}
