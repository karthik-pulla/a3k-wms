# Warehouse Management System (WMS)

A warehouse (A3K Imports) stores goods for several brands (Deccan, Matco/Falak, Anaganaga, Karachi-NKB, Millet Bank via Praj Natural Foods, and others). Brands send stock in; stores such as Patel Brothers, Balaji and Patidar order it out. Today it runs on Google Sheets: one workbook per brand, one tab per rack, recopied for every count. This project replaces that with a WMS: an installable web app on AWS, with a nightly backup to an in-house NAS.

Users: two owners plus warehouse workers who see less. Clients (brands) get their own logins to the client portal (`<warehouse address>/portal`) to place orders and announce deliveries; they see only their own products and what they sent.

Sources of truth, newest first: this file and `docs/design-notes.md`, then the owner's plan PDF (`WMS Plan-2.pdf`, Oct 2026), then the earlier plan doc https://claude.ai/code/artifact/a4a12e35-975f-4371-a3dc-90313c6c0a7e.

## Folder map

| Path | What it is |
| --- | --- |
| `data/source/` | Real inputs: the stock workbooks, logos, order-slip photos, a Deccan label example. Business data. Never edit or delete. |
| `data/csv/` | One CSV per workbook tab, made by `scripts/dump_workbooks.py` |
| `data/generated/` | `count.json` (rack layout, products, last sheet counts) and `label-catalog.json` (label products + logos) |
| `scripts/` | Python build steps, run in order by `npm run build` |
| `scripts/legacy-labels/` | One-off Millet Bank label scripts, superseded by the Label Maker |
| `app/` | The full WMS web app (React + TypeScript + Vite). `app/src/pages` holds screens (`pages/inbounds/`, `pages/inventory/`, `pages/outbounds/`, `pages/messages/`), `app/src/outbound/` picking plan, order reader and label PDFs, `app/src/components` shared pieces, `app/src/store/` app state, sample data and the put-away rules, `app/src/inventory/` stock and count helpers, `app/src/chat/` the Messages data layer. |
| `app/public/tenants/a3k/` | A3K as a tenant (warehouse) of the WMS, loaded by the app at startup. `config.json` (written by hand: rack layout, location-code format, clients, label sheet and logo profiles, groups, order inbox, expiry warning, languages, name), `products.json` (480 products with client), `logos.json` (brand logos for case labels) and `stock.json` (SAMPLE stock: the 27 Sep sheets moved onto the new codes; never on GitHub), made by `scripts/build_app_data.py`, never edit those by hand; `seed.json` (sample deliveries, orders, returns, emails, people and messages for testing; real store names; delete before go-live). |
| `app/public/tenants/demo/` | The made-up demo warehouse for the public demo site: its own racks (five-level high bay), code format (`03A-07-L2-B1`, like A3K's; `03B-F01`), label sheet, brands (Sunfield, Golden Field, Blue Lotus, Ridge, Crunchy Bay), logos, people and sample data. All hand-written (made with throwaway scripts); nothing real. |
| `app/src/home/` | The home screen's update cards, worked out from the store (`updates.ts`). |
| `app/src/help/`, `app/src/pages/help/` | The first-time tour (`Tour.tsx`) and Help (`#/help`): the map of the software and "how do I…" guides (`content.ts`). |
| `app/src/pages/manage/` | Manage warehouse (`#/manage/<tab>`, owners): Warehouse (name, picking rule, announcements), People (the server's people/roles/requests from `pages/warehouse/`), Racks (layout; slot codes read-only), Clients (contacts, email routing), Logs, Support, Setup. |
| `app/src/tenant/` | The tenant config types (`types.ts`), loading (`index.ts`) and `layout.ts`, the only place location codes are built or read. |
| `server/` | The WMS server (Node + TypeScript, Fastify), run on AWS ECS Fargate only: tenant from the Host header (`src/tenancy.ts`), every database connection through RDS Proxy with IAM sign-in under a per-task budget (`src/db/pools.ts`), the migration loop (`src/migrate/`, SQL in `migrations/platform/` and `migrations/tenant/`), tenant creation (`src/ops/createTenant.ts`) and the first console account (`src/ops/firstOperator.ts`), the nightly backup (`src/ops/backup.ts`) and order emails (`src/ops/inbound.ts`, `src/ops/inbound-worker.ts`). `src/core/` is the sign-in, accounts, roles, support, product-list (`products.ts`; codes may repeat, a product is its id) and ops-console logic (Web Crypto only, no Node imports: the app's preview runs it in the browser); `src/shared/` the switches (`permissions.ts`), password rules and API types, shared with the app; `src/app.ts` the web layer; `src/core/sync.ts` keeps stock, orders, tasks, counts and messages (rules in `src/shared/sync.ts`). |
| `app/landing.html`, `app/src/landing/` | The product's public page at `<domain>` (Lattice): minimal pages (Home, Features, How it works, Your data, Book a visit; `#/features` …) reached from the logo's square, which spins and drops a grey vertical menu when hovered or tapped; small looping feature animations (`FeatureArt.tsx`, still when less motion is asked for). "Book a visit" requests go to the console's Visits (`server/src/core/site.ts`). Only in server builds and the demo site; in the preview at `/landing.html`. |
| `app/src/setup/` | The setup template (`.xlsx`) and reading it back (`importSheets.ts`): products and opening stock, checked row by row. Used on Team → Setup. |
| `app/portal.html`, `app/src/portal/` | The client portal (`<warehouse address>/portal`; `portal.html` in the preview): a client's own login places orders and announces deliveries (ASNs) and follows what it sent. API `server/src/core/portal-api.ts`. Only in server builds. |
| `app/ops.html`, `app/src/ops/` | The ops console (the WMS team's own page, at `ops.<domain>`): every warehouse's health, people counts and setup checklist, creating warehouses, restoring an owner's access, support access, the team, activity and errors. Only in server builds. |
| `app/src/server/` | How the app talks to the server (`client.ts`), signing in with it (`ServerRoot.tsx`, `authParts.tsx`), and the preview (`preview.ts`, `pgliteWorker.ts`, `PreviewTools.tsx`). |
| `app/src/sync/` | Keeping the app's data in step with the server: `entities.ts` (the State as the server's pieces), `engine.ts` (waiting changes, sending, catching up, the encrypted copy on the device), `idb.ts`, `context.tsx`. |
| `app/src/pages/warehouse/` | The Team page for owners (server only): people, roles and switches, account requests, support access, security log, and Setup (`DataTab.tsx`: the warehouse files our team prepares, the `.xlsx` template, a copy of all the data). |
| `infra/` | The AWS setup as code (CDK): `WmsData-<stage>` (network, PostgreSQL 17, RDS Proxy, files bucket, keys, image repository, migration task, alarms) and `WmsApi-<stage>` (the API behind a load balancer, with CloudFront in front: `/assets/*` cached a year, pages and APIs never). Stages `staging` and `prod` (`lib/settings.ts`). |
| `.github/workflows/deploy-aws.yml` | Deploys to AWS, only when started by hand: data stack → image → migration loop → API stack. |
| `docs/aws-setup.md` | What to set up once in the AWS account and on GitHub before the first deploy. The one-time template it uses is `infra/setup/wms-account-setup.yaml`, generated from `infra/lib/setup-stack.ts` by `npm --prefix infra run setup:template` (never edit the YAML by hand). |
| `tools/<tool>/template.html` | Source of each published tool. Data goes in at the single `/*DATA*/` marker. |
| `tools/<tool>/dist/` | Built pages that get published. Never edit by hand. |
| `outputs/` | Files handed to the owners: count sheets, label PDFs (not on GitHub) |
| `tests/` | `node --test` tests |
| `docs/images/` | Photo of the label sheet and the fit check used to measure it |

## Commands

- `npm run build`: workbooks → CSV → generated JSON → `tools/*/dist/*.html`. The generated JSON must come out byte-identical unless the inputs or scripts changed; check with `git diff data/generated`.
- `npm run app:dev`: run the WMS app at http://localhost:5173 (or start `wms-app` in `.claude/launch.json`). `VITE_TENANT=demo npm run app:dev` runs it as the demo warehouse. `npm run app:build` type-checks and builds it. Install its packages once with `npm --prefix app install`.
- `npm test`: the count page's Excel export, the tenant layouts and seeds, the setup template and `.xlsx` reader, the server (`server/test/`, including the isolation tests: two warehouses with marker data behind the real web layer, `isolation.test.ts`) and the AWS templates (`infra/test/`). Install `server/` and `infra/` packages once with `npm --prefix server install` and `npm --prefix infra install`.
- `npm --prefix app run dev:preview` (or `wms-preview` in `.claude/launch.json`, port 5175): the app with the real server code running in the browser on PGlite (a PostgreSQL saved in that browser and shared by its tabs; each tab signs in on its own, so two tabs are two people), to try server sign-in, invites, the Team page, live updates and the ops console (`/ops.html`) before AWS exists. In dev, `window.__wmsSync` is the sync engine (what's waiting). The Preview pill (bottom right) shows the emails the server would have sent (invite links); "Preview: fill in the code" stands in for the authenticator app. Nothing leaves the browser; never part of a real build. `npm --prefix app run build:server` builds the app for the server image.
- `npm run infra:synth`: turns `infra/` into CloudFormation templates (`infra/cdk.out/`) to check them; needs no AWS account and deploys nothing. Nothing runs a database or server on this computer: the server only runs on AWS (owner's decision, 15 Oct 2026).
- `python3 scripts/make_count_sheet.py`: blank count workbook with product dropdowns (non-Deccan products) in `outputs/count-sheets/`.
- Preview a tool locally: start the `tools` server in `.claude/launch.json` and open `/tools/<tool>/dist/<tool>.html`. Add `<meta charset="utf-8">` to a test copy, because the published skeleton supplies it, not the template.

## GitHub and the demo site

- The repository on GitHub is public, so the real business data is in `.gitignore` and must never be committed: `data/source/`, `data/csv/`, `data/generated/count.json`, `outputs/`, `tools/warehouse-count/dist/`, `tools/rack6-map/`, `app/public/tenants/*/stock.json` and the loose copies in the top folder. Product names, the layout and the brand logos are fine to publish (owner's choice, 14 Oct 2026).
- Demo site: GitHub Pages (https://karthik-pulla.github.io/a3k-wms/), built by `.github/workflows/pages.yml` on every push to `main` with `npm --prefix app run build:site` (`app/scripts/site.mjs`): the minimal landing page in front ("Try the demo", and "Book a visit" as an email link, `DEMO_CONTACT` in `app/src/server/demo.ts`), and in `demo/` the server version running in the visitor's browser (the preview, `VITE_WMS_BACKEND=preview VITE_WMS_DEMO=1 VITE_TENANT=demo`) with the made-up demo warehouse and the console (`demo/ops.html`). Ready-made logins (`DEMO_LOGINS`, made by `preview.ts` through the real invite steps): `owner`, `coordinator`, `worker`, the console's `owner` and the client portal's `buyer` (`demo/portal.html`, the first client), all with the public demo password shown on the sign-in screens; "Preview: fill in the code" stands in for the phone. Relative paths, so it works under any folder; its security policy also allows WebAssembly (the in-browser database). Try it locally with `wms-site` in `.claude/launch.json` (http://localhost:4190/a3k-wms/) after `build:site`. A build carries only its own warehouse's folder (`vite.config.ts`), so the demo never includes A3K's files. `npm run build:demo` is the older device-only demo (`admin` / `password`).

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

## Design notes and must-keep rules

The detailed notes are in `docs/design-notes.md`, with the same authority as this file. Read the section for the area you touch before changing it:

| Section in `docs/design-notes.md` | Read it before working on |
| --- | --- |
| Reference documents | reading orders, packing lists, in-bounds (A3K's real SO, container packing list and inbound report formats) |
| Label sheets | label PDFs, the Order Label Maker |
| WMS app design | any app screen: tenant config, look and themes, home, in-bounds, put-away, sign-in, inventory, counts, out-bounds and picking, labels, Spanish, permissions, tasks, Work, logs, messages |
| Server on AWS | the server, sync, database, migrations, backups, order emails, client portal, ops console |
| Owner decisions for the full WMS | anything about what the owners want: roles, inbound, put-away, QR codes, expiry, reports, counts, orders, partial pallets, returns, go-live |
| Open questions | before assuming an answer the owners haven't given |

Rules that apply to almost every change:

- **What must be flawless:** in-bounds (a delivery reported and updating live on every screen) and keeping the inventory right. Changes there get the most care and testing (`docs/test-plan.md`, critical checks C1–C3).
- **Tenants:** nothing about one warehouse is built into the app (`docs/multi-tenant-design.md`). Location codes are built and read only through `app/src/tenant/layout.ts`; never write a code with a template string.
- **Look:** style through `.glass` and the CSS tokens in `app/src/styles/global.css`, never literal colours. Respect reduced motion. No underlined text.
- **Spanish:** add the Spanish for every new interface text to `app/src/i18n/es.ts` (pallet = tarima, slot = espacio, case = caja, pick = surtir, put away = acomodar, informal "tú"). Never translate names, codes, Logs text or exported/printed files.
- **Permissions:** every "may this person see or do this" check goes through `app/src/auth/permissions.ts` / `server/src/shared/permissions.ts`.
- **Every stock change** needs a reason and is logged (`app/src/store/audit.ts`); owners' direct changes need edit → review → reason → confirm.
- **Sync:** add every new store action to `ACTION_RULES` in `server/src/shared/sync.ts`; actions that move stock are checked in `server/src/core/sync-checks.ts` (change it with the reducer).
- **Server:** only through RDS Proxy (no session `SET`, temp tables, `LISTEN`/`NOTIFY`, advisory locks or named prepared statements); every new table or column is a new migration file, never an edit to one that ran.
- **Product boxes** use `ProductInput`. **Product name:** Lattice; inside the WMS the warehouse's own name and mark lead.

## Finding code: graphify

There is a code-only knowledge graph of the repo at `graphify-out/graph.json` (built locally from the code with no AI; `data/`, `outputs/`, tenant data and binaries are left out by `.graphifyignore`; not on GitHub). Use it before wide greps, and pass this rule on to subagents that explore code:

- `~/.local/bin/graphify query "<question>" --budget 800` lists the functions and files that match, with line numbers. `graphify explain "<name>"` shows one function's connections; `graphify path "<A>" "<B>"` how two connect; `graphify affected "<name>"` what depends on it.
- It matches names, not meaning: when it doesn't surface the file, use grep.
- After changing code, run `~/.local/bin/graphify update .` (local, no AI). If the graph is missing, rebuild it with `GRAPHIFY_BACKEND=none ~/.local/bin/graphify extract . --code-only`. Always keep `GRAPHIFY_BACKEND=none` or `--code-only` so nothing (least of all `data/source/`) is sent to an outside AI.

## Rules for agents

1. `data/source/` is real business data. Don't send it to outside services, and never put one brand's stock in another brand's report or file.
2. Never hand-edit `dist/`, `data/generated/` or A3K's generated tenant files (`products.json`, `logos.json`, `stock.json`). Change the template or script and rebuild. A tenant's `config.json` and `seed.json`, and all of the demo's files, are edited by hand.
3. Keep the stock workbook tabs, columns and row order exactly as above.
4. Run `npm run build` and `npm test` before saying work is done, and report the results honestly.
5. Ask before deleting anything in `outputs/` or `data/source/`.
6. Owner-confirmed facts (this file) beat what the sheets say. Record new confirmations here.
7. No tenant names, brands or location-code formats in app code: they belong in the tenant config.
8. Never deploy to AWS or push to GitHub without the user's go-ahead for that step. Server code must keep the RDS Proxy rules above, and every new table or column arrives as a new migration file.

