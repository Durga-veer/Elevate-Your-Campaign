import { useState } from "react";
import { Badge, EvidenceChips, NeedsCase, NextStep, PageHeader } from "../components/ui";
import { view } from "../lib/selectors";
import { useApp } from "../lib/store";
import type { PlanItem } from "../shared/types";

export default function Plan() {
  return (
    <NeedsCase>
      <Inner />
    </NeedsCase>
  );
}

function PlanCard({ item }: { item: PlanItem }) {
  const { updatePlan } = useApp();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [steps, setSteps] = useState(item.steps.join("\n"));
  const tone = item.status === "approved" ? "good" : item.status === "rejected" ? "bad" : item.status === "done" ? "accent" : "neutral";
  return (
    <div className={`card !p-4 ${item.status === "rejected" ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        {editing ? <input className="input font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} /> : <div className="font-semibold">{item.title}</div>}
        <Badge tone={tone}>{item.status}</Badge>
      </div>
      {editing ? (
        <textarea className="input mt-2 h-32 font-mono text-xs" value={steps} onChange={(e) => setSteps(e.target.value)} />
      ) : (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
          {item.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button className="btn-primary btn-sm" onClick={() => { updatePlan({ ...item, title, steps: steps.split("\n").map((s) => s.trim()).filter(Boolean), note: "edited by user" }); setEditing(false); }}>
              Save edit
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            {item.status !== "approved" && item.status !== "done" && (
              <button className="btn-primary btn-sm" onClick={() => updatePlan({ ...item, status: "approved" })}>✓ Approve</button>
            )}
            {item.status === "approved" && (
              <button className="btn-ghost btn-sm" onClick={() => updatePlan({ ...item, status: "done" })}>Mark done</button>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>✎ Edit</button>
            {item.status !== "rejected" && (
              <button className="btn-ghost btn-sm" onClick={() => updatePlan({ ...item, status: "rejected" })}>✕ Reject</button>
            )}
          </>
        )}
      </div>
      {item.status === "approved" && <div className="mt-2 text-[11px] text-good">Approved → saved to Marketing Memory by the Orchestrator.</div>}
    </div>
  );
}

function Inner() {
  const { caseFile, plan, addToPlan } = useApp();
  const v = view(caseFile!);
  const recs = caseFile!.recommendation?.recommendations ?? [];
  const todays = plan.filter((p) => p.caseId === caseFile!.id);
  const sorted = [...recs].sort((a, b) => (v.rankOf(a.finding_id)?.rank ?? 99) - (v.rankOf(b.finding_id)?.rank ?? 99));
  return (
    <div>
      <PageHeader title="Today's Plan" subtitle="Human approval is required before any action. Approve, edit or reject each item." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 font-bold">Recommendations</h3>
          <div className="space-y-3">
            {sorted.map((r) => {
              const added = todays.some((p) => p.recommendationId === r.id);
              const f = v.e.findings.find((x) => x.id === r.finding_id);
              return (
                <div key={r.id} className="card !p-4">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span>
                      #{v.rankOf(r.finding_id)?.rank} · {f?.title}
                    </span>
                    <Badge>effort: {r.effort}</Badge>
                  </div>
                  <div className="mt-1 font-semibold">{r.title}</div>
                  <div className="mt-1 text-xs text-muted">{r.expected_effect}</div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <EvidenceChips ids={r.evidence_ids.slice(0, 4)} evidence={v.e.evidence} />
                    <button className="btn-ghost btn-sm" disabled={added} onClick={() => addToPlan(r)}>
                      {added ? "✓ Added" : "+ Add to plan"}
                    </button>
                  </div>
                  {r.critic_note && <div className="mt-2 text-[11px] text-warn">🛡️ {r.critic_note}</div>}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <h3 className="mb-3 font-bold">Today's Plan ({todays.length})</h3>
          <div className="space-y-3">
            {todays.map((p) => (
              <PlanCard key={p.id} item={p} />
            ))}
            {!todays.length && <div className="card text-sm text-muted">Add recommendations with one click. Nothing is executed until you approve it.</div>}
          </div>
        </div>
      </div>
      <NextStep to="/experiments" label="Set up the test" hint="Validate the top fix with an experiment so you know it worked, not just that it changed." />
    </div>
  );
}
