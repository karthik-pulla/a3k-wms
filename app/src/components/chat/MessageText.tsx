import { Fragment, type ReactNode } from "react";
import { productById } from "../../data/catalog";
import { canSeeClient, visibleLines } from "../../auth/permissions";
import { productSnapshot } from "../../chat/refs";
import { useStore, shipmentTitle } from "../../store/store";
import { useSession } from "../../session";
import { useOverlay } from "../../chat/overlay";
import { useChatBackend } from "../../chat/backend";
import { go } from "../../router";
import type { Message, MessageRef } from "../../store/types";

/** Message text with its references drawn as chips. Chips show live state, plus "when sent" if it has changed. */
export function MessageText({ message, highlight }: { message: Message; highlight?: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  const refs = [...message.refs].sort((a, b) => a.start - b.start);
  refs.forEach((r, i) => {
    if (r.start < at) return;
    if (r.start > at) out.push(<Plain key={`t${i}`} text={message.text.slice(at, r.start)} highlight={highlight} />);
    out.push(<RefChip key={`r${i}`} r={r} label={message.text.slice(r.start, r.end)} />);
    at = r.end;
  });
  if (at < message.text.length) out.push(<Plain key="end" text={message.text.slice(at)} highlight={highlight} />);
  return <>{out}</>;
}

/** What people typed: never machine-translated */
function Plain({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight) return <span translate="no">{text}</span>;
  const parts = text.split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <span translate="no">{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</span>;
}

const sameLines = (a: { productId: string; cases: number }[], b: { productId: string; cases: number }[]) =>
  JSON.stringify(a.map(l => [l.productId, l.cases]).sort()) === JSON.stringify(b.map(l => [l.productId, l.cases]).sort());

export function RefChip({ r, label }: { r: MessageRef; label: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const overlay = useOverlay();
  const backend = useChatBackend();

  if (r.type === "slot") {
    const lines = state.stock[r.code] ?? [];
    const { shown, hidden } = visibleLines(me, lines);
    const now = shown.length ? shown.map(l => `${productById(l.productId)?.name} × ${l.cases}`).join(", ") : hidden ? "another client's stock" : "empty";
    const changed = !sameLines(r.snapshot.lines, lines);
    const was = r.snapshot.lines.filter(l => { const p = productById(l.productId); return p && canSeeClient(me, p.client); })
      .map(l => `${productById(l.productId)?.name} × ${l.cases}`).join(", ") || "empty";
    return (
      <button type="button" className={`rchip slot${changed ? " changed" : ""}`} title={`${r.code}: ${now}${changed ? ` · when sent: ${was}` : ""}`}
        onClick={() => overlay({ kind: "slots", codes: [r.code], snapshots: { [r.code]: r.snapshot.lines } })}>
        <span aria-hidden="true">📍</span>{r.code}{changed && <span className="rchip-dot" aria-label="changed since sent" />}
      </button>
    );
  }
  if (r.type === "product") {
    const p = productById(r.productId);
    if (!p || !canSeeClient(me, p.client)) return <span className="rchip hidden" title="Another client's product">📦 hidden product</span>;
    const live = productSnapshot(state, p.id);
    const changed = live.cases !== r.snapshot.cases || live.locations !== r.snapshot.locations;
    return (
      <button type="button" className={`rchip product${changed ? " changed" : ""}`}
        title={`${p.name} ${p.size} (${p.code}, ${p.client}): ${live.cases} cases in ${live.locations} locations${changed ? ` · when sent: ${r.snapshot.cases} cases in ${r.snapshot.locations}` : ""}`}
        onClick={() => overlay({ kind: "product", productId: p.id, snapshot: r.snapshot })}>
        <span aria-hidden="true">📦</span>{label.replace(/^#/, "")}<small>{live.cases} cs · {live.locations} loc</small>
      </button>
    );
  }
  if (r.type === "user") {
    const u = state.chat.users.find(x => x.id === r.userId);
    return <span className={`rchip person${r.userId === me.id ? " me" : ""}`}>@{u?.name ?? label.replace(/^@/, "")}</span>;
  }
  if (r.type === "group") return <span className={`rchip person${me.groups.includes(r.group) ? " me" : ""}`}>{label}</span>;
  if (r.type === "order") {
    const o = state.orders.find(x => x.id === r.orderId);
    if (o && !canSeeClient(me, o.client)) return <span className="rchip hidden">🧾 hidden order</span>;
    return (
      <button type="button" className="rchip order" title={`${r.orderId}${o ? ` · ${o.store}` : ` · when sent: ${r.snapshot.store}`}`}
        onClick={() => go(`#/messages/${backend.ensureThread({ type: "order", id: r.orderId })}`)}>
        <span aria-hidden="true">🧾</span>{r.orderId}{o && <small>{o.store}</small>}
      </button>
    );
  }
  if (r.type === "shipment") {
    const s = state.shipments.find(x => x.id === r.shipmentId);
    if (s && !canSeeClient(me, s.client)) return <span className="rchip hidden">🚚 hidden delivery</span>;
    const status = s?.status ?? "removed";
    const changed = status !== r.snapshot.status;
    const href = s ? `#/inbounds/${s.status === "incoming" ? "incoming" : "pending"}/${s.id}` : undefined;
    return (
      <a className={`rchip shipment${changed ? " changed" : ""}`} href={href} title={`${s ? shipmentTitle(s) : r.snapshot.title}: ${status}${changed ? ` · when sent: ${r.snapshot.status}` : ""}`}>
        <span aria-hidden="true">🚚</span>{s ? `${s.client} ${s.number}` : r.snapshot.title}<small>{status}</small>
      </a>
    );
  }
  const s = state.shipments.find(x => x.ref === r.ref && canSeeClient(me, x.client));
  return s
    ? <a className="rchip container" href={`#/inbounds/${s.status === "incoming" ? "incoming" : "pending"}/${s.id}`} title={`Container ${r.ref} · ${shipmentTitle(s)}`}>{label}</a>
    : <span className="rchip container">{label}</span>;
}
