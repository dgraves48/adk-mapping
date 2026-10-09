import { useMemo, useState } from "react";
import type { Peak } from "../lib/data";
import { newId, type Ascent, type Route } from "../lib/db";
import { fmtDate, isWinter, todayIso } from "../lib/dates";
import DataTable, { type Column, type Filters } from "./DataTable";

interface Props {
  peaks: Peak[];
  ascents: Ascent[];
  routes: Route[];
  onSaveAscent(a: Ascent): void;
  onDeleteAscent(id: string): void;
  onShowRoutes(peakId: string): void;
}

interface Row {
  peak: Peak;
  ascents: Ascent[];
  first?: string;
  winterFirst?: string;
  winterCount: number;
  routeCount: number;
}

export default function PeaksPage(p: Props) {
  const [filters, setFilters] = useState<Filters>({});
  const [selected, setSelected] = useState<string | null>(null);

  const rows: Row[] = useMemo(
    () =>
      p.peaks.map((peak) => {
        const asc = p.ascents.filter((a) => a.peakId === peak.id).sort((a, b) => a.date.localeCompare(b.date));
        const winter = asc.filter((a) => isWinter(a.date));
        return {
          peak,
          ascents: asc,
          first: asc[0]?.date,
          winterFirst: winter[0]?.date,
          winterCount: winter.length,
          routeCount: p.routes.filter((r) => r.peaks.some((rp) => rp.peakId === peak.id)).length,
        };
      }),
    [p.peaks, p.ascents, p.routes],
  );

  const columns: Column<Row>[] = [
    { key: "name", label: "Peak", type: "text", value: (r) => r.peak.name, render: (r) => <span className="peak-name">{r.peak.name}</span> },
    { key: "elev", label: "Elevation (ft)", type: "number", value: (r) => r.peak.elevationFt },
    { key: "official", label: "Official 46", type: "bool", value: (r) => r.peak.official, align: "center" },
    {
      key: "done",
      label: "Completed",
      type: "bool",
      value: (r) => r.ascents.length > 0,
      align: "center",
      render: (r) => (r.ascents.length ? <span className="yes">Y</span> : <span className="no">N</span>),
    },
    {
      key: "date",
      label: "Completed Date",
      type: "date",
      value: (r) => r.first,
      render: (r) =>
        r.first ? (
          <>
            {fmtDate(r.first)}
            {r.ascents.length > 1 && <span className="count"> (×{r.ascents.length})</span>}
          </>
        ) : null,
    },
    {
      key: "winter",
      label: "Winter",
      type: "date",
      value: (r) => r.winterFirst,
      render: (r) =>
        r.winterFirst ? (
          <>
            {fmtDate(r.winterFirst)}
            {r.winterCount > 1 && <span className="count"> (×{r.winterCount})</span>}
          </>
        ) : null,
    },
    {
      key: "route",
      label: "Route",
      type: "bool",
      value: (r) => r.routeCount > 0,
      align: "center",
      render: (r) => (r.routeCount ? <span className="yes">Y</span> : <span className="no">N</span>),
    },
    {
      key: "routes",
      label: "Routes",
      type: "number",
      value: (r) => r.routeCount,
      align: "center",
      render: (r) => (
        <button
          className="link"
          onClick={(e) => {
            e.stopPropagation();
            p.onShowRoutes(r.peak.id);
          }}
        >
          {r.routeCount ? `${r.routeCount} route${r.routeCount > 1 ? "s" : ""}` : "Routes"} →
        </button>
      ),
    },
  ];

  const official = rows.filter((r) => r.peak.official);
  const done46 = official.filter((r) => r.ascents.length).length;
  const winter46 = official.filter((r) => r.winterFirst).length;
  const extras = rows.filter((r) => !r.peak.official);
  const doneExtras = extras.filter((r) => r.ascents.length).length;
  const sel = rows.find((r) => r.peak.id === selected) ?? null;

  return (
    <div className="page peaks-page">
      <div className="page-main">
        <div className="progress-row">
          <Progress label="46 High Peaks" n={done46} of={46} />
          <Progress label="Winter 46" n={winter46} of={46} />
          <Progress label="Other 4000-footers" n={doneExtras} of={extras.length} />
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.peak.id}
          filters={filters}
          onFilters={setFilters}
          initialSort={{ key: "elev", dir: -1 }}
          onRowClick={(r) => setSelected(r.peak.id === selected ? null : r.peak.id)}
          selectedKey={selected}
        />
      </div>
      {sel && <AscentPanel {...p} row={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Progress({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <div className="progress">
      <div className="progress-label">
        <span>{label}</span>
        <strong>
          {n} / {of}
        </strong>
      </div>
      <div className="bar">
        <div style={{ width: `${(n / Math.max(of, 1)) * 100}%` }} />
      </div>
    </div>
  );
}

function AscentPanel({ row, routes, onSaveAscent, onDeleteAscent, onClose }: Props & { row: Row; onClose(): void }) {
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const routeName = (id?: string | null) => routes.find((r) => r.id === id)?.name;

  return (
    <aside className="side-panel">
      <div className="panel-head">
        <h2>{row.peak.name}</h2>
        <button className="icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="muted">
        {row.peak.elevationFt.toLocaleString()} ft · {row.peak.official ? "Official 46" : "Not on the official list"}
      </p>

      <h3>Ascents ({row.ascents.length})</h3>
      {!row.ascents.length && <p className="muted">No ascents logged yet.</p>}
      <ul className="ascents">
        {row.ascents.map((a) => (
          <li key={a.id}>
            <div className="ascent-head">
              <strong>{fmtDate(a.date)}</strong>
              {isWinter(a.date) && <span className="badge winter">Winter</span>}
              {a.routeId && <span className="badge">{routeName(a.routeId) ?? "route"}</span>}
              <button className="link danger" onClick={() => onDeleteAscent(a.id)}>
                Delete
              </button>
            </div>
            <textarea
              placeholder="Notes (weather, companions…)"
              defaultValue={a.notes}
              onBlur={(e) => e.target.value !== a.notes && onSaveAscent({ ...a, notes: e.target.value })}
            />
          </li>
        ))}
      </ul>

      <h3>Log an ascent</h3>
      <div className="form-grid">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="wide">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <button
        className="primary"
        disabled={!date}
        onClick={() => {
          onSaveAscent({ id: newId(), peakId: row.peak.id, date, notes, routeId: null });
          setNotes("");
        }}
      >
        Add ascent
      </button>
    </aside>
  );
}
