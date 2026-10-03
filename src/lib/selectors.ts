import type { CaseFile, Finding } from "../shared/types";

export function view(cf: CaseFile) {
  const e = cf.engine!;
  const rankOf = (id: string) => e.priorities.find((p) => p.findingId === id);
  const ranked = [...e.findings].sort((a, b) => (rankOf(a.id)?.rank ?? 99) - (rankOf(b.id)?.rank ?? 99));
  return {
    e,
    ranked,
    rankOf,
    hyp: (id: string) => cf.diagnosis?.hypotheses.find((h) => h.finding_id === id),
    rec: (id: string) => cf.recommendation?.recommendations.find((r) => r.finding_id === id),
    hint: (id: string) => cf.memoryHints.find((h) => h.findingId === id),
    campaign: (f: Finding) => e.campaigns.find((c) => c.campaign === f.campaign),
    top: e.findings.find((f) => f.id === cf.recommendation?.top_priority.finding_id) ?? ranked[0],
  };
}
