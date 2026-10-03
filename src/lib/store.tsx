// App state: business profile, dataset, current Case File, live agent logs,
// plan / experiments / memory (persisted server-side), Beginner/Expert mode.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SAMPLE_DATASET_NAME, SAMPLE_PROFILE } from "../shared/sampleData";
import type { AgentLog, BusinessProfile, CaseFile, Experiment, ExperimentProposal, MemoryEntry, PlanItem, Recommendation } from "../shared/types";
import * as api from "./api";

type Level = "beginner" | "expert";
interface Dataset {
  name: string;
  csvText: string | null; // null = built-in sample
}

interface AppState {
  profile: BusinessProfile;
  setProfile: (p: BusinessProfile) => void;
  dataset: Dataset;
  setDataset: (d: Dataset) => void;
  caseFile: CaseFile | null;
  running: boolean;
  liveLogs: AgentLog[];
  runError: string | null;
  showProgress: boolean;
  setShowProgress: (b: boolean) => void;
  elevate: () => Promise<void>;
  level: Level;
  setLevel: (l: Level) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  llm: { llm: boolean; model: string | null } | null;
  plan: PlanItem[];
  experiments: Experiment[];
  memory: MemoryEntry[];
  refresh: () => Promise<void>;
  addToPlan: (r: Recommendation) => Promise<void>;
  updatePlan: (p: PlanItem) => Promise<void>;
  createExperiment: (e: ExperimentProposal) => Promise<void>;
  updateExperiment: (e: Experiment) => Promise<void>;
  saveMemory: (m: Omit<MemoryEntry, "id" | "createdAt">) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {
        /* storage full or blocked: keep in memory only */
      }
    },
    [key],
  );
  return [v, set];
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useLocal<BusinessProfile>("eyc.profile", SAMPLE_PROFILE);
  const [dataset, setDataset] = useLocal<Dataset>("eyc.dataset", { name: SAMPLE_DATASET_NAME, csvText: null });
  const [caseFile, setCaseFile] = useLocal<CaseFile | null>("eyc.case", null);
  const [level, setLevel] = useLocal<Level>("eyc.level", "beginner");
  const [theme, setTheme] = useLocal<"dark" | "light">("eyc.theme", "dark");
  const [running, setRunning] = useState(false);
  const [liveLogs, setLiveLogs] = useState<AgentLog[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [llm, setLlm] = useState<AppState["llm"]>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const refresh = useCallback(async () => {
    const [p, e, m] = await Promise.all([
      api.storeList<PlanItem>("plan_items"),
      api.storeList<Experiment>("experiments"),
      api.storeList<MemoryEntry>("memory"),
    ]);
    setPlan(p);
    setExperiments(e);
    setMemory(m);
  }, []);

  useEffect(() => {
    api.getStatus().then(setLlm).catch(() => setLlm({ llm: false, model: null }));
    refresh().catch(() => undefined);
  }, [refresh]);

  const elevate = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    setLiveLogs([]);
    setShowProgress(true);
    try {
      await api.runCase(
        { csvText: dataset.csvText ?? undefined, useSample: !dataset.csvText, datasetName: dataset.name, profile },
        (ev) => {
          if (ev.type === "log") setLiveLogs((ls) => [...ls.filter((l) => l.id !== ev.log.id), ev.log]);
          else if (ev.type === "case") setCaseFile(ev.caseFile);
          else if (ev.type === "error") setRunError(ev.message);
        },
      );
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [dataset, profile, setCaseFile]);

  const addToPlan = useCallback(
    async (r: Recommendation) => {
      if (!caseFile) return;
      if (plan.some((p) => p.recommendationId === r.id && p.caseId === caseFile.id)) return;
      const now = new Date().toISOString();
      const item: PlanItem = { id: uid("plan"), caseId: caseFile.id, recommendationId: r.id, findingId: r.finding_id, title: r.title, steps: r.action_steps, status: "proposed", createdAt: now, updatedAt: now };
      setPlan((p) => [item, ...p]);
      await api.storeUpsert("plan_items", item);
    },
    [caseFile, plan],
  );

  const saveMemory = useCallback(async (m: Omit<MemoryEntry, "id" | "createdAt">) => {
    const entry: MemoryEntry = { ...m, id: uid("mem"), createdAt: new Date().toISOString() };
    setMemory((xs) => [entry, ...xs]);
    await api.storeUpsert("memory", entry);
  }, []);

  const updatePlan = useCallback(
    async (item: PlanItem) => {
      const prev = plan.find((p) => p.id === item.id);
      const next = { ...item, updatedAt: new Date().toISOString() };
      setPlan((ps) => ps.map((p) => (p.id === item.id ? next : p)));
      await api.storeUpsert("plan_items", next);
      // Orchestrator writes to Marketing Memory only after human approval.
      if (item.status === "approved" && prev?.status !== "approved" && caseFile?.engine) {
        const f = caseFile.engine.findings.find((x) => x.id === item.findingId);
        const h = caseFile.diagnosis?.hypotheses.find((x) => x.finding_id === item.findingId);
        if (f)
          await saveMemory({ kind: "action", findingType: f.type, platform: f.platform, campaign: f.campaign, summary: `${f.title}. ${h?.diagnosis_beginner ?? ""} Approved action: ${item.title}.`, caseId: caseFile.id });
      }
    },
    [plan, caseFile, saveMemory],
  );

  const createExperiment = useCallback(
    async (e: ExperimentProposal) => {
      if (!caseFile?.engine) return;
      const f = caseFile.engine.findings.find((x) => x.id === e.finding_id);
      const exp: Experiment = {
        id: uid("exp"), caseId: caseFile.id, findingId: e.finding_id, findingType: f?.type ?? "goal_gap",
        hypothesis: e.hypothesis, control: e.control, variant: e.variant, primary_metric: e.primary_metric, guardrail_metric: e.guardrail_metric,
        duration_days: e.duration_days, success_criterion: e.success_criterion, status: "draft", createdAt: new Date().toISOString(),
      };
      setExperiments((xs) => [exp, ...xs]);
      await api.storeUpsert("experiments", exp);
    },
    [caseFile],
  );

  const updateExperiment = useCallback(async (e: Experiment) => {
    setExperiments((xs) => xs.map((x) => (x.id === e.id ? e : x)));
    await api.storeUpsert("experiments", e);
  }, []);

  const deleteMemory = useCallback(async (id: string) => {
    setMemory((xs) => xs.filter((x) => x.id !== id));
    await api.storeDelete("memory", id);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      profile, setProfile, dataset, setDataset, caseFile, running, liveLogs, runError, showProgress, setShowProgress, elevate,
      level, setLevel, theme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"), llm,
      plan, experiments, memory, refresh, addToPlan, updatePlan, createExperiment, updateExperiment, saveMemory, deleteMemory,
    }),
    [profile, setProfile, dataset, setDataset, caseFile, running, liveLogs, runError, showProgress, elevate, level, setLevel, theme, setTheme, llm, plan, experiments, memory, refresh, addToPlan, updatePlan, createExperiment, updateExperiment, saveMemory, deleteMemory],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
