# Multi-tenant WMS: design

Draft, 15 Oct 2026. How to turn the A3K Imports WMS into a service other warehouses can rent, without forking the code and without one customer ever seeing another's data. Nothing here is built yet; the app still keeps everything in an encrypted vault in the browser (see CLAUDE.md).

## Words used here

- **Tenant**: one warehouse company that rents the WMS (A3K Imports is tenant #1). Tenants are often food importers or distributors in the same area, so they may compete with each other. Isolation between tenants is the main promise of the product.
- **Client**: what the code already calls a brand owner whose stock a tenant stores (Deccan, Matco, Praj for A3K). Clients live inside one tenant. The future client portal gives client users a login *inside* their warehouse's tenant; a client is never a tenant.
- **Platform operator**: us, the company running the service. Operators are not users of any tenant.
- **Bridge model**: one shared app deployment for everyone, but each tenant's data in its own PostgreSQL database. Fully separate infrastructure ("silo") is a paid tier, not the default.

## Summary

1. One app build, one API, served at `<tenant>.<product-domain>`. The server works out the tenant from the web address, never from anything the browser sends in a request body.
2. One PostgreSQL database per tenant, all on one shared RDS instance, each with its own database login that can open only that database. A small separate **platform database** holds tenants, plans, billing, domains, feature flags and support grants, and no warehouse data.
3. Every session token carries the tenant ID; a token used at another tenant's address is refused and logged.
4. Each tenant has its own KMS key for its files, nightly backups and exports. Deleting a tenant ends with deleting its key.
5. Everything A3K-specific in the code today (rack layout, location-code format, brands, logos, label sheet, order inbox, sample people, shift times) becomes per-tenant **configuration**. Differences between customers are handled with config and feature flags, never with a fork or `if tenant == "a3k"`.
6. A3K goes live first as tenant #1 on the shared platform, so the multi-tenant paths are used from day one.

---

## 1. Audit: what is A3K-specific today

Found by searching `app/` and `scripts/` for A3K, a3kimports, brand and store names, `layout.json`, `labelLogos`, location-code building and parsing, the label sheet, the order inbox and the sample people. Line numbers are as of commit `70f4db1`.

The biggest finding: **A3K's data is compiled into the app bundle.** `products.json`, `layout.json` and `labelLogos.json` are imported at build time, so every copy of the app would ship A3K's 480 products, rack layout and brand logos to every tenant. In the multi-tenant app the bundle holds no tenant data at all; config and products are fetched after the tenant is known.

The second: **the home screen's update cards and ticker are canned A3K text**, not computed from stock (`Home.tsx:2`, `Ticker.tsx:2` import `sampleUpdates`/`TICKER_LINES` from `data/sampleUpdates.ts`). These must be computed from the tenant's own data before anyone else uses the app.

### Name and branding

| Where | What | Becomes |
| --- | --- | --- |
| `app/index.html:7` | `<title>A3K Warehouse</title>` | Product name in the HTML; the tenant's `appTitle` set at runtime from the public config |
| `app/src/pages/login/LoginScreen.tsx:14` | "A3K" mark and "A3K Warehouse" heading | `branding.mark`, `branding.appTitle`, optional `branding.logo` from the tenant's public config (fetched before sign-in; only name, logo and languages are public) |
| `app/src/i18n/es.ts:56` | Spanish for "A3K Warehouse" | Removed. Tenant names are never translated (same rule as brand names) |
| `app/package.json:6` | "A3K Imports warehouse management system" | Product description |
| `app/src/auth/crypto.ts:24`, `:32`, `:58` | `a3k-wms\|user`, `a3k-wms\|wrap\|v1`, `a3k-wms\|share\|v1` key-derivation labels | Not tenant config. These are fixed protocol constants; changing them breaks existing vaults. Keep them for the browser vault until the server replaces it. If the browser vault stays as an offline cache, add the tenant ID to the username hash input (`:24`) so the same username in two tenants hashes differently |
| `app/public/theme.js:3`, `app/src/settings.ts:71`, `:110`, `app/src/auth/vault.ts:19`–`22`, `app/src/i18n/index.ts:12`, `app/src/pages/outbounds/LabelsTool.tsx:19`, `app/src/pages/inventory/CountGrid.tsx:18`, `app/src/components/chat/HomeMessages.tsx:13` | `wms.*` keys in localStorage | Keep. Each tenant subdomain is its own browser origin, so storage never mixes. Tenants on a custom domain are also their own origin |

### Clients, brands and stores

| Where | What | Becomes |
| --- | --- | --- |
| `app/src/data/catalog.ts:5`–`6` | `type Client = "Deccan" \| "Matco" \| "Praj"` and `CLIENTS` | `Client` becomes a string ID; the list comes from the tenant's `clients` table. Every `Record<Client, …>` in the code turns into a map |
| `app/src/pages/inbounds/NewShipment.tsx:9`, `:15`, `:18` | Supplier per client hard-coded; Deccan is the default client | `clients[].defaultSupplier`; default client is the last one used, or none |
| `app/src/store/store.tsx:146` | A return without an order falls back to client "Deccan" | The return form asks for the client |
| `app/src/data/catalog.ts:53`, `app/src/store/demoStock.ts:26` | `DONOTUSE\|CROSSDOCK` in item text sinks a product | A product `inactive` / `special` flag in the tenant's products table (A3K's import sets it from the item text) |
| `app/src/pages/outbounds/OrderEditor.tsx:95`, `app/src/i18n/es.ts:243` | Placeholder "e.g. Patel Brothers – Edison" | Generic placeholder ("Store name and branch") |
| `app/src/i18n/es.ts:261` | "Deccan footer" | Footer labels come from label profile names, which are not translated |
| `app/src/settings.ts:79` | Migration for the old default user "karthik" | Delete before tenant #2 |

### Sample data and sample people

| Where | What | Becomes |
| --- | --- | --- |
| `app/src/chat/sampleChat.ts:8`–`14`, `:27`–`86` | Six sample people (Karthik, Maya, Leo, Nina, Omar, Tess), their channels, DMs and messages | **Demo seed**, loaded only into demo and sandbox tenants. Never in a production tenant. Note `:8`: "karthik" is a real owner's name and is not marked `sample`; rename the sample owner |
| `app/src/store/sample.ts:12`–`184` | Sample shipments, orders, returns, emails and tasks using A3K's brands and real store names | Demo seed with made-up brands and stores, so a prospect's demo never shows A3K's customers |
| `app/src/store/demoStock.ts:9`–`58` | Made-up stock built from A3K products | Demo seed, generated from the demo tenant's own products and layout |
| `app/src/data/sampleUpdates.ts:47`–`126`, used by `app/src/pages/Home.tsx:2`, `app/src/components/Ticker.tsx:2` | Home update cards and ticker: fixed A3K text with real store names | Computed from the tenant's orders, deliveries, stock and audit log (a server query), or hidden until then. **Must be fixed before tenant #2** |
| `app/src/auth/vault.ts:24`, `:126` | First account `admin` / `password` | Tenant creation emails an invite to the tenant's first owner, who sets their own password and two-factor. No default password exists anywhere |
| `app/vite.config.ts:41`, `app/src/store/sample.ts:12` | `sampleStock.json` (A3K's real sheet stock) kept out of the demo build | Goes away: no tenant data is ever compiled into the bundle |

### Rack layout and location codes

The layout (which racks, sides, columns, levels and bays exist) and the code format (`06B-08-L3-B1`, `06B-FLOOR-P01`, `D6A`, `1518A`, the named areas) are written into the code in many places.

| Where | What | Becomes |
| --- | --- | --- |
| `scripts/build_app_data.py:39`–`66` | A3K's rack list (`SIDES`, `JUNCTIONS`, column 12 shape) | A3K's `layout` config (section 4). The compact "rack, sides, columns, shape" form is kept: it is how an owner describes a warehouse |
| `scripts/build_app_data.py:67`, `:85` | Areas copied from the count sheets; `layout.json` written into the app | `layout.areas` in config; layout served by the API |
| `app/src/data/catalog.ts:3`, `:31`–`32` | `layout.json` imported at build time | Layout fetched with the tenant config after sign-in |
| `app/src/data/catalog.ts:62`–`65` | Slot code built as `${face}-${col:2}-L${level}-B${bay}` | One `slotCode()` helper driven by `layout.codeFormat` |
| `app/src/data/catalog.ts:70`, `:75` | Floor spots matched with `-FLOOR-P\d+$` | `floorCode()` / `parseFloor()` from `layout.codeFormat.floor` |
| `app/src/data/catalog.ts:79`–`83` | "Door 6" and "Junction 15/18" naming rules | `displayName` on each rack in config |
| `app/src/chat/refs.ts:6`–`9`, `:15`–`25` | Location-code regex hard-codes `D6[AB]`, `1518[AB]`, `1619[AB]`, sides A–C, the area names, and zero-padding of rack numbers | Regex generated from config (rack IDs, sides, areas, padding, accepted old forms). Validation still checks the code against the real slot list |
| `app/src/components/RackView.tsx:33`, `:58`; `app/src/components/inventory/WarehouseMap.tsx:60`; `app/src/components/chat/MapOverlay.tsx:193`; `app/src/components/inventory/SlotDetail.tsx:111`, `:164`, `:170`; `app/src/pages/inventory/StockTab.tsx:161`; `app/src/pages/inventory/CountGrid.tsx:164`–`165`, `:431`; `app/src/inventory/count.ts:7`; `app/src/store/demoStock.ts:42`, `:53`; `app/src/store/putaway.ts:77`–`78`; `app/src/store/tasks.ts:20`–`27`; `app/src/inventory/selectors.ts:13` | The same code format rebuilt by hand in each file | All call `slotCode()`, `floorCode()`, `areaSpotCode()` and `faceOf()` from one module. This refactor is mechanical and should come first (Phase 0) |
| `app/src/store/tasks.ts:5`, `app/src/components/tasks/TaskCard.tsx:12` | Receiving area is `RECV-FLOOR` | `layout.receivingArea` |
| `app/src/chat/presence.ts:23`, `app/src/store/types.ts:169` | "Receiving at Door N" | `layout.docks` (list of door names) |
| `app/src/store/putaway.ts:28`–`33` | Put-away preference order | `putaway.preference` and `putaway.lowerLevelsFirst` in config; same defaults |

### Labels

| Where | What | Becomes |
| --- | --- | --- |
| `app/src/outbound/labelsPdf.ts:1`–`7` | A3K's label sheet: US Letter, 3 × 2 in, 2 × 5, left 30.1625 mm, top 6.35 mm, gap 3.175 mm | `labels.sheets[]` in config; A3K's measured sheet is one entry. Several sheets allowed (a tenant may use Avery 5163 and a thermal roll) |
| `app/src/outbound/labelsPdf.ts:105`, `:109`, `:121` | `"letter"` page size | `sheet.page` (`letter`, `a4`, or width × height) |
| `app/src/outbound/labelsPdf.ts:4`, `:9`–`17` | `labelLogos.json` bundled; `BrandKey` limited to deccan / milletbank / other; colours and the Deccan footer hard-coded; `brandKeyFor()` matches by regex | `labels.profiles[]`: logo asset, colour, default footer, which brands use it. Logos are tenant files in S3, not in the bundle |
| `app/src/outbound/labelsPdf.ts:36` | Best-before printed in `en-US` month style | `tenant.locale` |
| `scripts/build_app_data.py:86`–`88`, `scripts/build_label_catalog.py:19`, `:51`–`64` | Logos and Millet Bank's 23 products from the Praj order form | A3K's one-time import (see below) |

### Orders, roles, shifts, expiry

| Where | What | Becomes |
| --- | --- | --- |
| `app/src/pages/outbounds/Inbox.tsx:13`, `app/src/store/types.ts:140` | `orders@a3kimports.com` | `orders.inbox` per tenant (section 2, "Order email") |
| `app/src/outbound/reader.ts:41`–`42` | Dates like 10/14/26 read as month/day (US) | `tenant.locale` decides month/day order |
| `app/src/outbound/plan.ts:6` | Default picking: finish open pallets first | `orders.pickingDefault` (`partial-first` or `fifo`), the per-order choice stays |
| `app/src/auth/permissions.ts:38`–`84` | Roles and what each may do | The three roles stay in code. Config may move a short, listed set of actions between roles (section 4, `roles`) |
| `app/src/store/types.ts:155`, `app/src/auth/accountUser.ts:8` | Groups `owners`, `coordinators`, `receiving`, `shift-am`, `shift-pm` | `owners` and `coordinators` stay built in; the rest come from `groups[]` and `shifts[]` in config |
| `app/src/settings.ts:63`–`64` | Shift 07:00–19:00 | `shifts[]` in config, in the tenant's time zone |
| `app/src/chat/selectors.ts:7`, `:9` | Expiry warning: six months for everything | `expiry.defaultWarnMonths` and `expiry.byCategory` (the owner already wants this per category) |
| `app/src/App.tsx:77`–`83` | Admin-only role switcher and "view as" | Section 3 |

### A3K-only scripts and tools

`scripts/dump_workbooks.py`, `scripts/build_count_data.py` (sheet names at `:43`, `:103`), `scripts/build_label_catalog.py`, `scripts/make_count_sheet.py` (`:15`, `:101`), `scripts/build_tools.py`, `scripts/legacy-labels/` and the published tools in `tools/` all read A3K's Google Sheets workbooks. They are not part of the product. Move them to `onboarding/a3k/` as A3K's one-time import, used for the go-live count, then retire them. The useful general idea (import products, layout and opening stock from spreadsheets) becomes a product feature: an import wizard that accepts a documented `.xlsx` template.

The stock workbook format in CLAUDE.md (tabs `Rack00`…`RACK20`, the grey headers) stays an A3K export option until their sheets stop on go-live day; no other tenant needs it.

---

## 2. Target architecture on AWS

```
                 a3k.<product>   bravo.<product>   ops.<product>
                        \              |                /
                         CloudFront + WAF (one app build, no tenant data)
                                       |
                         Load balancer → API + WebSocket service (ECS Fargate, shared)
                          |                 |                    |
             platform DB (tenants,    RDS PostgreSQL       S3: tenants/<id>/…
             plans, billing, flags,   one instance,        (photos, logos, PDFs,
             support grants)          one database         exports, backups),
                                      per tenant           each tenant's own KMS key
```

### Picking the tenant

- Each tenant gets `<slug>.<product-domain>`. A custom domain (e.g. `wms.a3kimports.com`) is a CNAME to the platform plus a certificate; it maps to the same tenant.
- The server looks up the tenant from the `Host` header in the platform DB (cached for a minute). Unknown host: a plain "not found" page that does not list tenants.
- The tenant ID is never taken from the request body, query string or a header the browser can set. It comes from the host, and the session token must agree with it.
- Slugs are chosen by the tenant and can be neutral (`wh-7f3k`), because a public subdomain tells competitors who uses the service.

### Shared app and API

- One React build on S3 + CloudFront for every tenant. It contains no products, layout, logos or names. After loading, it fetches `/api/tenant/public` (name, mark, logo, languages) for the sign-in screen, then `/api/tenant/config` and the product list after sign-in.
- One API and WebSocket service on ECS Fargate (long-lived WebSocket connections are simpler there than on Lambda). Every request runs inside a **tenant context** set once by middleware from the host and token; data access code cannot run without it.
- WebSocket connections are tagged with their tenant; messages and live stock updates are published on channels named `tenant:<id>:…`, and the fan-out refuses to deliver across tenants.
- Background jobs (nightly backup, order email, expiry alerts) carry the tenant ID in every job and open a connection for that tenant only.

### Databases

- **One RDS PostgreSQL instance** (Multi-AZ) holds one database per tenant, named `t_<tenant_id>`. Each tenant database has its own login role that owns it; `CONNECT` is revoked from `PUBLIC` on every tenant database, so tenant A's role cannot even open tenant B's database. The app never connects as a superuser.
- **Connections**: every app connection goes through **RDS Proxy, from day one** (decided 15 Oct 2026; see "Connections and RDS Proxy" below). Inside the app, a small pool per tenant database, opened on demand and closed when idle, under one connection budget per server task. A pooled connection is tied to one database for its whole life, so it can never be reused for another tenant.
- **Same schema everywhere**: the migration loop (below) runs every change against the platform database and then every tenant database, and records each one's version. A release waits until all tenant databases are migrated; there is one code path, never per-tenant schemas.
- **Platform database** (`platform`, its own role): tenants, domains, plans, subscriptions and invoices (billing provider IDs only, no card numbers), feature flags, operators, support grants, and the platform's own audit log. It holds no stock, products, orders or messages.
- **Silo tier**: the same database, moved to its own RDS instance (and optionally its own AWS account). Only the connection string in the platform DB changes; the code is the same.
- **Size**: one instance comfortably holds dozens of small warehouses. Watch connections and storage per tenant; move a heavy tenant to its own instance with the same steps as silo.

### Connections and RDS Proxy

PostgreSQL has a hard limit on open connections (`max_connections`, about 400 on a 4 GB instance), and each connection uses memory. With a database per tenant this matters more than usual: a connection to tenant A's database can't serve tenant B, so 50 tenants × a few connections × several server tasks would run out quickly and the database would start refusing everyone. So, from the first deploy:

- **RDS Proxy sits between the app and the database.** The app connects only to the proxy; the proxy holds the real connections and lends them out per request. Its cap (`MaxConnectionsPercent`, 70% of `max_connections`) is the most the database ever sees, whatever the app does. When the cap is reached, requests wait (up to 30 s) instead of the database falling over. Idle connections are closed (`MaxIdleConnectionsPercent`), so quiet tenants cost nothing. It also keeps connections across a Multi-AZ failover.
- **Sign-in to the proxy is by IAM**, not passwords: each server task signs a short-lived token for the tenant's database user. The proxy itself logs in to the database with one Secrets Manager secret per database user; creating a tenant adds its secret to the proxy. AWS limits how many secrets one proxy takes (check the current quota). The platform database records which proxy each tenant uses, so a second proxy can be added later without code changes.
- **The app has its own budget too** (`server/src/db/pools.ts`): at most 3 connections per tenant pool and 30 per server task in all. A tenant's pool closes after 10 s idle; when the budget is full, the least recently used idle pool is closed to make room, and if every pool is busy the request gets "busy, try again" (503) after a short wait rather than piling up.
- **Nothing that pins**: RDS Proxy can only share a connection between requests if the connection keeps no session state. So the app never uses session `SET`, temporary tables, `LISTEN`/`NOTIFY`, advisory locks or named prepared statements through the proxy. Per-tenant settings like `statement_timeout` are set on the tenant's database role instead (`ALTER ROLE … SET`). Live updates (WebSockets) don't need `LISTEN`; they go through the server.
- **What doesn't go through the proxy**: migrations and tenant creation (DDL and advisory locks) connect straight to the database as the migration role, one database at a time, from a one-off task.
- **Watch it**: CloudWatch alarms on the proxy's `DatabaseConnections` (over 80% of its cap), `ClientConnections` and borrow latency, and on the instance's `DatabaseConnections`.
- **Cost**: RDS Proxy is billed per vCPU of the database instance, with a 2-vCPU minimum: a small fixed monthly amount, worth it for this.

### The migration loop

One code path means one schema: every tenant database must be at the same version before new code serves it. `server/src/migrate/` does this:

1. Migrations are numbered SQL files: `server/migrations/platform/*.sql` for the platform database, `server/migrations/tenant/*.sql` for every tenant database. A file is never edited once it has run anywhere; each database records the file name and a checksum, and a changed checksum stops the loop.
2. Changes only **add** (new tables, new columns with defaults, new indexes built `CONCURRENTLY` in their own file). Renaming or dropping happens in a later release, once no running code uses the old shape. So the old code keeps working while databases change, and a half-finished rollout is safe.
3. The loop runs as a one-off ECS task before the new code is deployed: platform database first, then the tenants listed in the platform database, a few at a time (default 4 in parallel, so the instance isn't overloaded). Each database takes an advisory lock first, so two loops can never migrate the same database at once. Each file runs in its own transaction.
4. If one tenant fails, no new tenants are started, the ones in progress finish, and the deploy stops. Everyone keeps running the old code, which still works because migrations only add. The failure, its tenant and the file are recorded in the platform database (`tenant_migrations`) and printed.
5. After a fix, the loop runs again and skips what's done. New tenants are migrated by the same code when they're created.
6. Before a release, the loop runs against a copy of the largest tenant database (restored from its nightly dump) in staging.

### Data on the server (stock, orders, tasks, counts, messages)

Built 19 Oct 2026 (`server/src/shared/sync.ts`, `server/src/core/sync.ts`, `app/src/sync/`, tenant migration `0005_sync.sql`).

- **Pieces with versions.** A warehouse's data is stored one piece per row in its own database (`entities`): each slot's stock, delivery, return, order, task, inbox email, count, counted slot, message, read marker, conversation, presence, product edit, change-log line and movement. Each row has a version and the number of the change that last wrote it (`seq`).
- **The app's own logic decides, the server checks.** A device works a change out with the same code as the device-only app (`store/store.tsx`, `root`), then sends only the pieces that changed, with the versions it started from (`sync.push`). The server checks that the person's role has the switch for that kind of change and that the change touches only its kinds of piece (`ACTION_RULES`). If any piece changed in the meantime, the change is refused as a conflict; the device catches up and works it out again on the newer data, so two people taking cases off the same pallet never lose one of the changes. A change refused for permissions is dropped and the person is told.
- **Numbered in order.** Saving takes a row lock on `sync_state`, so change numbers follow commit order; devices catch up with "everything after N" (`sync.pull`, pages of 5,000 that never split a change). No `LISTEN`/`NOTIFY` or advisory locks (RDS Proxy pinning): devices ask every 2 s while the app is in front, 15 s behind it. WebSockets can replace the asking later without changing the data.
- **Privacy.** Direct messages, thread messages and read markers go only to the conversation's members (`audience`); channels and everything else to everyone in the warehouse. People write only their own messages, read markers and status, join or leave only themselves, never join someone else's direct conversation, and join an order or delivery thread only if they may see its client. The change log and movement log are never changed or removed, and their "by" is set by the server.
- **Within a warehouse, brand limits are still on the screen.** Every device receives the whole warehouse's stock (the put-away planner needs to know which slots are taken); other clients' stock shows as "hidden". Sending each person only their clients' stock is a later step.
- **Offline.** Changes wait on the device (encrypted with a key the server gives each person, `people.cache_key`, retired on "Sign out everywhere", a reset or turning the account off) and are sent when the connection is back; a change sent twice is saved once (`sync_log`, device change ids). Without a connection the saved copy can't be opened after a reload until the person signs in again; support sessions keep nothing on the device.
- **Time.** Each change carries the time it was made on the device; the server keeps both that and when it was saved.
- **Preview.** The preview runs the same code on PGlite shared between the browser's tabs (each tab signs in on its own), so two tabs are two people.

### Files and keys

- Files (damage photos, logos, uploaded order PDFs, exports, backups) go in S3 under `tenants/<tenant_id>/…`. The API hands out short-lived signed links scoped to one object; the bucket policy denies anything without the tenant's KMS key.
- **One KMS key per tenant**, created with the tenant. It encrypts that tenant's S3 objects, nightly dumps and exports. Its key policy allows only the app's role and the backup job.
- RDS storage encryption is per instance, so it cannot use a key per tenant; the separation inside the instance is the database and role. If a tenant needs more, fields like message text and damage notes can be encrypted in the app with a data key wrapped by the tenant's KMS key. This is a later option, not the default.

### Backups and export

- **Disaster recovery**: RDS automatic snapshots and point-in-time recovery for the whole instance, kept 14 days.
- **Per-tenant nightly backup**: a `pg_dump` of each tenant database, encrypted with that tenant's key, kept in `tenants/<id>/backups/` for 30 days (longer on higher plans). Restoring one tenant restores only that database, without touching anyone else.
- **Backup to the tenant's own storage**: A3K's NAS backup becomes a feature for every tenant. The tenant's own device pulls the nightly export over HTTPS with a backup-only token (read-only, export endpoint only, can be revoked). The platform never reaches into a customer's network.
- **Export on demand** (owners only): a `.zip` with one `.xlsx` and one `.csv` per table (products, slots, stock, shipments, orders, returns, counts, tasks, audit log, messages), the tenant config as JSON, and all files. Open formats so a customer can always leave with their data.

### Order email

- Each tenant gets an address on the platform's mail domain (`<slug>@orders.<product>`), received with SES and routed by address to that tenant's inbox only. A tenant can forward its own address (like `orders@a3kimports.com`) to it.
- `orders.trustedSenders` in config: mail from anyone else lands in the inbox marked "unknown sender" and is never turned into a draft order automatically.

### Offboarding

1. **Notice**: the tenant (or billing) asks to leave. The platform DB marks the tenant `leaving`; sign-in still works.
2. **Export**: a full export is made and the owners get a link (valid 30 days). They confirm they have it, or the 30 days pass.
3. **Suspend**: sign-in is turned off, the order email address bounces, the backup token stops working.
4. **Delete**: drop the tenant database and role, delete `tenants/<id>/` in S3, remove the domain and certificate, and schedule the tenant's KMS key for deletion (30-day waiting period). After the key is gone, any leftover copy of their files or dumps cannot be read.
5. **What remains**: the tenant's row in the platform DB (name, dates, invoices: needed for accounting) and the platform audit log. Their data also stays inside the shared instance's automatic snapshots until those age out (14 days); the contract says so.
6. Every step is logged in the platform audit log, and the owners get an email when deletion is finished.

---

## 3. Sign-in, sessions and support access

### Tenant users

- Accounts live in the tenant's own database, so they belong to the customer and go with an export. A username is unique within a tenant; the same username can exist in two tenants as two different people.
- Sign-in happens only at the tenant's address. Password rules stay as today (12+ characters, not common, not containing the username), with two-factor for everyone (owner decision: authenticator app first, passkeys later).
- **Session**: a random session ID in a host-only cookie (`__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain`), so the browser never sends one tenant's cookie to another subdomain. The server-side session row stores tenant ID, user ID, role, the support grant (if any), created and last-seen times. If short-lived tokens are needed (WebSockets, mobile offline sync), they are signed and include `tenant_id`, `user_id`, `session_id` and expiry.
- **Every request** checks that the session's tenant equals the host's tenant. A mismatch is refused, logged in the platform audit log, and counts towards an alert.
- The idle and maximum session times stay as today (30 min idle / 12 h, or 7 / 30 days with "Keep me signed in"), adjustable per tenant within platform limits for shared warehouse devices.
- Lockout counters move to the server, per tenant and username.

### The tenant's own admin

- When a tenant is created, its first owner gets an invite. That owner holds the **account admin** permission: approve and reject account requests, assign roles and which clients a person may see, reset passwords, turn accounts off. This is today's `admin` flag (`app/src/auth/vault.ts:45`), now one or more people per tenant instead of the single built-in `admin` account. An account admin can give or take the permission from another owner; the last one cannot remove it from themself.
- A tenant's admin can never see or do anything outside their tenant. There is no cross-tenant role inside the app.

### Platform operator support access

Operators sign in at `ops.<product>`: their own accounts in the platform DB, hardware-key two-factor required, no accounts in any tenant database. Operators can see the tenant list, plans, health and billing, never warehouse data, unless the tenant grants access:

- **Grant**: the operator opens a request with a reason and ticket number; an account admin of the tenant approves it in Settings → Support access (or starts one themself when asking for help). The grant says how long (default 1 hour, at most 24), and whether it is read-only (default) or may change things.
- **Emergency access** without approval exists only for outages, needs a second operator to approve, and emails every tenant owner at once.
- **While it lasts**: the tenant's app shows a banner to every owner ("Support (Jane, <product>) has access until 15:30 · End now"). Any account admin can end it at once.
- **Logged on both sides**: every action goes into the tenant's own Logs as "Support: Jane (ticket 4821)" and into the platform audit log. The tenant can see and export that history; operators cannot delete it.
- When the grant ends, the support session ends with it, including open WebSocket connections.

### What happens to today's admin switcher

Today the built-in `admin` account can, for testing, use the app with another role as itself, or "view as" any person, with changes logged as "Admin (testing as worker)" / "Admin (viewing as Omar)" (`app/src/App.tsx:77`–`83`). In the SaaS:

| Today | Becomes |
| --- | --- |
| "Test as a role" (Owner / Coordinator / Worker) | Kept for the tenant's account admins, inside their own tenant: useful to check what a coordinator sees. **Read-only** while switched, so testing never changes real stock. Logged when switched on and off |
| "View as a person" | Kept for account admins inside their tenant, also read-only, logged as today ("Maya (viewing as Omar)"). The person sees it in their own activity |
| The same switch used for support | Support uses the same plumbing (`setActor`), but only through a support grant, and the actor name always says "Support: …" |
| Six sample people, "Reset sample data" | Only in **demo and sandbox tenants**. A production tenant never gets sample people and has no reset button |
| Only the account named `admin` can switch | The permission is "account admin", given per person; there is no special username |

---

## 4. Tenant config

Stored in the tenant's own database (it is the tenant's data and goes with an export), with every change kept and logged in the tenant's Logs. Checked against a JSON Schema on save. Plans, feature flags, domains and billing live in the platform DB, not here. Products are data in the products table, not config.

A3K's config, shortened:

```json
{
  "schemaVersion": 1,
  "tenant": {
    "name": "A3K Imports",
    "timezone": "America/New_York",
    "locale": "en-US",
    "unit": "case"
  },
  "branding": {
    "appTitle": "A3K Warehouse",
    "mark": "A3K",
    "logo": "asset:7c1e…"
  },
  "languages": { "default": "en", "enabled": ["en", "es"] },

  "layout": {
    "codeFormat": {
      "slot": "{face}-{col:2}-L{level}-B{bay}",
      "floor": "{face}-FLOOR-P{n:2}",
      "areaSpot": "{area}-P{n:2}",
      "padRackNumber": 2,
      "acceptUnpadded": true
    },
    "columnShapes": {
      "standard": { "levels": [1, 2, 3, 4], "bays": 2 },
      "top-three-bay": { "levels": [3, 4], "bays": 3 }
    },
    "racks": [
      { "id": "D6", "displayName": "Door 6", "pad": false, "sides": "AB", "columns": 6, "shape": "standard" },
      { "id": "0", "sides": "ABC", "columns": 10, "shape": "standard" },
      { "id": "1", "sides": "AB", "columns": 13, "shape": "standard", "columnShape": { "12": "top-three-bay" } },
      { "id": "2", "sides": "A", "columns": 13, "shape": "standard", "columnShape": { "12": "top-three-bay" } },
      { "id": "17", "sides": "A", "columns": 8, "shape": "standard" },
      { "id": "1518", "displayName": "Junction 15/18", "pad": false, "sides": "AB", "columns": 1, "shape": "top-three-bay", "junction": true }
    ],
    "slotOverrides": { "add": [], "remove": [] },
    "areas": [
      { "id": "NEARCOOLER-01", "name": "Near cooler 1" },
      { "id": "LINE-2-3", "name": "Between line 2 & 3" },
      { "id": "RECV-FLOOR", "name": "Receiving floor" }
    ],
    "receivingArea": "RECV-FLOOR",
    "docks": ["Door 2", "Door 3", "Door 6"]
  },

  "clients": [
    { "id": "deccan", "name": "Deccan", "defaultSupplier": "Deccan Foods", "labelProfile": "deccan" },
    { "id": "matco", "name": "Matco", "defaultSupplier": "Matco Foods" },
    { "id": "praj", "name": "Praj", "defaultSupplier": "Praj Natural Foods", "labelProfile": "milletbank" }
  ],

  "labels": {
    "sheets": [
      {
        "id": "a3k-3x2", "name": "3 × 2 in, 10 per sheet",
        "page": "letter", "labelWidthMm": 76.2, "labelHeightMm": 50.8,
        "columns": 2, "rows": 5,
        "leftMm": 30.1625, "topMm": 6.35, "gapXMm": 3.175, "gapYMm": 3.175
      }
    ],
    "defaultSheet": "a3k-3x2",
    "profiles": [
      { "id": "deccan", "name": "Deccan", "logo": "asset:…", "color": "#9b1c23",
        "footer": "Product of India\nDistributed By: Deccan Foods, USA", "brands": ["Deccan"] },
      { "id": "milletbank", "name": "Millet Bank", "logo": "asset:…", "color": "#4b5d27", "brands": ["Millet Bank"] }
    ]
  },

  "roles": {
    "start-count": ["owner"],
    "approve-count": ["owner"],
    "decide-return": ["owner"],
    "export": ["owner", "coordinator"],
    "workers-see-inventory": true,
    "last-online-visible-to": "owners-coordinators"
  },
  "groups": [ { "id": "receiving", "name": "Receiving" } ],
  "shifts": [
    { "id": "shift-am", "name": "AM", "start": "07:00", "end": "15:00" },
    { "id": "shift-pm", "name": "PM", "start": "15:00", "end": "23:00" }
  ],

  "orders": {
    "inbox": "a3k@orders.<product>",
    "forwardedFrom": ["orders@a3kimports.com"],
    "trustedSenders": ["*@patelbros.example"],
    "pickingDefault": "partial-first"
  },
  "expiry": { "defaultWarnMonths": 6, "byCategory": { "Rice": 6, "Snacks": 2 } },
  "putaway": {
    "preference": ["same-product", "same-brand", "same-client", "any"],
    "lowerLevelsFirst": true,
    "overflow": "floor-of-busiest-side"
  },
  "exports": { "stockWorkbookTemplate": "a3k-sheets" }
}
```

Notes on the fields:

- **`layout`** keeps the owner's way of describing a warehouse (rack, sides, column count, column shape) and the server expands it into the slot list. `slotOverrides` covers one-off oddities (a missing bay behind a pillar, a short column by a door) without new shape rules. The expanded A3K layout must give exactly today's 3,662 codes.
- **`codeFormat`** drives building, reading (the chat regex, the move box, count paste) and checking codes. Reading always ends with "is this a real slot in the layout?", as `normalizeLocation` does today.
- **Changing the layout** when stock exists: removing or renaming a slot that holds stock is refused until the stock is moved; renames are applied as a logged move. Layout changes are owner-only.
- **`roles`**: the three built-in roles (Owner, Coordinator, Worker) with switches for a listed set of actions, **plus roles the warehouse makes itself** (user, 16 Oct 2026): a name (e.g. "Night lead", "Receiving clerk") and the same switches. A handful of powers stay with owners and can't be switched on for any other role, so nobody can give themselves more: managing people and roles, adjusting stock directly, deciding returns, support access, exports of everything, and deleting data. Each tenant's answers to CLAUDE.md's open questions (who starts counts, whether workers see inventory) become these settings.
- **`languages`**: Spanish is on for A3K. Turning it off hides the language switch. New languages are added to the product for everyone, never per tenant.
- **Assets** (`asset:…`) are files in the tenant's S3 folder, shown through signed links.

---

## 5. Customising per customer: config and flags, never forks

Every customer runs the same code at the same version. A customer request is handled by the first of these that fits:

1. **Config**: if it is a difference in data or settings (their layout, their codes, their label sheet, their shifts, who may start counts), it goes in the tenant config, with a sensible default for everyone else.
2. **Feature flag**: if it is a capability some customers pay for or want switched off (Messages, forklift mode, count module, PDF order reader, order email, client portal, Spanish, custom domain, silo, app-level field encryption). Flags live in the platform DB: the plan sets the defaults, a per-tenant override can switch one on or off. The app reads them from `/api/tenant/config` and checks them through one helper (`has("messages")`), the same way permissions go through `can()` today.
3. **Extension point**: if it needs code, build it as a general option every tenant could turn on: an order-slip reading profile, an import template, a label layout, an export format. A3K's stock workbook export is the first example (`exports.stockWorkbookTemplate`).
4. **No**: if none of these fit, it is not built for one customer alone.

Rules:

- No tenant IDs, tenant names or customer brand names in the code. A CI check searches `app/src` and the server for every tenant slug and for strings from a list of known customer names, and fails the build if it finds one (tests and demo seeds excepted).
- Flags are also how new features roll out: platform sandbox first, then A3K, then everyone. Every flag has an owner and is removed once it is on for all tenants.
- Old flags and config fields are migrated, never left for "just this customer".
- A tenant can see its config and flags in Settings (owners), so nothing about their setup is hidden from them.

### Changes found on a site visit

The business plan says we "modify the base WMS if necessary" for each new customer. That means changing **the one shared WMS**, never making a copy for that customer:

1. At the survey, write each need down in their words ("our racks have 5 levels", "we need pallet labels with the PO number", "orders come by fax").
2. Sort each one with the list above: config, a flag, a general extension point, or no. Most rack and label differences are config and need no code at all.
3. If it needs code, build it in the shared code, switched **off by default** with a feature flag, and switch it on for that customer. Every other warehouse keeps working exactly as before. If it later helps others, switch it on for them too.
4. Give the customer a date for each change before go-live, and list them in the sign-off.

Why not a separate copy per customer: with ten copies, every bug fix, security fix and update has to be made ten times, and the copies drift apart until one is left behind unpatched. Competing warehouses trust us with their data because every one of them gets the same security fixes on the same day.

Charge for the work this creates: the setup fee covers the visit and config; a change that needs new code is quoted separately, or included when it's one we wanted to build anyway.

---

## 6. Phased plan

### Phase 0: separate A3K from the code (browser app, no server)

**Progress (15 Oct 2026)**: done: tenant config and loader (`app/src/tenant/`, `app/public/tenants/a3k/`), products, layout and logos out of the bundle, location codes in one module, clients, groups, label sheet and profiles, order inbox, expiry warning, languages and branding from config, and a test that A3K's config gives the same 3,662 slots and code reading as before (`tests/tenant-layout.test.js`). Then: home cards and ticker computed from data; sample data moved into each warehouse's optional `seed.json` (A3K's for testing, deleted at go-live); a made-up `demo` warehouse (own racks, code format, label sheet, brands, logos and people) that the public demo site now serves; saved data on a device kept apart per warehouse; the old `karthik` settings migration removed; tests that every seed points at things that exist and that the demo has nothing of A3K's (`tests/tenant-seed.test.js`). The default `admin` / `password` account is now the demo's only: elsewhere a new device asks the first person to make the owner account (19 Oct 2026).

- Put the location-code logic in one module and replace the hand-built codes listed in section 1.
- Turn `Client` into a string, `BRANDS` into label profiles, `GroupId` and shifts into config.
- Load a tenant config file at runtime instead of importing `layout.json`, `products.json` and `labelLogos.json`. A3K's config reproduces today exactly.
- Compute the home update cards and ticker from data; move sample people, orders and stock into a demo seed with made-up brands and stores.
- Remove the `karthik` migration and the default `admin` / `password` path for non-demo builds.
- Write a second, made-up config (a cold store with a different layout, A4 labels, no Spanish) and run the demo with it.
- **Checks**: A3K's config gives the same 3,662 slot codes; `normalizeLocation` gives the same answers for a list of real and invalid codes; label PDFs are byte-identical to today's for the same input; the built bundle contains no A3K product names, logos or store names.

### Phase 1: server, with A3K as tenant #1

**Progress (16 Oct 2026)**: built and tested (not deployed): the server's tenant routing, connection budget and RDS Proxy setup; the migration loop; sign-in with an authenticator code, sessions, invite and reset links; people, roles and switches with named custom roles; account requests; support access with owner approval, one-time links and emergency access; the ops console (warehouses, setup checklist, restoring owner access, creating warehouses, team, activity, errors); the warehouse's Team page; the app signing in with the server. Tests run on PGlite (PostgreSQL in WebAssembly) inside the test process, and the preview runs the same code in a browser. Then (19 Oct): stock, orders, tasks, counts and messages on the server with offline sync (section 2, "Data on the server"). Also built 19 Oct, not deployed: loading a warehouse (Team → Setup: our team's settings, products and logos files, the `.xlsx` template for products and opening stock, or the go-live count; `server/src/core/setup.ts`); the isolation tests of section 7 that run without AWS (`server/test/isolation.test.ts`: every method refused across warehouses, marker data never crossing, 1,200 interleaved requests, guessed ids, host-only cookies); nightly per-warehouse backups with their own keys, kept 35 days, an alarm on failure and an optional read-only NAS user (`server/src/ops/backup.ts`, `infra/lib/data-stack.ts`); the owner's copy of everything (Team → Setup); order emails per warehouse through SES (`server/src/core/inbound.ts`); the public page with "Book a visit" and the console's Visits (`app/src/landing/`, `server/src/core/site.ts`). Next: the AWS account, domain and first deploy (docs/aws-setup.md); then WebSockets instead of asking every 2 s, sending each person only their clients' stock, texts and emails for urgent messages and expiry.

**Everything runs on AWS** (user, 15 Oct 2026): no database or server on anyone's computer. There are two AWS environments, `staging` (sandbox tenants and made-up data, cheaper settings) and `prod`, built from the same code (`infra/`, AWS CDK). Changes are deployed from GitHub Actions by hand (`.github/workflows/deploy-aws.yml`, never on every push), using an AWS role the workflow can assume without stored passwords. The code is written and checked here (tests, `cdk synth`), but only runs in AWS.

- Build the platform DB, one tenant database, the API and WebSockets, sign-in with two-factor, and tenant context middleware from day one, even with one tenant.
- Load A3K: config from Phase 0, products and opening stock from the 3-day go-live count (via `onboarding/a3k/`).
- Nightly per-tenant backup, export, and A3K's NAS pulling it.
- Order email for A3K (forwarded from `orders@a3kimports.com`).
- A3K goes live as `a3k.<product>` (or `wms.a3kimports.com`). The spreadsheets stop that day, as planned.
- Add a second, internal **sandbox tenant** at the same time, so every release runs with two tenants.

### Phase 2: the second customer

- Tenant creation as a script and runbook: database and role, KMS key, S3 folder, domain, config from a template, first-owner invite.
- Support access with grants, banner and logs; the `ops` site.
- Offboarding runbook, tested end to end on a throwaway tenant.
- Billing (a provider such as Stripe; the platform DB stores only its IDs).
- The import wizard for products, layout and opening stock from a documented `.xlsx` template.
- An outside penetration test focused on crossing tenants, before the second customer's data goes in.

### Phase 3: grow

- Plans and flags in the ops site, custom domains, silo tier, app-level encryption option.
- Client portal (client users inside a tenant, limited to their client).
- Move busy tenants to their own instance when needed.

---

## 7. Verifying tenant isolation

These run in CI against at least two tenants (A and B) seeded with unique **canary** values (product names, store names, message text) and must pass before every release:

- **Wrong tenant address**: every API endpoint called with A's session at B's host is refused (401) and logged. Same for WebSocket connections.
- **Guessed IDs**: A's session asking for B's order, slot, file or message IDs gets "not found"; never data.
- **Database roles**: A's database role cannot connect to B's database; the app role is not a superuser; `CONNECT` is revoked from `PUBLIC` on every tenant database.
- **Pool mix-ups**: thousands of interleaved requests for A and B in parallel; every response is checked for the other tenant's canaries.
- **Live updates**: a client subscribed as A receives nothing when B's stock or messages change.
- **Files**: a signed link for A's object cannot be changed to read B's; B's KMS key cannot decrypt A's backup.
- **Caches and jobs**: every cache key and job payload includes the tenant ID (code check plus test); the nightly backup of A contains no B canaries.
- **Exports and reports**: A's export, stock report and logs are scanned for B's canaries.
- **Order email**: mail sent to A's address appears only in A's inbox.
- **The bundle**: the built app and the CDN contain no canaries and no A3K data (extends today's rule that the demo build never includes the sheet stock).
- **Support access**: refused without a grant; ends on time; every action shows in the tenant's Logs; emergency access emails the owners.
- **Offboarding**: after deletion the database, role, S3 folder and domain are gone and the key is scheduled for deletion; a restore attempt from a tenant dump fails.
- **Inside a tenant**: today's client-visibility rules (`canSeeClient`, `visibleLines`) keep their own tests; a worker limited to Deccan still sees other clients' stock only as "hidden".

Outside CI: the penetration test before tenant #2, then yearly; an alert on any refused cross-tenant request.

---

## 8. Adding a new warehouse (onboarding)

**Business plan (user, 15 Oct 2026):** every new customer is set up by our own team on site. We visit the warehouse, check the racks and floor ourselves, enter all the setup information, collect their product codes and lists, and change the base WMS where they need something it can't do yet. The customer does not set the system up themselves.

A new warehouse starts with an **empty** database at the current schema. Nothing from A3K or any other tenant is copied in, not even a brand both warehouses happen to store: if Deccan uses two of our customers, each keeps its own Deccan products. What a new tenant does get is the product's defaults: a starter config (standard column shape, the three roles, common label sheets such as Avery 5163, English with Spanish available).

Until go-live the tenant is in **setup mode**: practice stock and orders are allowed, and are cleared on go-live day (logged); config, products and accounts stay.

### Our team's access during setup

Our staff work inside the customer's tenant, so they need access, but the same rules as support (section 3) apply:

- An **onboarding grant** starts when the contract is signed and ends at go-live (or earlier if the owner ends it). The customer's owner approves it, can see it in Settings → Support access, and can end it at any time.
- Each of our people uses their own named account with two-factor, never a shared login. Everything they do shows in the tenant's Logs as "Onboarding: <name>".
- After go-live, our access drops to normal support grants (time-limited, approved each time).

### Handling their data

Our team sees several competing warehouses' products, stock and customers. So:

- Everyone on the team signs a confidentiality agreement, and the customer's contract says what we may and may not do with their data.
- Data goes **straight into their tenant**: entered on the tablet in the app, or uploaded into their tenant's import screen. No copies on personal laptops, phones or USB sticks, and no customer files in email threads or shared drives. Photos of their racks and order slips are taken in the app and saved in their tenant's folder.
- Nothing learned at one warehouse is used at another: no copying another customer's product list as a starting point, even for the same brand.

### The steps

1. **Before the visit** (operator, about 10 minutes with the script): create the tenant (database and role, KMS key, S3 folder, domain, starter config), the owner's invite, and the onboarding grant. Ask the customer for what they already have: product lists, a stock spreadsheet, floor plan, sample order slips and packing lists, the labels they use.
2. **Site survey** (our team, on site): walk every rack and floor area with the tablet and enter the layout in the compact form from section 4 (racks, sides, columns, column shapes, floor areas, docks, the code format). The app draws the map as we go, so mistakes show on the spot. Measure and print-test their label sheet until it lines up. Note anything they need that the WMS can't do yet (see "Changes found on a site visit" in section 5). The owner signs off the map before we leave.
3. **Products**: we import their lists through the `.xlsx` template, mapping their columns to ours: code, name, client, brand, category, size, units per case, cases per full pallet. The importer shows every problem (duplicate codes, missing client, a size it can't read) and saves nothing until confirmed. We fix the problems with the customer, not by guessing. Re-importing updates by code and never deletes a product that has stock.
4. **Clients, people and settings**: their clients with logos and label footers, shifts, the `roles` settings, the order email address and trusted senders. The owner gets their invite and adds or approves their staff.
5. **Opening stock**:
    - Import their current stock list (location, product, cases, lot, best-before, arrival) as a starting point, with their old location names mapped to the new codes (as A3K's old `6B-08-L3-B1` became `06B-08-L3-B1`).
    - Then a **full count** with Count mode, done by their workers with our team there to train and help, as in A3K's go-live plan (one count over a few days, the old system stops that day). With the import loaded first, the count only shows differences. Missing arrival dates are set to the count date, so FIFO starts from there. The owner approves the count; the numbers are theirs.
6. **Cut-over**: open orders and expected deliveries go in; old history is kept as attached files (Settings → Documents), not loaded into the stock log, which starts at go-live. Setup mode ends, practice data is cleared, the onboarding grant ends.

What counts as done (signed by the owner): the map matches the floor, labels print aligned, the count is approved, one real order has gone from draft to shipped, and every change promised at the site survey is either live or has a date.

Customers moving from another WMS get the same templates; we write a one-off conversion from their system's export into our templates, kept out of the product code (as `onboarding/a3k/` is for A3K).

### Tools our team needs for this

- A layout editor that works on a tablet on the warehouse floor, with the live map.
- The product and stock importers with column mapping and a problem list.
- An onboarding checklist per tenant in the `ops` site (survey done, map signed off, products in, labels tested, count approved, go-live), so nothing depends on memory.
- A site-survey form for the questions to ask every time: rack types, odd columns, floor areas, docks, label printer, who approves what, which clients they store, how orders arrive today.

---

## 9. Maintenance

Every tenant runs the same version, so maintenance is done once for everyone.

### Releasing changes

- Changes go through GitHub as today: a pull request, CI (the unit tests, the isolation tests from section 7, a type check and a build), then review.
- A merged change goes to **staging** first, which has only sandbox tenants with made-up data. Then production, as a rolling update: the new version starts beside the old one and takes over when healthy, so nobody is signed out and nothing stops. The app already reloads itself to the new version (`utils/freshLoad.ts`).
- Releases go out at a quiet time in the tenants' time zones. Small releases often (weekly) are safer than big ones rarely.
- Anything that changes how people work goes behind a feature flag: sandbox first, then A3K, then everyone, with a "What's new" note in the app (in English and Spanish).
- Phones that were offline may come back on an old version. The API accepts the previous version's requests for at least one release, and tells older apps to reload.

### Database changes

- A migration runs against every tenant database in turn, before the new code goes live. Migrations only **add** (new tables, new columns with defaults); removing or renaming something happens in a later release, once no running code uses it. That way the old code keeps working while the databases are changed.
- If a migration fails on one tenant, the rollout stops there. Everyone stays on the old code, which still works, while it is fixed. One tenant is never left on a different schema than the code expects.
- Migrations are tested on a copy of the largest tenant database before release.

### Watching it

- Health checks, error reports and per-tenant numbers (requests, errors, database size, connections, slow queries) in CloudWatch. Error reports from the app go to our own API, keeping the rule that the app makes no outside requests.
- Alerts to whoever is on call: the API down, errors rising, the database nearly full, a nightly backup missed, any refused cross-tenant request.
- A status page customers can check, and an email to tenant owners for planned work.

### Keeping it safe and current

- Library updates checked weekly (Dependabot); security fixes within a few days.
- AWS updates: RDS minor versions in a weekly maintenance window (early Sunday morning, US Eastern); with Multi-AZ the database is away for a minute or two, and phones keep working offline and sync after. Server images rebuilt monthly.
- KMS keys rotate automatically every year. Operator accounts are reviewed every quarter; anyone who leaves loses access the same day.
- A restore drill every month: one tenant's nightly backup, chosen at random, restored into a scratch database and checked (row counts, a stock total). A backup that has never been restored doesn't count.
- Penetration test yearly and before major changes to sign-in or tenant handling.

### Restoring a warehouse

A night's backup is `tenants/<id>/backups/<date>.dump` in the files bucket (PostgreSQL's own format, encrypted with the warehouse's key). To look at it or bring a warehouse back: run the one-off task with a command override (as for the first console account) that downloads the file, creates an empty database (`createdb t_<id>_restore`) and runs `pg_restore --no-owner --dbname=t_<id>_restore <file>`; check it, then in a quiet hour rename the databases so the restored one becomes `t_<id>`. (A ready-made restore command is a follow-up.) The database's own snapshots (14 days) restore the whole instance instead, every warehouse at once. Practise once on the sandbox warehouse before go-live.

### Per-tenant work

- Config changes (a new rack, a new label sheet, a role setting) are made by the tenant's owners in Settings. Support helps only through a support grant (section 3).
- Restoring one tenant to an earlier point, moving a busy tenant to its own instance, and offboarding are written runbooks, run by an operator and logged in the platform audit log.
- Support requests come in by email or from the app; plans set how fast we answer.

### Who does it

At first: the developer (with Claude Code) as operator and on call, with the runbooks kept in this repository. Once there are more than a few tenants, a second person on call is needed, so no customer depends on one person being reachable.

---

## Decisions so far (product, 16 Oct 2026)

- **Landing page**: the product's public site has a "Book a visit" form only (built 19 Oct: `app/landing.html`; requests in the console under Visits). Warehouses never sign themselves up; the operator creates each one from the ops console after the contract (matches the on-site onboarding plan, section 8).
- **Roles**: three built-in roles plus switches, and warehouses may add their own named roles built from the same switches (section 4, `roles`), with the owner-only powers kept out of reach: changing stock directly, deciding returns, applying count corrections, deleting counts, managing people and roles, warehouse settings, support access and the security log.
- **Product name and domain**: not chosen yet. One domain for the product, a subdomain per warehouse (`a3k.<domain>`); a warehouse's own domain is a paid extra.

## Open questions

- Product name and domain (the platform's own, separate from `a3kimports.com`).
- Does A3K stay on the shared instance or pay for silo, given they are the first and largest tenant?
- Which customer data must stay in the US, and do any customers need it written into the contract?
- How long to keep per-tenant backups on each plan, and how long the export link stays valid after leaving.
- Is read-only support access enough for most tickets, or do operators need to change data often?
- Should tenants be able to see each other exists at all (e.g. a shared "find a warehouse" listing)? The default is no.
- Price per plan, and which features are flags on which plan.
- Onboarding: what the setup fee covers (visit, data entry, count support), how far we travel, and how custom code is quoted.
- Onboarding: who on our team goes on site, and which confidentiality agreement they sign.
- Maintenance: who is the second person on call, and what response times do we promise on each plan?
