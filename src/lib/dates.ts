/** Dates are stored as ISO yyyy-mm-dd and shown as mm/dd/yyyy. */

export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Calendar winter for Winter 46 purposes: Dec 21 – Mar 20 inclusive. */
export function isWinter(iso: string): boolean {
  const md = iso.slice(5);
  return md >= "12-21" || md <= "03-20";
}
