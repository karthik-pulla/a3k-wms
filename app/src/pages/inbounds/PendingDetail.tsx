import { useState } from "react";
import { useStore, shipmentTitle, palletCount } from "../../store/store";
import type { Shipment } from "../../store/types";
import { suggestPutaway, isEmptySlot, type PalletPlan } from "../../store/putaway";
import { describeLocation, faceOf, isFloor, productById } from "../../data/catalog";
import { LinesEditor } from "../../components/LinesEditor";
import { RackView, type SlotMark } from "../../components/RackView";
import { useToast } from "../../components/Toast";
import { go } from "../../router";
import { occupied, isOpen } from "../../store/tasks";

const REASONS = ["Closer to the same product", "Suggested slot is blocked or damaged", "Heavy pallet, keep it low", "Fits the rack's product type better", "Other"];

/** A delivery on the dock. An owner checks it, confirms, and each pallet gets its own empty slot. */
export function PendingDetail({ shipment: s, who, owner }: { shipment: Shipment; who: string; owner: boolean }) {
  const { state, dispatch } = useStore();
  const [plan, setPlan] = useState<PalletPlan[] | null>(null);
  if (s.status === "stored" || s.status === "putaway") return <StoredSummary s={s} />;
  const damaged = s.lines.reduce((a, l) => a + (l.damaged ?? 0), 0);
  const ready = s.lines.length > 0 && s.lines.every(l => l.productId && l.cases > 0);

  if (plan) return <PutawayPlan s={s} plan={plan} setPlan={setPlan} who={who} onBack={() => setPlan(null)} />;
  return (
    <div className="stack">
      <div className="facts glass">
        <div className="fact"><span>Supplier</span><b>{s.supplier}</b></div>
        <div className="fact"><span>Container / BOL</span><b>{s.ref || "—"}</b></div>
        <div className="fact"><span>Arrived</span><b>{s.receivedAt ? new Date(s.receivedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</b></div>
        <div className="fact"><span>Received by</span><b>{s.receivedBy ?? "—"}</b></div>
        <div className="fact"><span>Condition</span><b className={s.condition === "damaged" ? "warn" : "ok"}>{s.condition === "damaged" ? "Some damage" : "All good"}</b></div>
      </div>
      <div className="panel glass">
        <LinesEditor lines={s.lines} client={s.client} editable={owner} showDamaged
          onChange={lines => dispatch({ type: "saveShipment", shipment: { ...s, lines } })} />
        {damaged > 0 && <p className="note warn">{damaged} damaged case{damaged > 1 ? "s" : ""} will be left out of put-away and listed for the supplier's damage report.</p>}
        <div className="panel-foot">
          {owner ? (
            <>
              <span className="muted small">Check the cases, lots and dates, then confirm. Each pallet gets an empty slot near similar stock.</span>
              <button className="btn primary big" disabled={!ready} onClick={() => setPlan(suggestPutaway(occupied(state), s))}>Confirm</button>
            </>
          ) : (
            <span className="muted">Waiting for a coordinator or owner to confirm. Slots are assigned after confirmation.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PutawayPlan({ s, plan, setPlan, who, onBack }: { s: Shipment; plan: PalletPlan[]; setPlan: (p: PalletPlan[]) => void; who: string; onBack: () => void }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [sel, setSel] = useState(plan[0]?.pallet ?? 0);
  const current = plan.find(p => p.pallet === sel);
  const [face, setFace] = useState(current ? faceOf(current.slot) : "");
  // The suggested slots, remembered from when the plan opened, so changed slots can ask for a reason
  const [original] = useState(() => new Map(plan.map(p => [p.pallet, p.slot])));
  const changed = (p: PalletPlan) => original.get(p.pallet) !== p.slot;
  const missingReason = plan.some(p => changed(p) && !p.reason);
  const marks: Record<string, SlotMark> = {};
  for (const p of plan) if (!isFloor(p.slot)) marks[p.slot] = { kind: p.pallet === sel ? "focus" : "suggested", label: `P${p.pallet}` };

  const select = (p: PalletPlan) => { setSel(p.pallet); if (!isFloor(p.slot)) setFace(faceOf(p.slot)); };
  const moveTo = (code: string) => {
    if (!current || !isEmptySlot(occupied(state), code) || plan.some(p => p.slot === code)) return;
    setPlan(plan.map(p => (p.pallet === sel ? { ...p, slot: code, why: "Chosen by hand", reason: original.get(p.pallet) === code ? undefined : p.reason } : p)));
  };

  return (
    <div className="stack">
      <div className="panel glass">
        <div className="plan-head">
          <h2>Put-away plan · {shipmentTitle(s)}</h2>
          <span className="muted small">{palletCount(s)} pallets. Pick a pallet, then click an empty slot to move it.</span>
        </div>
        <div className="plan">
          <ol className="plan-list">
            {plan.map(p => (
              <li key={p.pallet} className={p.pallet === sel ? "sel" : undefined}>
                <button className="plan-row" onClick={() => select(p)} aria-pressed={p.pallet === sel}>
                  <span className="plan-p">P{p.pallet}</span>
                  <span className="plan-what">
                    {p.lines.map(l => `${productById(l.productId)?.name ?? "?"} × ${l.cases}`).join(" + ")}
                    <small>{p.why}</small>
                  </span>
                  <span className="plan-slot mono">{p.slot}</span>
                </button>
                {changed(p) && (
                  <label className="plan-reason">
                    <span>Why a different slot?</span>
                    <select className={`input${p.reason ? "" : " invalid"}`} value={p.reason ?? ""} onChange={e => setPlan(plan.map(x => (x.pallet === p.pallet ? { ...x, reason: e.target.value || undefined } : x)))}>
                      <option value="">Choose a reason</option>
                      {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ol>
          <div className="plan-map">
            <RackView faceId={face} onFace={setFace} stock={state.stock} marks={marks} onPick={moveTo} />
            {current && <p className="muted small">P{current.pallet} → <b>{current.slot}</b> · {describeLocation(current.slot)}</p>}
          </div>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onBack}>Back</button>
          <div className="btns">
            {missingReason && <span className="warn small">Give a reason for each slot you changed.</span>}
            <button className="btn primary big" disabled={missingReason} onClick={() => {
              dispatch({ type: "putaway", id: s.id, by: who, plan });
              toast(`${shipmentTitle(s)}: ${plan.length} put-away tasks for the workers. Stock is added as each pallet is confirmed in its slot.`);
              go(`/inbounds/pending/${s.id}`);
            }}>Confirm and send to workers</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoredSummary({ s }: { s: Shipment }) {
  const { state } = useStore();
  const [face, setFace] = useState(faceOf(s.putaway?.find(p => !isFloor(p.slot))?.slot ?? "06A"));
  const tasks = state.tasks.filter(t => t.shipmentId === s.id && t.status !== "cancelled");
  const taskFor = (pallet: number) => tasks.find(t => t.pallet === pallet);
  const done = tasks.filter(t => t.status === "done").length;
  const marks: Record<string, SlotMark> = {};
  for (const p of s.putaway ?? []) { const t = taskFor(p.pallet); const slot = t?.to ?? p.slot; if (!isFloor(slot)) marks[slot] = { kind: t && isOpen(t) ? "suggested" : "focus", label: `P${p.pallet}` }; }
  const who = (id?: string) => (id ? state.chat.users.find(u => u.id === id)?.name ?? id : "any worker");
  return (
    <div className="stack">
      <div className="panel glass">
        <div className="plan-head">
          <h2>{s.status === "stored" ? "Put away" : `Being put away · ${done} of ${tasks.length} pallets in their slots`}</h2>
          <span className="muted small">Confirmed by {s.confirmedBy} · {s.confirmedAt ? new Date(s.confirmedAt).toLocaleString() : ""}</span>
        </div>
        <div className="plan">
          <ol className="plan-list">
            {(s.putaway ?? []).map(p => {
              const t = taskFor(p.pallet);
              const slot = t?.to ?? p.slot;
              return (
                <li key={p.pallet}>
                  <button className="plan-row" onClick={() => !isFloor(slot) && setFace(faceOf(slot))}>
                    <span className="plan-p">P{p.pallet}</span>
                    <span className="plan-what">{s.lines.filter(l => l.pallet === p.pallet).map(l => `${productById(l.productId ?? "")?.name} × ${l.cases - (l.damaged ?? 0)}`).join(" + ")}
                      {p.reason && <small>Changed: {p.reason}</small>}
                      {t && <small className={t.status === "done" ? "ok" : "warn"}>{t.status === "done" ? `In the slot · confirmed by ${t.doneBy}` : t.status === "doing" ? `On the way · ${who(t.assignee)}` : `Waiting for ${who(t.assignee)}`}{t.blocked?.length ? ` · ${t.blocked.join(", ")} was blocked` : ""}</small>}
                    </span>
                    <span className="plan-slot mono">{slot}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="plan-map"><RackView faceId={face} onFace={setFace} stock={state.stock} marks={marks} /></div>
        </div>
        {s.status === "putaway" && <p className="muted small">Each pallet is added to stock when a worker confirms it's in its slot. <a className="link" href="#/tasks">Tasks ›</a></p>}
      </div>
    </div>
  );
}
