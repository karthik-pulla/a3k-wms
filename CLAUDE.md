# Warehouse Management System (WMS)

A warehouse (A3K Imports) stores goods for several brands (Deccan, Matco/Falak, Anaganaga, Karachi-NKB, Millet Bank via Praj Natural Foods, and others). Brands send stock in; stores such as Patel Brothers, Balaji and Patidar order it out. Today it runs on Google Sheets: one workbook per brand, one tab per rack, recopied for every count. This project replaces that with a WMS: an installable web app on AWS, with a nightly backup to an in-house NAS.

Users: two owners plus warehouse workers who see less. No outside logins for now; a client portal comes in a later phase.

Sources of truth, newest first: this file, then the owner's plan PDF (`WMS Plan-2.pdf`, Oct 2026), then the earlier plan doc https://claude.ai/code/artifact/a4a12e35-975f-4371-a3dc-90313c6c0a7e.

## Folder map

| Path | What it is |
| --- | --- |
| `data/source/` | Real inputs: the stock workbooks, logos, order-slip photos, a Deccan label example. Business data. Never edit or delete. |
| `data/csv/` | One CSV per workbook tab, made by `scripts/dump_workbooks.py` |
| `data/generated/` | `count.json` (rack layout, products, last sheet counts) and `label-catalog.json` (label products + logos) |
| `scripts/` | Python build steps, run in order by `npm run build` |
| `scripts/legacy-labels/` | One-off Millet Bank label scripts, superseded by the Label Maker |
| `app/` | The full WMS web app (React + TypeScript + Vite). `app/src/pages` holds screens (`pages/inbounds/`, `pages/inventory/`, `pages/outbounds/`, `pages/messages/`), `app/src/outbound/` picking plan, order reader and label PDFs, `app/src/components` shared pieces, `app/src/store/` app state, sample data and the put-away rules, `app/src/inventory/` stock and count helpers, `app/src/chat/` the Messages data layer. |
| `app/public/tenants/a3k/` | A3K as a tenant (warehouse) of the WMS, loaded by the app at startup. `config.json` (written by hand: rack layout, location-code format, clients, label sheet and logo profiles, groups, order inbox, expiry warning, languages, name), `products.json` (480 products with client) and `logos.json` (brand logos for case labels), both made by `scripts/build_app_data.py`; never edit those two by hand. |
| `app/src/tenant/` | The tenant config types (`types.ts`), loading (`index.ts`) and `layout.ts`, the only place location codes are built or read. |
| `app/src/data/generated/` | `sampleStock.json` (SAMPLE stock: the 27 Sep sheets moved onto the new codes; never on GitHub). Made by `scripts/build_app_data.py`; never edit by hand. |
| `tools/<tool>/template.html` | Source of each published tool. Data goes in at the single `/*DATA*/` marker. |
| `tools/<tool>/dist/` | Built pages that get published. Never edit by hand. |
| `outputs/` | Files handed to the owners: count sheets, label PDFs (not on GitHub) |
| `tests/` | `node --test` tests |
| `docs/images/` | Photo of the label sheet and the fit check used to measure it |

## Commands

- `npm run build`: workbooks → CSV → generated JSON → `tools/*/dist/*.html`. The generated JSON must come out byte-identical unless the inputs or scripts changed; check with `git diff data/generated`.
- `npm run app:dev`: run the WMS app at http://localhost:5173 (or start `wms-app` in `.claude/launch.json`). `npm run app:build` type-checks and builds it. Install its packages once with `npm --prefix app install`.
- `npm test`: checks the count page's Excel export keeps the stock workbook layout.
- `python3 scripts/make_count_sheet.py`: blank count workbook with product dropdowns (non-Deccan products) in `outputs/count-sheets/`.
- Preview a tool locally: start the `tools` server in `.claude/launch.json` and open `/tools/<tool>/dist/<tool>.html`. Add `<meta charset="utf-8">` to a test copy, because the published skeleton supplies it, not the template.

## GitHub and the demo site

- The repository on GitHub is public, so the real business data is in `.gitignore` and must never be committed: `data/source/`, `data/csv/`, `data/generated/count.json`, `outputs/`, `tools/warehouse-count/dist/`, `tools/rack6-map/`, `app/src/data/generated/sampleStock.json` and the loose copies in the top folder. Product names, the layout and the brand logos are fine to publish (owner's choice, 14 Oct 2026).
- Demo site: GitHub Pages, built by `.github/workflows/pages.yml` on every push to `main` with `npm --prefix app run build:demo` (`VITE_WMS_DEMO=1`). It has made-up stock (`app/src/store/demoStock.ts`), relative paths, and a note on the sign-in screen (`admin` / `password`; changes stay on each device). The demo build never includes the sheet stock (`vite.config.ts`); without `sampleStock.json` (a fresh clone) the dev app uses the demo stock too. Preview locally with `wms-demo` in `.claude/launch.json` after `build:demo`.

## Published tools (claude.ai artifacts)

| Tool | Link | Notes |
| --- | --- | --- |
| Warehouse Count | https://claude.ai/artifact/MWGTwdznXht8VpyEPsftQ9 | Keyboard count entry for every slot. Capabilities `db` + `downloads`. Counts live in the artifact database at `sessions/<countId>/r-<rack>/<location>` and `sessions/<countId>/areas/<location>`. |
| Order Label Maker | https://claude.ai/artifact/BCMHj1WC8Dqw7hJPoWHVAS | Case labels from an order slip. Capabilities `sample` + `downloads`. |
| Rack 6 Map | https://claude.ai/artifact/S3eUscK2fHuhEAp8CiHWFS | Early prototype of the rack map |

To update a tool: edit its `template.html`, run `npm run build`, then republish `tools/<tool>/dist/<tool>.html` to the same link (from a new conversation, pass the link as the artifact `url` so it updates rather than creating a new one). Keep the capabilities as listed above.

## Warehouse facts (owner-confirmed; these win over the sheets)

- **Location code (full WMS)**: zero-padded rack number, `<rack 2 digits><side>-<column 2 digits>-L<level>-B<bay>`, e.g. `06B-08-L3-B1`, `00A-01-L1-B1`. Door 6 stays `D6A`/`D6B`; junctions are `1518A`, `1619B`, etc. L1 is the bottom beam, L4 the top. "B1/B2" is the bay (sub-column), unrelated to side B. The current stock sheets, Warehouse Count page and printed labels still use the old unpadded form (`6B-08-L3-B1`).
- **Floor spots**: `<side>-FLOOR-Pnn` (e.g. `06B-FLOOR-P01`; old tools `6B-FLOOR-P01`) plus areas `NEARCOOLER-01`…`05`, `LINE-2-3` (Between line 2 & 3), `LANE-7`, `DOOR-2-3`, `LOAD-AREA` (sheet label `LOAD_AREA_01`), `RECV-FLOOR` (`Recv Floor`).
- **Rack sides** (owner's plan, Oct 2026; the stock sheets are out of date). The WMS app uses this layout (`app/public/tenants/a3k/config.json`, `layout.racks`); the published Warehouse Count page and `data/generated/count.json` still use the older sheet layout.
    - Door 6: 6A and 6B, 6 columns each.
    - Rack 0: sides A, B, C, 10 columns each.
    - 13 columns: 1A, 1B, 2A, 3A, 3B, 4A, 4B, 5A, 5B, 6A, 6B, 7A, 7B, 8A, 9A, 9B, 10A, 10B, 11A, 12A, 12B, 13A, 13B, 14A, 14B. There is no 8B or 11B (owner confirmed); the plan's second 12A/12B was a typo.
    - Total: 3,662 slots.
    - 10 columns: 15A, 15B, 16A, 16B, 18A, 18B, 19A, 19B. 8 columns: 17A. 6 columns: 20A (A side only).
    - Junctions: 1518A, 1518B (between racks 15 and 18) and 1619A, 1619B (between 16 and 19): 1 column each, levels 3–4 only, bays B1–B3. Code like `1518A-01-L3-B1`.
- **Column shape**: 4 levels × 2 bays = 8 pallets. Column 12 on 13-column racks has levels 3–4 only, with bays B1–B3 (levels 1–2 have no slots). 3A-12 is B1–B3 like the others. 10B-13 is a normal column like 10A-13 (L2 has B1 and B2 only).
- **Floor and no-rack areas**: every rack side has a floor; near cooler 1–5, between line 2 & 3, lane 7, doors 2 & 3, load area, receiving floor and the coolers have no racks and are treated as floor.
- **Units** are cases. A product is identified by its full item text, e.g. `Rice:Deccan:10LBS*4:1073:SurtiKolam`; the 4-digit item code is the usual short form.

## Stock workbook format (do not change)

- Tabs: `Rack00`, `RACK01`…`RACK20`, `DOOR6`, plus `Anaganaga`, `NearCooler`, `DOOR2N3`, `Front`, `CSFloor`. The owners' old `RACK` tab is a Google Sheets QUERY over these exact tab names, so never rename them.
- Columns: Location, Item, No. of Cases, Best Before Date, Batch No, Container. Side A in A–F, side B in H–M, side C in O–T. Grey (#B7B7B7) bold headers, thin borders.
- Rows go rack column by rack column: L1-B1, L2-B1, L3-B1, L4-B1, L1-B2… with a blank row after each column; floor rows at the bottom. A mixed pallet repeats its location on extra rows.

## Label sheets

- US Letter, 10 labels of 3 × 2 in (2 across, 5 down). Left margin 30.1625 mm, top 6.35 mm, 3.175 mm gaps. Measured from `docs/images/label-sheet-photo.jpg` and confirmed by a print. Print at Actual size (100%).
- Millet Bank's 23 products and full SKUs come from the Praj Natural Foods order form; see `scripts/build_label_catalog.py`. One label per case ordered.

## WMS app design

- Multi-tenant groundwork (`docs/multi-tenant-design.md`, Phase 0): nothing about one warehouse is built into the app. At startup `main.tsx` loads the tenant (`app/src/tenant/index.ts`: `config.json`, `products.json`, `logos.json` from `public/tenants/<id>/`; `VITE_TENANT`, default `a3k`) before any screen; `data/catalog.ts` exposes it to the screens. Location codes are built and read only through `tenant/layout.ts` (`slotCode`, `spotCode`, `normalizeLocation`, …) from `layout.codeFormat`; never write a code with a template string. Client and group IDs are strings from the config. Still A3K-specific and next to move: the sample people, orders and messages, the home update cards and ticker (canned text), and the demo stock.
- Frosted-glass look over moving colour, light and dark themes. Frost levels (light, frosted, heavy) change the glass tint, blur and saturation together. The Moving background setting overrides the system reduce-motion preference (it only sets the default). On phones and tablets (coarse pointer) it starts off, and the colour shift (hue animation) runs only on computers: moving colour makes every pane of glass re-blur each frame, which made phones slow. Each screen in `App.tsx` is lazy-loaded (`screens`), and all of them load in the background 1.5 s after sign-in. Phones (≤ 760 px) show less at once: smaller titles, the admin's role switcher only in Settings, a section's tabs under its title, number tiles two per row, home update cards as title + count (tap to open), and Stock by brand with brand, cases, pallets and expired only. A crash shows an error card with Reload instead of a blank screen (`ErrorBoundary`); after a deploy, a missing script or screen file makes the page reload itself at a fresh address (`public/theme.js`, `utils/freshLoad.ts`). Opening the saved session gives up after 4 s if IndexedDB doesn't answer (some iPhones), and "Opening…" turns into a Reload card after 8 s; the demo also offers "Start over on this device". Routes accept the on-screen spelling (`#/in-bounds`, `#/Out-bounds`). All colours are CSS tokens in `app/src/styles/global.css`; style through `.glass` and the tokens, never literal colours in components.
- Fonts ship with the app (Inter for everything, with optical sizing for big headings; Geist Mono for the ticker); no outside requests.
- Home: "Welcome Back <name>!", In-bounds / Inventory / Out-bounds / Messages buttons on the left (a bottom bar on phones), update cards, the save-status pill, and the activity ticker bottom right. On screens 1300 px and wider, Messages and the ticker share a right-hand rail; narrower, Messages is a full-width card at its place in the card order; on phones it's a compact card (unread count, latest mentions). Home settings (theme, glass strength, moving background, which cards show and in what order, Messages settings) are saved per device until sign-in exists.
- Respect reduced motion: animations stop when the system asks.
- Every product box uses `ProductInput` (built on `Autocomplete`): the rest of the best match shows in grey, Tab or → accepts, ↑ ↓ and Enter pick from the list. The shipment's client ranks first; DONOTUSE/CROSSDOCK codes sink.
- In-bounds (`#/inbounds/…`): Dashboard, Incoming, Pending and Returns tabs at the bottom. Incoming → "Mark as arrived" → Pending → owner confirms → put-away plan → stored. Returns stay pending until an owner approves (back into stock creates a pending in-bound; write-off or back-to-brand don't touch inventory) or rejects.
- Put-away (`app/src/store/putaway.ts`): one empty slot per pallet. Preference: next to the same product (same rack, nearest column, then the other side), then the same brand, then the same client, then the first empty slot; lower levels first. No empty slot: the floor of the rack side holding most of that product. A person may move a pallet to another empty slot on the rack view; a reason is required. Lines with the same pallet number are one mixed pallet; damaged cases stay out of put-away.
- Sign-in and accounts (`app/src/auth/`, `#/account`). Until the server exists, everything is on this device:
    - Nothing shows until someone signs in. The only account at first is `admin` / `password` (an owner); it's told to change that password. Others use "Ask for an account" on the sign-in screen; an owner approves (choosing role and which clients they may see), rejects, resets a password (temporary, shown once) or turns an account off on the Account page. Approving, resetting and turning on ask for the owner's password again.
    - All app data (stock, orders, messages, accounts, the security log) is one AES-256-GCM "vault" in localStorage (`wms.vault.v1`); nothing is saved unencrypted (the old plain `wms.store.v1` is moved in and deleted). Passwords are never stored: PBKDF2-SHA256 (600,000 iterations, random salt) turns a password into the key that unlocks that account's copy of the vault key (`wms.auth.v1` holds only salts, ciphertext and hashed usernames). Account requests are encrypted to the vault's public key (ECDH P-256), so only a signed-in owner can read them; approval gives the new account the vault key encrypted to its own public key.
    - 5 wrong tries lock that username for 30 s, doubling to 15 min; unknown usernames take as long as known ones. Sessions keep a non-extractable key in IndexedDB; sign-out after 30 min idle (7 days with "Keep me signed in") and at most 12 h (30 days). New passwords: 12+ characters, not common, not containing the username. The built app sends a Content-Security-Policy (no outside requests, no inline scripts; `vite.config.ts`).
    - Limits, until the server: someone who controls the device or the app's code can get around a browser-only sign-in; turning an account off removes its key on this device but doesn't change the vault key; no two-factor yet; lockout counters live on the device.
    - Account requests no longer ask for a job: the admin picks Owner, Coordinator or Worker (with a description of each) and which clients the person may see.
    - Only the admin account (the first one, `admin`; no other account can get this) can switch, for testing and debugging, to any role as itself (Owner, Coordinator, Worker) or to any person, from the top bar or Settings. Changes made while switched are logged as "Admin (testing as worker)" / "Admin (viewing as Omar)". Other owners never get the switcher, and a switch left saved on the device is ignored for them.
    - The admin can "View the app as" a sample person (six made-up people: owners Karthik and Maya, coordinators Leo and Nina, workers Omar and Tess; Tess sees only Deccan and Praj) to check what others see. "Reset sample data" starts the sample data over (accounts stay).
- Inventory (`#/inventory/…`, `app/src/pages/inventory/`, helpers in `app/src/inventory/`): three tabs at the bottom.
    - Products: search by code or name (sorted A–Z, or by code when the text starts like a code), filter (stock, expiry, partial, client, brand) and sort. Picking a product or "All <brand>" highlights every pallet on a whole-warehouse map (one square per slot, tinted by expiry, expired in black) and the rack view, or lists them in a table (oldest arrival first). "Export stock report" makes an .xlsx per chosen brand(s): cases per product, a by-brand sheet, and every pallet location; "One file per brand" keeps brands apart.
    - Inventory: every slot and floor spot with occupancy, partial, mixed, expiring and expired counts; a searchable, sortable table (exportable, printable) or rack by rack with fill levels. Any location opens a detail drawer: each product's code, brand, lot, best-before, arrival, delivery, full-pallet size, history and messages; arrow keys step to the next slot. "Move pallet" moves everything to an empty slot or floor spot, with a required reason, logged as a `move`.
    - Count: an owner starts a count (whole warehouse or chosen racks, optionally blind). Everyone counts with the keyboard, with the same keys as the Warehouse Count page (arrows, Shift+arrows, Page Up/Down, type to search, Enter, Tab for a mixed pallet, `=`, `-`, Alt+A, Cmd/Ctrl+C/X/V incl. pasting rows from Excel, Del, Cmd/Ctrl+Z, `?`). An owner reviews the differences and applies corrections (logged as `count-correction` with the reason) or keeps the system stock; uncounted slots never change.
    - .xlsx files are written by `app/src/utils/xlsx.ts` (no library, no outside request): grey bold header like the stock workbooks, frozen header, filters.
    - SAMPLE: the 27 Sep sheets have no lots or best-before dates, so sheet stock gets made-up ones (`withSampleDates` in `app/src/store/sample.ts`) to test expiry screens.
- Out-bounds (`#/outbounds/…`, `app/src/pages/outbounds/`, logic in `app/src/outbound/`): Dashboard, Orders, Inbox and Labels tabs.
    - Orders come in three ways, always as a draft that a coordinator or owner approves: typed in (New order), read from a PDF (text read with pdf.js; codes, cases, store, due date and PO number filled in; lines matched by name are flagged; scanned PDFs have no text and are typed in), or from an email to the order inbox (`orders@a3kimports.com` once the server exists; until then sample emails and "Paste an email"). The client portal (later phase) will create drafts the same way. Status: draft → approved → picking → picked → shipped (or cancelled; picked cases go back on their pallets).
    - Approving plans the picks (`app/src/outbound/plan.ts`): FIFO by arrival date; expired stock is never planned; cases planned for other open orders are reserved; by default open (partial) pallets are used up before a full pallet is opened, so one pallet is taken from until it's empty ("Strictly oldest stock first" is the per-order alternative). Not enough stock = "short".
    - The order page shows the pick list in walking order (by location) with how many cases to take, what's left on the pallet, lot, best-before and arrival; the map highlights every pallet to pick (numbered in walking order; click a product to show only its pallets). Confirming a pick takes the cases off stock (logged as `pick`, undo logged as `pick-undo`). Taking fewer than planned needs a reason; that pallet is skipped for the order, flagged for a recount, and the rest is planned from the next oldest pallet. Pick list as .xlsx or printed.
    - Labels tab: case labels like the Order Label Maker (same sheet, layout, logos and footers; `app/src/outbound/labelsPdf.ts` with jsPDF), one per case, filled from an order (each pallet's best-before on its cases), from a PDF order slip or packing list ("Read a PDF order…", same reader as orders; best-before from the oldest pallet in stock; unread lines listed, other clients' lines left out) or products added by hand (the add box empties after Enter/Tab; Enter in the empty box adds the last product again); the footer box is labelled "Footer" (one per logo when lines use several logos); preview, PDF download, print, alignment test, start position for part-used sheets. Logos come from `data/source/logos` via the tenant's `logos.json`; the sheet, colours and footers from `labels` in its config.
    - Libraries added for this (bundled, loaded only when used, no outside requests): `pdfjs-dist` 4.10.38 (reading PDFs, label preview) and `jspdf` 4.2.1 (making label PDFs).
- Language: English or Español (Settings → Appearance, and on the sign-in screen; saved per device in `wms.lang`). Screens are written in English; in Spanish `app/src/i18n/index.ts` watches the page and swaps interface text, placeholders, titles and aria-labels using `app/src/i18n/es.ts` (exact phrases in `ES`, texts with numbers or names in `ES_PATTERNS`, `{n?plural:singular}` for Spanish endings). Words: pallet = tarima, slot = espacio, case = caja, pick = surtir, put away = acomodar, informal "tú". Never translated: anything under `translate="no"` (what people type in Messages, task reasons, email and PDF text), product, brand, store and people's names, codes, sample data, the Logs action text (a permanent record) and every exported or printed file (.xlsx, labels). Text for `window.confirm`/`prompt` goes through `t()`. `<option>`s need an explicit `value` or they stay English. When adding interface text, add its Spanish to `es.ts`; in dev, `window.__wmsMissing` lists text seen on screen with no translation.
- Permissions: every "may this person see or do this" check goes through `app/src/auth/permissions.ts` (`can`, `canSeeClient`, `visibleLines`), following the owner-defined roles above ("supervisor" was renamed "coordinator"; saved data is migrated). Owners and coordinators see In-bounds, Inventory, Out-bounds, Tasks, Messages and Logs; workers see Work, Inventory and Messages. Only owners decide returns, start and approve counts, adjust stock and manage accounts.
- Pallet tasks (`app/src/store/tasks.ts`, `#/tasks`, `#/work`): confirming a delivery creates one put-away task per pallet (receiving floor → the slot the planner chose); stock is added only when a worker confirms "it's in the slot". Moves: workers ask the WMS for a slot (nearest free on the same rack side) and get their own task; coordinators may choose the slot and give it to a worker or record a move they did. Slots promised to open tasks count as taken for every planner. "Slot is blocked" makes the WMS give the next free slot. Coordinators give tasks and orders to pack to workers on the Tasks page (and the order page); workers pack only orders given to them.
- Work screen (`#/work`, workers' home): clock, my tasks, tasks anyone can take, orders to pack, message alerts, "Move a pallet". Forklift mode (`#/work/forklift`): full screen, very large type, one task at a time with big buttons, next tasks, the latest message; keeps the screen awake.
- Logs (`#/logs`, `app/src/store/audit.ts`): every change is recorded automatically by the store (action in words, who, date and time; never edited, kept through "Reset sample data"). Owners see everything plus sign-ins and account changes; coordinators see the pallet log (put-away, moves, picks). Messages are not logged. Changes made while "viewing as" someone are logged as "<owner> (viewing as <person>)". Owners' direct stock changes ("Adjust stock here", in a slot's details) need: edit → review before/after → reason → confirm.
- Home for owners and coordinators adds "Stock by brand · live" (cases, pallets, products, expiring, expired per brand).
- Messages (`#/messages`, `app/src/chat/`, `app/src/components/chat/`): channels (team, one per shift), direct messages, and a thread per order and per delivery (members limited to people who may see that client). Chat never changes stock.
    - Messages are text plus structured references (`MessageRef`: slot, product, person, group, order, delivery, container) saved by id with a small snapshot, so chips show live state, "when sent: …" if it changed, and renames don't break old messages. Typed location codes (padded or old unpadded, Door 6, junctions, floor spots, areas) become slot references and are saved padded; invalid codes stay plain text.
    - Chips: a slot opens the map (`MapOverlay`, built on `RackView`) with the slot pulsing and a card of what's there; several slots get numbered markers in the order written; a product shows every location tinted by expiry (expired in black), partial pallets marked, and a FIFO list (oldest arrival first). Other clients' stock always shows as "hidden", in chips, maps, previews and search.
    - Composer: `@` people and groups (@owners, @coordinators, @receiving, @shift-am, @shift-pm), `#` products/orders/deliveries/containers, 📍 slot picker (dropdowns or tap the map), photos (camera on phones), urgent flag. Urgent mentions still unread after N minutes call the `Notifier` interface (`chat/notify.ts`, a console stub until texts/emails exist).
    - A message counts as read only once at least 60% of it has been on screen with the app in front. Presence: Online, Away (idle 5 min or app in background), Offline · syncing later, Offline; rough times only, latest only; manual statuses (On forklift, On break, Receiving at Door N, Off today). Exact times are limited by a setting (owners + coordinators by default).
    - Everything the screens ask of a server goes through the `ChatBackend` interface (`chat/backend.tsx`). The local version simulates other people (presence heartbeat, reads), and queues messages while offline; Settings → Developer → "Simulate offline" tests it. A real backend (AWS + WebSockets) replaces it without changing the screens. No end-to-end encryption.

## Rules for agents

1. `data/source/` is real business data. Don't send it to outside services, and never put one brand's stock in another brand's report or file.
2. Never hand-edit `dist/`, `data/generated/` or the generated tenant files (`products.json`, `logos.json`). Change the template or script and rebuild. A tenant's `config.json` is edited by hand.
3. Keep the stock workbook tabs, columns and row order exactly as above.
4. Run `npm run build` and `npm test` before saying work is done, and report the results honestly.
5. Ask before deleting anything in `outputs/` or `data/source/`.
6. Owner-confirmed facts (this file) beat what the sheets say. Record new confirmations here.
7. No tenant names, brands or location-code formats in app code: they belong in the tenant config.

## Owner decisions for the full WMS (Oct 2026)

- **Platform**: installable web app (React + TypeScript), managed AWS services with PostgreSQL, real-time updates for several users at once, nightly backup to the NAS. Phones keep working offline and sync later, with a visible saved/syncing icon.
- **Sign-in**: email/username and password plus two-factor for everyone.
- **Devices**: warehouse-owned devices; workers may also use their own phones.
- **Every stock change** needs a reason and is recorded permanently. History is visible only to certain roles.
- **Inbound** records: brand, supplier, SKU, lot number, best-before date, cases, number of pallets, shipment (arrival) date, container or BOL number, who received it, condition. Quantities are in cases; each pallet holds a number of cases.
- **Confirmation**: a higher role (not a worker) confirms each received pallet. The slot is assigned right after confirmation and saved to the cloud at once.
- **Damage report**: photos, quantity and reason, exportable as a PDF for the supplier.
- **Put-away**: racks hold set product types (list to come). The system suggests a slot near similar products; a person may choose another slot, with the reason logged. When a type's racks are full, overflow goes to the floor of the rack where most of that product sits; certain roles can route it to a free slot instead. Mixed pallets (two or more products on one pallet) are allowed.
- **QR codes**: on hold. Don't generate them until the owner says so. When made: one per slot (about 3,600 for now) on durable laminated labels. The QR holds only the slot address; scanning opens the live slot page after sign-in.
- **Expiry**: warning time set per product category (e.g. rice 6 months, snacks 2 months). Alerts on the home page, by email, and by text for some, with per-user settings. Expired stock is shown in black, can't be picked, and raises an alert.
- **Quantities**: always in cases. "Units" means products per case and is stored as product information (for labels and orders). Loose items such as single rice bags are still recorded in cases.
- **Inventory reports**: on demand; the user chooses the scope (per brand, per store, etc.) and the sort (product code, lot, expiry, quantity, shipment date). Download as `.xlsx`; no Google account connection.
- **Count mode**: under Inventory. Scan a slot, enter what's there, see the difference; an owner approves corrections. Counts happen when an owner decides.
- **Orders**: from stores, by PDF upload or emailed to a dedicated inbox (e.g. `orders@a3kimports.com`); the app drafts the order for approval. Each order has a due date, from the slip or typed in. The order page highlights the pallets to pick on the map.
- **Partial pallets**: an order may take cases off a pallet. Keep partial pallets to a minimum: take extra cases from existing partial pallets first, and only open a full pallet when no partial pallet is left.
- **Returns**: their own pages under In-bounds. A return stays pending and doesn't change inventory until it's approved.
- **Go-live**: build and test the full WMS on localhost with sample inventories first. Then do one full count over 3 days and load it into the app; the spreadsheets stop that day (no parallel run).
- **Labels**: printed with the Order Label Maker (and the app's Labels tab).
- **Roles** (owner-defined, 14 Oct 2026). The admin assigns the role when approving an account request.
    - **Owners**: everything is visible and editable, but not easily (direct changes need a review step and a reason). A **Logs** section records every change: the action, who made it, and the date and time.
    - **Coordinators**: only they (and owners) confirm in-bound quantities; they oversee the workers' pallet log, in-bounds, orders and all inventory, see where every pallet is, print labels for orders, confirm orders before they leave, send/report counts and in-bound reports, and always have a live stock count of every brand.
    - **Workers**: only move pallets (in-bound dock → rack, rack → out-bound, rack → rack), always with a slot given by the WMS, and confirm each pallet once it's in the rack. They pack orders given to them by coordinators. They have their own dashboard (time, their pallet tasks and packing, message notifications) and work devices mounted on forklifts showing their pallet tasks, the time and notifications.

## Open questions

- Roles: can workers see stock (Inventory, read-only, for now) and count? Do coordinators also start counts (now owners only)? Which coordinator gets put-away tasks by default (now any worker can take them)?
- Which racks hold which product types; warning time per category.
- Where inbound information comes from (packing lists?).
- Picking is FIFO by arrival date (user, 13 Oct 2026). Which wins when they disagree: oldest stock, or finishing an already-open pallet first (the owners' plan; the current default)?
- Order inbox: who sets up `orders@a3kimports.com` and receiving mail on AWS; which senders are trusted.
- What happens after picking: paperwork, delivery, proof of delivery.
- Sign-in on the server: two-factor method (authenticator app?), who the admins are, account recovery when someone forgets their password, how long sessions last on shared warehouse devices.
- Domain: `wms.a3kimports.com` is likely but not confirmed; who manages DNS. Billing; budget.
- Floor plan sketches haven't arrived yet.
- Messages: who can see "last online" times (now owners + coordinators)?
- Messages: should presence show outside shift hours (now a setting, off by default)?
- Messages: how long are messages kept?
- Messages: can owners read direct messages between workers?
- Messages: will brand contacts or drivers ever join the chat?
- Messages: who can send safety broadcasts (not built yet)?
- Inventory: who may move pallets (now everyone, always with a reason) and who may export reports?
- Counts: should counts be blind by default? Should a recount be required before a large correction is applied?
