import type { SegmentComparison } from "../shared/types";

/** Horizontal bars comparing segments (segment mode: no daily data to chart). */
export function SegmentBars({ s }: { s: SegmentComparison }) {
  const max = Math.max(...s.rows.map((r) => r.value), 1e-9);
  const title = s.metric === "conversion_rate" ? `Conversion rate by ${s.dimension}` : s.metric === "cpa" ? `Cost per conversion by ${s.dimension}` : "Effect size: converted vs not converted";
  return (
    <div className="rounded-xl border border-line bg-surface2 p-3">
      <div className="mb-2 text-xs font-semibold">{title}</div>
      <div className="space-y-1.5">
        {s.rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,9rem),1fr,auto] items-center gap-2 text-xs">
            <span className={`truncate ${r.highlight ? "font-semibold text-ink" : "text-muted"}`} title={r.label}>
              {r.label}
            </span>
            <div className="h-2.5 overflow-hidden rounded-full bg-line">
              <div className={`h-full rounded-full transition-all duration-700 ${r.highlight ? "bg-gradient-to-r from-accent to-accent2" : "bg-muted/50"}`} style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
            </div>
            <span className="tabular-nums text-muted">
              {r.display}
              {s.metric !== "effect_size" && <span className="ml-1 text-[10px]">n={r.n.toLocaleString("en-US")}</span>}
            </span>
          </div>
        ))}
      </div>
      {s.metric === "effect_size" && <div className="mt-2 text-[10px] text-muted">0.2 = small, 0.5 = medium, 0.8 = large difference. Correlation, not causation.</div>}
    </div>
  );
}
