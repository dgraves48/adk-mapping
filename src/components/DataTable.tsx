import { useMemo, useState, type ReactNode } from "react";

export type ColType = "text" | "number" | "bool" | "date" | "list";
type Value = string | number | boolean | null | undefined | string[];

export interface Column<T> {
  key: string;
  label: string;
  type: ColType;
  value(row: T): Value;
  render?(row: T): ReactNode;
  /** choices for a `list` column's filter */
  options?: string[];
  align?: "left" | "right" | "center";
  /** actions column: no sorting or filtering */
  plain?: boolean;
}

export interface Filter {
  text?: string;
  min?: string;
  max?: string;
  bool?: "" | "y" | "n";
}
export type Filters = Record<string, Filter>;

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey(row: T): string;
  filters: Filters;
  onFilters(f: Filters): void;
  initialSort?: { key: string; dir: 1 | -1 };
  onRowClick?(row: T): void;
  selectedKey?: string | null;
  empty?: ReactNode;
}

function passes<T>(col: Column<T>, row: T, f: Filter | undefined): boolean {
  if (!f) return true;
  const v = col.value(row);
  switch (col.type) {
    case "text":
      return !f.text || String(v ?? "").toLowerCase().includes(f.text.toLowerCase());
    case "list":
      return !f.text || ((v as string[]) ?? []).some((s) => s === f.text);
    case "bool":
      return !f.bool || (f.bool === "y") === !!v;
    case "number": {
      const n = v as number | null;
      if (f.min && (n == null || n < Number(f.min))) return false;
      if (f.max && (n == null || n > Number(f.max))) return false;
      return true;
    }
    case "date": {
      const s = v as string | null;
      if (f.min && (!s || s < f.min)) return false;
      if (f.max && (!s || s > f.max)) return false;
      return true;
    }
  }
}

function compare(a: Value, b: Value): number {
  const empty = (v: Value) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1; // blanks last regardless of direction handled by caller
  if (empty(b)) return -1;
  if (Array.isArray(a)) a = a.length;
  if (Array.isArray(b)) b = b.length;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export default function DataTable<T>(p: Props<T>) {
  const [sort, setSort] = useState(p.initialSort ?? { key: p.columns[0].key, dir: 1 as 1 | -1 });

  const shown = useMemo(() => {
    const col = p.columns.find((c) => c.key === sort.key)!;
    const rows = p.rows.filter((r) => p.columns.every((c) => passes(c, r, p.filters[c.key])));
    return rows.sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      const c = compare(va, vb);
      const blank = (v: Value) => v == null || v === "" || (Array.isArray(v) && !v.length);
      if (blank(va) !== blank(vb)) return c; // keep blanks at the bottom
      return c * sort.dir;
    });
  }, [p.rows, p.columns, p.filters, sort]);

  const setF = (key: string, patch: Filter) => p.onFilters({ ...p.filters, [key]: { ...p.filters[key], ...patch } });
  const active = Object.values(p.filters).some((f) => f && Object.values(f).some(Boolean));

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {p.columns.map((c) => (
              <th
                key={c.key}
                className={`${c.align ?? (c.type === "number" ? "right" : "left")} ${c.plain ? "" : "sortable"}`}
                onClick={() => !c.plain && setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : 1 }))}
              >
                {c.label}
                <span className="sort">{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
              </th>
            ))}
          </tr>
          <tr className="filters">
            {p.columns.map((c) => {
              const f = p.filters[c.key] ?? {};
              if (c.plain) return <th key={c.key} />;
              switch (c.type) {
                case "text":
                  return (
                    <th key={c.key}>
                      <input placeholder="Filter…" value={f.text ?? ""} onChange={(e) => setF(c.key, { text: e.target.value })} />
                    </th>
                  );
                case "list":
                  return (
                    <th key={c.key}>
                      <select value={f.text ?? ""} onChange={(e) => setF(c.key, { text: e.target.value })}>
                        <option value="">All</option>
                        {(c.options ?? []).map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </th>
                  );
                case "bool":
                  return (
                    <th key={c.key}>
                      <select value={f.bool ?? ""} onChange={(e) => setF(c.key, { bool: e.target.value as Filter["bool"] })}>
                        <option value="">All</option>
                        <option value="y">Yes</option>
                        <option value="n">No</option>
                      </select>
                    </th>
                  );
                case "number":
                  return (
                    <th key={c.key} className="range">
                      <input type="number" placeholder="min" value={f.min ?? ""} onChange={(e) => setF(c.key, { min: e.target.value })} />
                      <input type="number" placeholder="max" value={f.max ?? ""} onChange={(e) => setF(c.key, { max: e.target.value })} />
                    </th>
                  );
                case "date":
                  return (
                    <th key={c.key} className="range">
                      <input type="date" title="from" value={f.min ?? ""} onChange={(e) => setF(c.key, { min: e.target.value })} />
                      <input type="date" title="to" value={f.max ?? ""} onChange={(e) => setF(c.key, { max: e.target.value })} />
                    </th>
                  );
              }
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr
              key={p.rowKey(r)}
              onClick={() => p.onRowClick?.(r)}
              className={`${p.onRowClick ? "clickable" : ""} ${p.selectedKey === p.rowKey(r) ? "selected" : ""}`}
            >
              {p.columns.map((c) => (
                <td key={c.key} className={c.align ?? (c.type === "number" ? "right" : "left")}>
                  {c.render ? c.render(r) : fmt(c.value(r))}
                </td>
              ))}
            </tr>
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={p.columns.length} className="empty">
                {p.rows.length ? "No rows match the filters." : p.empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="table-foot">
        {shown.length} of {p.rows.length}
        {active && (
          <button className="link" onClick={() => p.onFilters({})}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function fmt(v: Value): ReactNode {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Y" : "N";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return v.toLocaleString();
  return v;
}
