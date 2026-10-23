// The map of the software for the first-time tour and the Help page (#/help): every section, its tabs, and short
// "how do I…" guides that link straight to the right screen. Plain data; who sees what is decided by `can`.
import type { Action } from "../auth/permissions";

export interface HelpSection {
  id: string;
  /** The left menu's link */
  href: string;
  title: string;
  about: string;
  /** Shown when the person may do this (workers see Work, Inventory, Messages) */
  need?: Action;
  /** Hidden from people who have this (workers' Work screen) */
  not?: Action;
  tabs: { name: string; about: string; href: string }[];
}

export const SECTIONS: HelpSection[] = [
  { id: "home", href: "#/", title: "Home", about: "Your own dashboard: announcements from the owners and the widgets you choose.", need: "use-inbounds",
    tabs: [{ name: "Widgets", about: "Orders going out, deliveries arriving, expiry, Messages and more; pick them with \"Widgets\".", href: "#/" }] },
  { id: "work", href: "#/work", title: "Work", about: "Your pallet tasks (the WMS gives every slot), tasks anyone can take, orders to pack, and messages.", not: "use-inbounds",
    tabs: [
      { name: "My tasks", about: "Start a task, take the pallet to its slot, confirm it's there.", href: "#/work" },
      { name: "Forklift mode", about: "Big buttons, one task at a time, for a device on the forklift.", href: "#/work/forklift" },
    ] },
  { id: "inbounds", href: "#/inbounds", title: "In-bounds", about: "Goods coming in: expected deliveries, arrivals waiting for confirmation, and returns.", need: "use-inbounds",
    tabs: [
      { name: "Dashboard", about: "What's arriving and waiting, at a glance.", href: "#/inbounds" },
      { name: "Incoming", about: "Deliveries on the way; add one, then \"Mark as arrived\" when it's at the dock.", href: "#/inbounds/incoming" },
      { name: "Pending", about: "Arrived deliveries: check them and confirm, and the WMS gives each pallet a slot.", href: "#/inbounds/pending" },
      { name: "Returns", about: "Goods coming back from stores, waiting for an owner's decision.", href: "#/inbounds/returns" },
    ] },
  { id: "inventory", href: "#/inventory", title: "Inventory", about: "What's where: products, every slot and floor spot, and counts.",
    tabs: [
      { name: "Products", about: "Search a product or brand and see every pallet on the warehouse map; export stock reports.", href: "#/inventory/products" },
      { name: "Inventory", about: "Every slot with what's on it; open one for its history, move or adjust it.", href: "#/inventory/stock" },
      { name: "Count", about: "Counting with the keyboard; an owner reviews the differences.", href: "#/inventory/count" },
    ] },
  { id: "outbounds", href: "#/outbounds", title: "Out-bounds", about: "Orders going out: drafts from PDFs and email, approval, picking, shipping and case labels.", need: "use-inbounds",
    tabs: [
      { name: "Dashboard", about: "Orders due, being picked and shipped.", href: "#/outbounds" },
      { name: "Orders", about: "Every order; approving one plans its picks with the warehouse's picking rule.", href: "#/outbounds/orders" },
      { name: "Inbox", about: "Emails sent to the order inbox, sorted by client; turn one into an order or a delivery.", href: "#/outbounds/inbox" },
      { name: "Labels", about: "Case labels for an order, a PDF or products you add.", href: "#/outbounds/labels" },
    ] },
  { id: "tasks", href: "#/tasks", title: "Tasks", about: "Give pallet moves and packing to workers or teams, and see what everyone is doing.", need: "assign-work",
    tabs: [
      { name: "Tasks", about: "Open and finished tasks; create a move and say which pallet.", href: "#/tasks" },
      { name: "Workers", about: "Who's online, what each person is doing, and their queue.", href: "#/tasks/workers" },
      { name: "Teams", about: "Groups of workers a task can be given to.", href: "#/tasks/teams" },
    ] },
  { id: "messages", href: "#/messages", title: "Messages", about: "Channels, direct messages, group chats, and a thread for each order and delivery. Anyone can message anyone.",
    tabs: [
      { name: "New message", about: "Search the people directory and start a direct message or a group chat.", href: "#/messages/new" },
      { name: "Mentions", about: "Everything that mentions you or your groups.", href: "#/messages/mentions" },
    ] },
  { id: "logs", href: "#/logs", title: "Logs", about: "The workers' pallet log: put-aways, moves and picks.", need: "view-logs", not: "manage-settings",
    tabs: [{ name: "Logs", about: "Search by person, date or action; export to .xlsx.", href: "#/logs" }] },
  { id: "manage", href: "#/manage", title: "Manage warehouse", about: "For owners: the warehouse's name, people and roles, racks, picking rule, announcements, clients and carriers, and every change ever made.", need: "manage-settings",
    tabs: [
      { name: "Warehouse", about: "Name, picking rule (FIFO, FEFO or LIFO) and announcements on everyone's home.", href: "#/manage/warehouse" },
      { name: "People", about: "Invite people, change their role and brands, turn accounts off; roles and requests.", href: "#/manage/people" },
      { name: "Racks", about: "The racks and columns, and the slot code format (set with the Lattice team).", href: "#/manage/racks" },
      { name: "Clients", about: "Client and carrier contacts, and where emails to the order inbox go.", href: "#/manage/clients" },
      { name: "Logs", about: "Every change, sign-ins and account changes.", href: "#/manage/logs" },
    ] },
];

export interface Guide { q: string; steps: string[]; href: string; need?: Action }

/** "How do I…": a few steps and a link to the screen */
export const GUIDES: Guide[] = [
  { q: "Receive a delivery", need: "use-inbounds", href: "#/inbounds/incoming", steps: ["In-bounds → Incoming: open the delivery (or add one).", "When the truck is at the dock: \"Mark as arrived\".", "In Pending, check the cases and confirm: every pallet gets a slot and a put-away task."] },
  { q: "Put a pallet away", href: "#/work", steps: ["Open Work (or Tasks) and start the put-away task.", "Take the pallet to the slot the WMS gave.", "Confirm \"It's in the slot\"; the stock is added then. Slot blocked? Say so and the WMS gives the next one."] },
  { q: "Move a pallet", href: "#/inventory/stock", steps: ["Inventory → Inventory: open the slot.", "\"Move pallet\": choose an empty slot or floor spot and give a reason.", "Coordinators can also create a move task for a worker in Tasks."] },
  { q: "Give a task to a worker or a team", need: "assign-work", href: "#/tasks", steps: ["Tasks → \"Move a pallet\".", "Say which pallet: its number, the products on it, or how to recognise it.", "\"Give to\": a person, a team, or anyone."] },
  { q: "See what each worker is doing", need: "assign-work", href: "#/tasks/workers", steps: ["Tasks → Workers: each person's status, the task they're on and what's next."] },
  { q: "Approve an order and pick it", need: "approve-order", href: "#/outbounds/orders", steps: ["Out-bounds → Orders: open the draft and check it.", "\"Approve & plan picks\": the WMS picks pallets by the warehouse's rule.", "Pickers follow the list in walking order and confirm each pallet."] },
  { q: "Turn an email into an order", need: "create-order", href: "#/outbounds/inbox", steps: ["Out-bounds → Inbox: emails are sorted by client and kind (order or delivery notice).", "Open one and \"Draft an order\" (or \"Add the delivery\").", "Check the draft and approve it."] },
  { q: "Print case labels", need: "print-labels", href: "#/outbounds/labels", steps: ["Out-bounds → Labels.", "Fill from an order, a PDF, or add products.", "Preview, then download or print at Actual size."] },
  { q: "Count stock", href: "#/inventory/count", steps: ["An owner starts a count in Inventory → Count.", "Everyone counts with the keyboard (? shows the keys).", "The owner reviews the differences and applies corrections."] },
  { q: "Find a product", href: "#/inventory/products", steps: ["Inventory → Products: type a code or name.", "Every pallet lights up on the map, coloured by expiry."] },
  { q: "Start a group chat", href: "#/messages/new", steps: ["Messages → New.", "Search people by name, pick two or more, give the group a name.", "As its creator you can rename it, add or remove people, or delete it."] },
  { q: "Message someone", href: "#/messages/new", steps: ["Messages → New: search their name and pick them."] },
  { q: "Post an announcement", need: "manage-settings", href: "#/manage/warehouse", steps: ["Manage warehouse → Warehouse → Announcements.", "Write it, mark it urgent if it is, and choose until when.", "It shows on top of everyone's home and Work screens."] },
  { q: "Change the picking rule (FIFO, FEFO, LIFO)", need: "manage-settings", href: "#/manage/warehouse", steps: ["Manage warehouse → Warehouse → Picking.", "Choose the rule and whether open pallets are finished first.", "New orders use it; an order can still be planned another way."] },
  { q: "Invite someone or change their role", need: "manage-people", href: "#/manage/people", steps: ["Manage warehouse → People.", "\"Invite someone\" (they get a link) or open a person to change their role, brands or turn their account off."] },
  { q: "Route client emails", need: "manage-settings", href: "#/manage/clients", steps: ["Manage warehouse → Clients → Email routing.", "Add a sender address or @domain, its client, and whether it sends orders or delivery notices."] },
  { q: "Change the racks or slot codes", need: "manage-settings", href: "#/manage/racks", steps: ["Manage warehouse → Racks: add racks or columns.", "The slot code format is set with the Lattice team: \"Ask the Lattice team\"."] },
  { q: "Choose what's on my home", href: "#/", steps: ["Home → \"Widgets\" (or Settings → Home screen).", "Tick the widgets you want and order them."] },
];
