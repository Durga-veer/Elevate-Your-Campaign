import { useEffect, useState } from "react";

export const scoreTone = (s: number) => (s >= 75 ? "rgb(var(--good))" : s >= 50 ? "rgb(var(--warn))" : "rgb(var(--bad))");

/** Animated health ring: counts up and sweeps on mount. */
export function HealthRing({ score, size = 168, label = "Health" }: { score: number; size?: number; label?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1100);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreTone(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-extrabold tabular-nums">{shown}</div>
        <div className="label">{label}</div>
      </div>
    </div>
  );
}

export function MiniBar({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: tone ?? scoreTone(value) }} />
    </div>
  );
}
