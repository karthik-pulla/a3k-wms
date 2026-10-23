import { useSession } from "../../session";
import { can } from "../../auth/permissions";
import { useStore, shipmentTitle } from "../../store/store";
import { SubTabs } from "../../components/SubTabs";
import { Dashboard } from "./Dashboard";
import { ShipmentList } from "./ShipmentList";
import { IncomingDetail } from "./IncomingDetail";
import { PendingDetail } from "./PendingDetail";
import { NewShipment } from "./NewShipment";
import { Returns } from "./Returns";
import { ReturnDetail } from "./ReturnDetail";
import { ThreadSection } from "../../components/chat/ThreadSection";

export function InboundsPage({ parts }: { parts: string[] }) {
  const { state } = useStore();
  const { me } = useSession();
  const [tab = "", id] = parts;
  // "owner" below means "may decide returns"; confirming deliveries is open to coordinators too
  const owner = can(me, "decide-return");
  const confirm = can(me, "confirm-inbound");
  const who = me.name;
  const shipment = id ? state.shipments.find(s => s.id === id) : undefined;
  const ret = id ? state.returns.find(r => r.id === id) : undefined;
  const counts = {
    incoming: state.shipments.filter(s => s.status === "incoming").length,
    pending: state.shipments.filter(s => s.status === "pending" || s.status === "putaway").length,
    returns: owner ? state.returns.filter(r => r.status === "pending").length : 0,
  };

  const crumb = tab === "new" ? "Incoming / New delivery"
    : shipment ? `${tab === "pending" ? "Pending" : "Incoming"} / ${shipmentTitle(shipment)}`
    : ret ? `Returns / ${ret.id}`
    : { "": "Dashboard", incoming: "Incoming", pending: "Pending", returns: "Returns" }[tab] ?? "";

  let body;
  const thread = shipment && <ThreadSection target={{ shipment: shipment.id }} />;
  if (tab === "new") body = <NewShipment mailId={id} />;
  else if (tab === "incoming" && id) body = shipment ? <div className="stack"><IncomingDetail shipment={shipment} who={who} canReceive={confirm} />{thread}</div> : <NotFound what="delivery" />;
  else if (tab === "incoming") body = <ShipmentList status="incoming" />;
  else if (tab === "pending" && id) body = shipment ? <div className="stack"><PendingDetail shipment={shipment} who={who} owner={confirm} />{thread}</div> : <NotFound what="delivery" />;
  else if (tab === "pending") body = <ShipmentList status="pending" />;
  else if (tab === "returns" && id) body = ret ? <ReturnDetail request={ret} who={who} owner={owner} /> : <NotFound what="return request" />;
  else if (tab === "returns") body = <Returns who={who} owner={owner} />;
  else body = <Dashboard owner={owner} />;

  return (
    <main className="section">
      <header className="section-head">
        <h1>In-bounds</h1>
        <p className="crumb">{crumb}</p>
      </header>
      {body}
      <SubTabs base="inbounds" current={tab === "new" ? "incoming" : tab}
        tabs={[{ id: "", label: "Dashboard" }, { id: "incoming", label: "Incoming", badge: counts.incoming }, { id: "pending", label: "Pending", badge: counts.pending }, { id: "returns", label: "Returns", badge: counts.returns }]} />
    </main>
  );
}

function NotFound({ what }: { what: string }) {
  return <div className="panel glass"><p>This {what} doesn't exist any more. It may have been reset with the sample data.</p><a className="link" href="#/inbounds">Back to the dashboard ›</a></div>;
}
