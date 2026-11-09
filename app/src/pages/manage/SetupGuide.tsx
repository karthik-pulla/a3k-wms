import { useState } from "react";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import { useAction, useApiData } from "../warehouse/useApi";

/** What setup.status answers (server/src/core/setup.ts) */
interface Status {
  products: number; stockLocations: number; people: number; invited: number; racks: number; clients: number;
  closedCounts: number; shippedOrders: number;
  setup: { mode: "setup" | "live"; ticks?: Record<string, { at: string; by: string }>; liveAt?: string; liveBy?: string };
}
interface Step { id: string; title: string; how: string; done: boolean; tick?: "survey" | "labels" | "training"; links: [string, string][] }

/**
 * Manage warehouse → Get started (owners and our onboarding team, while the warehouse is in setup mode): every step
 * from the site visit to go-live, each ticked by the data itself where it can be (racks saved, products loaded, people
 * invited, the count approved), or by hand where only a person knows (the map matches the floor, labels line up).
 */
export function SetupGuide() {
  const status = useApiData<Status>("setup.status");
  const act = useAction();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [clearActivity, setClearActivity] = useState(true);
  const s = status.data;
  if (status.error) return <section className="panel glass"><p className="warn">{status.error}</p></section>;
  if (!s) return <section className="panel glass"><p className="muted">Loading…</p></section>;
  if (s.setup.mode === "live") return (
    <section className="panel glass"><h2 className="plain-h">This warehouse is live</h2>
      <p className="muted">{s.setup.liveAt ? `Since ${new Date(s.setup.liveAt).toLocaleDateString()}${s.setup.liveBy ? `, by ${s.setup.liveBy}` : ""}.` : ""} Practice data can no longer be cleared, and changes to the racks need a reason.</p></section>
  );
  const ticked = (id: string) => !!s.setup.ticks?.[id];
  const steps: Step[] = [
    { id: "survey", title: "Walk the floor", how: "Every rack, side, column and floor area checked on site; the owner agrees the map matches the floor.", done: ticked("survey"), tick: "survey", links: [["#/manage/racks", "Racks and map"]] },
    { id: "racks", title: "Enter the racks", how: "Column types, racks, odd columns, junctions and floor areas, with the map redrawn as you go.", done: s.racks > 0, links: [["#/manage/racks", "Layout editor"]] },
    { id: "clients", title: "Clients and their labels", how: "The brands stored here, with their logos and label footers (from the settings our team prepares).", done: s.clients > 0, links: [["#/manage/clients", "Clients"], ["#/manage/setup", "Settings files"]] },
    { id: "products", title: "Load the products", how: "From their lists, through the .xlsx template: every problem is shown before anything is saved.", done: s.products > 0, links: [["#/manage/setup", "Products template"]] },
    { id: "people", title: "Invite the team", how: "Owners, coordinators and workers, each with their own sign-in and phone code.", done: s.people > 1 || s.invited > 0, links: [["#/manage/people", "People"]] },
    { id: "labels", title: "Print a test label sheet", how: "Print the alignment test on their label sheets until it lines up.", done: ticked("labels"), tick: "labels", links: [["#/outbounds/labels", "Labels"]] },
    { id: "training", title: "Practise", how: "Receive a delivery, put it away, pick an order, move a pallet. Practice data can be cleared below and starts nothing real.", done: ticked("training"), tick: "training", links: [["#/inbounds", "In-bounds"], ["#/outbounds", "Out-bounds"]] },
    { id: "count", title: "Opening stock and the go-live count", how: "Load their current stock list (optional), then count everything in Count mode; the owner approves the differences.", done: s.stockLocations > 0 && s.closedCounts > 0, links: [["#/manage/setup", "Opening stock"], ["#/inventory/count", "Count"]] },
  ];
  const done = steps.filter(x => x.done).length;
  const canGoLive = s.racks > 0 && s.products > 0;

  const tick = async (step: string, on: boolean) => {
    const r = await act("setup.tick", { step, done: on });
    if (!r.ok) toast(r.error); else void status.reload();
  };
  const clear = async () => {
    if (!window.confirm(t("Clear all practice data? Stock, deliveries, orders, tasks, returns and counts are removed; racks, products, people and messages stay. The stock history keeps a note of what was cleared."))) return;
    setBusy(true);
    const r = await act<{ cleared: number; stockLocations: number }>("setup.clearPractice", {});
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    toast(`Cleared ${r.value.cleared} practice records (stock on ${r.value.stockLocations} locations).`);
    void status.reload();
  };
  const goLive = async () => {
    if (!window.confirm(t(clearActivity
      ? "Go live now? Practice orders, deliveries, tasks and returns are cleared; the stock stays as it is (the go-live count). This can't be undone."
      : "Go live now? Everything stays as it is. This can't be undone."))) return;
    setBusy(true);
    const r = await act("setup.goLive", { clearActivity });
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    toast("The warehouse is live. Reloading…");
    window.setTimeout(() => window.location.reload(), 900);
  };

  return (
    <div className="stack setup-guide">
      <section className="panel glass">
        <h2 className="plain-h">Getting the warehouse ready · {done} of {steps.length}</h2>
        <p className="muted small">Setup mode: practice deliveries, orders and stock are fine and can be cleared. Going live ends setup mode for good.</p>
        <div className="progress" aria-hidden><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        <ol className="guide-steps">
          {steps.map((x, i) => (
            <li key={x.id} className={x.done ? "done" : ""}>
              <span className="guide-mark" aria-label={x.done ? "Done" : "To do"}>{x.done ? "✓" : i + 1}</span>
              <div className="guide-body">
                <b>{x.title}</b>
                <p className="muted small">{x.how}</p>
                <div className="btns">
                  {x.links.map(([href, label]) => <a key={href + label} className="btn small" href={href}>{label}</a>)}
                  {x.tick && <label className="toggle-row small"><input type="checkbox" checked={x.done} onChange={e => void tick(x.tick!, e.target.checked)} /> Done{x.done && s.setup.ticks?.[x.tick] ? ` (${s.setup.ticks[x.tick].by})` : ""}</label>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="panel glass">
        <h2 className="plain-h">Practice data</h2>
        <p className="muted small">Start the practice over: stock, deliveries, orders, tasks, returns and counts go; racks, products, people and messages stay. Do it before loading the real opening stock.</p>
        <div className="btns"><button className="btn" disabled={busy} onClick={() => void clear()}>Clear practice data</button></div>
      </section>
      <section className="panel glass">
        <h2 className="plain-h">Go live</h2>
        <p className="muted small">When the count is approved and the team is ready: from now on everything is real, and the old spreadsheets stop.{!canGoLive ? " Enter the racks and load the products first." : ""}</p>
        <label className="toggle-row"><input type="checkbox" checked={clearActivity} onChange={e => setClearActivity(e.target.checked)} /> Also clear practice orders, deliveries, tasks and returns (the stock stays)</label>
        <div className="btns"><button className="btn primary" disabled={busy || !canGoLive} onClick={() => void goLive()}>Go live</button></div>
      </section>
    </div>
  );
}
