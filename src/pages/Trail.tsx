import { Badge, NeedsCase, PageHeader } from "../components/ui";
import { useApp } from "../lib/store";

export default function Trail() {
  return (
    <NeedsCase>
      <Inner />
    </NeedsCase>
  );
}

function Inner() {
  const { caseFile } = useApp();
  const cf = caseFile!;
  const ver = cf.verification;
  const llmCalls = cf.logs.filter((l) => l.usedLlm).length;
  const total = cf.logs.reduce((a, l) => a + l.durationMs, 0);
  return (
    <div>
      <PageHeader title="Agent Trail" subtitle="Every agent step, what it received, what it produced, and how long it took. Plus everything the Critic checked." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Agent steps", cf.logs.length],
          ["AI calls", llmCalls],
          ["Total time", `${(total / 1000).toFixed(1)}s`],
          ["Evidence items", cf.engine?.evidence.length ?? 0],
        ].map(([k, v]) => (
          <div key={k} className="card !p-4">
            <div className="label">{k}</div>
            <div className="mt-1 text-2xl font-extrabold">{v}</div>
          </div>
        ))}
      </div>

      <div className="card mb-6 overflow-x-auto !p-0">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="p-3">Agent</th>
              <th className="p-3">Step</th>
              <th className="p-3">Input</th>
              <th className="p-3">Output</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {cf.logs.map((l) => (
              <tr key={l.id} className="border-b border-line/60 align-top last:border-0">
                <td className="p-3 font-semibold">{l.agent}</td>
                <td className="p-3">
                  {l.step} {l.usedLlm && <span className="chip">AI</span>} {l.offline && <span className="chip">offline</span>}
                </td>
                <td className="p-3 text-muted">{l.inputSummary}</td>
                <td className="p-3 text-muted">{l.outputSummary}</td>
                <td className="p-3">
                  <Badge tone={l.status === "done" ? "good" : l.status === "failed" ? "bad" : "warn"}>{l.status}</Badge>
                </td>
                <td className="p-3 text-right tabular-nums">{(l.durationMs / 1000).toFixed(2)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ver && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">🛡️ Critic verification</h3>
            <Badge tone={ver.status === "verified" ? "good" : "warn"}>{ver.status.replace(/_/g, " ")}</Badge>
            {ver.revised && <Badge tone="accent">1 revision round</Badge>}
          </div>
          <p className="mt-2 text-sm">{ver.summary}</p>
          {ver.issuesFound.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="label">Issues found (before revision)</div>
              {ver.issuesFound.map((i, k) => (
                <div key={k} className="rounded-xl border border-line p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.severity === "reject" ? "bad" : "warn"}>{i.severity}</Badge>
                    <span className="font-mono">{i.target}</span>
                    <span className="chip">{i.source === "code" ? "number checker" : "Claude review"}</span>
                    {ver.remainingIssues.some((r) => r.target === i.target && r.problem === i.problem) ? <Badge tone="warn">still flagged</Badge> : <Badge tone="good">resolved</Badge>}
                  </div>
                  <div className="mt-1">{i.problem}</div>
                  <div className="text-muted">Fix: {i.fix}</div>
                </div>
              ))}
            </div>
          )}
          {ver.downgrades.length > 0 && (
            <div className="mt-4">
              <div className="label">Downgrades applied</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {ver.downgrades.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
