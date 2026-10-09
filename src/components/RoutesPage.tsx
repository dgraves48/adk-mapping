import type { Peak } from "../lib/data";
import type { Route } from "../lib/db";
import { fmtDate } from "../lib/dates";
import DataTable, { type Column, type Filters } from "./DataTable";

interface Props {
  routes: Route[];
  peaks: Peak[];
  filters: Filters;
  onFilters(f: Filters): void;
  onOpen(route: Route): void;
  onNew(): void;
  onDelete(route: Route): void;
}

export default function RoutesPage(p: Props) {
  const peakName = new Map(p.peaks.map((x) => [x.id, x.name]));
  const names = (r: Route) => r.peaks.map((x) => peakName.get(x.peakId) ?? x.peakId);

  const columns: Column<Route>[] = [
    { key: "name", label: "Name", type: "text", value: (r) => r.name, render: (r) => <strong>{r.name || "Untitled"}</strong> },
    {
      key: "peaks",
      label: "Peaks",
      type: "list",
      options: p.peaks.map((x) => x.name),
      value: names,
      render: (r) => <span className="wrap">{names(r).join(", ")}</span>,
    },
    {
      key: "campsites",
      label: "Campsites",
      type: "text",
      value: (r) => r.campsites.map((c) => c.name).join(", "),
      render: (r) => <span className="wrap">{r.campsites.map((c) => c.name).join(", ")}</span>,
    },
    { key: "nights", label: "Nights", type: "number", value: (r) => r.nights },
    { key: "miles", label: "Miles", type: "number", value: (r) => r.miles, render: (r) => r.miles.toFixed(1) },
    { key: "gain", label: "Gain (ft)", type: "number", value: (r) => r.gainFt, render: (r) => Math.round(r.gainFt).toLocaleString() },
    {
      key: "completed",
      label: "Completed",
      type: "bool",
      value: (r) => r.completed,
      align: "center",
      render: (r) => (r.completed ? <span className="yes">Y</span> : <span className="no">N</span>),
    },
    {
      key: "date",
      label: "Dates",
      type: "date",
      // planned and completed trips alike; the Completed column tells them apart
      value: (r) => r.startDate,
      render: (r) =>
        r.startDate
          ? r.endDate && r.endDate !== r.startDate
            ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}`
            : fmtDate(r.startDate)
          : null,
    },
    {
      key: "actions",
      label: "",
      type: "text",
      plain: true,
      value: () => "",
      render: (r) => (
        <button
          className="link danger"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete route “${r.name || "Untitled"}”? Ascents logged from it are removed too.`)) p.onDelete(r);
          }}
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-main">
        <div className="toolbar">
          <h2>Routes</h2>
          <button className="primary" onClick={p.onNew}>
            + New route
          </button>
        </div>
        <DataTable
          rows={p.routes}
          columns={columns}
          rowKey={(r) => r.id}
          filters={p.filters}
          onFilters={p.onFilters}
          initialSort={{ key: "name", dir: 1 }}
          onRowClick={p.onOpen}
          empty={<>No routes yet. Click “New route”, then click on the map to place points.</>}
        />
      </div>
    </div>
  );
}
