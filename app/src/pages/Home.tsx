import { useMemo } from "react";
import { sampleUpdates, type UpdateGroup } from "../data/sampleUpdates";
import { useStore, shipmentTitle, palletCount, totalCases } from "../store/store";
import { UpdateCard } from "../components/UpdateCard";
import { HomeMessages, HomeMessagesCompact } from "../components/chat/HomeMessages";
import { useSession } from "../session";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { fmtMonth, stockRows } from "../inventory/selectors";
import { can, canSeeClient } from "../auth/permissions";
import { go } from "../router";
import { orderCases, statusOf } from "../outbound/plan";
import { SOURCE_LABEL, STATUS_LABEL, dueText, dueTone, isActive } from "../outbound/labels";
import { useLang } from "../i18n";

/** messagesInRail: on wide screens Messages lives in the right rail, so the card grid leaves it out. */
export function Home({ messagesInRail }: { messagesInRail: boolean }) {
  const { state } = useStore();
  const { me, settings } = useSession();
  const phone = useMediaQuery("(max-width: 760px)");
  const base = useMemo(sampleUpdates, []);
  // In-bound cards come from the live store; the rest stay sample until their screens exist
  const groups: UpdateGroup[] = useMemo(() => {
    const incoming = state.shipments.filter(s => s.status === "incoming").sort((a, b) => a.expected.localeCompare(b.expected));
    const pending = state.shipments.filter(s => s.status === "pending");
    const returns = state.returns.filter(r => r.status === "pending");
    // Expired first, then the earliest best-before within 6 months; only clients this person may see
    const expiring = stockRows(state, me).filter(r => r.line && r.tone !== "ok")
      .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "expired" ? -1 : 1) || (a.line!.bestBefore ?? "").localeCompare(b.line!.bestBefore ?? ""));
    // Out-bounds, only clients this person may see
    const orders = state.orders.filter(o => canSeeClient(me, o.client));
    const todayISO = new Date().toISOString().slice(0, 10);
    const going = orders.filter(o => ["picking", "picked"].includes(statusOf(o)) || (statusOf(o) === "shipped" && o.shippedAt?.startsWith(todayISO)));
    const dueSoon = orders.filter(o => isActive(o) && statusOf(o) !== "draft" && ["overdue", "today", "soon"].includes(dueTone(o))).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
    const toApprove = orders.filter(o => statusOf(o) === "draft");
    const href = (id: string) => `#/outbounds/orders/${encodeURIComponent(id)}`;
    const live: Partial<Record<UpdateGroup["kind"], UpdateGroup>> = {
      outgoing: { kind: "outgoing", mode: "outbounds", title: "Going out today", subtitle: "Picking, picked or shipped today", count: going.length,
        items: going.map(o => ({ id: o.id, what: o.store, detail: `${o.id} · ${o.client} · ${orderCases(o)} cases`, meta: STATUS_LABEL[statusOf(o)].toLowerCase(), href: href(o.id) })) },
      deadlines: { kind: "deadlines", mode: "outbounds", title: "Due soon", subtitle: "Orders due in the next 2 days", count: dueSoon.length, tone: dueSoon.some(o => dueTone(o) === "overdue") ? "danger" : dueSoon.length ? "warn" : undefined,
        items: dueSoon.map(o => ({ id: o.id, what: o.store, detail: `${o.id} · ${orderCases(o)} cases · ${STATUS_LABEL[statusOf(o)].toLowerCase()}`, meta: dueText(o), tone: dueTone(o) === "overdue" ? "danger" as const : dueTone(o) === "today" ? "warn" as const : undefined, href: href(o.id) })) },
      ordersToApprove: { kind: "ordersToApprove", mode: "outbounds", title: "Orders to approve", subtitle: "From PDFs, email and the app", count: toApprove.length,
        items: toApprove.map(o => ({ id: o.id, what: o.store, detail: `${o.id} · ${SOURCE_LABEL[o.source ?? "app"]} · ${o.lines.length} products`, meta: dueText(o), href: href(o.id) })) },
      incoming: { kind: "incoming", mode: "inbounds", title: "Arriving", subtitle: "Expected in-bounds", count: incoming.length,
        items: incoming.map(s => ({ id: s.id, what: shipmentTitle(s), detail: `${s.supplier} · ${palletCount(s)} pallets`, meta: s.expected, href: `#/inbounds/incoming/${s.id}` })) },
      toConfirm: { kind: "toConfirm", mode: "inbounds", title: "Waiting for confirmation", subtitle: "Arrived, waiting for slots", count: pending.length, tone: pending.length ? "warn" : undefined,
        items: pending.map(s => ({ id: s.id, what: shipmentTitle(s), detail: `${palletCount(s)} pallets · ${totalCases(s)} cases`, meta: s.condition === "damaged" ? "damage" : "on dock", tone: s.condition === "damaged" ? "warn" : undefined, href: `#/inbounds/pending/${s.id}` })) },
      expiry: { kind: "expiry", mode: "inventory", title: "Expiry alerts", subtitle: "Expired stock can't be picked", count: expiring.filter(r => r.tone === "expired").length, tone: "danger",
        items: expiring.slice(0, 6).map(r => ({ id: `${r.code}-${r.product!.id}`, what: `${r.product!.name} ${r.product!.size}`, detail: `${r.code} · ${r.line!.cases} cases`,
          meta: `${r.tone === "expired" ? "expired" : "best before"} ${fmtMonth(r.line!.bestBefore)}`, tone: r.tone === "expired" ? "expired" as const : "warn" as const, href: `#/inventory/stock/${encodeURIComponent(r.code)}` })) },
      returns: { kind: "returns", mode: "inbounds", title: "Returns pending", subtitle: "Not in inventory until approved", count: returns.length,
        items: returns.map(r => ({ id: r.id, what: r.store, detail: `${r.orderId} · ${r.items.reduce((a, i) => a + i.cases, 0)} cases · ${r.reason}`, meta: r.id, href: `#/inbounds/returns/${r.id}` })) },
    };
    return base.map(g => live[g.kind] ?? g);
  }, [base, state, me]);
  const byKind = new Map(groups.map(g => [g.kind, g]));
  const shown = settings.cards.filter(c => c.visible && !(c.kind === "messages" && messagesInRail));
  const count = (k: string) => byKind.get(k as never)?.count ?? 0;
  const name = me.name.trim();
  const lang = useLang();

  return (
    <main className="home">
      <h1 className="greeting" translate="no">
        {lang === "es" ? <>{name ? "¡" : ""}Bienvenido <em>de nuevo</em>{name ? "," : ""}</> : <>Welcome <em>Back</em></>}
        {name && <span className="name">{name}!</span>}
      </h1>
      {settings.showSummary && (
        <p className="summary">
          <b>{count("outgoing")} orders</b> go out today, <b>{count("toConfirm")} pallets</b> are waiting for confirmation and{" "}
          <b>{count("incoming")} deliveries</b> are on the way.
        </p>
      )}
      <BrandTotals />
      <section aria-labelledby="updates-h" style={{ display: "grid", gap: 16 }}>
        <div className="updates-head">
          <h2 id="updates-h">Updates</h2>
          <span className="chip">Sample data</span>
        </div>
        {shown.length ? (
          <div className="cards">{shown.map(c => {
            if (c.kind === "messages") return phone ? <HomeMessagesCompact key="messages" /> : <HomeMessages key="messages" placement="grid" />;
            const g = byKind.get(c.kind);
            return g ? <UpdateCard key={g.kind} group={g} /> : null;
          })}</div>
        ) : (
          <p className="no-cards glass">All update cards are hidden. Turn some back on in Settings.</p>
        )}
      </section>
    </main>
  );
}

/** Coordinators and owners: stock of every brand, live (updates with every put-away, pick, move and count) */
function BrandTotals() {
  const { state } = useStore();
  const { me } = useSession();
  const rows = useMemo(() => {
    const m = new Map<string, { brand: string; client: string; cases: number; pallets: Set<string>; expiring: number; expired: number; products: Set<string> }>();
    for (const r of stockRows(state, me)) {
      if (!r.line || !r.product) continue;
      const b = r.product.brand || r.product.client;
      const e = m.get(b) ?? { brand: b, client: r.product.client, cases: 0, pallets: new Set(), expiring: 0, expired: 0, products: new Set() };
      e.cases += r.line.cases; e.pallets.add(r.code); e.products.add(r.product.id);
      if (r.tone === "warn") e.expiring += r.line.cases;
      if (r.tone === "expired") e.expired += r.line.cases;
      m.set(b, e);
    }
    return [...m.values()].sort((a, b) => b.cases - a.cases);
  }, [state, me]);
  if (!can(me, "use-inbounds")) return null;
  const total = rows.reduce((a, r) => a + r.cases, 0);
  return (
    <section className="panel glass brand-totals" aria-labelledby="bt-h">
      <div className="panel-foot"><h2 id="bt-h" className="plain-h">Stock by brand <span className="live-dot" aria-hidden="true" /> live</h2><span className="muted small">{total.toLocaleString()} cases · <a className="link" href="#/inventory/products">Inventory ›</a></span></div>
      <div className="table-wrap">
        <table className="lines bt-table">
          <thead><tr><th>Brand</th><th>Client</th><th className="num">Cases</th><th className="num">Pallets</th><th className="num">Products</th><th className="num">Expiring</th><th className="num">Expired</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.brand} onClick={() => go(`#/inventory/products/${encodeURIComponent(`brand:${r.brand}`)}`)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") go(`#/inventory/products/${encodeURIComponent(`brand:${r.brand}`)}`); }}>
              <td><b>{r.brand}</b></td><td className="muted">{r.client}</td><td className="num">{r.cases.toLocaleString()}</td><td className="num">{r.pallets.size}</td><td className="num">{r.products.size}</td>
              <td className={`num${r.expiring ? " warn" : ""}`}>{r.expiring || "—"}</td><td className={`num${r.expired ? " danger" : ""}`}>{r.expired || "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
