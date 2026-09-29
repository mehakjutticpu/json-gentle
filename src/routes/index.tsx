import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  CloudDownload,
  Download,
  FileSpreadsheet,
  FileText,
  Github,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ABS_KEY,
  CUSTOMERS_KEY,
  ENTRIES_KEY,
  buildReport,
  builtInCustomers,
  cleanName,
  fmt,
  keyOf,
  normaliseCustomers,
  parseCity,
  parseLooseJson,
  statusLabel,
  toNumber,
  toRawGithubUrl,
  type Customer,
  type ManualEntries,
  type ReportRow,
  type Status,
} from "@/lib/ledger";
import { exportExcel, exportPdf } from "@/lib/exports";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RDX Account Zone — Customer Balance Comparison Book" },
      {
        name: "description",
        content:
          "Compare computer account balances with your manual book entries, filter by city, find differences and export the full report to Excel or PDF.",
      },
      { property: "og:title", content: "RDX Account Zone — Customer Balance Comparison Book" },
      {
        property: "og:description",
        content:
          "Upload your customer JSON, add manual amounts and instantly see who is short, who is over and who has no entry.",
      },
    ],
  }),
  component: AccountZone,
});

type StatusFilter = "all" | Status;

const statusTone: Record<Status, string> = {
  match: "text-success",
  "computer-high": "text-warning",
  "book-high": "text-accent",
  missing: "text-muted-foreground",
};

function AccountZone() {
  type Book = { id: string; name: string; customers: Customer[]; entries: ManualEntries };
  const BOOKS_KEY = "rdx-books-v3";
  const ACTIVE_KEY = "rdx-active-book-v3";
  const [books, setBooks] = useState<Book[]>([
    { id: "default", name: "Default list", customers: builtInCustomers, entries: {} },
  ]);
  const [activeId, setActiveId] = useState("default");
  const active = books.find((b) => b.id === activeId) ?? books[0]!;
  const customers = active.customers;
  const entries = active.entries;
  const setEntries = (fn: (prev: ManualEntries) => ManualEntries) =>
    setBooks((bs) => bs.map((b) => (b.id === active.id ? { ...b, entries: fn(b.entries) } : b)));
  const [compareAbs, setCompareAbs] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [showSuggest, setShowSuggest] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [city, setCity] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<"name" | "diff">("name");
  const [ghUrl, setGhUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // load persisted state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BOOKS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Book[];
        if (Array.isArray(parsed) && parsed.length) {
          setBooks(parsed);
          const a = localStorage.getItem(ACTIVE_KEY);
          setActiveId(a && parsed.some((b) => b.id === a) ? a : parsed[0]!.id);
        }
      } else {
        // migrate old single-list data
        const c = localStorage.getItem(CUSTOMERS_KEY);
        const e = localStorage.getItem(ENTRIES_KEY);
        const list = c ? normaliseCustomers(JSON.parse(c)) : [];
        setBooks([
          {
            id: "default",
            name: "Default list",
            customers: list.length ? list : builtInCustomers,
            entries: e ? (JSON.parse(e) as ManualEntries) : {},
          },
        ]);
      }
      const a = localStorage.getItem(ABS_KEY);
      if (a) setCompareAbs(a === "1");
    } catch {
      /* ignore corrupt storage */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
    localStorage.setItem(ACTIVE_KEY, activeId);
  }, [books, activeId, loaded]);
  useEffect(() => {
    if (loaded) localStorage.setItem(ABS_KEY, compareAbs ? "1" : "0");
  }, [compareAbs, loaded]);

  function resetForm() {
    setNameInput("");
    setAmountInput("");
    setEditingKey(null);
    setCity("ALL");
  }

  function applyCustomers(list: Customer[], name = "New list") {
    const id = `b${Date.now()}`;
    setBooks((bs) => [...bs, { id, name, customers: list, entries: {} }]);
    setActiveId(id);
    resetForm();
  }

  function selectBook(id: string) {
    setActiveId(id);
    resetForm();
  }

  function deleteBook(id: string) {
    const b = books.find((x) => x.id === id);
    if (!b || !confirm(`"${b.name}" list aur us ki entries delete karein?`)) return;
    const rest = books.filter((x) => x.id !== id);
    const next = rest.length
      ? rest
      : [{ id: "default", name: "Default list", customers: builtInCustomers, entries: {} }];
    setBooks(next);
    if (id === activeId) selectBook(next[0]!.id);
  }

  function renameBook(id: string) {
    const b = books.find((x) => x.id === id);
    const n = b && prompt("List ka naya naam", b.name);
    if (n && n.trim()) setBooks((bs) => bs.map((x) => (x.id === id ? { ...x, name: n.trim() } : x)));
  }

  const report = useMemo(
    () => buildReport(customers, entries, compareAbs),
    [customers, entries, compareAbs],
  );

  const cities = useMemo(() => {
    const set = new Set(customers.map((c) => parseCity(c.name)));
    return ["ALL", ...Array.from(set).sort()];
  }, [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const rows = report.filter((r) => {
      if (city !== "ALL" && r.city !== city) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !r.name.toUpperCase().includes(q)) return false;
      return true;
    });
    rows.sort((a, b) =>
      sortKey === "name"
        ? a.name.localeCompare(b.name)
        : Math.abs(b.difference) - Math.abs(a.difference),
    );
    return rows;
  }, [report, city, statusFilter, search, sortKey]);

  const totals = useMemo(() => {
    const computer = filtered.reduce((s, r) => s + r.computer, 0);
    const manual = filtered.reduce((s, r) => s + (r.manual ?? 0), 0);
    const diff = filtered.reduce((s, r) => s + (r.manual === null ? 0 : r.difference), 0);
    const counts = { match: 0, "computer-high": 0, "book-high": 0, missing: 0 } as Record<
      Status,
      number
    >;
    filtered.forEach((r) => (counts[r.status] += 1));
    return { computer, manual, diff, counts };
  }, [filtered]);

  // ---- entry suggestions ----
  const suggestions = useMemo(() => {
    const q = nameInput.trim().toUpperCase();
    if (!q) return [];
    const pool = customers.filter((c) => (city === "ALL" ? true : parseCity(c.name) === city));
    const starts: Customer[] = [];
    const contains: Customer[] = [];
    for (const c of pool) {
      const u = c.name.toUpperCase();
      if (u.startsWith(q)) starts.push(c);
      else if (u.includes(q)) contains.push(c);
      if (starts.length > 40) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [nameInput, customers, city]);

  function chooseSuggestion(c: Customer) {
    setNameInput(c.name);
    setShowSuggest(false);
    setAmountInput(entries[keyOf(c.name)] !== undefined ? String(entries[keyOf(c.name)]) : "");
    setTimeout(() => amountRef.current?.focus(), 0);
  }

  function saveEntry() {
    const name = cleanName(nameInput);
    if (!name) return;
    const match =
      customers.find((c) => keyOf(c.name) === keyOf(name)) ??
      (suggestions.length === 1 ? suggestions[0] : undefined);
    if (!match) {
      setFlash(`"${name}" list mein nahi mila`);
      return;
    }
    if (amountInput.trim() === "") {
      amountRef.current?.focus();
      return;
    }
    const value = toNumber(amountInput);
    setEntries((prev) => ({ ...prev, [keyOf(match.name)]: value }));
    setFlash(
      editingKey ? `Updated: ${match.name} = ${fmt(value)}` : `Saved: ${match.name} = ${fmt(value)}`,
    );
    setNameInput("");
    setAmountInput("");
    setEditingKey(null);
    setShowSuggest(false);
    nameRef.current?.focus();
  }

  function editEntry(name: string) {
    const k = keyOf(name);
    if (entries[k] === undefined) return;
    setEditingKey(k);
    setNameInput(name);
    setAmountInput(String(entries[k]));
    setShowSuggest(false);
    setTimeout(() => amountRef.current?.focus(), 0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingKey(null);
    setNameInput("");
    setAmountInput("");
    nameRef.current?.focus();
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  function removeEntry(name: string) {
    setEntries((prev) => {
      const next = { ...prev };
      delete next[keyOf(name)];
      return next;
    });
  }

  async function handleFile(file: File) {
    setBusy("file");
    try {
      const text = await file.text();
      const list = normaliseCustomers(parseLooseJson(text));
      if (!list.length) throw new Error("empty");
      applyCustomers(list);
      setFlash(`${list.length} customers load ho gaye (${file.name})`);
    } catch {
      setFlash("JSON file read nahi hui — format check karein");
    } finally {
      setBusy(null);
    }
  }

  async function loadFromUrl() {
    if (!ghUrl.trim()) return;
    setBusy("url");
    try {
      const res = await fetch(toRawGithubUrl(ghUrl));
      const text = await res.text();
      const list = normaliseCustomers(parseLooseJson(text));
      if (!list.length) throw new Error("empty");
      applyCustomers(list);
      setFlash(`${list.length} customers GitHub se load ho gaye`);
    } catch {
      setFlash("URL se load nahi hua — raw JSON link use karein");
    } finally {
      setBusy(null);
    }
  }

  const entryCount = Object.keys(entries).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
              RDX
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wide">RDX ACCOUNT ZONE</h1>
              <p className="text-xs text-muted-foreground">
                Computer balance vs manual book — comparison &amp; difference report
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => exportExcel(filtered)}
              className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
            >
              <FileSpreadsheet className="size-4" /> Excel
            </button>
            <button
              onClick={() => exportPdf(filtered, totals)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <FileText className="size-4" /> PDF
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-6">
        {/* Data source */}
        <section className="grid gap-4 rounded-xl border border-border bg-card/70 p-5 lg:grid-cols-[1fr_1fr_auto]">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-background/40 px-4 py-3 text-sm transition-colors hover:border-primary">
            <Upload className="size-5 text-primary" />
            <span>
              <span className="font-medium">JSON file upload karein</span>
              <span className="block text-xs text-muted-foreground">
                {busy === "file" ? "Loading…" : `Abhi ${customers.length} customers loaded hain`}
              </span>
            </span>
            <input
              type="file"
              accept=".json,application/json,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </label>

          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-input bg-background/40 px-3">
              <Github className="size-4 text-muted-foreground" />
              <input
                value={ghUrl}
                onChange={(e) => setGhUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void loadFromUrl()}
                placeholder="GitHub raw JSON URL paste karein"
                className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              onClick={() => void loadFromUrl()}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              <CloudDownload className="size-4" />
              {busy === "url" ? "…" : "Load"}
            </button>
          </div>

          <button
            onClick={() => {
              applyCustomers(builtInCustomers);
              setFlash("Default customer list restore ho gayi");
            }}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-4" /> Default list
          </button>
        </section>

        {/* Manual entry */}
        <section className="rounded-xl border border-border bg-card/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-widest text-primary">MANUAL ENTRY</h2>
            <span className="text-xs text-muted-foreground">
              {entryCount} / {customers.length} entries ho chuki hain
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
            <div className="relative">
              <input
                ref={nameRef}
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  setShowSuggest(true);
                  setHighlight(0);
                }}
                onFocus={() => setShowSuggest(true)}
                onKeyDown={(e) => {
                  if (!showSuggest || !suggestions.length) {
                    if (e.key === "Enter") amountRef.current?.focus();
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => (h + 1) % suggestions.length);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    chooseSuggestion(suggestions[highlight] ?? suggestions[0]!);
                  } else if (e.key === "Escape") {
                    setShowSuggest(false);
                  }
                }}
                placeholder="Customer ka naam type karein…"
                className="w-full rounded-lg border border-input bg-background/50 px-4 py-3 text-sm outline-none focus:border-primary"
              />
              {showSuggest && suggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
                  {suggestions.map((s, i) => {
                    const done = entries[keyOf(s.name)] !== undefined;
                    return (
                      <li key={s.name}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => chooseSuggestion(s)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                            i === highlight ? "bg-secondary" : "hover:bg-secondary/60"
                          }`}
                        >
                          <span className="truncate">
                            {s.name}
                            {done && <CheckCircle2 className="ml-2 inline size-3.5 text-success" />}
                          </span>
                          <span className="num shrink-0 text-xs text-muted-foreground">
                            {fmt(compareAbs ? Math.abs(s.amount) : s.amount)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <input
              ref={amountRef}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveEntry()}
              inputMode="decimal"
              placeholder="Manual amount"
              className="num w-full rounded-lg border border-input bg-background/50 px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={saveEntry}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <Save className="size-4" /> {editingKey ? "Update" : "Save"}
              </button>
              {editingKey && (
                <button
                  onClick={cancelEdit}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          {editingKey && (
            <p className="mt-3 text-xs text-warning">
              Edit mode: entry update ho rahi hai — Enter dabayen ya Update click karein
            </p>
          )}
          {flash && <p className="mt-3 text-xs text-accent">{flash}</p>}

          {/* Saved entries list */}
          {entryCount > 0 && (
            <div className="mt-5 border-t border-border/60 pt-4">
              <h3 className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground">
                AAPKI ENTRIES ({entryCount})
              </h3>
              <ul className="grid max-h-56 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(entries)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => (
                    <li
                      key={k}
                      className="flex items-center justify-between gap-2 rounded-md bg-background/50 px-3 py-1.5 text-xs"
                    >
                      <span className="truncate" title={k}>
                        {k}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="num font-medium text-foreground">{fmt(v)}</span>
                        <button
                          onClick={() => editEntry(k)}
                          title="Edit entry"
                          className="text-muted-foreground hover:text-primary"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => removeEntry(k)}
                          title="Delete entry"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>

        {/* Summary */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Computer Total" value={fmt(totals.computer)} tone="text-foreground" />
          <Stat label="Manual Book Total" value={fmt(totals.manual)} tone="text-foreground" />
          <Stat
            label="Net Difference"
            value={fmt(totals.diff)}
            tone={Math.abs(totals.diff) < 0.005 ? "text-success" : "text-primary"}
          />
          <Stat
            label="Entry Baqi"
            value={`${totals.counts.missing}`}
            tone="text-muted-foreground"
          />
        </section>

        {/* Filters */}
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/70 p-4">
          <div className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-input bg-background/40 px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Report mein naam search karein"
              className="w-full bg-transparent py-2.5 text-sm outline-none"
            />
          </div>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-lg border border-input bg-background/40 px-3 py-2.5 text-sm outline-none"
          >
            {cities.map((c) => (
              <option key={c} value={c}>
                {c === "ALL" ? "Sab cities" : c}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-input bg-background/40 px-3 py-2.5 text-sm outline-none"
          >
            <option value="all">Sab status</option>
            <option value="computer-high">{statusLabel["computer-high"]}</option>
            <option value="book-high">{statusLabel["book-high"]}</option>
            <option value="match">{statusLabel.match}</option>
            <option value="missing">{statusLabel.missing}</option>
          </select>
          <button
            onClick={() => setSortKey((s) => (s === "name" ? "diff" : "name"))}
            className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2.5 text-sm"
          >
            <ArrowDownUp className="size-4" />
            {sortKey === "name" ? "A → Z" : "Bara farq pehle"}
          </button>
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={compareAbs}
              onChange={(e) => setCompareAbs(e.target.checked)}
              className="size-4 accent-[var(--color-primary)]"
            />
            Minus sign ignore
          </label>
          <button
            onClick={() => {
              if (confirm("Sari manual entries delete karein?")) setEntries({});
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2.5 text-sm text-destructive"
          >
            <Trash2 className="size-4" /> Clear entries
          </button>
        </section>

        {/* Report */}
        <section className="overflow-hidden rounded-xl border border-border bg-card/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 text-xs text-muted-foreground">
            <span>{filtered.length} accounts</span>
            <span className="flex flex-wrap gap-4">
              <span className="text-warning">
                {statusLabel["computer-high"]}: {totals.counts["computer-high"]}
              </span>
              <span className="text-accent">
                {statusLabel["book-high"]}: {totals.counts["book-high"]}
              </span>
              <span className="text-success">
                {statusLabel.match}: {totals.counts.match}
              </span>
              <span>
                {statusLabel.missing}: {totals.counts.missing}
              </span>
            </span>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary text-xs uppercase tracking-wider text-secondary-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">City</th>
                  <th className="px-4 py-3 text-right">Computer</th>
                  <th className="px-4 py-3 text-right">Manual</th>
                  <th className="px-4 py-3 text-right">Difference</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <Row
                    key={r.name}
                    row={r}
                    onEdit={() => editEntry(r.name)}
                    onRemove={() => removeEntry(r.name)}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      Koi record nahi mila.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="flex items-center justify-center gap-2 pb-8 text-xs text-muted-foreground">
          <Download className="size-3.5" /> Data aap ke browser mein hi mehfooz rehta hai — RDX
          ACCOUNT ZONE
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function Row({
  row,
  onEdit,
  onRemove,
}: {
  row: ReportRow;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-secondary/30">
      <td className="max-w-[26rem] truncate px-4 py-2.5">{row.name}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.city}</td>
      <td className="num px-4 py-2.5 text-right">{fmt(row.computer)}</td>
      <td className="num px-4 py-2.5 text-right">{fmt(row.manual)}</td>
      <td
        className={`num px-4 py-2.5 text-right font-medium ${
          row.manual === null
            ? "text-muted-foreground"
            : Math.abs(row.difference) < 0.005
              ? "text-success"
              : "text-primary"
        }`}
      >
        {row.manual === null ? "—" : fmt(row.difference)}
      </td>
      <td className={`px-4 py-2.5 text-xs font-semibold ${statusTone[row.status]}`}>
        {statusLabel[row.status]}
      </td>
      <td className="px-2 py-2.5 text-right">
        {row.manual !== null && (
          <span className="inline-flex items-center gap-2">
            <button
              onClick={onEdit}
              title="Entry edit"
              className="text-muted-foreground hover:text-primary"
            >
              <Pencil className="size-4" />
            </button>
            <button
              onClick={onRemove}
              title="Entry delete"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}
