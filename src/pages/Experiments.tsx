import { useState } from "react";
import { Badge, NextStep, PageHeader } from "../components/ui";
import { useApp } from "../lib/store";
import type { Experiment } from "../shared/types";

function ExperimentCard({ x }: { x: Experiment }) {
  const { updateExperiment, saveMemory, caseFile } = useApp();
  const finding = caseFile?.id === x.caseId ? caseFile.engine?.findings.find((f) => f.id === x.findingId) : undefined;
  const [result, setResult] = useState(x.result ?? "");
  const [outcome, setOutcome] = useState<Experiment["outcome"]>(x.outcome ?? "inconclusive");
  const tone = x.status === "running" ? "accent" : x.status === "completed" ? "good" : x.status === "cancelled" ? "bad" : "neutral";
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="font-semibold">🧪 {x.hypothesis}</div>
        <Badge tone={tone}>{x.status}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
        <div><b className="text-ink">Control:</b> {x.control}</div>
        <div><b className="text-ink">Variant:</b> {x.variant}</div>
        <div><b className="text-ink">Primary metric:</b> {x.primary_metric}</div>
        <div><b className="text-ink">Guardrail:</b> {x.guardrail_metric}</div>
        <div><b className="text-ink">Duration:</b> {x.duration_days} days</div>
        <div><b className="text-ink">Success:</b> {x.success_criterion}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {x.status === "draft" && <button className="btn-primary btn-sm" onClick={() => updateExperiment({ ...x, status: "running" })}>▶ Approve & mark running</button>}
        {x.status !== "completed" && x.status !== "cancelled" && <button className="btn-ghost btn-sm" onClick={() => updateExperiment({ ...x, status: "cancelled" })}>Cancel</button>}
      </div>
      {(x.status === "running" || x.status === "completed") && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <div className="label">Result (entered by you from the ad platform)</div>
          <textarea className="input h-20 text-sm" placeholder="e.g. Variant B CTR recovered; CPA back near target after 10 days." value={result} onChange={(e) => setResult(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value as Experiment["outcome"])}>
              <option value="won">Variant won</option>
              <option value="lost">Variant lost</option>
              <option value="inconclusive">Inconclusive</option>
            </select>
            <button className="btn-ghost btn-sm" disabled={!result.trim()} onClick={() => updateExperiment({ ...x, status: "completed", result, outcome })}>
              Save result
            </button>
            {x.status === "completed" && !x.savedToMemory && (
              <button
                className="btn-primary btn-sm"
                onClick={async () => {
                  await saveMemory({ kind: "experiment", findingType: x.findingType, platform: finding?.platform ?? "", campaign: finding?.campaign ?? "", summary: `Experiment: ${x.hypothesis}`, outcome: `${x.outcome}: ${x.result}`, caseId: x.caseId });
                  await updateExperiment({ ...x, savedToMemory: true });
                }}
              >
                🧠 Save to Marketing Memory?
              </button>
            )}
            {x.savedToMemory && <Badge tone="good">saved to memory</Badge>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Experiments() {
  const { experiments, caseFile, createExperiment } = useApp();
  const proposal = caseFile?.recommendation?.experiment;
  const already = proposal && experiments.some((x) => x.caseId === caseFile?.id && x.findingId === proposal.finding_id);
  return (
    <div>
      <PageHeader title="Experiment Center" subtitle="Test the fix before scaling it. Results you save here become Marketing Memory for future diagnoses." />
      {proposal && !already && (
        <div className="card mb-6 border-accent/40">
          <div className="label text-accent">Proposed by the Recommendation Agent</div>
          <div className="mt-1 font-semibold">{proposal.hypothesis}</div>
          <button className="btn-primary btn-sm mt-3" onClick={() => createExperiment(proposal)}>+ Create draft experiment</button>
        </div>
      )}
      <div className="space-y-4">
        {experiments.map((x) => (
          <ExperimentCard key={x.id} x={x} />
        ))}
        {!experiments.length && <div className="card text-sm text-muted">No experiments yet. Run a diagnosis and create the proposed experiment.</div>}
      </div>
      <NextStep to="/memory" label="See Marketing Memory" hint="Completed experiments saved to memory show up as 'similar past case' hints on future runs." />
    </div>
  );
}
