import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useApp } from "../lib/store";
import { AgentProgress } from "./AgentProgress";

const NAV = [
  { to: "/", label: "Command Center", short: "Home", icon: "⚡" },
  { to: "/diagnosis", label: "Diagnosis", short: "Why", icon: "🔬" },
  { to: "/priorities", label: "Priority Engine", short: "Priority", icon: "🎯" },
  { to: "/plan", label: "Today's Plan", short: "Plan", icon: "✅" },
  { to: "/experiments", label: "Experiments", short: "Tests", icon: "🧪" },
  { to: "/ask", label: "Ask Your Campaign", short: "Ask", icon: "💬" },
  { to: "/memory", label: "Marketing Memory", short: "Memory", icon: "🧠" },
  { to: "/data", label: "Data & Health", short: "Data", icon: "🗂️" },
  { to: "/trail", label: "Agent Trail", short: "Trail", icon: "🛡️" },
];
const MOBILE = ["/", "/diagnosis", "/plan", "/ask", "/data"];

export function Layout({ children }: { children: ReactNode }) {
  const { level, setLevel, theme, toggleTheme, llm, caseFile } = useApp();
  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-2">
          <div className="text-lg font-extrabold leading-tight">
            Elevate <span className="gradient-text">Your Campaign</span>
          </div>
          <div className="text-[11px] text-muted">AI campaign diagnosis agents</div>
        </div>
        <nav className="mt-6 flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${isActive ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface2 hover:text-ink"}`}
            >
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-2 text-[11px] text-muted">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${llm?.llm ? "bg-good" : "bg-warn"}`} />
            {llm === null ? "Checking Claude…" : llm.llm ? `AI: ${llm.model}` : "Offline mode (no API key)"}
          </div>
          {caseFile && <div className="truncate">Case: {caseFile.datasetName}</div>}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur sm:px-6">
          <div className="font-extrabold lg:hidden">
            ⚡ <span className="gradient-text">Elevate</span>
          </div>
          <div className="hidden text-xs text-muted lg:block">Most tools tell you what happened. This tells you why, what to do next, tests it, and remembers what worked.</div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-line bg-surface2 p-0.5 text-xs font-semibold" role="group" aria-label="Wording level">
              {(["beginner", "expert"] as const).map((l) => (
                <button key={l} onClick={() => setLevel(l)} className={`rounded-lg px-2.5 py-1 capitalize transition ${level === l ? "bg-surface text-ink shadow" : "text-muted"}`}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={toggleTheme} className="btn-ghost btn-sm" aria-label="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${isActive ? "text-accent" : "text-muted"}`}>
            <span className="text-lg leading-none">{n.icon}</span>
            {n.short}
          </NavLink>
        ))}
      </nav>
      <AgentProgress />
    </div>
  );
}
