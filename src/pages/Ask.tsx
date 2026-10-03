import { useEffect, useRef, useState } from "react";
import { EvidenceChips, NeedsCase, PageHeader } from "../components/ui";
import { askCampaign } from "../lib/api";
import { useApp } from "../lib/store";
import type { ChatMessage } from "../shared/types";

const SUGGESTED = [
  "What should I fix first, and why?",
  "Why did CPA go up on Meta?",
  "Can I trust the Performance Max numbers?",
  "Which audience should I scale?",
  "Is the Google Search problem the ad or the landing page?",
  "Have we seen a problem like this before?",
];

export default function Ask() {
  return (
    <NeedsCase>
      <Inner />
    </NeedsCase>
  );
}

function Inner() {
  const { caseFile, level, llm } = useApp();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    setQ("");
    setBusy(true);
    try {
      const a = await askCampaign(caseFile!, text, msgs, level);
      setMsgs([...next, a]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `Sorry, that failed: ${e instanceof Error ? e.message : e}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col lg:h-[calc(100vh-8rem)]">
      <PageHeader title="Ask Your Campaign" subtitle={`Answers only from the findings and your data. The Orchestrator routes each question to the right agent${llm?.llm ? " (Claude tool-calling)" : " (keyword routing, offline)"}.`} />
      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-line bg-surface p-4">
        {!msgs.length && (
          <div className="py-6 text-center">
            <div className="text-3xl">💬</div>
            <div className="mt-2 text-sm text-muted">Try one of these:</div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {SUGGESTED.map((s) => (
                <button key={s} className="chip !px-3 !py-1.5 !text-xs hover:border-accent hover:text-accent" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex animate-rise ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-gradient-to-r from-accent to-accent2 text-white" : "border border-line bg-surface2"}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === "assistant" && (m.toolsUsed?.length || m.evidenceIds?.length) ? (
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
                  {m.toolsUsed?.map((t) => (
                    <span key={t} className="chip">
                      consulted: {t}
                    </span>
                  ))}
                  <EvidenceChips ids={m.evidenceIds ?? []} evidence={caseFile!.engine!.evidence} />
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted">Orchestrator is consulting the agents…</div>}
        <div ref={end} />
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <input className="input" placeholder="Ask about your campaign…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" disabled={busy || !q.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
