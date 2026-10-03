import { useState, type ChangeEvent, type DragEvent } from "react";
import { Badge, EvidenceChips, Explain, NextStep, PageHeader } from "../components/ui";
import { useApp } from "../lib/store";
import { fmtNum } from "../shared/engine/format";
import { CSV_COLUMNS, SAMPLE_DATASET_NAME, SAMPLE_PROFILE, sampleCsv } from "../shared/sampleData";
import type { BusinessProfile } from "../shared/types";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DataPage() {
  const { dataset, setDataset, profile, setProfile, caseFile, elevate, running } = useApp();
  const [draft, setDraft] = useState<BusinessProfile>(profile);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const report = caseFile?.data;

  const readFile = (file?: File) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setErr("Please upload a .csv file.");
    if (file.size > 10_000_000) return setErr("File is larger than 10 MB.");
    setErr(null);
    file.text().then((t) => setDataset({ name: file.name, csvText: t }));
  };
  const num = (k: keyof BusinessProfile) => (e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: Number(e.target.value) });
  const breakEven = draft.marginPct > 0 ? 100 / draft.marginPct : 0;

  return (
    <div>
      <PageHeader title="Data & Health" subtitle="Upload a CSV export (or use the sample), set your business profile, and check data reliability before trusting any diagnosis." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="font-bold">1 · Campaign data</h3>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files[0]); }}
            className={`mt-3 rounded-2xl border-2 border-dashed p-6 text-center transition ${drag ? "border-accent bg-accent/5" : "border-line"}`}
          >
            <div className="text-2xl">📄</div>
            <div className="mt-1 text-sm">Drop a CSV here or</div>
            <label className="btn-ghost btn-sm mt-2 cursor-pointer">
              Choose file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
            </label>
          </div>
          {err && <div className="mt-2 text-xs text-bad">{err}</div>}
          {caseFile && caseFile.datasetName !== dataset.name && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs">
              <span>
                New file selected. Results on screen are still from <b>{caseFile.datasetName}</b>.
              </span>
              <button className="btn-primary btn-sm" onClick={elevate} disabled={running}>
                ⚡ Analyse {dataset.name}
              </button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              Current: <b>{dataset.name}</b> {!dataset.csvText && <Badge tone="accent">built-in sample</Badge>}
            </div>
            <div className="flex gap-2">
              {dataset.csvText && <button className="btn-ghost btn-sm" onClick={() => setDataset({ name: SAMPLE_DATASET_NAME, csvText: null })}>Use sample</button>}
              <button className="btn-ghost btn-sm" onClick={() => download("sample_campaign_data.csv", sampleCsv())}>↓ Sample CSV</button>
            </div>
          </div>
          <div className="mt-4 text-xs text-muted">
            <div className="label mb-1">Expected columns</div>
            <code className="block break-words rounded-lg bg-surface2 p-2 font-mono text-[11px]">{CSV_COLUMNS.join(", ")}</code>
            <b>Any CSV works.</b> Daily exports (date, impressions, clicks, spend, plus campaign, conversions, revenue) get trend and anomaly analysis; common Meta / Google / LinkedIn header names are mapped automatically, and <b>website_conversions</b> is checked against platform conversions. Files without dates (e.g. one row per customer or per campaign) get segment comparison and conversion-driver analysis: they need at least one category column (channel, campaign type, gender...) and a spend or conversion column.
          </div>
        </div>

        <div className="card">
          <h3 className="font-bold">2 · Business profile</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label className="col-span-2">
              <span className="label">Business name</span>
              <input className="input mt-1" value={draft.businessName} onChange={(e) => setDraft({ ...draft, businessName: e.target.value })} />
            </label>
            <label>
              <span className="label">Goal</span>
              <select className="input mt-1" value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value as BusinessProfile["goal"] })}>
                <option value="purchases">Purchases</option>
                <option value="leads">Leads</option>
                <option value="revenue">Revenue</option>
              </select>
            </label>
            <label>
              <span className="label">Product price ($)</span>
              <input type="number" min={0} className="input mt-1" value={draft.productPrice} onChange={num("productPrice")} />
            </label>
            <label>
              <span className="label">Margin (%)</span>
              <input type="number" min={0} max={100} className="input mt-1" value={draft.marginPct} onChange={num("marginPct")} />
            </label>
            <label>
              <span className="label">Target CPA ($) <Explain k="cpa" /></span>
              {caseFile?.engine && caseFile.engine.account.total.cpa > 0 && <span className="ml-1 text-[10px] text-muted">(your data: ${fmtNum(caseFile.engine.account.total.cpa, 0)})</span>}
              <input type="number" min={0} className="input mt-1" value={draft.targetCpa} onChange={num("targetCpa")} />
            </label>
            <label>
              <span className="label">Target ROAS <Explain k="roas" /></span>
              <input type="number" min={0} step="0.1" className="input mt-1" value={draft.targetRoas} onChange={num("targetRoas")} />
            </label>
            <div className="text-xs text-muted">
              Break-even ROAS ≈ {breakEven.toFixed(2)}x
              <br />
              Max CPA at break-even ≈ ${fmtNum((draft.productPrice * draft.marginPct) / 100, 2)}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" onClick={() => setProfile(draft)}>Save profile</button>
            <button className="btn-ghost btn-sm" onClick={() => setDraft(SAMPLE_PROFILE)}>Reset to sample</button>
          </div>
        </div>
      </div>

      {/* Data Health */}
      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">3 · Data Health check (Data Agent)</h3>
          {report && (
            <Badge tone={report.reliability === "ok" ? "good" : report.reliability === "warn" ? "warn" : "bad"}>
              {report.reliability === "ok" ? "✓ Reliable" : report.reliability === "warn" ? "⚠ Usable with warnings" : "⛔ Blocked"}
            </Badge>
          )}
        </div>
        {!report ? (
          <div className="mt-3 text-sm text-muted">Run the agents to check your data.</div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="label">Rows</div>{report.rowCount} <span className="text-xs text-muted">({report.droppedRows} dropped)</span></div>
              <div><div className="label">Campaigns</div>{report.campaigns.length}</div>
              <div><div className="label">Platforms</div>{report.platforms.join(", ") || "-"}</div>
              <div><div className="label">Dates</div>{report.mode === "segment" ? "none (segment mode)" : `${report.dateRange.start} → ${report.dateRange.end}`}</div>
            </div>
            <div className="mt-4 rounded-xl border border-line bg-surface2 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="label">Analysis mode</span>
                <Badge tone="accent">{report.mode === "segment" ? "Segment comparison + conversion drivers" : "Daily trends + anomaly detection"}</Badge>
              </div>
              {report.detected?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {report.detected.map((d) => (
                    <span key={d.role + d.column} className="chip">
                      {d.column} → {d.role}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 space-y-2">
              {report.issues.map((i) => (
                <div key={i.id} className={`rounded-xl border p-3 text-sm ${i.severity === "block" ? "border-bad/40 bg-bad/5" : i.severity === "warn" ? "border-warn/40 bg-warn/5" : "border-line"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.severity === "block" ? "bad" : i.severity === "warn" ? "warn" : "neutral"}>{i.severity}</Badge>
                    <span className="font-mono text-xs text-muted">{i.check}</span>
                  </div>
                  <div className="mt-1">{i.message}</div>
                  <div className="mt-1">
                    <EvidenceChips ids={i.evidenceIds} evidence={caseFile?.engine?.evidence ?? report.evidence} />
                  </div>
                </div>
              ))}
              {!report.issues.length && <div className="text-sm text-good">No data-quality issues found.</div>}
            </div>
            {report.trackingChecks.length > 0 && (
              <div className="mt-5 overflow-x-auto">
                <div className="label mb-2">
                  Tracking check: platform vs website conversions <Explain k="trackingRatio" />
                </div>
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1.5">Campaign</th>
                      <th>Baseline ratio</th>
                      <th>Last 7 days ratio</th>
                      <th>Platform / Website (7d)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.trackingChecks.map((t) => (
                      <tr key={t.campaign} className="border-t border-line">
                        <td className="py-1.5">{t.campaign}</td>
                        <td>{t.baselineRatio.toFixed(2)}x</td>
                        <td className={t.status === "mismatch" ? "font-bold text-bad" : ""}>{t.recentRatio.toFixed(2)}x</td>
                        <td>{t.platformConversionsRecent} / {t.websiteConversionsRecent}</td>
                        <td><Badge tone={t.status === "ok" ? "good" : "bad"}>{t.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <button className="btn-primary mt-5" onClick={elevate} disabled={running}>
          ⚡ {running ? "Running…" : "Run agents on this data"}
        </button>
      </div>
      <NextStep to="/" label="Command Center" hint="Run the agents, then start from the top priority card." />
    </div>
  );
}
