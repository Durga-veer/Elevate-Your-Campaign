import { Link, useNavigate, useParams } from "react-router-dom";
import { SegmentBars } from "../components/SegmentBars";
import { Sparkline } from "../components/Sparkline";
import { Badge, ConfidenceBadge, EvidenceChips, Explain, NeedsCase, NextStep, PageHeader, SeverityBadge } from "../components/ui";
import { view } from "../lib/selectors";
import { useApp } from "../lib/store";
import { fmtChange, fmtMoney, fmtPct } from "../shared/engine/format";
import type { DailyPoint, Finding } from "../shared/types";

type SeriesKey = keyof Omit<DailyPoint, "date">;
const SERIES: Record<string, { key: SeriesKey; label: string; fmt: (v: number) => string; explain?: string }[]> = {
  creative_fatigue: [
    { key: "frequency", label: "Frequency", fmt: (v) => v.toFixed(2), explain: "frequency" },
    { key: "ctr", label: "CTR", fmt: (v) => fmtPct(v), explain: "ctr" },
    { key: "cpa", label: "CPA", fmt: (v) => fmtMoney(v), explain: "cpa" },
  ],
  landing_page_issue: [
    { key: "ctr", label: "CTR (stable?)", fmt: (v) => fmtPct(v), explain: "ctr" },
    { key: "cvr", label: "Conversion rate", fmt: (v) => fmtPct(v), explain: "cvr" },
    { key: "lpRate", label: "Landing-page view rate", fmt: (v) => fmtPct(v, 1), explain: "lpRate" },
  ],
  tracking_break: [
    { key: "platform_conversions", label: "Platform conversions / day", fmt: (v) => v.toFixed(0) },
    { key: "conversions", label: "Website conversions / day", fmt: (v) => v.toFixed(0) },
  ],
  audience_opportunity: [
    { key: "cpa", label: "CPA", fmt: (v) => fmtMoney(v), explain: "cpa" },
    { key: "spend", label: "Spend / day", fmt: (v) => fmtMoney(v, 0) },
  ],
  default: [
    { key: "cpa", label: "CPA", fmt: (v) => fmtMoney(v), explain: "cpa" },
    { key: "roas", label: "ROAS", fmt: (v) => `${v.toFixed(2)}x`, explain: "roas" },
  ],
};

function Chain({ f, evidence }: { f: Finding; evidence: Parameters<typeof EvidenceChips>[0]["evidence"] }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
      {f.chain.map((n, i) => (
        <div key={i} className="flex flex-col items-center gap-2 md:flex-1 md:flex-row">
          <div
            className={`w-full animate-rise rounded-xl border p-3 ${n.isRootCause ? "border-accent bg-accent/10 shadow-lg shadow-accent/10" : "border-line bg-surface2"}`}
            style={{ animationDelay: `${i * 140}ms` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold">{n.metric}</span>
              <span className={`text-sm font-bold ${n.direction === "up" ? "text-bad" : n.direction === "down" ? "text-warn" : "text-good"}`}>
                {n.direction === "up" ? "▲" : n.direction === "down" ? "▼" : "▬"} {n.changePct !== null ? fmtChange(n.changePct) : ""}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted">{n.note}</div>
            <div className="mt-1.5 flex items-center justify-between">
              {n.evidenceId ? <EvidenceChips ids={[n.evidenceId]} evidence={evidence} /> : <span />}
              {n.isRootCause && <Badge tone="accent">root cause</Badge>}
            </div>
          </div>
          {i < f.chain.length - 1 && <span className="text-muted md:px-1">{"→"}</span>}
        </div>
      ))}
    </div>
  );
}

export default function Diagnosis() {
  return (
    <NeedsCase>
      <DiagnosisInner />
    </NeedsCase>
  );
}

function DiagnosisInner() {
  const { caseFile, level, addToPlan, plan, createExperiment, experiments } = useApp();
  const { findingId } = useParams();
  const nav = useNavigate();
  const v = view(caseFile!);
  const { e } = v;
  const f = v.ranked.find((x) => x.id === findingId) ?? v.top ?? v.ranked[0];
  if (!f) return <PageHeader title="Diagnosis" subtitle="No findings: nothing looks wrong in this data." />;
  const h = v.hyp(f.id);
  const r = v.rec(f.id);
  const c = v.campaign(f);
  const p = v.rankOf(f.id);
  const exp = caseFile!.recommendation?.experiment;
  const hasExp = exp && exp.finding_id === f.id;
  const inPlan = r && plan.some((x) => x.recommendationId === r.id && x.caseId === caseFile!.id);
  const expCreated = hasExp && experiments.some((x) => x.caseId === caseFile!.id && x.findingId === f.id);
  const series = SERIES[f.type] ?? SERIES.default;

  return (
    <div>
      <PageHeader title="Diagnosis" subtitle="WHY → WHAT → HOW → RESULT for each issue, with evidence the Critic has checked." />
      <div className="grid gap-6 lg:grid-cols-[260px,1fr]">
        {/* Finding list */}
        <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
          {v.ranked.map((x) => (
            <button
              key={x.id}
              onClick={() => nav(`/diagnosis/${x.id}`)}
              className={`min-w-[220px] rounded-xl border p-3 text-left transition lg:min-w-0 ${x.id === f.id ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/50"}`}
            >
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>
                  #{v.rankOf(x.id)?.rank} · {x.id}
                </span>
                <SeverityBadge f={x} />
              </div>
              <div className="mt-1 text-sm font-semibold leading-snug">{x.title}</div>
            </button>
          ))}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="card">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-extrabold">{f.title}</h2>
              <SeverityBadge f={f} />
              <ConfidenceBadge c={h?.confidence} />
              {p && <Badge tone="accent">Priority #{p.rank} · {p.total}/100</Badge>}
            </div>
            <div className="mt-1 text-xs text-muted">
              {f.platform} · {f.campaign} {c?.audience && <>· audience: {c.audience}</>} {f.startDate && <>· started ≈ {f.startDate}</>} {v.e.mode === "segment" && <>· segment analysis (no dates)</>}
            </div>
            {h?.critic_note && <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">🛡️ Critic: {h.critic_note}</div>}
            {f.dataCaveat && <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs">⚠ {f.dataCaveat}</div>}
            {v.hint(f.id) && <div className="mt-3 rounded-xl border border-line bg-surface2 p-3 text-xs">🧠 {v.hint(f.id)!.text} {v.hint(f.id)!.outcome && <b>Outcome: {v.hint(f.id)!.outcome}</b>}</div>}
          </div>

          {/* WHY */}
          <section className="card">
            <div className="label text-accent">1 · WHY did this happen?</div>
            <p className="mt-2 text-base">{level === "beginner" ? h?.diagnosis_beginner : h?.diagnosis_expert}</p>
            <div className="mt-4">
              <Chain f={f} evidence={e.evidence} />
            </div>
            <div className="mt-3 text-xs text-muted">
              <b>Rule fired ({f.ruleId}):</b> {f.ruleText} · {f.supportingSignals}/5 independent signals agree
            </div>
          </section>

          {/* WHAT */}
          <section className="card">
            <div className="label text-accent">2 · WHAT the data shows (facts)</div>
            {f.segment && (
              <div className="mt-3">
                <SegmentBars s={f.segment} />
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {c &&
                c.daily.length > 0 &&
                series.map((s) => (
                  <div key={s.key} className="rounded-xl border border-line bg-surface2 p-3">
                    <div className="text-xs font-semibold">
                      {s.label} {s.explain && <Explain k={s.explain} />}
                    </div>
                    <Sparkline values={c.daily.map((d) => d[s.key])} dates={c.daily.map((d) => d.date)} marker={f.startDate} recentFrom={e.periods.recent.start} format={s.fmt} />
                  </div>
                ))}
            </div>
            <ul className="mt-4 space-y-1.5 text-sm">
              {h?.facts.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-good">✓</span> {x}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <div className="label mb-1">Evidence (hover to see exact values)</div>
              <EvidenceChips ids={[...new Set([...(h?.evidence_ids ?? []), ...f.evidenceIds])]} evidence={e.evidence} />
            </div>
            <div className="mt-5">
              <div className="label mb-2">Alternative explanations (hypotheses, not facts)</div>
              <div className="space-y-2">
                {h?.alternatives.map((a, i) => (
                  <div key={i} className="rounded-xl border border-line p-3 text-sm">
                    <div className="font-semibold">{a.explanation}</div>
                    <div className="text-xs text-muted">Less likely because: {a.why_less_likely}</div>
                    <div className="mt-1">
                      <EvidenceChips ids={a.evidence_ids} evidence={e.evidence} />
                    </div>
                  </div>
                ))}
              </div>
              {h?.what_would_confirm && (
                <div className="mt-3 text-sm">
                  <b>To confirm:</b> {h.what_would_confirm}
                </div>
              )}
            </div>
          </section>

          {/* HOW */}
          <section className="card">
            <div className="label text-accent">3 · HOW to fix it</div>
            {r ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold">{r.title}</h3>
                  <Badge>effort: {r.effort}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{r.why}</p>
                <ol className="mt-3 space-y-2 text-sm">
                  {r.action_steps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                {r.critic_note && <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">🛡️ Critic: {r.critic_note}</div>}
                <button className="btn-primary mt-4" disabled={inPlan} onClick={() => addToPlan(r)}>
                  {inPlan ? "✓ In Today's Plan" : "+ Add to Today's Plan"}
                </button>
              </>
            ) : (
              <div className="mt-2 text-sm text-muted">No recommendation for this finding.</div>
            )}
          </section>

          {/* RESULT */}
          <section className="card">
            <div className="label text-accent">4 · RESULT to expect (estimate) and how to test it</div>
            {r && <p className="mt-2 text-sm">{r.expected_effect}</p>}
            {hasExp ? (
              <div className="mt-3 rounded-xl border border-line bg-surface2 p-4 text-sm">
                <div className="font-semibold">🧪 {exp.hypothesis}</div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div><b>Control:</b> {exp.control}</div>
                  <div><b>Variant:</b> {exp.variant}</div>
                  <div><b>Primary metric:</b> {exp.primary_metric}</div>
                  <div><b>Guardrail:</b> {exp.guardrail_metric}</div>
                  <div><b>Duration:</b> {exp.duration_days} days</div>
                  <div><b>Success:</b> {exp.success_criterion}</div>
                </div>
                {expCreated ? (
                  <Link to="/experiments" className="btn-ghost btn-sm mt-3">Open in Experiment Center →</Link>
                ) : (
                  <button className="btn-ghost btn-sm mt-3" onClick={() => createExperiment(exp)}>+ Create experiment (draft)</button>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Suggested minimum test length for this campaign: {f.suggestedTestDays} days. The proposed experiment targets the top priority.
              </p>
            )}
            {f.impact.weeklyCostEstimate > 0 && (
              <div className="mt-3 text-xs text-muted">
                Impact: ≈ {fmtMoney(f.impact.weeklyCostEstimate, 0)} {f.impact.unitLabel ?? "/ week"}. {f.impact.note}
              </div>
            )}
          </section>
        </div>
      </div>
      <NextStep to="/plan" label="Review Today's Plan" hint="Approve, edit or reject the actions. Nothing runs without your approval." />
    </div>
  );
}
