import type { HomeCardKind, HomeSettings } from "../../settings";
import { DownIcon, UpIcon } from "../icons";

/** What each home widget shows, for choosing them (the tour, Settings, the home screen's "Widgets" button) */
export const WIDGETS: Record<HomeCardKind, { name: string; about: string }> = {
  messages: { name: "Messages", about: "Unread conversations and mentions (on the right on wide screens)" },
  outgoing: { name: "Going out today", about: "Orders being picked, picked or shipped today" },
  deadlines: { name: "Due soon", about: "Orders due in the next 2 days" },
  ordersToApprove: { name: "Orders to approve", about: "Drafts from PDFs, email and the app" },
  incoming: { name: "Arriving", about: "Deliveries on the way" },
  toConfirm: { name: "Waiting for confirmation", about: "Arrived deliveries that need slots" },
  expiry: { name: "Expiry alerts", about: "Stock past or near its best-before" },
  returns: { name: "Returns pending", about: "Returns waiting for an owner" },
  changesToApprove: { name: "Changes to approve", about: "Count differences to review" },
  stockByBrand: { name: "Stock by brand", about: "Live cases, pallets and expiry per brand" },
};

/** Tick the widgets to show; arrows change their order. */
export function WidgetPicker({ cards, onChange }: { cards: HomeSettings["cards"]; onChange: (cards: HomeSettings["cards"]) => void }) {
  const move = (i: number, d: -1 | 1) => { const next = [...cards]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };
  return (
    <ul className="cardlist widget-list">
      {cards.map((c, i) => (
        <li key={c.kind}>
          <input type="checkbox" id={`widget-${c.kind}`} checked={c.visible} onChange={e => onChange(cards.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)))} />
          <label htmlFor={`widget-${c.kind}`}>{WIDGETS[c.kind].name}<small className="muted block">{WIDGETS[c.kind].about}</small></label>
          <button type="button" className="mini" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${WIDGETS[c.kind].name} up`}><UpIcon /></button>
          <button type="button" className="mini" disabled={i === cards.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${WIDGETS[c.kind].name} down`}><DownIcon /></button>
        </li>
      ))}
    </ul>
  );
}
