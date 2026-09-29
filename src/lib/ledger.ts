import rawCustomers from "@/data/customers.json";

export type Customer = { name: string; amount: number };
export type ManualEntries = Record<string, number>;

export const CUSTOMERS_KEY = "rdx-customers-v2";
export const ENTRIES_KEY = "rdx-manual-entries-v2";
export const ABS_KEY = "rdx-compare-abs-v2";

export const builtInCustomers: Customer[] = rawCustomers as Customer[];

/** Pull the city / branch tag out of the trailing parentheses of a name. */
export function parseCity(name: string): string {
  const groups = [...name.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]!.trim().toUpperCase());
  const last = groups[groups.length - 1];
  if (last && !/^\d+$/.test(last) && last.split(/\s+/).length === 1 && groups.length === 1) {
    return last;
  }
  // Names like "BHALWAL (JABBAR BARTAN) (373)" -> city is the leading town name.
  const lead = name.split("(")[0]!.trim().toUpperCase();
  if (groups.length > 1 && lead) return lead;
  if (last && !/^\d+$/.test(last)) return lead || last;
  return lead || "OTHER";
}


export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function keyOf(name: string): string {
  return cleanName(name).toUpperCase();
}

/** Accepts almost any JSON shape the user pastes/uploads and normalises it. */
export function normaliseCustomers(input: unknown): Customer[] {
  let list: unknown = input;
  if (typeof list === "string") list = parseLooseJson(list);
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const values = Object.values(list as Record<string, unknown>);
    const arr = values.find((v) => Array.isArray(v));
    if (arr) list = arr;
  }
  if (!Array.isArray(list)) return [];

  const out: Customer[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    let name = "";
    let amount: number | null = null;
    for (const [rawKey, rawValue] of Object.entries(record)) {
      const k = rawKey.trim().toUpperCase();
      if (
        !name &&
        (k.includes("NAME") ||
          k.includes("CUSTOMER") ||
          k.includes("PARTY") ||
          k.includes("DESCRIPTION") ||
          k.includes("TITLE"))
      ) {
        name = cleanName(String(rawValue ?? ""));
      } else if (
        amount === null &&
        (k.includes("AMOUNT") || k.includes("BALANCE") || k.includes("BAL"))
      ) {
        amount = toNumber(rawValue);
      }
    }
    if (!name) continue;
    out.push({ name, amount: amount ?? 0 });
  }
  return out;
}

/** Handles a file that is a bare list of objects without surrounding brackets. */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(`[${trimmed.replace(/,\s*$/, "")}]`);
    } catch {
      return null;
    }
  }
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type Status = "match" | "computer-high" | "book-high" | "missing";

export type ReportRow = {
  name: string;
  city: string;
  computer: number;
  manual: number | null;
  difference: number;
  status: Status;
};

export const statusLabel: Record<Status, string> = {
  match: "BARABAR",
  "computer-high": "COMPUTER ZAYDA",
  "book-high": "BOOK ZAYDA",
  missing: "ENTRY NAHI",
};

export function buildReport(
  customers: Customer[],
  entries: ManualEntries,
  compareAbs: boolean,
): ReportRow[] {
  return customers.map((c) => {
    const k = keyOf(c.name);
    const hasEntry = Object.prototype.hasOwnProperty.call(entries, k);
    const manual = hasEntry ? entries[k]! : null;
    const computerValue = compareAbs ? Math.abs(c.amount) : c.amount;
    const manualValue = manual === null ? null : compareAbs ? Math.abs(manual) : manual;
    const difference = manualValue === null ? 0 : computerValue - manualValue;
    let status: Status;
    if (manualValue === null) status = "missing";
    else if (Math.abs(difference) < 0.005) status = "match";
    else if (difference > 0) status = "computer-high";
    else status = "book-high";
    return {
      name: c.name,
      city: parseCity(c.name),
      computer: computerValue,
      manual: manualValue,
      difference,
      status,
    };
  });
}

export function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Turns a github page/blob link into a raw content link. */
export function toRawGithubUrl(url: string): string {
  const u = url.trim();
  if (u.includes("github.com") && u.includes("/blob/")) {
    return u.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  }
  return u;
}
