import { fmtDate } from "../shared/engine/format";

/** Small daily-trend chart with optional change-point marker and recent-window shading. */
export function Sparkline({
  values,
  dates,
  marker,
  recentFrom,
  color = "rgb(var(--accent))",
  format,
  height = 64,
}: {
  values: number[];
  dates: string[];
  marker?: string;
  recentFrom?: string;
  color?: string;
  format: (v: number) => string;
  height?: number;
}) {
  const w = 300;
  const h = height;
  const pad = 4;
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const mi = marker ? dates.indexOf(marker) : -1;
  const ri = recentFrom ? dates.indexOf(recentFrom) : -1;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" role="img" aria-label="trend chart">
        {ri >= 0 && <rect x={x(ri)} y={0} width={w - x(ri)} height={h} fill="rgb(var(--accent) / 0.07)" />}
        <path d={`${d} L${x(values.length - 1)},${h} L${x(0)},${h} Z`} fill={color} opacity={0.08} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {mi >= 0 && <line x1={x(mi)} x2={x(mi)} y1={0} y2={h} stroke="rgb(var(--bad))" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>
          {fmtDate(dates[0])}: {format(values[0])}
        </span>
        {mi >= 0 && <span className="text-bad">change {fmtDate(dates[mi])}</span>}
        <span>
          {fmtDate(dates[dates.length - 1])}: {format(values[values.length - 1])}
        </span>
      </div>
    </div>
  );
}
