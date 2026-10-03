import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { GLOSSARY } from "../lib/glossary";
import { useApp } from "../lib/store";
import type { Confidence, Evidence, Finding } from "../shared/types";

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "accent"; children: ReactNode }) {
  const cls = {
    neutral: "border-line bg-surface2 text-muted",
    good: "border-good/30 bg-good/10 text-good",
    warn: "border-warn/30 bg-warn/10 text-warn",
    bad: "border-bad/30 bg-bad/10 text-bad",
    accent: "border-accent/30 bg-accent/10 text-accent",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export function ConfidenceBadge({ c }: { c?: Confidence }) {
  if (!c) return null;
  const map = { likely: ["good", "● Likely"], possible: ["warn", "◐ Possible"], insufficient_data: ["neutral", "○ Insufficient data"] } as const;
  const [tone, label] = map[c];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={tone}>{label}</Badge>
      <Explain k="confidence" />
    </span>
  );
}

export function SeverityBadge({ f }: { f: Finding }) {
  if (f.kind === "opportunity") return <Badge tone="good">▲ Opportunity</Badge>;
  if (f.kind === "data_warning") return <Badge tone="warn">⚠ Data warning</Badge>;
  const tone = f.severity === "critical" || f.severity === "high" ? "bad" : "warn";
  return <Badge tone={tone}>{f.severity.toUpperCase()}</Badge>;
}

/** Evidence id chip: hover/click shows the exact value from the Case File. */
export function EvidenceChip({ id, evidence }: { id: string; evidence: Evidence[] }) {
  const e = evidence.find((x) => x.id === id);
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${e ? "border-accent/40 bg-accent/10 text-accent" : "border-bad/40 bg-bad/10 text-bad line-through"}`}
      >
        {id}
      </button>
      {open && (
        <span className="absolute bottom-full left-0 z-40 mb-1 w-64 rounded-lg border border-line bg-surface p-2 text-xs text-ink shadow-xl">
          {e ? (
            <>
              <span className="block text-muted">{e.label}</span>
              <span className="mt-1 block font-mono text-sm font-semibold">{e.display}</span>
            </>
          ) : (
            <span className="text-bad">Unknown evidence id: not in the Case File</span>
          )}
        </span>
      )}
    </span>
  );
}

export function EvidenceChips({ ids, evidence }: { ids: string[]; evidence: Evidence[] }) {
  if (!ids.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => (
        <EvidenceChip key={id} id={id} evidence={evidence} />
      ))}
    </span>
  );
}

/** ⓘ Explain popover (Beginner / Expert wording). */
export function Explain({ k }: { k: string }) {
  const { level } = useApp();
  const g = GLOSSARY[k];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!g) return null;
  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button type="button" aria-label={`Explain ${g.name}`} onClick={() => setOpen(!open)} className="ml-0.5 h-4 w-4 rounded-full border border-line text-[10px] leading-none text-muted hover:border-accent hover:text-accent">
        i
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 rounded-xl border border-line bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-2xl">
          <span className="block font-semibold">{g.name}</span>
          <span className="mt-1 block text-muted">{level === "beginner" ? g.beginner : g.expert}</span>
          {g.good && <span className="mt-1 block text-[11px] text-accent">{g.good}</span>}
        </span>
      )}
    </span>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg animate-rise overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function NeedsCase({ children }: { children: ReactNode }) {
  const { caseFile } = useApp();
  if (caseFile?.engine) return <>{children}</>;
  return (
    <div className="card mx-auto mt-10 max-w-md text-center">
      <div className="text-4xl">⚡</div>
      <h2 className="mt-2 text-lg font-bold">No analysis yet</h2>
      <p className="mt-1 text-sm text-muted">
        {caseFile?.status === "blocked" ? "The last run was blocked by the Data Agent. Check Data Health." : "Run the agents on your data (or the sample) first."}
      </p>
      <Link to={caseFile?.status === "blocked" ? "/data" : "/"} className="btn-primary mt-4">
        {caseFile?.status === "blocked" ? "Open Data Health" : "Go to Command Center"}
      </Link>
    </div>
  );
}

/** "What should I do next?" footer strip present on every screen. */
export function NextStep({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <div className="mt-8 flex flex-col items-start justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center">
      <div>
        <div className="label text-accent">What should I do next?</div>
        <div className="text-sm">{hint}</div>
      </div>
      <Link to={to} className="btn-primary btn-sm">
        {label} →
      </Link>
    </div>
  );
}
