import type { Evidence } from "../types";

export const fmtPct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;
export const fmtMoney = (x: number, digits = 2) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const fmtNum = (x: number, digits = 0) =>
  x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtChange = (x: number | null) => (x === null ? "n/a" : `${x > 0 ? "+" : ""}${x.toFixed(1)}%`);

export function fmtByUnit(value: number, unit: Evidence["unit"]): string {
  switch (unit) {
    case "pct":
      return fmtPct(value);
    case "currency":
      return fmtMoney(value);
    case "ratio":
      return value.toFixed(2);
    case "x":
      return `${value.toFixed(2)}x`;
    case "days":
      return `${Math.round(value)} days`;
    default:
      return fmtNum(value);
  }
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
