import { Badge, NextStep, PageHeader } from "../components/ui";
import { seedMemory } from "../lib/api";
import { useApp } from "../lib/store";

export default function Memory() {
  const { memory, deleteMemory, refresh } = useApp();
  return (
    <div>
      <PageHeader
        title="Marketing Memory"
        subtitle="Approved diagnoses, actions and experiment results. The Orchestrator reads this at the start of every run to surface similar past cases."
        actions={
          <button className="btn-ghost btn-sm" onClick={async () => { await seedMemory(); await refresh(); }}>
            + Load 2 demo memories (labelled)
          </button>
        }
      />
      <div className="space-y-3">
        {memory.map((m) => (
          <div key={m.id} className="card !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{m.kind}</Badge>
                <Badge>{m.findingType.replace(/_/g, " ")}</Badge>
                {m.platform && <Badge>{m.platform}</Badge>}
                {m.demoSeed && <Badge tone="warn">demo seed</Badge>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                {m.createdAt.slice(0, 10)}
                <button className="hover:text-bad" onClick={() => deleteMemory(m.id)} aria-label="Delete memory">✕</button>
              </div>
            </div>
            <div className="mt-2 text-sm">{m.summary}</div>
            {m.outcome && <div className="mt-1 text-sm text-good">Outcome: {m.outcome}</div>}
          </div>
        ))}
        {!memory.length && (
          <div className="card text-sm text-muted">
            Memory is empty. Approve a plan item or save an experiment result, and it will appear here. Next time the same kind of problem shows up, you'll see "Similar to a past case".
          </div>
        )}
      </div>
      <NextStep to="/" label="Run again" hint="Re-run the agents: findings matching a memory now show the past case and its outcome." />
    </div>
  );
}
