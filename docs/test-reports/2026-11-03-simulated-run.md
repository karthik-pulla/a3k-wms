# Lattice test report: simulated run, 3 Nov 2026

A simulated hands-on run of [test-plan.md](../test-plan.md). An agent acted as the owner, coordinator and worker (plus the portal buyer and console owner) in separate browser tabs. It looked for bugs and changed no code.

## 1. About this run

| | |
| --- | --- |
| Date | 3 Nov 2026, about 16:20–17:05 local; continued 4 Nov about 03:22–03:30 UTC (22:22–22:30 local, 3 Nov) |
| Tester | Claude (automated, acting as owner / coordinator / worker / buyer / console owner) |
| Where | Local dev server `wms-demo-dev` (http://localhost:5176, `VITE_WMS_BACKEND=preview VITE_WMS_DEMO=1 VITE_TENANT=demo`). It runs the real server code in the browser on PGlite. |
| Demo reset ("Start over") | Not done. The run used the data already in the browser and tracked everything against it. |
| Computer and browser | Claude desktop app's built-in browser pane (Chromium), 1024×768 viewport, several tabs (one person per tab) |
| Phone or tablet | None. One mobile-width check was cut short by bug B14 (see 14.1). |
| Time spent | About 55 min of active testing |
| Caveats | (1) **The code changed during the run.** From about 16:58, another session edited `app/src/store/*`, `server/src/core/sync-checks.ts`, `portal-api.ts` and other files. Vite hot-reloaded every tab, which broke one tab and caused B14a. (2) Later the dev server was stopped ("stopped by the app"), and I restarted it with `preview_start wms-demo-dev`. (3) The coordinator asked me to re-check C1 against the new in-bound behaviour (announced vs received cases, a reason for differences, full-first pallet split). That re-run is section 3b. (4) Only **one** run of C1–C3 was done, not three. (5) Some steps used page JavaScript for **inspection only**: reading `window.__wmsSync.getState()` for the ledger, reading generated .xlsx blobs, and stubbing `window.prompt`/`confirm`/`open`/`clipboard` where the in-app browser blocks native dialogs. No app code was changed. |

## 2. Summary

| Critical | Checks | Run 1 result |
| --- | --- | --- |
| C1. In-bound reported, updates live | 14 | 11 P · 2 ~ · 0 F · 1 – (see notes; the re-run on the new code passed) |
| C2. Inventory stays right | 8 | 5 P · 1 ~ · 2 F |
| C3. Under pressure | 8 | 5 P · 1 ~ · 0 F · 2 – |

**Ledger matched on every step:** **no**. One step broke it (B1: over-pick). Every other step matched to the case, on every screen checked.

**Bugs found:** 2 Critical-class (B1 wrong stock and wrong permanent log, B4 stock change with no reason), 3 High, 13 Medium, many Low. Full list in section 5.

**In one sentence:** in-bounds, put-away, moves, picks, counts, offline sync and concurrency held up well, and stock totals agreed across every screen and the export. But the pick screen lets a picker take more than planned and logs a number that never moved. Role switches never reach the UI. A put-away plan can show another delivery's pallets. Several "every change needs a reason" rules are missing (count corrections).

## 3. Critical checks: in-bounds and inventory (run 1, product SF101)

Tabs: A `coordinator`, B `owner`, C `worker` (and a second `worker` tab for C3.3).

### C1. An in-bound is reported and updates live

| # | Check | Run 1 | Notes |
| --- | --- | --- | --- |
| C1.1 | "Before" numbers | P | SF101 399 cs on 11 locations; Sunfield brand 11,800 cs; Incoming 3, Pending 2 |
| C1.2 | New delivery shows in B within 5 s | P | Sunfield 2932 (2 × 50, lot LOT-T1, BB 2028-06, TCNU 777001) appeared in B in under 4 s |
| C1.3 | Arrival shows in B's Pending within 5 s | P | |
| C1.4 | Short delivery confirmed; 2 empty slots; tasks reach C; stock not added yet | P | Plan 05B-10-L1-B1 and 06A-01-L4-B1, both empty; tasks reached C; stock still 399. **But** see B3: the plan screen can show another delivery's pallets. |
| C1.5 | First pallet in slot; B shows it with lot, BB, arrival | P | 449; the slot drawer showed SF101 50 cs, LOT-T1, Jun 2028, arrived Nov 3 2026, the delivery link and the history line |
| C1.6 | Total = before + 98 everywhere | P | 497; Stock by brand Sunfield 11,898 |
| C1.7 | Logs: one line per step | P | Added, arrived, edited, confirmed (with slots), started, confirmed in slot, all with who and time. The "arrived" line doesn't say who received it or the condition. |
| C1.8 | Slot history shows the put-away | P | History reads "Put away 50 cs · Demo Worker" |
| C1.9 | Survives reload and quitting the browser | P | Three tab reloads kept everything. Later the browser pane closed completely and the dev server was restarted: SF101 was still 556 (the ledger value) and all deliveries and orders were still there. Sessions without "keep me signed in" ended, as designed. |
| C1.10 | Mixed pallet: one slot, right cases | P | Sunfield 2933 P1 = SF101 × 20 + SF102 × 30 in 01A-01-L1-B1. SF101 +20, SF102 2001 → 2031. |
| C1.11 | Damaged cases left out exactly | ~ | 50 with 3 damaged → +47 (correct). Typing 60 damaged was clamped to 50. **But** the 3 damaged cases are not listed anywhere on the delivery after put-away (B12). |
| C1.12 | Back-to-back deliveries never share or reuse a slot | P | Confirmed 2933 and then 2930: 6 different empty slots, none overlapping |
| C1.13 | Portal delivery notice shows in Incoming | P | The buyer announced SF103 101 cs on 2 pallets. It showed in B within 4 s as 2 lines (51 / 50). |
| C1.14 | Exported report matches the screen | P | Sunfield file: SF101 564 on 15 locations, each new pallet with slot, cases, lot, BB, arrival 2026-11-03. Golden Field went to its own file. Frozen header and filter present. See B10 for the About sheet text. |

### C2. The inventory stays right

| # | Check | Run 1 | Notes |
| --- | --- | --- | --- |
| C2.1 | Total matches the ledger after every step | **F** | The move, the 7-case pick, the −2 adjustment and the +1 count all matched. A careless "Cases taken" entry of 99 removed 21 cases (B1). Undo restored it. |
| C2.2 | Same total in five places | P | 556 in Products, the sum of slots, the Inventory table (15 rows), "Export these rows" (.xlsx) and Stock by brand (Sunfield 11,987, consistent) |
| C2.3 | Move: old slot empty, everything carried over | P | 05B-10-L1-B1 → 05B-09-L1-B1: lot, BB and delivery (so arrival) kept; old slot empty |
| C2.4 | Mixed pallet moves as one | P | 01A-01-L1-B1 → 01A-02-L1-B1 as a task given to the worker; both lines moved together |
| C2.5 | Never below 0; "short" | ~ | Order for 600 → "154 short" (correct). Over-picking was clamped to the pallet, so the slot never went negative, but the extra cases were taken off stock (B1). |
| C2.6 | Expired stock never planned | P | The expired pallet 06A-01-L2-B2 (BB Sep 2026) was not planned, and the short message names "50 cs in stock are expired" |
| C2.7 | One log line per stock change, none extra | **F** | "Picked 99 cases" was logged when 21 moved (B1). The count correction line has no reason and no before/after numbers (B4). |
| C2.8 | Looking, chatting and exporting change nothing | P (partial) | Exports, map and table views changed nothing. Messages were not tested. |

### C3. Under pressure

| # | Check | Run 1 | Notes |
| --- | --- | --- | --- |
| C3.1 | Double-click / double-tap counted once | P | Double-clicked "Yes, it's in the slot", "Confirm and send to workers" and the pick "Confirm": each happened once |
| C3.2 | Two people confirm the same delivery | P | Owner and coordinator clicked "Confirm and send to workers" on 2930 together: confirmed once (by the owner), 4 tasks, the other tab caught up. I didn't see a message telling the coordinator. |
| C3.3 | Two workers take the same task | ~ | Same `worker` login in two tabs: one "Started" log line. Both then pressed "Yes, it's in" together: stock added once (+20 / +30). Not tested with two different worker accounts. |
| C3.4 | Same pallet moved twice at once | P | Owner → 05B-09-L2-B1 and coordinator → 05B-09-L1-B2 at the same moment: it ended up only in 05B-09-L2-B1, 50 cs, total unchanged. I didn't see a message in the coordinator's tab. |
| C3.5 | Last cases picked twice at once | – | Not run |
| C3.6 | Offline put-away + online confirm | P | Worker offline: finished the move task GF202 03A-F02 → 03A-02-L1-B2 (waiting 2). The owner online confirmed Lotus 2931 meanwhile. Reloading while offline kept the waiting changes. Back online, both arrived; GF202 total unchanged (1,798). |
| C3.7 | Window closed right after confirming | P | Confirmed a put-away and reloaded at once: saved once (564) |
| C3.8 | 20-pallet delivery | – | Not run (time) |

### Stock ledger, SF101 (run 1)

| Step | What I did | Change | Should be | Products | Sum of slots | Inventory table | Export | Match? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Start | — | — | 399 | 399 | 399 | — | — | yes |
| C1.5 | 2932 pallet 1 put away | +50 | 449 | 449 | 449 | 449 | — | yes |
| C1.6 | 2932 pallet 2 (48) put away | +48 | 497 | — | 497 | — | — | yes |
| C1.10 | Mixed pallet put away | +20 | 517 | — | 517 | — | — | yes |
| C1.11 | 50 with 3 damaged put away | +47 | 564 | — | 564 | — | 564 | yes |
| C2.1 | Pallet moved (reason "test") | 0 | 564 | — | 564 | — | — | yes |
| C2.1 | Mixed pallet moved by worker task | 0 | 564 | — | 564 | — | — | yes |
| (bug) | "Cases taken" = 99 on a pick planned at 4 | −4 expected | 560 | — | **543** | — | — | **no (B1)** |
| (undo) | Undo that pick | | 564 | — | 564 | — | — | yes |
| C2.1 | Order 16 for 7: 4 + 1 (short, reason) + 2 | −7 | 557 | — | 557 | — | — | yes |
| C2.1 | Owner adjust 06A-01-L1-B2 32 → 30 | −2 | 555 | — | 555 | — | — | yes |
| C2.1 | Count correction 30 → 31 (06A-01-L1-B2); "keep system" on 5010 | +1 | 556 | — | 556 | — | — | yes |
| C2.2 | Five places | 0 | 556 | 556 | 556 | 556 | 556 | yes (Sunfield brand 11,987) |
| 5.12 | Order 17: picked 20, then cancelled | 0 | 556 | — | 556 | — | — | yes |
| C3.4 | Simultaneous moves | 0 | 556 | — | 556 | — | — | yes |
| C1.9 | Browser closed, server restarted | 0 | 556 | — | 556 | — | — | yes |
| 3b | Re-run on new code: 2935 put away 50 + 48 | +98 | 654 | — | 654 (C), 654 in B after about 10 s in background | — | — | yes |

Other ledgers: SF102 2001 → 2031 (+30 mixed) → 2019 (portal order 18 shipped −12, expected). GF202 1798 → 1798 (offline move) → 1796 (scan correction −2).

### 3b. C1 re-checked on the new in-bound code (after the dev server restart)

| Check | Result | Notes |
| --- | --- | --- |
| New delivery 2935 (2 × 50 SF101) shows live in the owner's tab | P | |
| Arrival → Pending; new "Announced and received" table | P | 100 announced / 100 received |
| Pallet 2 changed to 48 | P | The table shows −2; "Confirm" stays **disabled** until a reason is typed; the reason box is labelled "kept in Logs" |
| Confirm → plan; choosing another slot needs a reason | P | Picked 01A-03-L3-B1 by hand; "Confirm and send" stayed disabled until a reason was chosen |
| Log line | P | "Confirmed Sunfield 2935 … Received differs from announced: SF101 100 → 98. Reason: 2 cases short on pallet 2". The hand-chosen slot's reason is stored but not written in the log text (B24). |
| Put-away by the worker | P | 556 → 606 → 654; shipment "stored" |
| "Split into pallets…" (full first) | P | Portal delivery 2934 (101 SF103, 51 / 50) → proposed and made 55 + 46 |

## 4. Feature checklist (P pass · ~ partly · F fail · – not tried)

### 1. Sign-in and two-factor
| # | Result | Notes |
| --- | --- | --- |
| 1.1 | P | |
| 1.2 | P | |
| 1.3 | – | |
| 1.4 | P | After 5 wrong tries the right password was refused: "Too many wrong tries … (24 s)" |
| 1.5 | P | An unknown username gets the same message. Lockout for unknown usernames was not tested. |
| 1.6 | P | "That code isn't right…" |
| 1.7 | ~ | Without the tick, closing the browser signed everyone out (correct). With the tick: not verified. |
| 1.8 | P | Invited with no email address, so the link came from "Copy link", not the Preview pill |
| 1.9 | P | Short, `password123456` and username-containing passwords all refused. Wording problem in B22. |
| 1.10 | P | Wendy signed in as Worker (Lotus only) |
| 1.11 | P | "Reset sign-in": Wendy's open tab was signed out within 5 s, and the old password was refused |
| 1.12 | ~ | Password asked again before invite and support approval; after about 10 min it was asked again |

### 2. Roles and switches
| # | Result | Notes |
| --- | --- | --- |
| 2.1 | P | Worker menu: Work, Inventory, Messages |
| 2.2 | P | `#/outbounds`, `#/tasks`, `#/logs`, `#/manage/people` and `#/inbounds/pending/...` are all turned away for the worker |
| 2.3 | P | Coordinator menu: In-bounds, Inventory, Out-bounds, Tasks, Messages, Logs |
| 2.4 | P | No "Adjust stock here" in the coordinator's slot drawer; Returns shows only their own requests, with no decision buttons |
| 2.5 | **F** | B2 |
| 2.6 | – | |
| 2.7 | ~ | Inventory shows "Another client's stock" for a Lotus-only worker (good), but the Work screen shows Sunfield tasks with product names (B8) |
| 2.8 | P | Owner-only switches are disabled for the Coordinator role |

### 3. In-bounds and put-away
3.1 P · 3.2 P · 3.3 P · 3.4 P · 3.5 P (by URL guard) · 3.6 P (damaged left out) · 3.7 P · 3.8 P · 3.9 P (reason required; see B24 about the log) · 3.10 P ("Reported 06B-01-L1-B2 blocked; the WMS gave 06B-01-L2-B1") · 3.11 P (R-0001 restock created a pending in-bound; SF120 unchanged) · 3.12 – · 3.13 –

### 4. Inventory and counts
4.1 ~ (product page map works; expiry tints not checked visually) · 4.2 – · 4.3 P · 4.4 P (Sunfield and Golden Field in separate files) · 4.5 – (blocked for the coordinator by B2; the owner sees "Edit product") · 4.6 P · 4.7 P (the "Other" reason needs text; but see B31) · 4.8 P (review before/after, reason, logged) · 4.9 P (one side, blind) · 4.10 ~ (keyboard entry works; B5, B6; Excel paste and `?` not verifiable with my tools) · 4.11 ~ (applied one, kept one; B4) · 4.12 – · 4.13 ~ (search, sort, export work; print not tried)

### 5. Out-bounds
5.1 P · 5.2 – (no test PDF) · 5.3 – · 5.4 – · 5.5 P (FIFO, open pallets first, walking order; B7) · 5.6 P · 5.7 P (Order 17 skipped the 30 reserved by Order 14) · 5.8 – · 5.9 P · 5.10 P (reason field, recount banner, replanned 2 more; B13) · 5.11 – · 5.12 P (shipped; cancel after picking put 20 cs back; needs `window.prompt`, B17) · 5.13 – · 5.14 ~ (preview correct apart from the missing logo, B28) · 5.15 – · 5.16 – (start position present) · 5.17 –

### 6. Tasks and Work
6.1 P (owner gave a move task to the worker from the slot drawer; it appeared on Work) · 6.2 – · 6.3 P · 6.4–6.8 –

### 7. Messages
Not tested (time). The worker's Work screen shows "Messages 5" next to "No messages for you." (possible inconsistency, unverified).

### 8. QR slot pages
8.1 P (QR labels on screen; 20 column labels for rack 03) · 8.2 P (`#/slot/03A-02`, level by level) · 8.3 P (`#/slot/rack/3` and `/03`) · 8.4 P (60 → 58 with review and reason; owners' log "stock: Corrected … after scanning its QR code"; −5 rejected; 999999 gave a wrong message, B22) · 8.5 – (likely affected by B2)

### 9. Client portal
9.1 P (only Sunfield-client products: SF and GF codes; no stock or slots) · 9.2 P (Order 18 as a draft, source "Client portal (Demo Buyer…)"; a BL product was refused) · 9.3 P · 9.4 P ("Shipped" after refresh) · 9.5 ~ (an `owner` login on the portal is refused; `buyer` on the warehouse app not tried) · 9.6 –

### 10. Ops console
10.1 ~ (health, people and setup only; name and checklist oddities, B27) · 10.2 P · 10.3 ~ (works end to end: ask, owner allows with password, one-time link opens "Support: Owner (WMS team)"; stale lists, B11, B16) · 10.4–10.9 –

### 11. Spanish
11.1 – · 11.2 ~ (In-bounds and order pages mostly Spanish; English left over: "In walking order. Pallets chosen by oldest stock first (FIFO), open pallets first." and "(154 cs; 50 cs in stock are expired and can't be picked)" on the order page; mixed units "cs" and "cj") · 11.3 P (names, codes and lots stay as typed) · 11.4 ~ (`__wmsMissing` lists mostly names and dates, plus the two sentences above)

### 12. Offline and sync
12.1 P · 12.2 P (after the reload, `waiting` went from 2 to 3: a third queued change appeared, origin unknown) · 12.3 P · 12.4 – · 12.5 –

### 13. Isolation
13.1 – · 13.2 ~ (portal yes; worker partly, B8) · 13.3 – (`npm test` not run)

### 14. Everyday quality
14.1 – (mobile check blocked by B14: the reloaded tab hung) · 14.2 – · 14.3 – · 14.4 –

### 15. Home, account, managing
15.1 ~ (widgets chosen and shown; but per device and shared across people, B9) · 15.2 ~ (cards show sensible numbers; not cross-checked) · 15.3–15.8 – · 15.9 ~ (the owner's "Every change" log is complete with who and time) · 15.10–15.13 –

## 5. Bugs

Severity: **Critical** = wrong stock, data loss or security · **High** = a main flow blocked or misleading · **Medium** = wrong, but there's a workaround · **Low** = cosmetic or text.

| ID | Severity | Area | Short description |
| --- | --- | --- | --- |
| B1 | Critical | Out-bounds → order → pick | "Cases taken" accepts more than planned; takes the whole pallet; logs a number that never moved |
| B2 | High | Manage → Roles and switches | Switch changes never reach the person's UI (Edit products stays hidden) |
| B3 | High | In-bounds → Pending | Put-away plan shows the previous delivery's pallets after a hash/URL change; "Confirm and send" silently does nothing |
| B4 | Critical (rule: every stock change needs a reason) / Medium (workaround) | Inventory → Count → review | Count corrections applied with no reason; log has no before/after |
| B5 | Medium | Count entry | Pre-filled "50" not selected → "5010" accepted with no warning |
| B6 | Medium | Count grid / rack maps | Level labels off by one on 4-level racks |
| B7 | Medium | Pick list | "Take 3 of 3 cs · whole pallet · slot empties" when the pallet holds 33 (30 reserved) |
| B8 | Medium | Work screen | A brand-limited worker sees other brands' tasks with product names |
| B9 | Medium | Home / Settings | Home settings and the tour are per browser, shared by everyone; the tour re-opens and blocks clicks |
| B10 | Medium | Stock report export | A3K-specific "SAMPLE: the 27 Sep 2026 sheets…" text is hardcoded into every report |
| B11 | Medium | Manage → Support; console | Support requests and status don't refresh (owner and console both stale) |
| B12 | Medium | In-bounds | Damaged cases not shown after put-away; the delivery's `putaway` keeps the blocked slot, not the real one |
| B13 | Medium | Inventory | Recount flag after a short pick isn't shown in Inventory |
| B14 | High (demo/preview only) | Preview (PGlite multi-tab) | Reloading one tab breaks the others; new tabs hang at "Setting up the preview…"; sync stops while the pill says "All changes saved" |
| B16 | Low | Support handoff | The handoff link in a tab already signed in as someone else is silently ignored |
| B17 | Low/Medium | Order cancel | Uses native `window.prompt`; where prompts are blocked, cancel is impossible (console error "prompt() is not supported") |
| B18 | Low | Cancelled order | Still shows "Next: 01A-02-L1-B1 · take 20 …" pick guidance |
| B19 | Low | Routing | `#/inventory/inventory` shows Products with the subtitle "Count" |
| B20 | Low | Delivery detail at 1024 px | LOT column squeezed to about 10 px; Damaged column cut off |
| B21 | Low | Manage → People | List doesn't update live after an invitee signs up |
| B22 | Low | Text | "1 pallets", "1 cases", "Start counting 1 sides", "Needs not containing your username.", "Cases are whole numbers." for 999999, numbers without thousands separators in Stock by brand |
| B23 | Low | Forms | Disabled or no-op buttons give no reason (Save delivery, Save draft on an empty order) |
| B24 | Low | Logs | Damaged edit logged as an identical "Edited delivery…" line; hand-chosen slot reason not in log text; slot history pick line has no case count |
| B25 | Low | Put-away | A slot reported "blocked" is offered again by the next plan |
| B26 | Low | Accessibility | Radios and checkboxes announced as "on" |
| B27 | Low | Console | Name "Demo Foods Warehouse" vs app "Demo Warehouse"; checklist 0/7 "Being set up" for a warehouse in use; "Support sessions open 0" while one is open |
| B28 | Low (unsure) | Labels | Preview shows no logo with "Sunfield" logo selected |
| B29 | Low | Invite form | Username auto-fills from the name; typing in it appends ("wendy.testwendy") |
| B30 | Low | Preview loader | "Setting up the preview in this browser (first visit only)…" shows on every reload |
| B31 | Low (UX) | Move pallet | Reason dropdown preselects "Consolidating partial pallets", so a reason is always recorded even if nobody chose it |

### Bug details

**B1 · Critical · coordinator · Out-bounds → Orders → order detail → Pick list**
1. New order: Sunfield, store "Test Mart", SF101 × 7 → Save draft → Approve & plan picks. The plan was 06A-01-L1-B1 take 4 (pallet 21) and 06A-01-L1-B2 take 3.
2. On line 1 press "Picked"; in "Cases taken" replace 4 with **99**; press Confirm.
- Expected: refused, or capped at the planned 4 (or at what the order still needs) with a warning or reason; the log states what really moved.
- Actual: the whole pallet (21 cs) was taken off stock, and slot 06A-01-L1-B1 emptied. The order shows "21 picked" for a 7-case order. The toast says "Picked 99 cs from 06A-01-L1-B1." The permanent log says "Picked 99 cases of SF101 Jasmine Rice from 06A-01-L1-B1 for Order 16". SF101 went 564 → 543 and Undo restored it. The "Confirm" button stays enabled at 99. Over-picking needs no reason, though under-picking does.
- URL: `#/outbounds/orders/Order%2016`.

**B2 · High · owner + coordinator · Manage warehouse → People → Roles and switches**
1. Owner: Coordinator role → tick "Edit products" → Save switches ("Role saved.").
2. Coordinator: Inventory → Products → SF101. Reload; then sign out and in again.
- Expected: "Edit product" button.
- Actual: never shown; the owner sees it.
- Likely cause: in `App.tsx` `Session()`, `self = state.chat.users.find(u => u.id === own.id) ?? own`. The synced chat-user record for the coordinator has no `perms`: `{"id":…,"name":"Demo Coordinator","role":"coordinator","roleName":"Coordinator","groups":["coordinators"]}`. So it overrides `own`, which carries `me.perms` from the server.
- This probably also breaks switches turned **off** (e.g. 8.5 "Correct a slot after scanning it" for workers) and custom roles (2.6) on screen. Server enforcement was not checked.

**B3 · High · coordinator · In-bounds → Pending**
1. Open a pending delivery (Sunfield 2933) → Confirm, so its put-away plan shows.
2. Without going back to the list, change the address to `#/inbounds/pending/sunfield-2930` (the same happens with back/forward or any link between two pending deliveries).
- Expected: 2930's own page.
- Actual: the heading reads "Put-away plan · Sunfield 2930 · 4 pallets", but it lists 2933's 2 pallets and slots (Jasmine × 20 + Basmati × 30 → 01A-01-L1-B1 …). "Confirm and send to workers" does nothing and shows no message. No stock was changed. Opening 2930 from the Pending list shows the right page.

**B4 · Critical-class (rule) · owner · Inventory → Count → review**
1. Count 06A with one difference (30 → 31).
2. In review, tick the row, leave "Note (optional)" empty, press "Apply 1 correction".
- Expected: a reason required (CLAUDE.md: every stock change needs a reason; count corrections "logged as count-correction with the reason").
- Actual: applied; the log line is only "Applied 1 count correction (06A-01-L1-B2)", with no reason and no before/after.
- "Keep system stock" logs "kept system stock for 06A-01-L1-B1" (fine).

**B5 · Medium · coordinator · Count**
In a slot's entry, after picking the product the Cases box is pre-filled with the full-pallet size (50). On the second slot it wasn't selected, so typing "10" made **5010**. It saved with no warning (pallet size 50). The review only shows "+4995". Suggest a sanity check (more than the full pallet, or a big jump) and select the pre-filled number.

**B6 · Medium · any · Count grid (`#/inventory/count/<id>`) and rack maps**
On rack side 06A (4 levels), the grid rows are labelled L5, L4, L3, L2, L1. The slots sit in rows L5–L2 and row L1 is empty. Selecting the top-left cell shows "06A-01-L4-B1"; moving down 3 shows "06A-01-L1-B1" while the highlight sits in the row labelled **L2**. Put-away and order maps also draw an empty hatched L5 row on 4-level racks. Counters reading the row labels will mis-locate pallets.

**B7 · Medium · coordinator/worker · pick list**
Order 16 line 2: "06A-01-L1-B2 · Take 3 of 3 cs · whole pallet · slot empties". The pallet holds 33; 30 are reserved for Order 14. A picker told "whole pallet, slot empties" may take all 33. Show the physical cases on the pallet and what to leave.

**B8 · Medium · worker limited to Lotus (Wendy) · Work**
"Anyone can take" lists Sunfield put-away tasks with codes and names (SF103 Brown Rice, SF121 Chickpeas …). Inventory correctly shows "Another client's stock". Other brands' products should show as hidden, or the tasks shouldn't be offered.

**B9 · Medium · all · Home/Settings (`wms.home.settings.v1` in localStorage)**
Widget choice, theme, the tour's "toured" list, simulate-offline, and the "last online visible to" and shift settings are stored per browser, not per person. Choosing widgets as the owner changed the coordinator's home. "Skip the tour" was forgotten: the tour came back in the coordinator and worker tabs whenever someone else signed in on the same browser. The overlay then swallowed a click on "Approve & plan picks", so the order silently stayed a draft. A worker's Settings also shows office widgets and the "Exact last online times visible to" policy. On shared warehouse devices this mixes people's settings.

**B10 · Medium · owner · Export stock report → About sheet**
The "Data" row reads "SAMPLE: the 27 Sep 2026 sheets moved onto the new slot codes, with made-up lots and best-before dates". This is hardcoded in `app/src/components/inventory/ExportDialog.tsx:81`. It appears in the demo warehouse's reports and would appear in real production reports too (it also breaks rule 7: no tenant specifics in app code).

**B11 · Medium · owner + console · Manage → Support / console warehouse panel**
1. Console: Ask for access.
2. Owner, already on any Manage tab, opens Support: "No support access open or asked for." It appears only after leaving Manage (e.g. Home) and coming back. `support.list` is fetched once on ManagePage mount.
- Nothing else tells the owner a request is waiting (no home card or menu badge outside Manage).
- After the owner allows it, the console panel still says "Waiting for an owner … asked just now" until reopened, and the summary says "Support sessions open 0".

**B12 · Medium · coordinator · In-bounds delivery page**
After 2933 (3 damaged) was put away, its page shows no mention of the damaged cases. They exist only in the data (`damaged: 3`). The plan says "listed as damaged". Also the delivery's `putaway` record keeps `06B-01-L1-B2` for pallet 2, the slot the worker reported blocked. The page itself correctly shows "06B-01-L2-B1 · 06B-01-L1-B2 was blocked".

**B13 · Medium · coordinator/owner · Inventory**
After a short pick ("Cases crushed, only 1 good"), the order page says the pallet "is skipped … until it's counted" and offers "Open in Inventory ›". But the slot drawer and Inventory table show no recount flag.

**B14 · High for the demo (preview only) · all tabs**
(a) When code hot-reloaded, one tab showed "Can't open the warehouse · Something went wrong". Console: `Leader changed, pending operation in indeterminate state` (PGlite worker).
(b) Later, reloading one tab left it stuck at "Setting up the preview in this browser (first visit only)…" for more than 40 s, with or without mobile emulation, and with no recovery card. A brand-new tab hung the same way. The two open tabs stopped syncing (`lastSyncedAt` frozen at 03:27:38 while the time was 03:29:10). Console: `InvalidStateError: Failed to execute 'postMessage' on 'BroadcastChannel': Channel is closed`. **Their save pill still said "All changes saved".**
On the public demo, a visitor who closes or reloads the first tab could get a dead demo, and the pill shouldn't claim "saved" when sync has stopped.

**B17 · Low/Medium · coordinator · order "Cancel order"**
It uses `window.prompt` for the reason. In the Claude in-app browser prompts are blocked, so clicking did nothing and the console showed `Uncaught Error: prompt() is not supported` (OrderDetail.tsx). In normal browsers it works: with a reason, Order 17 was cancelled and the 20 picked cases went back on 01A-02-L1-B1 with their delivery link. Prefer an in-page reason box, like the other flows.

**B18 · Low · Order 17 (cancelled)**
It still shows "Next: 01A-02-L1-B1 · take 20 × Jasmine Rice" and the full pick list (without Picked buttons).

## 6. Confusing UX (not strictly bugs)

- Sign-in quick buttons (`owner` / `coordinator` / `worker`) fill in the password too. Typing the password afterwards doubles it, and the failed try counts toward the lockout.
- "Confirm" on a short pick is enabled before a reason is typed (I didn't try submitting empty).
- Move-task worker list offers "Omar" and "Tess" (seed people without logins); tasks can be given to people who can't sign in.
- After a support "handoff", opening the link in a tab where someone is signed in keeps that person (B16); should warn.
- "Picked 99 cs" toast and log for a 21-case pick (part of B1).
- Coordinator's Returns page says "No return requests yet" while R-0001 exists (created by another person); fine by design, but it could say "others' requests go to owners".
- The count review keeps showing "+4,995 cases net" after the owner kept the system stock.

## 7. Couldn't test, and why

- Three full runs of C1–C3 (time). Only run 1, plus a C1 re-run on the changed in-bound code.
- C3.5 (two pickers on the last cases), C3.8 (20-pallet delivery), 12.4 (same pallet moved offline and online), 12.5 (real phone).
- PDF order reading (5.2, 5.3): no test PDF available to the browser tool. Email inbox (5.4). Label PDF download, printing and alignment (5.15, 5.16).
- Messages (area 7), teams, workers board and forklift (6.4–6.8), announcements (6.7). Not reached in time.
- Console 10.4–10.9 (emergency access, new warehouse, slot codes, restore owner, team invite, activity/errors). Client-login management (9.6). Landing page and "Book a visit" (15.12, 15.13). Setup .xlsx import (15.10, 15.11).
- Phone width (14.1): blocked by B14b when the tab was reloaded under emulation. The viewport was reset to desktop afterwards.
- Excel paste and the `?` shortcut in Count: my tool types text by insertion, not key events, so I couldn't tell.
- `npm test` / `npm run build`: not run (not part of this browser run; no code was changed).
- Server-side enforcement of role switches (whether the server refuses `edit-products` etc.). Only the UI was checked.

## 8. What passed (highlights)

Live updates between tabs (in about 4 s in front tabs, under 15 s in background tabs). Put-away only adds stock when the worker confirms. Mixed pallets stay together through put-away, move and pick. Damaged cases stay out of stock. Expired stock is never planned, and "short" is calculated exactly. Double-clicks and simultaneous confirms or moves happen once. Offline changes queue, survive a reload and sync once. Worker URL guards work. Owner-only switches are locked. QR slot pages and scan-corrections work and are logged. The portal sees only its own products, and its orders and notices arrive live. Support access works end to end with password re-entry and a one-time link. Invite, password rules and reset sign-in (old session killed within 5 s) work. Stock totals agreed across Products, slots, the table, Stock by brand and both .xlsx exports. The new in-bound code (announced vs received, reason for differences, full-first split) behaves as described.
