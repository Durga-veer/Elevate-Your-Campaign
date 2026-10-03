import { useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import type { AgentLog, AgentName } from "../shared/types";

const AGENTS: { name: AgentName; icon: string; role: string }[] = [
  { name: "Orchestrator", icon: "🧭", role: "Plans, routes, retries, merges" },
  { name: "Data Agent", icon: "🧮", role: "Cleans + validates data" },
  { name: "Diagnosis Agent", icon: "🔬", role: "Anomalies + root cause" },
  { name: "Recommendation Agent", icon: "🎯", role: "Priority + plan + test" },
  { name: "Critic Agent", icon: "🛡️", role: "Verifies every claim" },
];

function agentStatus(logs: AgentLog[], name: AgentName) {
  const mine = logs.filter((l) => l.agent === name);
  if (!mine.length) return "idle";
  if (mine.some((l) => l.status === "running")) return "running";
  if (mine.some((l) => l.status === "failed")) return "failed";
  if (mine.some((l) => l.status === "warn" || l.status === "retried")) return "warn";
  return "done";
}

const STATUS_ICON: Record<string, string> = { running: "⏳", done: "✓", warn: "!", failed: "✕", retried: "↻", skipped: "–" };

/** Live multi-agent progress view shown while the Orchestrator runs. */
export function AgentProgress() {
  const { showProgress, setShowProgress, liveLogs, running, caseFile, runError } = useApp();
  const nav = useNavigate();
  if (!showProgress) return null;
  const revision = liveLogs.some((l) => l.step.startsWith("Revision"));
  const done = !running;
  const blocked = done && caseFile?.status === "blocked";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-md">
      <div className="w-full max-w-3xl animate-rise rounded-3xl border border-line bg-surface p-5 shadow-2xl sm:p-7">
        <div className="flex items-center justify-between">
          <div>
            <div className="label">Multi-agent run</div>
            <h2 className="text-xl font-extrabold sm:text-2xl">{done ? (blocked ? "Run stopped by Data Agent" : runError ? "Run failed" : "Diagnosis complete") : "Elevating your campaign…"}</h2>
          </div>
          <span className="text-3xl">⚡</span>
        </div>

        {/* Agent pipeline */}
        <div className="mt-5 grid grid-cols-5 gap-1.5 sm:gap-3">
          {AGENTS.map((a, i) => {
            const st = agentStatus(liveLogs, a.name);
            const ring =
              st === "running" ? "border-accent animate-pulseRing" : st === "done" ? "border-good/60" : st === "warn" ? "border-warn/60" : st === "failed" ? "border-bad/60" : "border-line opacity-50";
            return (
              <div key={a.name} className="relative flex flex-col items-center text-center">
                {i > 0 && <div className={`absolute right-1/2 top-6 h-0.5 w-full -translate-y-1/2 ${st === "idle" ? "bg-line" : "bg-gradient-to-r from-accent to-accent2"}`} style={{ zIndex: 0 }} />}
                <div className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl border-2 bg-surface2 text-xl transition ${ring}`}>
                  {a.icon}
                  {st !== "idle" && st !== "running" && (
                    <span className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${st === "done" ? "bg-good" : st === "warn" ? "bg-warn" : "bg-bad"}`}>{STATUS_ICON[st]}</span>
                  )}
                </div>
                <div className="mt-2 text-[10px] font-semibold leading-tight sm:text-xs">{a.name.replace(" Agent", "")}</div>
                <div className="hidden text-[10px] text-muted sm:block">{a.role}</div>
              </div>
            );
          })}
        </div>
        {revision && <div className="mt-3 text-center text-xs text-warn">↺ Critic rejected some claims and sent them back for one revision</div>}

        {/* Reasoning trail */}
        <div className="mt-5 max-h-64 space-y-1.5 overflow-y-auto rounded-2xl border border-line bg-surface2 p-3">
          {liveLogs.length === 0 && <div className="h-4 w-1/2 animate-shimmer rounded bg-gradient-to-r from-line via-surface to-line bg-[length:200%_100%]" />}
          {liveLogs.map((l) => (
            <div key={l.id} className="flex animate-rise items-start gap-2 text-xs">
              <span className={`mt-0.5 w-4 shrink-0 text-center font-bold ${l.status === "running" ? "text-accent" : l.status === "done" ? "text-good" : l.status === "failed" ? "text-bad" : "text-warn"}`}>
                {l.status === "running" ? "•" : STATUS_ICON[l.status]}
              </span>
              <div className="min-w-0 flex-1">
                <div>
                  <span className="font-semibold">{l.agent}</span> <span className="text-muted">· {l.step}</span>
                  {l.usedLlm && <span className="chip ml-1 !py-0">AI</span>}
                  {l.offline && <span className="chip ml-1 !py-0">offline template</span>}
                  {l.status !== "running" && <span className="ml-1 text-muted">{(l.durationMs / 1000).toFixed(1)}s</span>}
                </div>
                {l.outputSummary && <div className="truncate text-muted" title={l.outputSummary}>{l.outputSummary}</div>}
              </div>
            </div>
          ))}
        </div>

        {runError && <div className="mt-3 rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs text-bad">{runError}</div>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {done && (
            <>
              <button className="btn-ghost" onClick={() => setShowProgress(false)}>
                Close
              </button>
              {blocked ? (
                <button className="btn-primary" onClick={() => { setShowProgress(false); nav("/data"); }}>
                  Open Data Health →
                </button>
              ) : caseFile?.status === "complete" ? (
                <button className="btn-primary" onClick={() => { setShowProgress(false); nav("/"); }}>
                  See results →
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
