import { useState } from "react";
import { Link } from "react-router-dom";
import { HealthRing, MiniBar, scoreTone } from "../components/HealthRing";
import { Badge, ConfidenceBadge, EvidenceChips, Explain, Modal, NextStep, SeverityBadge } from "../components/ui";
import { view } from "../lib/selectors";
import { useApp } from "../lib/store";
import { fmtMoney } from "../shared/engine/format";
import type { HealthComponent } from "../shared/types";

const ICONS: Record<HealthComponent["key"], string> = { goal: "🏁", budget: "💰", creative: "🎨", audience: "👥", conversion: "🛒", data_quality: "🧾" };

function ElevateButton({ big = false }: { big?: boolean }) {
  const { elevate, running } = useApp();
  return (
    <button onClick={elevate} disabled={running} className={`btn-primary ${big ? "px-8 py-4 text-base sm:text-lg" : ""} tracking-wide`}>
      ⚡ {running ? "ELEVATING…" : "ELEVATE MY CAMPAIGN"}
    </button>
  );
}

function Hero() {
  const { dataset, llm } = useApp();
  return (
    <div className="mx-auto max-w-3xl py-10 text-center sm:py-16">
      <Badge tone="accent">5 agents · Data → Diagnosis → Recommendation → Critic</Badge>
      <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-6xl">
        Know <span className="gradient-text">why</span> your campaign is slipping, and what to do next.
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-muted">
        Deterministic analysis finds the anomalies and root causes. Claude explains them with evidence and confidence. A Critic agent checks every number before you see it.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3">
        <ElevateButton big />
        <div className="text-xs text-muted">
          Data: <b className="text-ink">{dataset.name}</b> · <Link className="text-accent underline" to="/data">change data or business profile</Link>
        </div>
        {llm && !llm.llm && <div className="text-xs text-warn">No ANTHROPIC_API_KEY found: agents use offline templates (analysis is still fully computed).</div>}
      </div>
      <div className="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-3 text-left text-sm sm:grid-cols-4">
        {[
          ["🔬", "Diagnose", "Anomalies + root-cause chain"],
          ["🎯", "Prioritise", "ONE thing to fix first"],
          ["🧪", "Test", "Experiment with approval"],
          ["🧠", "Remember", "Learns what worked"],
        ].map(([i, t, d]) => (
          <div key={t} className="card !p-4">
            <div className="text-xl">{i}</div>
            <div className="mt-1 font-semibold">{t}</div>
            <div className="text-xs text-muted">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { caseFile, level, addToPlan, plan } = useApp();
  const [why, setWhy] = useState<HealthComponent | null>(null);

  if (!caseFile?.engine) return <Hero />;
  const v = view(caseFile);
  const { e } = v;
  const top = v.top;
  const topH = top && v.hyp(top.id);
  const topR = top && v.rec(top.id);
  const alerts = v.ranked.filter((f) => f.kind !== "opportunity");
  const opps = v.ranked.filter((f) => f.kind === "opportunity");
  const todays = plan.filter((p) => p.caseId === caseFile.id);
  const ver = caseFile.verification;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Command Center</h1>
          <p className="text-sm text-muted">
            {caseFile.profile.businessName} · {e.mode === "segment" ? `${caseFile.data?.rowCount.toLocaleString("en-US")} rows, segment analysis (no dates)` : `${e.periods.recent.start} to ${e.periods.recent.end} vs baseline`} · {caseFile.llmMode === "claude" ? "Claude agents" : "offline templates"}
          </p>
        </div>
        <ElevateButton />
      </div>

      {ver && (
        <div className={`flex items-start gap-3 rounded-2xl border p-3 text-sm ${ver.status === "verified" ? "border-good/30 bg-good/5" : "border-warn/30 bg-warn/5"}`}>
          <span className="text-lg">🛡️</span>
          <div>
            <b>Critic Agent:</b> {ver.summary}{" "}
            <Link to="/trail" className="text-accent underline">
              see reasoning trail
            </Link>
          </div>
        </div>
      )}

      {/* Health */}
      <div className="card grid animate-rise gap-6 md:grid-cols-[auto,1fr] md:items-center">
        <div className="flex flex-col items-center">
          <HealthRing score={e.health.overall} />
          <div className="mt-1 text-xs text-muted">
            Campaign health <Explain k="health" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {e.health.components.map((c, i) => (
            <button key={c.key} onClick={() => setWhy(c)} className="animate-rise rounded-xl border border-line bg-surface2 p-3 text-left transition hover:border-accent/60" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {ICONS[c.key]} {c.label}
                </span>
                <span className="font-bold tabular-nums" style={{ color: c.measurable === false ? undefined : scoreTone(c.score) }}>
                  {c.measurable === false ? "n/a" : c.score}
                </span>
              </div>
              <div className="mt-2">
                <MiniBar value={c.measurable === false ? 0 : c.score} />
              </div>
              <div className="mt-1.5 text-[10px] text-accent">why this score →</div>
            </button>
          ))}
        </div>
      </div>

      {/* Top priority */}
      {top && (
        <div className="relative animate-rise overflow-hidden rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/15 via-surface to-accent2/10 p-6" style={{ animationDelay: "150ms" }}>
          <div className="label text-accent">Top priority today</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-extrabold sm:text-2xl">{top.title}</h2>
            <SeverityBadge f={top} />
            <ConfidenceBadge c={topH?.confidence} />
          </div>
          <p className="mt-3 max-w-3xl text-sm">{level === "beginner" ? topH?.diagnosis_beginner : topH?.diagnosis_expert}</p>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            <b className="text-ink">Why first:</b> {caseFile.recommendation?.top_priority.reasoning}{" "}
            <EvidenceChips ids={caseFile.recommendation?.top_priority.evidence_ids ?? []} evidence={e.evidence} />
          </p>
          {top.impact.weeklyCostEstimate > 0 && (
            <div className="mt-3 text-sm">
              <Badge tone={top.kind === "opportunity" ? "good" : "bad"}>≈ {fmtMoney(top.impact.weeklyCostEstimate, 0)} {top.impact.unitLabel ?? "/ week"} (estimate)</Badge> <span className="text-xs text-muted">{top.impact.note}</span>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to={`/diagnosis/${top.id}`} className="btn-primary">
              Why did this happen? →
            </Link>
            {topR && (
              <button className="btn-ghost" disabled={todays.some((p) => p.recommendationId === topR.id)} onClick={() => addToPlan(topR)}>
                {todays.some((p) => p.recommendationId === topR.id) ? "✓ In Today's Plan" : "+ Add to Today's Plan"}
              </button>
            )}
          </div>
          {v.hint(top.id) && <div className="mt-4 rounded-xl border border-line bg-surface/70 p-3 text-xs">🧠 {v.hint(top.id)!.text}</div>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Alerts */}
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold">Alerts</h3>
            <span className="chip">{alerts.length}</span>
          </div>
          <div className="space-y-2">
            {alerts.map((f) => (
              <Link key={f.id} to={`/diagnosis/${f.id}`} className="flex items-start gap-3 rounded-xl border border-line p-3 transition hover:border-accent/60">
                <span className="mt-0.5 font-mono text-xs text-muted">#{v.rankOf(f.id)?.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {f.title} <SeverityBadge f={f} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">{v.hyp(f.id)?.diagnosis_beginner ?? f.ruleText}</div>
                </div>
              </Link>
            ))}
            {!alerts.length && <div className="text-sm text-muted">No problems detected. 🎉</div>}
          </div>
        </div>
        {/* Opportunities + plan */}
        <div className="space-y-6">
          <div className="card">
            <h3 className="mb-3 font-bold">Opportunities</h3>
            {opps.map((f) => (
              <Link key={f.id} to={`/diagnosis/${f.id}`} className="block rounded-xl border border-good/30 bg-good/5 p-3 transition hover:border-good">
                <div className="text-sm font-semibold">▲ {f.title}</div>
                <div className="mt-0.5 text-xs text-muted">{level === "beginner" ? v.hyp(f.id)?.diagnosis_beginner : v.hyp(f.id)?.diagnosis_expert}</div>
                {f.impact.weeklyCostEstimate > 0 && <div className="mt-1 text-xs text-good">Potential ≈ {fmtMoney(f.impact.weeklyCostEstimate, 0)} {f.impact.unitLabel ?? "/ week"} (estimate)</div>}
              </Link>
            ))}
            {!opps.length && <div className="text-sm text-muted">No clear opportunity in this data.</div>}
          </div>
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">Today's Plan</h3>
              <Link to="/plan" className="text-xs text-accent">
                open →
              </Link>
            </div>
            {todays.length ? (
              <ul className="space-y-1.5 text-sm">
                {todays.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{p.title}</span>
                    <Badge tone={p.status === "approved" ? "good" : p.status === "rejected" ? "bad" : "neutral"}>{p.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-muted">Nothing yet. Add the top priority to start.</div>
            )}
          </div>
        </div>
      </div>

      {/* Story */}
      <div className="card">
        <h3 className="mb-4 font-bold">Campaign Story</h3>
        <ol className="relative space-y-4 border-l border-line pl-5">
          {e.story.map((s, i) => (
            <li key={i} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
              <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${s.tone === "bad" ? "bg-bad" : s.tone === "warn" ? "bg-warn" : s.tone === "good" ? "bg-good" : "bg-muted"}`} />
              {s.date && <div className="text-xs text-muted">{s.date}</div>}
              <div className="text-sm font-semibold">{s.findingId ? <Link to={`/diagnosis/${s.findingId}`}>{s.title}</Link> : s.title}</div>
              <div className="text-xs text-muted">{s.detail}</div>
            </li>
          ))}
        </ol>
      </div>

      <NextStep to={top ? `/diagnosis/${top.id}` : "/diagnosis"} label="Open the diagnosis" hint="Understand why the top priority happened, then approve the fix in Today's Plan." />

      <Modal open={!!why} onClose={() => setWhy(null)} title={why ? `${ICONS[why.key]} ${why.label}: ${why.measurable === false ? "not measurable" : `${why.score}/100`} · why this score` : ""}>
        {why && (
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              {why.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <div>
              <div className="label mb-1">Evidence</div>
              <EvidenceChips ids={why.evidenceIds} evidence={e.evidence} />
            </div>
            <div className="text-xs text-muted">Scores are computed by code from your data (not by AI). Weights: Goal 25%, Conversion 20%, Budget 15%, Creative 15%, Data Quality 15%, Audience 10%.</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
