import { useMemo, useState } from "react";
import { productById } from "../../data/catalog";
import { can, canSeeClient } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { BackIcon } from "../../components/icons";
import { differences, scopeTotal } from "../../inventory/count";
import { byLocation, today } from "../../inventory/selectors";
import { buildXlsx, download } from "../../utils/xlsx";
import type { CountSession, StockLine } from "../../store/types";
import { useDeleteCount } from "./useDeleteCount";

type Show = "pending" | "all-diffs" | "matched";

/** Differences between the count and the system. An owner applies corrections (logged as count corrections) or keeps the system stock. */
export function CountReview({ session }: { session: CountSession }) {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const owner = can(me, "approve-count");
  const del = useDeleteCount();
  const { diffs, matched } = useMemo(() => differences(session, state.stock), [session, state.stock]);
  const sorted = useMemo(() => [...diffs].sort((a, b) => byLocation(a.code, b.code)), [diffs]);
  const pending = sorted.filter(d => !session.decided?.[d.code]);
  const [show, setShow] = useState<Show>("pending");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(pending.map(d => d.code)));
  const [note, setNote] = useState("");
  const list = show === "pending" ? pending : show === "all-diffs" ? sorted : [];
  const total = scopeTotal(session.scope);
  const counted = Object.keys(session.entries).length;
  const net = diffs.reduce((a, d) => a + d.changes.reduce((x, c) => x + c.is - c.was, 0), 0);
  // People scoped to some clients see other clients' lines only as "hidden"
  const visible = (id: string) => { const p = productById(id); return !!p && canSeeClient(me, p.client); };
  const name = (id: string) => (visible(id) ? `${productById(id)!.code} ${productById(id)!.name}` : "Another client's product");
  const linesText = (lines: { productId: string; cases: number }[]) => (lines.length ? lines.map(l => `${name(l.productId)} × ${l.cases}`).join(", ") : "empty");

  const decide = (apply: boolean) => {
    const codes = [...picked].filter(c => pending.some(d => d.code === c));
    if (!codes.length) return;
    dispatch({ type: "count/decide", id: session.id, by: me.name, apply: apply ? codes : [], keep: apply ? [] : codes, note: note.trim() });
    setPicked(new Set());
    toast(apply ? `Applied ${codes.length} correction${codes.length > 1 ? "s" : ""}. Each is in the history with the reason.` : `Kept the system stock for ${codes.length} location${codes.length > 1 ? "s" : ""}.`);
  };
  const exportXlsx = () => {
    download(buildXlsx([{
      name: "Differences", header: ["Location", "Code", "Product", "System cases", "Counted cases", "Difference", "Counted by", "Decision"],
      widths: [15, 11, 34, 9, 9, 9, 12, 10],
      rows: sorted.flatMap(d => d.changes.filter(c => visible(c.productId)).map(c => [d.code, productById(c.productId)?.code ?? "", productById(c.productId)?.name ?? "", c.was, c.is, c.is - c.was, d.counted.by, session.decided?.[d.code] ?? "pending"])),
    }, {
      name: "Counted", header: ["Location", "Code", "Product", "Cases", "Counted by", "At"], widths: [15, 11, 34, 8, 12, 18],
      rows: Object.entries(session.entries).sort((a, b) => byLocation(a[0], b[0])).flatMap(([code, e]) => (e.lines.length ? e.lines.filter(l => visible(l.productId)).map(l => [code, productById(l.productId)?.code ?? "", productById(l.productId)?.name ?? "", l.cases, e.by, e.at.slice(0, 16).replace("T", " ")]) : [[code, "", "(empty)", 0, e.by, e.at.slice(0, 16).replace("T", " ")]])),
    }]), `${session.name.replace(/\W+/g, "-").toLowerCase()}-${today()}.xlsx`);
  };

  return (
    <div className="stack">
      <div className="count-head">
        <button className="iconbtn glass" onClick={() => go("#/inventory/count")} aria-label="All counts"><BackIcon /></button>
        <div className="count-title"><h2>{session.name} · review</h2><span className="muted small">{session.status === "closed" ? `Finished ${session.closedAt?.slice(0, 10)} by ${session.closedBy}` : session.status === "review" ? "Counting finished, waiting for an owner" : "Still counting"}</span></div>
        <div className="btns">
          {can(me, "export") && <button className="btn small" onClick={exportXlsx}>Export (.xlsx)</button>}
          {session.status !== "closed" && <button className="btn small" onClick={() => go(`#/inventory/count/${session.id}`)}>{session.status === "open" ? "Back to counting" : "View count"}</button>}
          {owner && session.status === "review" && <button className="btn small" onClick={() => { dispatch({ type: "count/status", id: session.id, status: "open", by: me.name }); go(`#/inventory/count/${session.id}`); }}>Reopen counting</button>}
          {can(me, "delete-count") && <button className="btn small danger" onClick={() => { if (del(session)) go("#/inventory/count"); }}>Delete count</button>}
          {owner && session.status !== "closed" && <button className="btn small" disabled={pending.length > 0} title={pending.length ? "Decide every difference first" : ""} onClick={() => { dispatch({ type: "count/status", id: session.id, status: "closed", by: me.name }); toast(`"${session.name}" is finished.`); }}>Finish count</button>}
        </div>
      </div>

      <div className="stats">
        <div className="stat glass"><span className="stat-n">{counted.toLocaleString()}</span><span className="stat-l">locations counted<small>of {total.toLocaleString()} slots plus floor spots</small></span></div>
        <div className="stat glass"><span className="stat-n ok">{matched.length.toLocaleString()}</span><span className="stat-l">match the system</span></div>
        <div className="stat glass"><span className="stat-n warn">{diffs.length}</span><span className="stat-l">differences<small>{pending.length} still to decide</small></span></div>
        <div className="stat glass"><span className={`stat-n${net < 0 ? " danger" : ""}`}>{net > 0 ? "+" : ""}{net.toLocaleString()}</span><span className="stat-l">cases net<small>counted minus system</small></span></div>
      </div>
      <p className="muted small">Slots nobody counted keep their system stock. {owner ? "Applying a correction changes the stock and logs the change with the reason below." : "An owner approves corrections."}</p>

      <div className="chip-wrap" role="group" aria-label="Show">
        <button className={`chip-btn${show === "pending" ? " on" : ""}`} onClick={() => setShow("pending")}>To decide · {pending.length}</button>
        <button className={`chip-btn${show === "all-diffs" ? " on" : ""}`} onClick={() => setShow("all-diffs")}>All differences · {diffs.length}</button>
        <button className={`chip-btn${show === "matched" ? " on" : ""}`} onClick={() => setShow("matched")}>Matched · {matched.length}</button>
      </div>

      {show === "matched" ? (
        <div className="panel glass"><div className="chip-wrap">{[...matched].sort(byLocation).map(c => <span key={c} className="chip-btn static mono">{c}</span>)}</div>{!matched.length && <p className="muted">None yet.</p>}</div>
      ) : (
        <div className="panel glass">
          {owner && show === "pending" && pending.length > 0 && (
            <div className="review-actions">
              <label className="toggle-row"><input type="checkbox" checked={pending.every(d => picked.has(d.code))} onChange={e => setPicked(e.target.checked ? new Set(pending.map(d => d.code)) : new Set())} /> Select all</label>
              <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Note for the history (optional), e.g. recount confirmed" aria-label="Note" />
              <button className="btn primary" disabled={!picked.size} onClick={() => decide(true)}>Apply {picked.size || ""} correction{picked.size === 1 ? "" : "s"}</button>
              <button className="btn" disabled={!picked.size} onClick={() => decide(false)}>Keep system stock</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="lines">
              <thead><tr>{owner && show === "pending" && <th />}<th>Location</th><th>System</th><th>Counted</th><th>Difference</th><th>By</th><th>Decision</th></tr></thead>
              <tbody>
                {list.map(d => (
                  <tr key={d.code}>
                    {owner && show === "pending" && <td><input type="checkbox" checked={picked.has(d.code)} onChange={() => setPicked(p => { const n = new Set(p); if (n.has(d.code)) n.delete(d.code); else n.add(d.code); return n; })} aria-label={`Select ${d.code}`} /></td>}
                    <td className="mono">{d.code}</td>
                    <td className="small">{linesText(d.expected as StockLine[])}</td>
                    <td className="small">{linesText(d.counted.lines)}</td>
                    <td>{d.changes.map(c => <div key={c.productId} className={c.is - c.was < 0 ? "danger" : "ok"}>{c.is - c.was > 0 ? "+" : ""}{c.is - c.was} <small className="muted">{visible(c.productId) ? productById(c.productId)!.code : "hidden"}</small></div>)}</td>
                    <td className="small">{d.counted.by}</td>
                    <td className="small">{session.decided?.[d.code] === "applied" ? "Corrected" : session.decided?.[d.code] === "kept" ? "Kept system" : "—"}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={7} className="empty-row">{show === "pending" ? "Nothing left to decide." : "No differences."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
