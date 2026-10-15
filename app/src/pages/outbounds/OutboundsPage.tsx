import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { canSeeClient } from "../../auth/permissions";
import { SubTabs } from "../../components/SubTabs";
import { statusOf } from "../../outbound/plan";
import { OutboundsDashboard } from "./Dashboard";
import { OrderList } from "./OrderList";
import { OrderDetail } from "./OrderDetail";
import { OrderEditor } from "./OrderEditor";
import { Inbox } from "./Inbox";
import { LabelsTool } from "./LabelsTool";

/**
 * #/outbounds                     dashboard
 * #/outbounds/orders              all orders;  /orders/<id> one order;  /orders/<id>/edit check or edit a draft
 * #/outbounds/new                 new order (typed in or read from a PDF)
 * #/outbounds/inbox               emails to the order inbox
 * #/outbounds/labels[/<orderId>]  case labels (one per case), for an order or any products
 */
export function OutboundsPage({ parts }: { parts: string[] }) {
  const { state } = useStore();
  const { me } = useSession();
  const [tab = "", id, sub] = parts;
  const order = tab === "orders" && id ? state.orders.find(o => o.id === id) : undefined;
  const mine = state.orders.filter(o => canSeeClient(me, o.client));
  const drafts = mine.filter(o => statusOf(o) === "draft").length;
  const newMail = state.inbox.filter(m => m.status === "new").length;
  const crumb = tab === "new" ? "Orders / New order" : order ? `Orders / ${order.id}${sub === "edit" ? " / edit" : ""}`
    : (tab === "labels" ? `Labels${id ? ` / ${id}` : ""}` : ({ "": "Dashboard", orders: "Orders", inbox: "Inbox" } as Record<string, string>)[tab] ?? "");

  let body;
  if (tab === "new") body = <OrderEditor />;
  else if (tab === "orders" && id) body = !order ? <div className="panel glass"><p>This order doesn't exist any more.</p><a className="link" href="#/outbounds/orders">All orders ›</a></div>
    : sub === "edit" && statusOf(order) === "draft" ? <OrderEditor key={order.id} order={order} /> : <OrderDetail order={order} />;
  else if (tab === "orders") body = <OrderList />;
  else if (tab === "inbox") body = <Inbox />;
  else if (tab === "labels") body = <LabelsTool key={id ?? ""} orderId={id} />;
  else body = <OutboundsDashboard />;

  return (
    <main className="section outbounds">
      <header className="section-head">
        <h1>Out-bounds</h1>
        <p className="crumb">{crumb}</p>
      </header>
      {body}
      <SubTabs base="outbounds" current={tab === "new" ? "orders" : tab}
        tabs={[{ id: "", label: "Dashboard" }, { id: "orders", label: "Orders", badge: drafts }, { id: "inbox", label: "Inbox", badge: newMail }, { id: "labels", label: "Labels" }]} />
    </main>
  );
}
