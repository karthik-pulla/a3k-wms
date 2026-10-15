import type { Client } from "../data/catalog";

/** One product line of a shipment. Lines with the same pallet number share a pallet (a mixed pallet). */
export interface ShipmentLine {
  key: string;
  productId: string | null;
  cases: number;
  pallet: number;
  lot: string;
  /** YYYY-MM */
  bestBefore: string;
  /** Cases found damaged at receiving; reported to the supplier */
  damaged?: number;
}

/** putaway = confirmed, pallets being taken to their slots by workers (stored once every pallet is confirmed in its slot) */
export type ShipmentStatus = "incoming" | "pending" | "putaway" | "stored";

export interface Shipment {
  id: string;
  client: Client;
  number: string;
  supplier: string;
  /** Container or bill-of-lading number */
  ref: string;
  /** YYYY-MM-DD */
  expected: string;
  status: ShipmentStatus;
  lines: ShipmentLine[];
  notes?: string;
  receivedAt?: string;
  receivedBy?: string;
  condition?: "ok" | "damaged";
  confirmedAt?: string;
  confirmedBy?: string;
  putaway?: { pallet: number; slot: string; reason?: string }[];
  /** Set when the shipment is goods coming back from a store */
  returnId?: string;
}

export interface StockLine {
  productId: string;
  cases: number;
  lot?: string;
  bestBefore?: string;
  shipmentId?: string;
}

export type ReturnOutcome = "restock" | "writeoff" | "brand";
export interface ReturnRequest {
  id: string;
  orderId: string;
  store: string;
  items: { key: string; productId: string | null; cases: number }[];
  photos: string[];
  reason: string;
  notes: string;
  status: "pending" | "approved" | "rejected";
  outcome?: ReturnOutcome;
  createdAt: string;
  createdBy: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
}

/** Permanent record of every stock change. Corrections are new entries, never edits. */
export interface Movement {
  id: string;
  at: string;
  by: string;
  type: "putaway" | "receive" | "return-approved" | "return-rejected" | "move" | "count-correction" | "pick" | "pick-undo" | "adjustment";
  orderId?: string;
  /** For moves: where the pallet came from (location is where it went) */
  from?: string;
  shipmentId?: string;
  location?: string;
  productId?: string;
  cases?: number;
  reason?: string;
}

export type OrderStatus = "draft" | "approved" | "picking" | "picked" | "shipped" | "cancelled";
export type OrderSource = "app" | "pdf" | "email" | "portal";
/** How pallets are chosen: oldest stock first, finishing pallets already opened before opening a new one (default) */
export type PickStrategy = "fifo-open-first" | "fifo";

/** One pallet to take cases from, chosen by the picking plan */
export interface PickLine {
  key: string;
  productId: string;
  location: string;
  /** Cases to take */
  cases: number;
  /** Cases on that pallet when planned (after other orders' reservations) */
  onPallet: number;
  lot?: string;
  bestBefore?: string;
  arrival: string;
  /** The pallet was already open (partial) when planned */
  openPallet: boolean;
  picked?: { cases: number; by: string; at: string; note?: string; taken: StockLine[] };
}

export interface StoreOrder {
  id: string;
  store: string;
  client: Client;
  /** Order date YYYY-MM-DD */
  date: string;
  /** Due date YYYY-MM-DD */
  due?: string;
  lines: { productId: string; cases: number }[];
  status?: OrderStatus;
  source?: OrderSource;
  /** Store's PO / slip number, file name, sender */
  ref?: string;
  sourceName?: string;
  /** Text read from the PDF or email, kept for checking the draft */
  sourceText?: string;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  strategy?: PickStrategy;
  picks?: PickLine[];
  /** Ordered cases that couldn't be planned (not enough stock that isn't expired or reserved) */
  short?: Record<string, number>;
  /** The worker packing this order (assigned by a coordinator) */
  assignee?: string;
  /** "location|productId" a picker found short: skipped when re-planning this order, and worth recounting */
  avoid?: string[];
  shippedAt?: string;
  shippedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

/** An email that arrived at the warehouse's order inbox (tenant config: orders.inbox) */
export interface InboxMail {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
  attachments: { name: string; text: string }[];
  status: "new" | "drafted" | "ignored";
  orderId?: string;
  sample?: boolean;
}

// ---------- Messages ----------
export type Role = "owner" | "coordinator" | "worker";
/** "owners", "coordinators", or one of the warehouse's own groups (tenant config: receiving, shifts) */
export type GroupId = string;

export interface User {
  id: string;
  name: string;
  role: Role;
  groups: GroupId[];
  /** Clients whose stock this person may see; undefined = all */
  clients?: Client[];
  /** Made-up person for testing */
  sample?: boolean;
}

export type PresenceState = "online" | "away" | "syncing" | "offline";
export type ManualStatus = { kind: "forklift" } | { kind: "break"; until: string } | { kind: "receiving"; door: number } | { kind: "off" };
/** Latest presence only; no history is kept. */
export interface Presence {
  userId: string;
  state: PresenceState;
  lastSeenAt: string;
  lastSyncedAt?: string;
  manual?: ManualStatus;
}

export type ConversationKind = "channel" | "dm" | "order" | "shipment";
export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string;
  members: string[];
  shift?: "am" | "pm";
  link?: { type: "order" | "shipment"; id: string };
  createdAt: string;
}

/** A structured reference saved next to the message text, with a small snapshot taken when sent. */
export type MessageRef =
  | { type: "slot"; code: string; start: number; end: number; snapshot: { lines: { productId: string; cases: number }[] } }
  | { type: "product"; productId: string; start: number; end: number; snapshot: { name: string; cases: number; locations: number } }
  | { type: "user"; userId: string; start: number; end: number }
  | { type: "group"; group: GroupId; start: number; end: number }
  | { type: "order"; orderId: string; start: number; end: number; snapshot: { store: string } }
  | { type: "shipment"; shipmentId: string; start: number; end: number; snapshot: { title: string; status: string } }
  | { type: "container"; ref: string; start: number; end: number };

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  text: string;
  refs: MessageRef[];
  photos: string[];
  createdAt: string;
  /** queued = waiting for a connection; sent = reached the server; delivered = reached the recipients' devices */
  status: "queued" | "sent" | "delivered";
  urgent?: boolean;
  escalateAt?: string;
  escalatedAt?: string;
}

export interface ChatState {
  users: User[];
  conversations: Conversation[];
  messages: Message[];
  /** reads[userId][conversationId] = time of the newest message that person has actually seen */
  reads: Record<string, Record<string, string>>;
  presence: Record<string, Presence>;
  seq: number;
}

// ---------- Pallet tasks ----------
/**
 * Moving a pallet, given to a worker by the WMS: put-away (dock → slot), move (slot → slot) or pick-up (slot → out-bound dock).
 * The slot is chosen by the WMS; stock changes only when the worker confirms the pallet is in place.
 */
export interface Task {
  id: string;
  kind: "putaway" | "move";
  status: "open" | "doing" | "done" | "cancelled";
  /** Worker it's given to; empty = any worker may take it */
  assignee?: string;
  from: string;
  to: string;
  /** What's on the pallet */
  lines: StockLine[];
  shipmentId?: string;
  pallet?: number;
  reason?: string;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  doneBy?: string;
  doneAt?: string;
  /** Slots that turned out to be blocked, so the WMS gave another */
  blocked?: string[];
}

/** One recorded change: what was done, by whom, when. Never edited or deleted. */
export interface AuditEntry {
  id: string;
  at: string;
  byId: string;
  by: string;
  area: "stock" | "inbound" | "outbound" | "count" | "task" | "messages" | "data";
  action: string;
  /** Moves of pallets (put-away, moves, picks): the workers' pallet log */
  pallet?: boolean;
}

// ---------- Counts ----------
/** What a counter found in one location. empty = checked and nothing there. */
export interface CountEntry {
  lines: { productId: string; cases: number }[];
  empty?: boolean;
  by: string;
  at: string;
}
export interface CountSession {
  id: string;
  name: string;
  /** Rack sides (face ids) and floor areas in this count */
  scope: string[];
  /** Counters don't see what the system expects */
  blind: boolean;
  status: "open" | "review" | "closed";
  startedBy: string;
  startedAt: string;
  entries: Record<string, CountEntry>;
  /** Locations whose correction an owner approved (or kept as is) */
  decided?: Record<string, "applied" | "kept">;
  closedAt?: string;
  closedBy?: string;
}

export interface State {
  version: 1;
  shipments: Shipment[];
  stock: Record<string, StockLine[]>;
  returns: ReturnRequest[];
  movements: Movement[];
  orders: StoreOrder[];
  seq: number;
  chat: ChatState;
  counts: CountSession[];
  inbox: InboxMail[];
  tasks: Task[];
  audit: AuditEntry[];
}
