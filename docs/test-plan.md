# Lattice test plan

A feature-by-feature check of the whole WMS, done for free in a web browser, plus a one-page report to hand to the supervisor (and later to investors). Every test says what to try, what should happen, and leaves room for Pass / Fail / Notes.

Nothing here needs AWS, a credit card or a server. The demo runs the real server code inside the browser, with its own database (PGlite, a PostgreSQL saved in that browser).

## How to use this plan

1. Pick where to test (next section). The public demo site is the easiest.
2. **Start with the critical checks (C1–C3).** In-bounds and inventory are what the warehouse can't do without; everything else branches from them. Run them three times, each after "Start over". They must pass every time; one fail is a blocker, so stop and get it fixed before going on.
3. Then go area by area (1–15). Each area takes 10–30 minutes; the whole plan takes about two afternoons.
4. For each line, write **P** (pass), **F** (fail), **~** (partly works) or **–** (not tried), plus a short note. A fail always gets a screenshot and a line in the bug list of the report.
5. Time the tasks in "Timing: old way vs. Lattice" with a phone stopwatch.
6. Record everything in the report, [test-report-template.md](test-report-template.md): copy it once per test run. It lists every feature by test number, with room for bugs and feedback.

A test that fails is useful too: it shows the testing was real. Report it honestly and say whether it was fixed.

## Before you start

### Where to test

| Option | Address | When to use it |
| --- | --- | --- |
| Public demo site | https://karthik-pulla.github.io/a3k-wms/ → "Try the demo" (the app is at `…/a3k-wms/demo/`) | Most tests. Made-up warehouse ("Demo Foods Warehouse"), ready-made logins. |
| Client portal on the demo | `…/a3k-wms/demo/portal.html` | Area 9 |
| Ops console on the demo | `…/a3k-wms/demo/ops.html` | Area 10 |
| Local preview | `npm --prefix app install` once, then `npm --prefix app run dev:preview`, open http://localhost:5175 | Testing invites from scratch, the "Book a visit" form (`/landing.html`), and the missing-translation list (Area 11). The first owner signs up through the invite email in the Preview pill; there are no ready-made logins. |

### Demo logins

All demo logins use the public demo password shown on the sign-in screen (`rack-and-pallet-26`). After the password, press **"Preview: fill in the code"**: it stands in for the authenticator app on a phone.

| Login | Where | Who it is |
| --- | --- | --- |
| `owner` | demo app | Owner: sees and manages everything |
| `coordinator` | demo app | Coordinator: in-bounds, orders, tasks, inventory |
| `worker` | demo app | Worker: Work screen, Inventory, Messages |
| `buyer` | `portal.html` | A client (the first brand, Sunfield) placing orders |
| `owner` | `ops.html` | The Lattice team's own console |

### Good to know

- **Two tabs = two people.** Each tab signs in on its own but shares the same warehouse data. Sign in as `owner` in one tab and `worker` in another to test live updates and messages.
- **Each browser is its own warehouse.** The demo lives in the browser that opened it. The supervisor's laptop gets its own fresh copy; nothing is shared between computers.
- **Emails don't leave the browser.** Invite links, reset links and alerts appear in the **Preview** pill (bottom right).
- **Starting over:** Preview pill → "Start over" wipes the demo in this browser and makes fresh sample data. Do this before a clean test run, and write the date of the reset in your notes.
- **Test on a phone too.** Areas 6 (forklift), 8 (QR codes) and 12 (offline) mean most on a real phone or tablet.
- **Screenshots:** name them by test number, e.g. `4.7-count-review.png`.

---

## Critical: in-bounds and inventory (must be flawless)

The warehouse's verdict: reporting an in-bound and seeing it update live, and keeping the inventory right, must work **flawlessly**. Everything else is a variation of these or branches from them. So these checks go first, go deeper, and have no "partly works".

**How to run them**

- Open **three windows side by side** in the same browser (not tabs hidden behind each other): A = `coordinator`, B = `owner`, C = `worker`. A window in front catches up every 2 seconds, so "live" here means **within 5 seconds, without reloading**. A tab in the background catches up within about 15 seconds; that isn't a fail.
- Track one product (e.g. `SF101`) through C1.1–C1.11 and C2 in the **stock ledger** in the report: what the total should be after each step, and what each screen shows. Use other products for C1.12, C1.13 and C3, so the ledger stays simple.
- Run C1–C3 three times, each after Preview pill → "Start over". **All three runs must pass every check.** Any fail is a blocker.
- On the demo, "live" can only be shown between windows of one browser: each browser has its own copy of the warehouse. Live updates between a phone and a computer need the staging setup on AWS (see "What it doesn't prove yet").

### C1. An in-bound is reported and updates live

| # | Try this | What should happen | Run 1 / 2 / 3 |
| --- | --- | --- | --- |
| C1.1 | B: write down the "before" numbers in the ledger: `SF101`'s total cases and pallets (Inventory → Products), Sunfield's cases in "Stock by brand", the In-bounds badges. | — | |
| C1.2 | A: In-bounds → Incoming → add a delivery: `SF101`, 2 pallets × 50 cases, a lot, a best-before date, a container number. | Appears in B's Incoming within 5 s; badges go up by one. | |
| C1.3 | A: "Mark as arrived" → fill in "Received by" → "Move to Pending". | B sees it move to Pending within 5 s; the home card "to confirm" goes up. | |
| C1.4 | A: in Pending, change pallet 2 to **48** cases (a short delivery), then "Confirm" → "Confirm and send to workers". | A put-away plan with 2 slots, both empty. C sees 2 put-away tasks within 5 s. B's stock hasn't changed yet. | |
| C1.5 | C: take task 1 → "It's in the slot". | Within 5 s in B: that slot shows `SF101`, 50 cases, the lot, best-before and today's arrival; the product total is +50; Stock by brand +50; the slot lights up on the map. | |
| C1.6 | C: finish task 2. | Total is exactly **before + 98** (what arrived, not the 100 expected), everywhere. | |
| C1.7 | B: Manage warehouse → Logs. | One line per step (added, arrived, confirmed, each put-away), each with who, slot and time. | |
| C1.8 | B: open each new slot's details → history. | The put-away is there with who and when. | |
| C1.9 | Reload all three windows. Then quit the browser completely and open the demo again. | Everything from C1.2–C1.8 is still there, unchanged. | |
| C1.10 | Add, arrive, confirm and put away a **mixed pallet**: pallet 1 = `SF101` × 20 and `SF102` × 30. | One slot holds both products, 20 and 30 cases; each product's total goes up by exactly that. | |
| C1.11 | Do one delivery of 50 cases: on arrival choose "Some damage", then in Pending enter **3** damaged cases. | Stock goes up by 47; the 3 are listed as damaged, not put away. | |
| C1.12 | Confirm two deliveries one right after the other, before putting either away. | No two pallets are given the same slot, and no pallet is given a slot that's already full. | |
| C1.13 | Portal (`demo/portal.html`, `buyer`): announce a delivery. | Appears in B's Incoming within 5 s, one line per pallet. | |
| C1.14 | B: export the Sunfield stock report (.xlsx). | The new pallets are in it, with slot, cases, lot, best-before and arrival matching the screen. | |

### C2. The inventory stays right

Carry on with the same product. After each step, write the expected total and what each screen shows in the ledger.

| # | Try this | What should happen | Run 1 / 2 / 3 |
| --- | --- | --- | --- |
| C2.1 | Do these in order: move a pallet (reason "test"); make and approve an order for 7 cases and confirm the pick; owner "Adjust stock here" −2 (with a reason); count one slot and apply a +1 correction. | After every step the total is exactly what the ledger says it should be. | |
| C2.2 | After the last step, read the total in five places: Products, the sum of its slot details, Stock by brand, the Inventory table, the exported .xlsx. | All five agree, and agree with the ledger. | |
| C2.3 | Look at the moved pallet's old and new slots. | Old slot empty. New slot has the same products, cases, lot, best-before and arrival date. Total unchanged by the move. | |
| C2.4 | Move the mixed pallet from C1.10. | Both products move together; neither is left behind. | |
| C2.5 | Try to pick more cases from a pallet than it has (take-fewer screen, or an order bigger than stock). | Never allowed: no slot ever shows below 0; the order shows "short". | |
| C2.6 | Find an expired pallet (shown in black) and order that product. | The expired pallet isn't planned; it stays in stock and in black. | |
| C2.7 | Compare the ledger with Manage warehouse → Logs. | Every stock change in the ledger has exactly one log line with who, when and the reason; there are no stock changes in the log that aren't in the ledger. | |
| C2.8 | Send messages about the product, open its map, export and print reports. | The total doesn't change: looking, chatting and exporting never change stock. | |

### C3. Under pressure

These are what breaks stock systems in real life: double taps, two people at once, bad Wi-Fi.

| # | Try this | What should happen | Run 1 / 2 / 3 |
| --- | --- | --- | --- |
| C3.1 | Double-click "Confirm" on a pending delivery, and double-tap "It's in the slot". | Each happens once: stock added once, one log line. | |
| C3.2 | A and B open the same pending delivery and both press Confirm at the same moment. | Confirmed once; the other window is told and catches up. Stock not doubled. | |
| C3.3 | Two worker windows (the `worker` login in two windows, or a second worker invited as in 1.8) take the same put-away task at once. | Only one gets it; the other catches up. | |
| C3.4 | A and B move the same pallet to different slots at the same moment. | It ends up in exactly one slot; cases counted once. | |
| C3.5 | Two orders, each wanting the last cases of one pallet, picked at the same moment. | The pallet never goes below 0; the second pick is refused and replanned or shown "short". | |
| C3.6 | C: Settings → Developer → "Simulate offline", confirm a put-away. Meanwhile B (online) confirms a different delivery. Turn C back online. | Both arrive, each counted once; the ledger total is right. | |
| C3.7 | C: confirm a put-away and close the window straight away. Open it again. | The change is either saved or still waiting to send, never lost and never doubled. | |
| C3.8 | A big delivery: 20 pallets, 5 products. Confirm and put all away. | 20 different empty slots; each product's total exactly right; the screens stay quick. | |

## 1. Sign-in and two-factor

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 1.1 | Open the demo. Sign in as `owner` with the demo password. | A second step asks for a 6-digit code. | |
| 1.2 | Press "Preview: fill in the code". | You reach the home screen as the owner. | |
| 1.3 | Sign out (avatar → Account → sign out). Press the browser's Back button. | You stay on the sign-in screen; no warehouse data shows. | |
| 1.4 | Sign in as `owner` with a wrong password 5 times, then the right one. | After 5 tries the username is locked for 30 s; the right password is refused until the wait is over. | |
| 1.5 | Try a username that doesn't exist, with any password. | The same "wrong username or password" answer as 1.4, after about the same wait. It doesn't say whether the username exists. | |
| 1.6 | Right password, then type a wrong 6-digit code. | Refused. | |
| 1.7 | Sign in with "Keep me signed in" ticked. Close the tab, open the demo again. | Still signed in. Without the tick, closing for 30+ min signs you out. | |
| 1.8 | As owner: Manage warehouse → People → "Invite someone" (any name, role Worker). Open the Preview pill. | An invite email with a link appears. | |
| 1.9 | Copy the invite link into a new tab. Try passwords that are too short (under 12), common (`password123456`), or contain the username. | Each is refused with a reason. | |
| 1.10 | Choose a good password, then fill in the code. | The new person is signed in with the Worker role. | |
| 1.11 | As owner, open that person → "Reset sign-in". Try the old password in the other tab. | The old password stops working at once; a new 24-hour link appears in the Preview pill. | |
| 1.12 | As owner, change someone's role. | You're asked for your password again first (good for 10 min). | |

## 2. Roles and switches

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 2.1 | Sign in as `worker`. Look at the menu. | Work, Inventory and Messages only. No In-bounds, Out-bounds, Tasks or Manage warehouse. | |
| 2.2 | As `worker`, type `#/outbounds` at the end of the address. | "This section is for coordinators and owners", with a link to Work. | |
| 2.3 | Sign in as `coordinator`. | In-bounds, Inventory, Out-bounds, Tasks, Messages and Logs (the pallet log). No Manage warehouse. | |
| 2.4 | As `coordinator`, look for "Adjust stock here" in a slot's details, "Apply corrections" on a count, and the decision buttons on a return. | Not offered: these are owner-only. | |
| 2.5 | As `owner`: Manage warehouse → People → roles. Turn on "Edit products" for coordinators. In the coordinator's tab, Inventory → Products. | "Edit product" now shows for the coordinator. Turn it off again: it disappears. | |
| 2.6 | As `owner`, make a new role (a name, a base role, a few switches) and give it to the person from 1.10. | That person sees exactly what the switches allow. | |
| 2.7 | As `owner`, limit the worker to one brand. As `worker`, search a product of another brand. | Other brands' stock shows as "hidden" in maps, chips and search. | |
| 2.8 | Check that the owner-only list can't be switched on for other roles: change stock directly, decide returns, apply count corrections, delete counts, manage people and roles, warehouse settings, support access, security log. | These switches aren't offered for non-owner roles. | |

## 3. In-bounds and put-away

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 3.1 | As `coordinator`: In-bounds → Incoming. Open a delivery. | Brand, supplier, products, lot, best-before, cases, pallets, container/BOL show. | |
| 3.2 | Add a delivery by hand (two products, three pallets). | Saved with every field above; it appears in Incoming. | |
| 3.3 | Give two lines the same pallet number. | Treated as one mixed pallet: one slot for both. | |
| 3.4 | Open it → "Mark as arrived". | It moves to Pending. | |
| 3.5 | As `worker`, try to confirm it. | A worker can't confirm in-bound quantities. | |
| 3.6 | As `coordinator`, confirm it (mark one case damaged). | A put-away plan: one slot per pallet, next to the same product if there's room, lower levels first. Damaged cases stay out of put-away. | |
| 3.7 | Before confirming the move, check Inventory for the product. | Stock is **not** added yet: one put-away task per pallet waits. | |
| 3.8 | As `worker`: Work → open the put-away task → "It's in the slot". | Now the stock appears in that slot. | |
| 3.9 | On another put-away task, choose a different slot on the rack view. | A reason is required; it's saved in Logs. | |
| 3.10 | On a task, press "Slot is blocked". | The WMS gives the next free slot. | |
| 3.11 | In-bounds → Returns. Open a return as `owner` → approve "back into stock". | A pending in-bound is created; stock doesn't change until it's confirmed. | |
| 3.12 | Approve another return as write-off (or back to brand). Reject a third. | Inventory doesn't change for either. | |
| 3.13 | In-bounds → Dashboard. | The numbers match the Incoming, Pending and Returns lists. | |

## 4. Inventory and counts

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 4.1 | Inventory → Products: type `SF101`. | Every pallet of it lights up on the warehouse map, tinted by expiry; expired stock in black. | |
| 4.2 | Choose "All Sunfield". Switch to the table. | Every Sunfield pallet, oldest arrival first. | |
| 4.3 | "Export stock report" for one brand. Open the `.xlsx` in Excel or Google Sheets. | Grey bold header, frozen, filters. Cases per product, a by-brand sheet, every pallet location. Only that brand. | |
| 4.4 | Export two brands with "One file per brand". | Two files; neither has the other brand's rows. | |
| 4.5 | As `owner`: Edit product → change its name → review before/after → reason → save. | Name changes everywhere; its stock and orders stay with it; Logs → Products shows the edit. | |
| 4.6 | Inventory → Inventory: open any slot. Use the arrow keys. | A drawer with each product's code, brand, lot, best-before, arrival, history; arrows step to the next slot. | |
| 4.7 | "Move pallet" → pick an empty slot → leave the reason blank, then fill it in. | Refused without a reason; with one, it moves and Logs shows a `move`. | |
| 4.8 | As `owner`: "Adjust stock here" → change the cases → review → reason → confirm. | Saved and in Logs with before/after and the reason. | |
| 4.9 | As `owner`: Count → start a count of one rack (try "blind"). | The count opens for everyone. | |
| 4.10 | As `worker` or `coordinator` in another tab: count with the keyboard (arrows, Enter, `?` for the key list). Type a different number in a few slots. Paste two rows copied from Excel. | Numbers save; pasted rows fill in. | |
| 4.11 | As `owner`: review the differences. Apply one correction with a reason; keep the system number for another. | Only the applied slot changes (logged as `count-correction`). Uncounted slots never change. | |
| 4.12 | Inventory → Products: try each filter (in stock, expiring, partial, client, brand) and each sort. | The list changes to match; codes typed at the start sort by code. | |
| 4.13 | Inventory → Inventory: sort and search the table, export it, print it, then switch to rack by rack. | Occupied, partial, mixed, expiring and expired counts are right; fill levels show per rack. | |

## 5. Out-bounds: orders, PDF reading, picking, labels

Make a small test order PDF first: in Word or Google Docs, type a store name, a PO number, a due date and 3 lines like `SF101  Jasmine Rice  12 cases`, then "Save as PDF". Also take a phone photo of a printed page and save it as a PDF (a "scanned" one).

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 5.1 | As `coordinator`: Out-bounds → Orders → New order. Type 2 lines. | Saved as a draft. | |
| 5.2 | Read your test PDF. | Codes, cases, store, due date and PO filled in. Lines matched only by name are flagged. | |
| 5.3 | Read the "scanned" PDF. | It says there's no text to read and lets you type the order in. | |
| 5.4 | Out-bounds → Inbox: open a sample email → "Draft an order". Then "Paste an email" with your own text. | Drafts appear for the right client. | |
| 5.5 | Open a draft → "Approve & plan picks". | Pick list in walking order: location, cases to take, what's left, lot, best-before, arrival. Oldest stock first; open pallets used up before a full one is opened; no expired stock. | |
| 5.6 | Make an order for more cases than exist. | The line shows "short". | |
| 5.7 | Make two orders for the same product. | The second order doesn't plan cases already planned for the first. | |
| 5.8 | On the map, click a product in the pick list. | Only its pallets show, numbered in walking order. | |
| 5.9 | Confirm a pick. Check the slot. Undo it. | Stock goes down (`pick`), then back (`pick-undo`). | |
| 5.10 | Take fewer cases than planned. | A reason is required; that pallet is flagged for a recount and the rest is planned from the next oldest pallet. | |
| 5.11 | Download the pick list (.xlsx) and print it. | Readable, same walking order. | |
| 5.12 | Take an order to shipped. Cancel another after picking. | Status goes draft → approved → picking → picked → shipped. The cancelled order's cases go back on their pallets. | |
| 5.13 | As `owner`: Manage warehouse → Warehouse → Picking: change to FEFO. Approve a new order. | Picks now go by earliest best-before. Change it back. | |
| 5.14 | Out-bounds → Labels: fill from an order. Preview. | One label per case, with logo, product, best-before and footer. | |
| 5.15 | Download the PDF; print the alignment test on plain paper at **Actual size (100%)**, hold it over a label sheet. | Lines up with the labels. If you have a sheet, print real labels and photograph them. | |
| 5.16 | Set a start position (e.g. label 4) for a part-used sheet. | Printing starts at label 4. | |
| 5.17 | Out-bounds → Dashboard. | Orders going out, due soon and to approve match the Orders list. | |

## 6. Tasks, Work and forklift screens

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 6.1 | As `coordinator`: Tasks → "Move a pallet" → say which pallet → give to the worker. | The task appears on the worker's Work screen within a few seconds (other tab). | |
| 6.2 | As `worker`: Work → "Move a pallet" (ask the WMS for a slot). | The WMS gives the nearest free slot on the same rack side and makes a task. | |
| 6.3 | Finish a move task as `worker`. | Stock moves; Logs shows it. | |
| 6.4 | Tasks → Teams: make a team with the worker; give a task to the team. | Any team member can take it. | |
| 6.5 | Tasks → Workers. | Each person's status and current task. | |
| 6.6 | Give an order to pack to the worker. | It shows on the worker's Work screen; orders not given to them don't. | |
| 6.7 | As `owner`: Manage warehouse → Warehouse → Announcements: post one marked urgent. | It shows on top of home and the Work screen. | |
| 6.8 | As `worker` on a tablet or phone: open `#/work/forklift`. | Full screen, very large type, one task at a time, big buttons, next tasks, latest message. The screen doesn't go to sleep. | |

## 7. Messages

Use two tabs: `owner` in one, `worker` in the other.

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 7.1 | Owner: Messages → New → pick the worker → send a message. | It appears in the worker's tab within a few seconds. | |
| 7.2 | Worker: open it, but scroll so only part is on screen. Then show all of it. | It counts as read only once most of it has been on screen. | |
| 7.3 | Make a group chat with 2+ people. As its creator, rename it, change members, delete it. | All work; others can't do this to your group. | |
| 7.4 | Type a slot code (e.g. `03A-02-L1-B1`), `@coordinator`, `#SF101`. | They turn into chips. Clicking the slot opens the map with it pulsing; the product shows all its pallets by expiry. | |
| 7.5 | Type a code that doesn't exist (`99Z-99-L9-B9`). | Stays plain text. | |
| 7.6 | Open an order's thread. | Only people allowed to see that brand are members. | |
| 7.7 | On a phone, attach a photo with the camera. Send one marked urgent. | Photo shows; urgent is marked. | |
| 7.8 | Put the worker's tab in the background for 5+ min. | The worker shows as Away. | |
| 7.9 | Send a message with a slot and product in it, then check Inventory. | Nothing changed: chat never changes stock. | |

## 8. QR slot pages

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 8.1 | As `owner`: Manage warehouse → Racks → QR labels. Print or show on screen. | One QR per rack and one per column. | |
| 8.2 | Scan a column QR with a phone camera (signed out). | Sign-in comes first, then the column level by level. (No phone: type `#/slot/03A-02` in the address.) | |
| 8.3 | Scan a rack QR (or `#/slot/rack/3`). | The rack's columns as big numbers. | |
| 8.4 | Tap a slot. Change its cases with a reason. | Saved; owners see it in Logs (`stock/scan-adjust`). | |
| 8.5 | As `owner`, turn off "Correct a slot after scanning it" for workers. Try 8.4 as `worker`. | The worker can look but not change. Turn it back on. | |

## 9. Client portal

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 9.1 | Open `demo/portal.html`, sign in as `buyer` (password + code). | Only Sunfield's products: code, name, size, units. No stock, no slots, no other brands. | |
| 9.2 | Place an order. | In the owner's tab it appears as a draft in Out-bounds (source "portal"), with a Logs line. | |
| 9.3 | Announce a delivery (2 pallets). | It appears in In-bounds → Incoming, one line per pallet. | |
| 9.4 | Approve and ship the order in the warehouse app. Refresh the portal. | The portal shows the new status only. | |
| 9.5 | Sign in as `buyer` on the warehouse app (`demo/`), and as `owner` on the portal. | Both refused: client and warehouse logins are separate. | |
| 9.6 | As `owner`: Manage warehouse → Clients: make a new client login, reset it, turn it off. Try signing in with it. | The password is asked again before each step; a turned-off login can't sign in. Each step is in the security log. | |

## 10. Ops console

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 10.1 | Open `demo/ops.html`, sign in as the console `owner`. | Every warehouse's health, people counts and setup checklist. **No** stock, orders or messages. | |
| 10.2 | Try a warehouse login (`coordinator`) on the console. | Refused. | |
| 10.3 | Ask for support access to the demo warehouse. In the warehouse app as `owner`: Manage warehouse → Support → approve (time-limited, look-only). | The console gets a one-time link that opens the warehouse look-only. The owner can end it any time. Both logs record it. | |
| 10.4 | Use emergency access. | Opens at once; every owner gets an email (Preview pill). | |
| 10.5 | Create a new warehouse ("Test Two"). | It appears in the list, with its own setup checklist; invite its first owner. | |
| 10.6 | Warehouses → demo warehouse → Slot codes: try to change the format. Then try on "Test Two". | Refused for the demo (it has stock); allowed for Test Two (no stock yet). | |
| 10.7 | Restore an owner's access to the demo warehouse. | Your password is asked again; a link appears in the Preview pill. | |
| 10.8 | Team → invite someone to the console team. | An invite email in the Preview pill. | |
| 10.9 | Activity, then Errors. | Activity lists what you did in 10.3–10.8. Errors shows counts only, no warehouse data. | |

## 11. Spanish

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 11.1 | On the sign-in screen, switch to Español. | The sign-in screen is in Spanish. | |
| 11.2 | Signed in: Settings → Appearance → Español. Visit every section. | Menus, buttons, hints in Spanish (tarima, espacio, caja, surtir, acomodar). Write down any English left over. | |
| 11.3 | Check names, codes, messages people typed, exported `.xlsx` and labels. | These stay as they are (not translated), by design. | |
| 11.4 | Local preview only: in the browser console type `window.__wmsMissing`. | Lists any text seen with no translation. Paste it into the notes. | |

## 12. Offline and sync

Two tabs: `owner` and `coordinator`.

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 12.1 | Coordinator tab: Settings → Developer → "Simulate offline". Move a pallet and send a message. | The save pill shows changes waiting. The owner's tab doesn't see them yet. | |
| 12.2 | Reload the coordinator tab while still offline. | The waiting changes are still there. | |
| 12.3 | Turn "Simulate offline" off. | Changes send; the owner's tab shows them within a few seconds. | |
| 12.4 | Offline in the coordinator tab, move pallet X. In the owner tab (online), move the same pallet X somewhere else. Go back online. | The pallet ends up in exactly one slot, its cases counted once (never doubled or lost). The coordinator's tab catches up; if its move no longer makes sense, it says so. | |
| 12.5 | On a real phone: airplane mode, do a pick or move, turn airplane mode off. | Same as 12.1–12.3. | |

## 13. Isolation between warehouses

The browser demo opens one warehouse's app at a time, so part of this is checked by the automated tests.

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 13.1 | After 10.5, look at "Test Two" in the console. | Its own counts; none of the demo warehouse's people or data. | |
| 13.2 | Repeat 9.1 and 2.7. | A client and a brand-limited worker see only their own brands. | |
| 13.3 | On a computer with Node: `npm --prefix app install`, `npm --prefix server install` and `npm --prefix infra install` once, then `npm test` in the project folder. | All tests pass, including `isolation.test.ts` (two warehouses with marker data; neither can read the other's). Save the summary lines (tests, pass, fail). | |

## 14. Everyday quality (quick checks)

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 14.1 | Open the demo on a phone. | Readable without zooming; menu at the bottom. | |
| 14.2 | Settings: dark theme, frost levels, moving background off. | All readable. | |
| 14.3 | Help (the ? button in the top bar) → the tour and a "How do I…" guide. | The guide's link opens the right screen. | |
| 14.4 | Use the app for 10 minutes on a phone. | No freezing; screens open in about a second. | |

## 15. Home, account and managing the warehouse

| # | Try this | What should happen | P / F / Notes |
| --- | --- | --- | --- |
| 15.1 | As `owner`: Home → "Widgets": pick a few, change their order. Reload. | Your choice is kept. | |
| 15.2 | Open each home update card (orders going out, due soon, to approve, deliveries, expiry, returns, count differences). | Each number matches the screen it opens. | |
| 15.3 | On a wide screen, tuck Messages away to the side, then bring it back with the tab on the right edge. | Works both ways. | |
| 15.4 | Watch "Stock by brand · live" while the worker picks in another tab. | The numbers change by themselves. | |
| 15.5 | Account → "Sign out everywhere". | Every tab signed in as that person is signed out. | |
| 15.6 | Manage warehouse → Warehouse: change the warehouse name. | The new name shows for everyone. Change it back. | |
| 15.7 | Manage warehouse → Racks: add a column to a rack. | It shows on the map. Slot codes can't be changed here ("Ask the Lattice team"). | |
| 15.8 | Manage warehouse → Clients: add a contact, then an email routing rule (sender address → client, orders). Out-bounds → Inbox → "Paste an email" from that sender. | The email lands under that client as an order. | |
| 15.9 | Manage warehouse → Logs. Then Logs as `coordinator`. | The owner sees every change from today, sign-ins and account changes, with who and when. The coordinator sees only the pallet log. | |
| 15.10 | Manage warehouse → Setup: download the `.xlsx` template, add 2 products and opening stock (make one row wrong on purpose), upload it. | The wrong row is pointed out by row number; the good rows go in with their arrival date. ("Start over" afterwards.) | |
| 15.11 | Setup → "Download a copy (.json)". | A file with the warehouse's data. | |
| 15.12 | Open the demo site's front page. Hover or tap the logo's square; open Features, How it works, Your data. | The menu drops down; each page opens; animations play (and stop if the device asks for less motion). | |
| 15.13 | Local preview only: `/landing.html` → "Book a visit", send the form. | The request shows in the console's Visits. | |

---

## Timing: old way vs. Lattice

Pick the tasks the warehouse actually does every week. Time the old Google Sheets way with someone who does it today if you can (or time yourself and say so). Time Lattice on the demo. Do each 2–3 times and use the middle time.

| Task | Old way (Sheets): how | Old time | Lattice time | Mistakes old / new | Notes |
| --- | --- | --- | --- | --- | --- |
| Find every pallet of one product | Search across rack tabs | | | | |
| Receive a 5-pallet delivery and choose slots | Look for empty rows, type locations | | | | |
| Build a pick list for a 5-line order, oldest stock first | Search tabs, compare dates | | | | |
| Make case labels for that order | Order Label Maker / by hand | | | | |
| Stock report for one brand | Copy rows into a new sheet | | | | |
| Count one rack and find the differences | New copy of the workbook, compare by eye | | | | |
| Know who moved a pallet last week | Ask around / sheet history | | | | |

---

## Report template

Use [test-report-template.md](test-report-template.md): a summary page, the full checklist of features by test number, the bug list, feedback, timing, and what isn't built yet.

---

## What this proves (for a non-technical reader)

**What was tested.** Every part of the warehouse system was tried by hand, step by step, the way the owners, coordinators, workers and brands would use it: signing in, receiving goods, putting pallets away, finding stock, counting, taking orders, picking, printing labels, messaging, and the brands' own ordering page. Each step was marked pass or fail, with screenshots of anything that went wrong.

**Why the results count.** The demo isn't a mock-up. It runs the same server code and the same kind of database (PostgreSQL) that will run in the real warehouse, just inside the browser instead of on Amazon's servers. If a rule works here (only owners can change stock directly, a worker can't confirm a delivery, a brand sees only its own products), it is the same rule in the real thing.

**What it shows:**

- **The two things the warehouse can't do without work every time.** A delivery reported on one screen shows up on the others within seconds, and the stock numbers agree on every screen and in every report, after deliveries, moves, picks, corrections and counts. This was run three times from a clean start, including double taps, two people doing the same thing at once, and a device going offline.
- **It does the warehouse's real work**, end to end: a delivery comes in, gets a slot, is picked for an order oldest-first, and gets case labels, with every move recorded.
- **Mistakes are harder to make**: stock changes need a reason, workers are given the slot, expired stock can't be picked, and two people can't move the same pallet at once.
- **People only see what they should**: workers, coordinators, owners and each brand see different things, and two warehouses never see each other's data.
- **It keeps working with bad Wi-Fi**: changes wait on the phone and send when the connection comes back.
- **It's faster than the spreadsheets**: see the timing table.
- **Testing cost nothing**: no servers, no cloud bill.

**What it doesn't prove yet** (to be honest about it):

- How fast it is with the whole team on it at once, on Amazon's servers, and live updates between different devices (a phone and a computer). The free demo keeps each browser's warehouse in that browser, so live updates were tested between windows of one browser. Both need the staging setup on AWS.
- Real emails to the order inbox, real nightly backups to the NAS, and text alerts. These are built but only run on AWS.
- A real day in the warehouse. The go-live plan is one full 3-day count loaded into the app; a week of use after that is the real proof.

**On cost:** PostgreSQL, the database Lattice uses, is free and open source, like MongoDB. What costs money is the place it runs (AWS), which any database would need. The choice of PostgreSQL is about keeping stock numbers exact when several people change them at once, which this plan tests in C3.
