// Shared types for the analysis engine, the agents (server) and the UI.
// The Case File is the single JSON document every agent reads/writes.

export type Platform = "Meta" | "Google" | "LinkedIn" | string;

/** One cleaned CSV row (one day x one campaign/ad set). */
export interface Row {
  date: string; // YYYY-MM-DD
  platform: Platform;
  campaign: string;
  audience: string;
  creative: string;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  landing_page_views: number;
  spend: number;
  platform_conversions: number;
  website_conversions: number;
  revenue: number;
}

export type Goal = "purchases" | "leads" | "revenue";

export interface BusinessProfile {
  businessName: string;
  goal: Goal;
  productPrice: number;
  marginPct: number; // 0-100
  targetCpa: number;
  targetRoas: number;
}

/** Derived metrics for any aggregate (campaign, period, account, day). */
export interface Metrics {
  impressions: number;
  reach: number;
  clicks: number;
  landing_page_views: number;
  spend: number;
  conversions: number; // website (source of truth)
  platform_conversions: number;
  revenue: number;
  frequency: number;
  ctr: number; // clicks / impressions
  cpc: number;
  cpm: number;
  cvr: number; // conversions / clicks
  cpa: number;
  roas: number;
  lpRate: number; // landing page views / clicks
  trackingRatio: number; // platform conv / website conv
}

export type MetricKey = keyof Metrics;

// ---------------- Data Agent ----------------

export type Reliability = "ok" | "warn" | "block";

export interface DataIssue {
  id: string;
  severity: "info" | "warn" | "block";
  check: string;
  message: string;
  campaign?: string;
  evidenceIds: string[];
}

export interface TrackingCheck {
  campaign: string;
  platform: Platform;
  baselineRatio: number;
  recentRatio: number;
  platformConversionsRecent: number;
  websiteConversionsRecent: number;
  status: "ok" | "mismatch";
  startDate?: string;
}

export interface DataReport {
  rowCount: number;
  droppedRows: number;
  campaigns: string[];
  platforms: string[];
  dateRange: { start: string; end: string; days: number };
  issues: DataIssue[];
  trackingChecks: TrackingCheck[];
  reliability: Reliability;
  totals: Metrics;
  evidence: Evidence[];
  missingColumns: string[];
  /** timeseries = daily campaign export (trends, anomalies); segment = no dates (segment comparison, drivers). */
  mode: AnalysisMode;
  /** How uploaded columns were interpreted, e.g. { role: "spend", column: "AdSpend" }. */
  detected: { role: string; column: string }[];
}

export type AnalysisMode = "timeseries" | "segment";

// ---------------- Evidence + Findings ----------------

export interface Evidence {
  id: string; // E1, E2 ...
  label: string; // human description: "CTR, Meta - Prospecting Video, last 7 days"
  metric: string;
  value: number;
  display: string; // formatted: "0.71%"
  unit: "pct" | "currency" | "ratio" | "count" | "days" | "x";
  scope: string; // campaign / account / audience
  period?: string; // "baseline 2026-09-01..2026-09-23" etc
}

export type FindingType =
  | "creative_fatigue"
  | "landing_page_issue"
  | "tracking_break"
  | "auction_pressure"
  | "budget_waste"
  | "audience_opportunity"
  | "goal_gap"
  | "segment_underperformer"
  | "segment_opportunity"
  | "conversion_drivers";

/** Segment comparison attached to segment-mode findings (drives the bar chart in the UI). */
export interface SegmentComparison {
  dimension: string;
  value: string;
  metric: "conversion_rate" | "cpa" | "effect_size";
  rows: { label: string; n: number; value: number; display: string; highlight?: boolean }[];
}

export type Category = "creative" | "conversion" | "data_quality" | "audience" | "budget" | "goal" | "platform";

export interface ChainNode {
  metric: string;
  direction: "up" | "down" | "stable";
  changePct: number | null;
  evidenceId?: string;
  note: string;
  isRootCause?: boolean;
}

export interface Finding {
  id: string; // F1, F2...
  type: FindingType;
  category: Category;
  kind: "problem" | "opportunity" | "data_warning";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  campaign: string;
  platform: Platform;
  ruleId: string;
  ruleText: string; // the metric-tree rule that fired, in plain words
  chain: ChainNode[]; // root-cause chain, symptom -> root cause
  evidenceIds: string[];
  startDate?: string; // detected change point
  supportingSignals: number; // how many independent signals agree
  impact: { weeklyCostEstimate: number; evidenceId: string; note: string; /** "/ week" or "over the dataset" */ unitLabel?: string };
  dataCaveat?: string;
  segment?: SegmentComparison;
  /** Minimum A/B test length from conversion volume (rule of thumb: 100 conversions per arm). */
  suggestedTestDays?: number;
  testDaysEvidenceId?: string;
}

export interface PriorityScore {
  findingId: string;
  impact: number; // 0-1
  urgency: number;
  confidence: number;
  effort: number; // 0-1, higher = more effort
  goalRelevance: number;
  total: number; // 0-100
  rank: number;
}

export interface HealthComponent {
  key: "goal" | "budget" | "creative" | "audience" | "conversion" | "data_quality";
  label: string;
  score: number;
  reasons: string[];
  evidenceIds: string[];
  /** false = this data cannot measure it (excluded from the overall score). */
  measurable?: boolean;
}

export interface Health {
  overall: number;
  components: HealthComponent[];
}

export interface DailyPoint {
  date: string;
  ctr: number;
  cvr: number;
  cpa: number;
  frequency: number;
  spend: number;
  conversions: number;
  platform_conversions: number;
  roas: number;
  lpRate: number;
}

export interface CampaignSummary {
  campaign: string;
  platform: Platform;
  audience: string;
  creative: string;
  baseline: Metrics;
  recent: Metrics;
  total: Metrics;
  spendShare: number;
  daily: DailyPoint[];
}

export interface StoryEvent {
  date: string;
  title: string;
  detail: string;
  findingId?: string;
  tone: "neutral" | "bad" | "good" | "warn";
}

export interface DiagnosisEngineOutput {
  mode: AnalysisMode;
  periods: { baseline: { start: string; end: string }; recent: { start: string; end: string } };
  account: { baseline: Metrics; recent: Metrics; total: Metrics };
  campaigns: CampaignSummary[];
  findings: Finding[];
  evidence: Evidence[];
  priorities: PriorityScore[];
  health: Health;
  story: StoryEvent[];
}

// ---------------- LLM layer outputs ----------------

export type Confidence = "likely" | "possible" | "insufficient_data";

export interface Hypothesis {
  finding_id: string;
  title: string;
  diagnosis_beginner: string;
  diagnosis_expert: string;
  confidence: Confidence;
  evidence_ids: string[];
  facts: string[];
  alternatives: { explanation: string; why_less_likely: string; evidence_ids: string[] }[];
  what_would_confirm: string;
  critic_note?: string;
}

export interface DiagnosisOutput {
  hypotheses: Hypothesis[];
}

export interface Recommendation {
  id: string;
  finding_id: string;
  title: string;
  why: string;
  action_steps: string[];
  expected_effect: string; // qualitative, labeled as estimate
  effort: "low" | "medium" | "high";
  evidence_ids: string[];
  critic_note?: string;
}

export interface ExperimentProposal {
  finding_id: string;
  hypothesis: string;
  control: string;
  variant: string;
  primary_metric: string;
  guardrail_metric: string;
  duration_days: number;
  success_criterion: string;
  evidence_ids: string[];
}

export interface RecommendationOutput {
  top_priority: { finding_id: string; reasoning: string; evidence_ids: string[] };
  recommendations: Recommendation[];
  experiment: ExperimentProposal;
}

export interface CriticIssue {
  target: string; // "hypothesis:F1" | "recommendation:R1" | "experiment" | "top_priority"
  problem: string;
  severity: "reject" | "downgrade";
  fix: string;
  source: "code" | "llm";
}

export interface Verification {
  status: "verified" | "verified_with_downgrades" | "unverified";
  revised: boolean;
  checksRun: number;
  issuesFound: CriticIssue[];
  remainingIssues: CriticIssue[];
  downgrades: string[];
  summary: string;
}

// ---------------- Agent log + Case File ----------------

export type AgentName = "Orchestrator" | "Data Agent" | "Diagnosis Agent" | "Recommendation Agent" | "Critic Agent";

export interface AgentLog {
  id: string;
  agent: AgentName;
  step: string;
  status: "running" | "done" | "failed" | "retried" | "skipped" | "warn";
  inputSummary: string;
  outputSummary: string;
  startedAt: string;
  durationMs: number;
  usedLlm: boolean;
  offline?: boolean;
}

export interface MemoryHint {
  memoryId: string;
  findingId: string;
  text: string;
  outcome?: string;
}

export interface CaseFile {
  id: string;
  createdAt: string;
  datasetName: string;
  profile: BusinessProfile;
  status: "running" | "complete" | "blocked" | "failed";
  llmMode: "claude" | "offline";
  data?: DataReport;
  engine?: DiagnosisEngineOutput;
  diagnosis?: DiagnosisOutput;
  recommendation?: RecommendationOutput;
  verification?: Verification;
  memoryHints: MemoryHint[];
  logs: AgentLog[];
}

/** Events streamed (NDJSON) from the orchestrator to the UI. */
export type RunEvent =
  | { type: "log"; log: AgentLog }
  | { type: "case"; caseFile: CaseFile }
  | { type: "error"; message: string };

// ---------------- Plan / Experiments / Memory (store tables) ----------------

export interface PlanItem {
  id: string;
  caseId: string;
  recommendationId: string;
  findingId: string;
  title: string;
  steps: string[];
  status: "proposed" | "approved" | "rejected" | "done";
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Experiment {
  id: string;
  caseId: string;
  findingId: string;
  findingType: FindingType;
  hypothesis: string;
  control: string;
  variant: string;
  primary_metric: string;
  guardrail_metric: string;
  duration_days: number;
  success_criterion: string;
  status: "draft" | "running" | "completed" | "cancelled";
  result?: string;
  outcome?: "won" | "lost" | "inconclusive";
  savedToMemory?: boolean;
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  kind: "diagnosis" | "action" | "experiment";
  findingType: FindingType;
  platform: string;
  campaign: string;
  summary: string;
  outcome?: string;
  caseId?: string;
  createdAt: string;
  demoSeed?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  evidenceIds?: string[];
}
