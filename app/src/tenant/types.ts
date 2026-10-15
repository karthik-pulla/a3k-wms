// One warehouse company (tenant) and its settings. See docs/multi-tenant-design.md, section 4.
// Everything that differs between warehouses lives here, never in the code. A3K's is app/public/tenants/a3k/config.json.

/** A brand owner whose stock the warehouse stores (Deccan, Matco, Praj for A3K). The ID is what's saved on stock and orders. */
export type Client = string;

export interface ClientConfig {
  id: Client;
  name: string;
  /** Filled in on a new delivery for this client */
  defaultSupplier?: string;
}

/** One kind of column: which levels it has (L1 is the bottom beam) and how many bays (pallets side by side) per level. */
export interface ColumnShape { levels: number[]; bays: number }

export interface RackConfig {
  /** As people say it: "6", "0", "D6", "1518". Numbers up to `codeFormat.rackDigits` digits are zero-padded in codes ("06") */
  id: string;
  /** Shown in place of "Rack 06", e.g. "Door 6", "Junction 15/18" */
  name?: string;
  /** Each letter is one side of the rack, e.g. "AB" */
  sides: string;
  columns: number;
  /** Column shape for every column (default: layout.defaultShape) */
  shape?: string;
  /** Columns with another shape, by column number, e.g. { "12": "top" } */
  columnShapes?: Record<string, string>;
  /** A small rack bridging two others (shown apart on maps) */
  junction?: boolean;
}

export interface AreaConfig { id: string; name: string }

export interface LayoutConfig {
  codeFormat: {
    /** Tokens: {face} (rack + side), {col}, {level}, {bay} */
    slot: string;
    /** A floor spot in front of a rack side. Tokens: {face}, {n} */
    floor: string;
    /** A spot in a named floor area; must start with {area}. The area's ID alone is also a valid location. Tokens: {area}, {n} */
    areaSpot: string;
    /** Rack numbers with at most this many digits are zero-padded to it ("6" → "06") */
    rackDigits: number;
    colDigits: number;
    spotDigits: number;
    /** Also read codes typed without the padding ("6B-8-L3-B1") */
    acceptUnpadded: boolean;
  };
  shapes: Record<string, ColumnShape>;
  defaultShape: string;
  /** In the order they're shown and walked */
  racks: RackConfig[];
  /** Floor areas with no racks (coolers, lanes, the receiving floor) */
  areas: AreaConfig[];
  /** Where delivered pallets wait before put-away (an area ID) */
  receivingArea: string;
}

/** One label sheet, in millimetres */
export interface LabelSheetConfig {
  id: string;
  name: string;
  /** "letter", "a4", or [width, height] in mm */
  page: "letter" | "a4" | [number, number];
  labelWidth: number;
  labelHeight: number;
  columns: number;
  rows: number;
  left: number;
  top: number;
  /** Space between labels, across and down */
  gapX: number;
  gapY: number;
}

/** A logo, colour and footer used on case labels, picked by the product's brand */
export interface LabelProfileConfig {
  id: string;
  name: string;
  /** Key in the tenant's logos.json */
  logo?: string;
  /** "#rrggbb" */
  color: string;
  footer?: string;
  /** Product brands that get this profile (not case-sensitive) */
  brands: string[];
}

export interface TenantConfig {
  schemaVersion: 1;
  tenant: { id: string; name: string; locale: string; timezone: string };
  branding: { appTitle: string; mark: string };
  languages: { default: "en" | "es"; enabled: ("en" | "es")[] };
  layout: LayoutConfig;
  clients: ClientConfig[];
  labels: { sheets: LabelSheetConfig[]; defaultSheet: string; profiles: LabelProfileConfig[] };
  /** Extra Messages groups besides owners and coordinators (receiving, shifts) */
  groups: { id: string; name: string }[];
  orders: { inbox: string };
  expiry: { warnMonths: number };
  /** unscopedKeys: this warehouse's data on the device keeps the names it had before warehouses were separated
   *  (A3K only, so nothing saved then is lost). Every other warehouse's are named after it. */
  storage?: { unscopedKeys?: boolean };
}

export interface Product {
  id: string;
  client: Client;
  brand: string;
  code: string;
  name: string;
  cat: string;
  size: string;
  units: number | null;
  perPallet: number | null;
  item: string | null;
}

export interface Logo { src: string; w: number; h: number }

// ---------- Sample data (seed.json, optional) ----------
// Made-up deliveries, orders, people and messages a new vault starts with, for testing and the demo. A real
// warehouse has none. Times are relative, so the sample always looks current: days from today, hours or minutes ago.
// Products are named by code; a shipment's or order's client says whose. Message parts are text or references
// ({ slot }, { product: <code> }, { user }, { group }, { order }, { shipment }, { container }). "@name" in a text
// field means texts[name]; "{date:+4}" in a text is the date 4 days from today.

/** [product code, cases, pallet number, lot, best-before in months from now, damaged cases?] */
export type SeedShipmentLine = [string, number, number, string, number, number?];
export interface SeedWho { by: string; hoursAgo: number }

export interface Seed {
  note?: string;
  /** Made-up stock when the warehouse has no stock.json: which clients to leave out (so an order shows a shortage) */
  demoStock?: { seed: number; leaveOut?: Client[]; areas?: string[] };
  people: { id: string; name: string; role: "owner" | "coordinator" | "worker"; groups: string[]; clients?: Client[] }[];
  /** The person with unread messages waiting (the others have read up to 15 minutes ago) */
  focus: string;
  channels: { id: string; title: string; shift?: "am" | "pm"; members: string[] | "everyone" }[];
  /** Direct messages: pairs of people */
  dms: [string, string][];
  shipments: {
    id: string; client: Client; number: string; supplier: string; ref: string; expected: number; status: "incoming" | "pending";
    received?: SeedWho & { condition: "ok" | "damaged" }; lines: SeedShipmentLine[];
  }[];
  orders: {
    id: string; store: string; client: Client; date: number; due: number; source: "app" | "pdf" | "email";
    status: "draft" | "approved" | "shipped"; lines: [string, number][];
    created?: SeedWho; approved?: SeedWho; shipped?: SeedWho; ref?: string; sourceName?: string; sourceText?: string;
    /** Being picked: the first pallet on its list is done */
    picking?: SeedWho;
    /** Given to this worker to pack */
    assignee?: string;
  }[];
  returns: { id: string; orderId: string; store: string; reason: string; notes: string; created: SeedWho; items: [string, number][] }[];
  texts?: Record<string, string>;
  inbox: { id: string; from: string; subject: string; hoursAgo: number; body: string; attachments: { name: string; text: string }[]; status: "new" | "drafted" | "ignored"; orderId?: string }[];
  /** [conversation, author, minutes ago, parts, { urgent, escalateMinutesAgo }?] */
  messages: [string, string, number, unknown[], { urgent?: boolean; escalateMinutesAgo?: number }?][];
  /** When the focus person last read these conversations, in minutes ago (null = never) */
  reads?: Record<string, number | null>;
  presence: Record<string, { state: "online" | "away" | "syncing" | "offline"; minutesAgo: number; manual?: { kind: "forklift" } | { kind: "off" } | { kind: "receiving"; door: number } }>;
  /** Sample pallet tasks: who made them and who gets the first one */
  tasks?: { createdBy: string; assignee?: string };
}
