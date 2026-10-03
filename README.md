# ⚡ Elevate Your Campaign: AI Marketing Campaign Diagnosis Agent

Most tools tell you what happened. This one tells you **why**, **what to do next**, **tests it**, and **remembers what worked**.

**DATA → ANOMALY → ROOT CAUSE → EVIDENCE → DIAGNOSIS (confidence) → RECOMMENDATION → ACTION PLAN → EXPERIMENT → RESULT → MEMORY**

## Run it in VS Code
```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY (optional: without it, offline templates are used)
npm run dev               # http://localhost:5173
```
Click **⚡ ELEVATE MY CAMPAIGN**. With no data uploaded, it uses the built-in sample with 3 planted problems and 1 opportunity.

Other scripts:
- `npm run build`: typecheck and production build
- `npx vite-node scripts/smoke-test.ts`: checks the engine finds every planted problem and the Critic passes
- `node scripts/api-test.mjs`: end-to-end API test against a running dev server
- `npm run gen:csv`: writes `public/sample_campaign_data.csv`

## Any CSV: two analysis modes (picked automatically by the Data Agent)
| Your file | Mode | What you get |
|---|---|---|
| Daily export (`date, impressions, clicks, spend`, plus campaign, conversions, revenue…) | **Daily trends** (`engine/diagnosis.ts`) | Change points, metric-tree root causes (fatigue, landing page, tracking, auction), budget waste, audience opportunities |
| No dates (e.g. one row per customer or per campaign) with a category column and a spend/conversion column | **Segment** (`engine/segments.ts`) | Segment comparison with significance tests (z-test, p < 0.01), weak/strong segments, conversion drivers (converted vs not, Cohen's d), age/income bands |

Check any file offline: `npx vite-node scripts/analyze-file.ts path/to/file.csv`

## Architecture
Two layers. **The LLM never does the math.**

| Layer | Where | What |
|---|---|---|
| Deterministic engine (TypeScript) | `src/shared/engine/` | CSV parsing, metrics, period comparison, z-score change points, metric-tree rules, priority, health, number tracing |
| Claude layer | `server/` | Receives **only** the findings JSON (`server/agents/payload.ts`) and returns hypotheses, plan, experiment and critique, citing evidence ids |

**5 agents** share one **Case File** (`src/shared/types.ts → CaseFile`):
| Agent | Type | File |
|---|---|---|
| Orchestrator | code | `server/orchestrator.ts` (plans, retries, falls back, runs the revision loop, saves) + `server/ask.ts` (tool-calling router) |
| Data Agent | code | `server/agents/dataAgent.ts` → `engine/dataQuality.ts` (warns or **blocks**) |
| Diagnosis Agent | code + Claude | `server/agents/diagnosisAgent.ts` → `engine/diagnosis.ts` |
| Recommendation Agent | Claude | `server/agents/recommendationAgent.ts` (+ `engine/priority.ts`) |
| Critic Agent | code + Claude | `server/agents/criticAgent.ts` → `engine/claimCheck.ts` (rejects, asks for one revision, then downgrades) |

**Marketing Memory** is a store, not an agent (`server/store.ts`; Supabase schema in `supabase/migrations/001_schema.sql`). It is written only after human approval and read at the start of every run.

**AI provider:** set `LLM_PROVIDER` in `.env` to `anthropic` (Claude), `gemini` (Google, `GEMINI_API_KEY`, default model `gemini-3.6-flash`) or `openrouter`. All providers get the same prompts and the same Critic checks (`server/llm.ts`, `server/gemini.ts`).

Claude calls per run: 3 (Diagnosis, Recommendation, Critic), plus 1 more only if the Critic rejects something. The model is set by `ANTHROPIC_MODEL` (default `claude-opus-5-5`, effort `low`). Calls go through `server/llm.ts`, which also turns on the server-side refusal fallback (beta). Set `CLAUDE_FALLBACKS=off` to disable it.

The backend runs inside the Vite dev server (`vite.config.ts → agentsApi`), so the API key stays in Node. For Lovable, port `server/` to Supabase edge functions (see `docs/PLAYBOOK.md`).

## Docs
- `docs/BLUEPRINT.md`: concept critique, screens, tables, findings schema, metric-tree rules, dataset spec, prompt overview
- `docs/PLAYBOOK.md`: Lovable prompts, 24-hour timeline and 3-person split, 5-minute demo script, judge Q&A
- `server/prompts.ts`: the Claude prompt templates (diagnosis, recommendation/priority/experiment, critic, ask)
