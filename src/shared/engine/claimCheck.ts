// Critic Agent core (pure code): verifies every number and reference in the
// LLM outputs against the Case File evidence. Anything that cannot be traced
// to evidence is flagged; remaining issues after revision are downgraded.
import type {
  CriticIssue,
  DiagnosisEngineOutput,
  DiagnosisOutput,
  Evidence,
  Hypothesis,
  Recommendation,
  RecommendationOutput,
} from "../types";

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";

export interface FoundNumber {
  raw: string;
  value: number;
}

/** Pull numeric claims out of free text, ignoring dates and evidence/finding ids. */
export function extractNumbers(text: string, names: string[] = []): FoundNumber[] {
  let cleaned = text;
  // Entity names (campaigns, audiences, creatives) may contain digits: "Lookalike 1%", "Broad 25-44".
  for (const n of [...names].sort((a, b) => b.length - a.length)) if (n) cleaned = cleaned.split(n).join(" ");
  cleaned = cleaned
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(new RegExp(`\\b(${MONTHS})\\.?\\s+\\d{1,2}(st|nd|rd|th)?\\b`, "gi"), " ")
    .replace(new RegExp(`\\b\\d{1,2}\\s+(${MONTHS})\\b`, "gi"), " ")
    .replace(/\b[EDFR]\d+\b/g, " ")
    .replace(/\b(last|past|first|next|previous)\s+\d+\s+days?\b/gi, " ")
    .replace(/\b\d+-day\b/gi, " ")
    .replace(/\b\d+(st|nd|rd|th)\b/gi, " ")
    .replace(/\bday\s+\d+\b/gi, " ");
  const out: FoundNumber[] = [];
  const re = /[-+]?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|x\b)?/g;
  for (const m of cleaned.matchAll(re)) {
    const raw = m[0].trim();
    const value = Number(raw.replace(/[$,%x+\s]/g, ""));
    if (Number.isFinite(value)) out.push({ raw, value });
  }
  return out;
}

export function buildAllowedNumbers(evidence: Evidence[], extra: number[] = []): number[] {
  const allowed = new Set<number>(extra);
  for (const e of evidence) {
    allowed.add(e.value);
    if (e.unit === "pct") allowed.add(e.value * 100);
    for (const n of extractNumbers(e.display)) allowed.add(n.value);
  }
  return [...allowed].flatMap((a) => [a, Math.abs(a)]);
}

export function isSupported(n: FoundNumber, allowed: number[]): boolean {
  const v = Math.abs(n.value);
  const hasUnit = /[%$x]/.test(n.raw);
  if (!hasUnit && Number.isInteger(v) && v <= 10) return true; // counts like "2 variants", "step 3"
  if (v === 0 || v === 100) return true;
  return allowed.some((a) => {
    const tol = Number.isInteger(v) ? Math.max(0.5, Math.abs(a) * 0.015) : Math.max(0.051, Math.abs(a) * 0.015);
    return Math.abs(v - Math.abs(a)) <= tol;
  });
}

const CAUSAL = /\b(caused by|is causing|proves?|definitely|certainly|because of)\b/i;

function textOfHypothesis(h: Hypothesis): string[] {
  return [h.title, h.diagnosis_beginner, h.diagnosis_expert, ...h.facts, h.what_would_confirm, ...h.alternatives.flatMap((a) => [a.explanation, a.why_less_likely])];
}
function textOfRecommendation(r: Recommendation): string[] {
  return [r.title, r.why, r.expected_effect, ...r.action_steps];
}

export function checkDiagnosis(d: DiagnosisOutput, engine: DiagnosisEngineOutput): CriticIssue[] {
  const issues: CriticIssue[] = [];
  const evIds = new Set(engine.evidence.map((e) => e.id));
  const allowed = allowedFor(engine);
  const names = entityNames(engine);
  const add = (target: string, problem: string, severity: CriticIssue["severity"], fix: string) =>
    issues.push({ target, problem, severity, fix, source: "code" });

  for (const f of engine.findings) {
    if (!d.hypotheses.some((h) => h.finding_id === f.id))
      add(`hypothesis:${f.id}`, `Finding ${f.id} (${f.title}) has no hypothesis.`, "reject", "Add a hypothesis for this finding.");
  }
  for (const h of d.hypotheses) {
    const t = `hypothesis:${h.finding_id}`;
    const f = engine.findings.find((x) => x.id === h.finding_id);
    if (!f) {
      add(t, `Hypothesis references unknown finding ${h.finding_id}.`, "reject", "Only diagnose findings present in the findings JSON.");
      continue;
    }
    const bad = h.evidence_ids.filter((id) => !evIds.has(id));
    if (!h.evidence_ids.length) add(t, "No evidence cited.", "reject", "Cite evidence ids from the finding.");
    if (bad.length) add(t, `Cites evidence ids that do not exist: ${bad.join(", ")}.`, "reject", "Use only evidence ids from the Case File.");
    if (!h.alternatives.length) add(t, "No alternative explanation listed.", "downgrade", "List at least one alternative explanation.");
    if (h.confidence === "likely" && f.supportingSignals < 3)
      add(t, `Confidence "likely" but only ${f.supportingSignals} supporting signal(s) in the engine output.`, "downgrade", 'Use "possible".');
    for (const s of textOfHypothesis(h)) {
      if (h.confidence !== "likely" && CAUSAL.test(s)) add(t, `Causal wording without "likely" confidence: "${s.slice(0, 90)}"`, "downgrade", "Use hedged wording (may, suggests, consistent with).");
      for (const n of extractNumbers(s, names)) {
        if (!isSupported(n, allowed)) add(t, `Number "${n.raw}" is not in the evidence.`, "reject", "Remove or replace with an evidence value.");
      }
    }
  }
  return dedupe(issues);
}

export function checkRecommendation(r: RecommendationOutput, engine: DiagnosisEngineOutput): CriticIssue[] {
  const issues: CriticIssue[] = [];
  const evIds = new Set(engine.evidence.map((e) => e.id));
  const allowed = allowedFor(engine);
  const names = entityNames(engine);
  const add = (target: string, problem: string, severity: CriticIssue["severity"], fix: string) =>
    issues.push({ target, problem, severity, fix, source: "code" });
  const findingIds = new Set(engine.findings.map((f) => f.id));

  const top3 = engine.priorities.slice(0, 3).map((p) => p.findingId);
  if (!findingIds.has(r.top_priority.finding_id)) add("top_priority", `Top priority references unknown finding ${r.top_priority.finding_id}.`, "reject", "Pick a finding from the ranking.");
  else if (!top3.includes(r.top_priority.finding_id))
    add("top_priority", `Top priority ${r.top_priority.finding_id} is not in the Priority Engine top 3 (${top3.join(", ")}).`, "reject", "Pick from the top 3 or justify with evidence.");
  for (const n of extractNumbers(r.top_priority.reasoning, names))
    if (!isSupported(n, allowed)) add("top_priority", `Number "${n.raw}" is not in the evidence.`, "reject", "Remove or cite evidence.");

  for (const rec of r.recommendations) {
    const t = `recommendation:${rec.id}`;
    if (!findingIds.has(rec.finding_id)) add(t, `References unknown finding ${rec.finding_id}.`, "reject", "Link to an existing finding.");
    const bad = rec.evidence_ids.filter((id) => !evIds.has(id));
    if (!rec.evidence_ids.length) add(t, "No evidence cited.", "reject", "Cite evidence ids.");
    if (bad.length) add(t, `Cites evidence ids that do not exist: ${bad.join(", ")}.`, "reject", "Use only Case File evidence ids.");
    const effectNums = extractNumbers(rec.expected_effect, names);
    if (effectNums.length && !/estimat/i.test(rec.expected_effect))
      add(t, "Expected effect contains numbers but is not labelled as an estimate.", "downgrade", 'Label forecasts as "estimate".');
    for (const s of textOfRecommendation(rec))
      for (const n of extractNumbers(s, names)) if (!isSupported(n, allowed)) add(t, `Number "${n.raw}" is not in the evidence.`, "reject", "Remove or cite evidence.");
  }

  const ex = r.experiment;
  const f = engine.findings.find((x) => x.id === ex.finding_id);
  if (!f) add("experiment", `Experiment references unknown finding ${ex.finding_id}.`, "reject", "Link to an existing finding.");
  else if (f.suggestedTestDays && ex.duration_days < f.suggestedTestDays)
    add("experiment", `Duration ${ex.duration_days} days is shorter than the minimum ${f.suggestedTestDays} days the data supports.`, "reject", `Use at least ${f.suggestedTestDays} days.`);
  for (const s of [ex.hypothesis, ex.control, ex.variant, ex.success_criterion, ex.primary_metric, ex.guardrail_metric])
    for (const n of extractNumbers(s, names)) if (!isSupported(n, allowed)) add("experiment", `Number "${n.raw}" is not in the evidence.`, "reject", "Remove or cite evidence.");
  return dedupe(issues);
}

/** Evidence values + numbers stated in the findings themselves (rule thresholds, priority scores). */
export function allowedFor(engine: DiagnosisEngineOutput): number[] {
  const extra = [
    ...engine.findings.flatMap((f) => extractNumbers(f.ruleText).map((n) => n.value)),
    ...engine.priorities.flatMap((p) => [p.total, p.impact, p.urgency, p.confidence, p.effort, p.goalRelevance]),
    engine.health.overall,
    ...engine.health.components.map((c) => c.score),
  ];
  return buildAllowedNumbers(engine.evidence, extra);
}

export function entityNames(engine: DiagnosisEngineOutput): string[] {
  return [
    ...engine.campaigns.flatMap((c) => [c.campaign, ...c.audience.split(", "), ...c.creative.split(", ")]),
    // segment labels such as "18-24" or "Q2 (52k-85k)" contain digits that are names, not claims
    ...engine.findings.flatMap((f) => [f.campaign, ...(f.segment ? [f.segment.dimension, ...f.segment.rows.map((r) => r.label)] : [])]),
  ].filter(Boolean);
}

function dedupe(issues: CriticIssue[]): CriticIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = i.target + i.problem;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** After the one allowed revision: annotate and downgrade anything still unsupported. */
export function applyDowngrades(d: DiagnosisOutput, r: RecommendationOutput, remaining: CriticIssue[]): string[] {
  const notes: string[] = [];
  for (const h of d.hypotheses) {
    const mine = remaining.filter((i) => i.target === `hypothesis:${h.finding_id}`);
    if (!mine.length) continue;
    if (h.confidence === "likely") {
      h.confidence = "possible";
      notes.push(`${h.finding_id}: confidence downgraded to "possible".`);
    }
    h.critic_note = mine.map((i) => i.problem).join(" ");
  }
  for (const rec of r.recommendations) {
    const mine = remaining.filter((i) => i.target === `recommendation:${rec.id}`);
    if (!mine.length) continue;
    rec.critic_note = mine.map((i) => i.problem).join(" ");
    notes.push(`${rec.id}: flagged (${mine.length} unsupported claim(s)).`);
  }
  return notes;
}
