import { Link } from "react-router-dom";
import { MiniBar } from "../components/HealthRing";
import { Badge, EvidenceChips, Explain, NeedsCase, NextStep, PageHeader, SeverityBadge } from "../components/ui";
import { view } from "../lib/selectors";
import { useApp } from "../lib/store";
import { PRIORITY_WEIGHTS } from "../shared/engine/priority";

const FACTORS = [
  ["impact", "Impact"],
  ["urgency", "Urgency"],
  ["confidence", "Confidence"],
  ["effort", "Ease (1 - effort)"],
  ["goalRelevance", "Goal fit"],
] as const;

export default function Priorities() {
  return (
    <NeedsCase>
      <Inner />
    </NeedsCase>
  );
}

function Inner() {
  const { caseFile } = useApp();
  const v = view(caseFile!);
  const tp = caseFile!.recommendation?.top_priority;
  return (
    <div>
      <PageHeader
        title="Priority Engine"
        subtitle={
          <>
            Deterministic ranking by impact, urgency, confidence, effort and goal relevance <Explain k="priority" />. The Recommendation Agent picks ONE top priority; the Critic checks it is in the top 3.
          </>
        }
      />
      {v.top && tp && (
        <div className="card mb-6 border-accent/40">
          <div className="label text-accent">Top priority</div>
          <div className="mt-1 text-lg font-bold">{v.top.title}</div>
          <p className="mt-1 text-sm">{tp.reasoning}</p>
          <div className="mt-2">
            <EvidenceChips ids={tp.evidence_ids} evidence={v.e.evidence} />
          </div>
        </div>
      )}
      <div className="space-y-3">
        {v.e.priorities.map((p) => {
          const f = v.e.findings.find((x) => x.id === p.findingId)!;
          return (
            <Link key={p.findingId} to={`/diagnosis/${f.id}`} className="card block !p-4 transition hover:border-accent/60">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-sm font-extrabold text-accent">#{p.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    {f.title} <SeverityBadge f={f} />
                    {f.id === tp?.finding_id && <Badge tone="accent">★ chosen</Badge>}
                  </div>
                  <div className="text-xs text-muted">{f.campaign}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold tabular-nums">{p.total}</div>
                  <div className="label">score</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {FACTORS.map(([k, label]) => {
                  const val = k === "effort" ? 1 - p.effort : p[k];
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-[11px] text-muted">
                        <span>{label}</span>
                        <span>{Math.round(val * 100)}</span>
                      </div>
                      <MiniBar value={val * 100} tone="rgb(var(--accent))" />
                    </div>
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-4 text-xs text-muted">
        Weights: {Object.entries(PRIORITY_WEIGHTS).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(" · ")}. Impact is normalised by the estimated weekly cost of each issue.
      </div>
      <NextStep to="/plan" label="Plan today" hint="Add the top priority's actions to Today's Plan and approve them." />
    </div>
  );
}
