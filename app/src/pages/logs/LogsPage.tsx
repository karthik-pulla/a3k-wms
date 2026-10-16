import { useMemo, useState } from "react";
import { can } from "../../auth/permissions";
import { useIdentity } from "../../auth/identity";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { buildXlsx, download } from "../../utils/xlsx";
import type { AuditEntry } from "../../store/types";

type Area = AuditEntry["area"] | "accounts";
const AREAS: [Area | "all" | "pallets", string][] = [["all", "Everything"], ["pallets", "Pallet moves"], ["stock", "Stock"], ["inbound", "In-bounds"], ["outbound", "Out-bounds"], ["count", "Counts"], ["task", "Tasks"], ["products", "Products"], ["accounts", "Accounts and sign-in"], ["data", "Data"]];
interface Row { id: string; at: string; by: string; area: Area; action: string; pallet?: boolean }
const PAGE = 200;

/**
 * Logs: every change, with the action, who did it and when. Read-only: nothing here can be edited or deleted.
 * Owners see everything (and sign-ins); coordinators see the workers' pallet log (put-away, moves, picks).
 */
export function LogsPage() {
  const { state } = useStore();
  const { me } = useSession();
  const { securityLog } = useIdentity();
  const all = can(me, "view-all-logs");
  const [area, setArea] = useState<Area | "all" | "pallets">(all ? "all" : "pallets");
  const [who, setWho] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const rows: Row[] = useMemo(() => {
    const changes: Row[] = (state.audit ?? []).map(e => ({ ...e }));
    const signins: Row[] = all ? securityLog.map((e, i) => ({ id: `S${i}`, at: e.at, by: e.who ?? "", area: "accounts" as const, action: `${e.kind.replace(/-/g, " ")}${e.detail ? `: ${e.detail}` : ""}` })) : [];
    return [...changes, ...signins].sort((a, b) => b.at.localeCompare(a.at));
  }, [state.audit, securityLog, all]);
  const people = [...new Set(rows.map(r => r.by).filter(Boolean))].sort();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(r =>
    (all || r.pallet) &&
    (area === "all" || (area === "pallets" ? r.pallet : r.area === area)) &&
    (!who || r.by === who) &&
    (!from || r.at.slice(0, 10) >= from) && (!to || r.at.slice(0, 10) <= to) &&
    words.every(w => `${r.action} ${r.by}`.toLowerCase().includes(w)));
  const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

  if (!can(me, "view-logs")) return <main className="section"><div className="panel glass"><p>Logs are for owners and coordinators.</p></div></main>;
  return (
    <main className="section logs">
      <header className="section-head"><h1>Logs</h1><p className="crumb">{all ? "Every change: what was done, by whom, and when" : "The workers' pallet log: put-away, moves and picks"}</p></header>
      <div className="toolbar">
        <input className="input search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search actions, slots, products, orders" aria-label="Search the log" />
        <select className="input log-sel" value={who} onChange={e => setWho(e.target.value)} aria-label="Person"><option value="">Everyone</option>{people.map(p => <option key={p}>{p}</option>)}</select>
        <label className="log-date">From <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="log-date">To <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {all && <div className="chip-wrap">{AREAS.map(([v, t]) => <button key={v} className={`chip-btn${area === v ? " on" : ""}`} onClick={() => setArea(v)}>{t}</button>)}</div>}
      <div className="panel glass">
        <div className="panel-foot">
          <span className="muted small">{shown.length.toLocaleString()} entr{shown.length === 1 ? "y" : "ies"} · nothing in the log can be edited or deleted</span>
          {can(me, "export") && <button className="btn small" disabled={!shown.length} onClick={() => download(buildXlsx([{ name: "Log", header: ["Date and time", "Name", "Action", "Area"], widths: [22, 16, 90, 12], rows: shown.map(r => [stamp(r.at), r.by, r.action, r.area]) }]), `log-${new Date().toISOString().slice(0, 10)}.xlsx`)}>Export (.xlsx)</button>}
        </div>
        <div className="table-wrap">
          <table className="lines log-table">
            <thead><tr><th>Action</th><th>Name</th><th>Date and time</th></tr></thead>
            <tbody>
              {shown.slice(0, limit).map(r => (
                <tr key={r.id}><td className="log-action"><span className={`log-area ${r.area}`}>{AREAS.find(x => x[0] === r.area)?.[1] ?? r.area}</span>{r.action}</td><td>{r.by || "—"}</td><td className="mono">{stamp(r.at)}</td></tr>
              ))}
              {!shown.length && <tr><td colSpan={3} className="empty-row">No changes recorded{q || who || from || to ? " for this search" : " yet"}.</td></tr>}
            </tbody>
          </table>
        </div>
        {shown.length > limit && <button className="btn" onClick={() => setLimit(l => l + PAGE * 2)}>Show more</button>}
      </div>
    </main>
  );
}
