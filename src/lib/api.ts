import type { BusinessProfile, CaseFile, ChatMessage, RunEvent } from "../shared/types";

export async function getStatus(): Promise<{ llm: boolean; model: string | null }> {
  const r = await fetch("/api/status");
  return r.json();
}

/** Starts an orchestrated run and streams agent events (NDJSON). */
export async function runCase(
  body: { csvText?: string; useSample?: boolean; datasetName?: string; profile: BusinessProfile },
  onEvent: (e: RunEvent) => void,
): Promise<void> {
  const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`Run failed: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as RunEvent);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as RunEvent);
}

export async function askCampaign(caseFile: CaseFile, question: string, history: ChatMessage[], level: "beginner" | "expert"): Promise<ChatMessage> {
  const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseFile, question, history, level }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function storeList<T>(table: string): Promise<T[]> {
  const r = await fetch(`/api/store/${table}`);
  return r.ok ? r.json() : [];
}
export async function storeUpsert(table: string, item: unknown): Promise<void> {
  await fetch(`/api/store/${table}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
}
export async function storeDelete(table: string, id: string): Promise<void> {
  await fetch(`/api/store/${table}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function seedMemory(): Promise<void> {
  await fetch("/api/memory/seed", { method: "POST" });
}
