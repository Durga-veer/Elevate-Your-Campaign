import type { Evidence } from "../types";
import { fmtByUnit } from "./format";

/** Collects evidence items and hands out stable ids (prefix + counter). */
export class EvidenceRegistry {
  items: Evidence[] = [];
  private n = 0;
  constructor(private prefix: string) {}

  add(e: Omit<Evidence, "id" | "display"> & { display?: string }): string {
    const id = `${this.prefix}${++this.n}`;
    this.items.push({ ...e, id, display: e.display ?? fmtByUnit(e.value, e.unit) });
    return id;
  }
}
