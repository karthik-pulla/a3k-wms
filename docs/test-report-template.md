# Lattice test report

Copy this file once per test run (e.g. `test-report-2026-11-05.md`) and fill it in. The steps for each check are in [test-plan.md](test-plan.md) under the same number.

## 1. About this run

| | |
| --- | --- |
| Date | |
| Tester | |
| Where | demo site / local preview |
| Demo reset ("Start over") on | |
| Computer and browser | |
| Phone or tablet and browser | |
| Time spent testing | |
| Others who tried it (name, role) | |

**How to mark each check:** **P** pass · **F** fail · **~** partly works · **–** not tried. Every **F** and **~** gets a line in the bug list (section 5) and a screenshot named by its number, e.g. `4.7-count-review.png`.

## 2. Summary

**Critical checks (in-bounds and inventory): must be 30 / 30 on all three runs.**

| Critical | Checks | Run 1 passed | Run 2 passed | Run 3 passed |
| --- | --- | --- | --- | --- |
| C1. In-bound reported, updates live | 14 | | | |
| C2. Inventory stays right | 8 | | | |
| C3. Under pressure | 8 | | | |
| **Total** | **30** | | | |

**Ledger matched on every step, every run:** yes / no

**Everything else:**

| Area | Checks | P | ~ | F | – |
| --- | --- | --- | --- | --- | --- |
| 1. Sign-in and two-factor | 12 | | | | |
| 2. Roles and switches | 8 | | | | |
| 3. In-bounds and put-away | 13 | | | | |
| 4. Inventory and counts | 13 | | | | |
| 5. Out-bounds | 17 | | | | |
| 6. Tasks and Work | 8 | | | | |
| 7. Messages | 9 | | | | |
| 8. QR slot pages | 5 | | | | |
| 9. Client portal | 6 | | | | |
| 10. Ops console | 9 | | | | |
| 11. Spanish | 4 | | | | |
| 12. Offline and sync | 5 | | | | |
| 13. Isolation | 3 | | | | |
| 14. Everyday quality | 4 | | | | |
| 15. Home, account, managing | 13 | | | | |
| **Total** | **129** | | | | |

**Automated tests (`npm test`):** ____ passed, ____ failed

**Bugs found:** (any critical fail counts as a blocker) ____ blocker · ____ major · ____ minor · ____ cosmetic

**In one sentence:** ____

## 3. Critical checks: in-bounds and inventory

Three windows side by side: A `coordinator`, B `owner`, C `worker`. "Live" = within 5 seconds without reloading. Each run starts with "Start over". Mark each run **P** or **F** only (no "partly").

**Run dates:** run 1 ____ · run 2 ____ · run 3 ____ **Product used:** ____

### C1. An in-bound is reported and updates live

| # | Check | Run 1 | Run 2 | Run 3 | Notes |
| --- | --- | --- | --- | --- | --- |
| C1.1 | "Before" numbers written in the ledger | | | | |
| C1.2 | New delivery shows in B within 5 s | | | | |
| C1.3 | Arrival shows in B's Pending within 5 s | | | | |
| C1.4 | Short delivery confirmed; 2 empty slots; tasks reach C live; stock not added yet | | | | |
| C1.5 | First pallet in slot: B shows it live with lot, best-before, arrival | | | | |
| C1.6 | Total = before + what arrived (98), everywhere | | | | |
| C1.7 | Logs: one line per step, who, slot, time | | | | |
| C1.8 | Slot history shows the put-away | | | | |
| C1.9 | Still there after reload and quitting the browser | | | | |
| C1.10 | Mixed pallet: one slot, right cases per product | | | | |
| C1.11 | Damaged cases left out exactly | | | | |
| C1.12 | Back-to-back deliveries never share or reuse a full slot | | | | |
| C1.13 | Portal delivery notice shows in Incoming live | | | | |
| C1.14 | Exported report matches the screen | | | | |

### C2. The inventory stays right

| # | Check | Run 1 | Run 2 | Run 3 | Notes |
| --- | --- | --- | --- | --- | --- |
| C2.1 | Total matches the ledger after every step | | | | |
| C2.2 | Same total in all five places | | | | |
| C2.3 | Move: old slot empty, everything carried over | | | | |
| C2.4 | Mixed pallet moves as one | | | | |
| C2.5 | Never below 0; "short" when there isn't enough | | | | |
| C2.6 | Expired stock never planned | | | | |
| C2.7 | One log line per stock change, none extra | | | | |
| C2.8 | Looking, chatting, exporting change nothing | | | | |

### C3. Under pressure

| # | Check | Run 1 | Run 2 | Run 3 | Notes |
| --- | --- | --- | --- | --- | --- |
| C3.1 | Double-click / double-tap counted once | | | | |
| C3.2 | Two people confirm the same delivery: once | | | | |
| C3.3 | Two workers take the same task: one gets it | | | | |
| C3.4 | Same pallet moved twice at once: one slot | | | | |
| C3.5 | Last cases picked twice at once: never below 0 | | | | |
| C3.6 | Offline put-away + online confirm: both counted once | | | | |
| C3.7 | Window closed right after confirming: not lost, not doubled | | | | |
| C3.8 | 20-pallet delivery: all slots different, totals right, still quick | | | | |

### Stock ledger

One table per run. "Should be" = the previous line plus or minus what you did. Every "Shown" column must equal "Should be".

| Step | What I did | Change | Should be | Products | Sum of slots | Stock by brand | Inventory table | Export (.xlsx) | Match? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Start | — | — | | | | | | | |
| C1.5 | Pallet 1 put away | +50 | | | | | | | |
| C1.6 | Pallet 2 put away | +48 | | | | | | | |
| C1.10 | Mixed pallet put away | +20 | | | | | | | |
| C1.11 | Delivery with 3 damaged put away | +47 | | | | | | | |
| C2.1 | Pallet moved | 0 | | | | | | | |
| C2.1 | Order picked | −7 | | | | | | | |
| C2.1 | Owner adjustment | −2 | | | | | | | |
| C2.1 | Count correction | +1 | | | | | | | |
| C2.8 | Messages, maps, exports | 0 | | | | | | | |
| End | | | | | | | | | |

## 4. Feature checklist

### 1. Sign-in and two-factor

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 1.1 | Password, then asks for a 6-digit code | | |
| 1.2 | Code accepted, reaches home | | |
| 1.3 | Sign out; Back shows no data | | |
| 1.4 | 5 wrong passwords lock the username for 30 s | | |
| 1.5 | Unknown username gets the same answer | | |
| 1.6 | Wrong code refused | | |
| 1.7 | "Keep me signed in" | | |
| 1.8 | Owner invites someone; email in Preview pill | | |
| 1.9 | Weak passwords refused (short, common, has username) | | |
| 1.10 | New person signs in with the given role | | |
| 1.11 | "Reset sign-in" stops the old password | | |
| 1.12 | Password asked again before account changes | | |

### 2. Roles and switches

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 2.1 | Worker sees only Work, Inventory, Messages | | |
| 2.2 | Worker typing `#/outbounds` is turned away | | |
| 2.3 | Coordinator's menu (no Manage warehouse) | | |
| 2.4 | Owner-only actions hidden from coordinator | | |
| 2.5 | Turning a switch on/off for a role ("Edit products") | | |
| 2.6 | Making a custom role | | |
| 2.7 | Brand limits: other brands show as "hidden" | | |
| 2.8 | Owner-only powers can't be given to other roles | | |

### 3. In-bounds and put-away

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 3.1 | Delivery details (brand, supplier, lot, best-before, cases, pallets, container/BOL) | | |
| 3.2 | Add a delivery by hand | | |
| 3.3 | Mixed pallet (same pallet number = one slot) | | |
| 3.4 | "Mark as arrived" → Pending | | |
| 3.5 | Worker can't confirm a delivery | | |
| 3.6 | Confirm → put-away plan; damaged cases left out | | |
| 3.7 | Stock not added until the pallet is in the slot | | |
| 3.8 | Worker confirms "It's in the slot" → stock added | | |
| 3.9 | Choosing another slot needs a reason | | |
| 3.10 | "Slot is blocked" gives the next free slot | | |
| 3.11 | Return back into stock → pending in-bound | | |
| 3.12 | Return write-off / back to brand / reject: no stock change | | |
| 3.13 | In-bounds dashboard numbers | | |

### 4. Inventory and counts

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 4.1 | Product search lights up pallets on the map by expiry | | |
| 4.2 | "All <brand>" and the table, oldest first | | |
| 4.3 | Stock report `.xlsx` for one brand | | |
| 4.4 | "One file per brand" keeps brands apart | | |
| 4.5 | Edit product: review, reason, logged; stock stays | | |
| 4.6 | Slot details drawer; arrow keys | | |
| 4.7 | Move pallet needs a reason; logged | | |
| 4.8 | Owner "Adjust stock here": review, reason, logged | | |
| 4.9 | Owner starts a count (one rack, blind) | | |
| 4.10 | Counting with the keyboard; pasting from Excel | | |
| 4.11 | Reviewing differences; only applied slots change | | |
| 4.12 | Product filters and sorts | | |
| 4.13 | Inventory table: sort, search, export, print, rack view | | |

### 5. Out-bounds

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 5.1 | New order typed in → draft | | |
| 5.2 | Reading an order PDF | | |
| 5.3 | Scanned PDF: told to type it in | | |
| 5.4 | Inbox: email → draft; "Paste an email" | | |
| 5.5 | Approve & plan picks: walking order, oldest first, open pallets first, no expired | | |
| 5.6 | Not enough stock → "short" | | |
| 5.7 | Second order doesn't take cases planned for the first | | |
| 5.8 | Map shows one product's pallets, numbered | | |
| 5.9 | Confirm a pick and undo it | | |
| 5.10 | Taking fewer: reason, recount flag, replanned | | |
| 5.11 | Pick list `.xlsx` and print | | |
| 5.12 | Status through to shipped; cancel puts cases back | | |
| 5.13 | Picking rule (FEFO) in Manage warehouse | | |
| 5.14 | Labels from an order: preview | | |
| 5.15 | Label PDF and alignment test at Actual size | | |
| 5.16 | Start position on a part-used sheet | | |
| 5.17 | Out-bounds dashboard numbers | | |

### 6. Tasks and Work

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 6.1 | Coordinator gives a move task to a worker | | |
| 6.2 | Worker asks the WMS for a slot | | |
| 6.3 | Finishing a move task moves the stock | | |
| 6.4 | Team tasks: any member takes it | | |
| 6.5 | Tasks → Workers status | | |
| 6.6 | Orders to pack go only to the chosen worker | | |
| 6.7 | Announcements on home and Work | | |
| 6.8 | Forklift mode on a tablet or phone | | |

### 7. Messages

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 7.1 | Direct message arrives in the other tab | | |
| 7.2 | Read only once most of it was on screen | | |
| 7.3 | Group chat: create, rename, members, delete | | |
| 7.4 | Slot, person and product chips; map opens | | |
| 7.5 | Wrong slot code stays plain text | | |
| 7.6 | Order thread members limited by brand | | |
| 7.7 | Photo from the camera; urgent flag | | |
| 7.8 | Away status after 5 min in the background | | |
| 7.9 | Chat never changes stock | | |

### 8. QR slot pages

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 8.1 | QR labels for racks and columns | | |
| 8.2 | Column QR: sign-in first, then levels | | |
| 8.3 | Rack QR: columns as big numbers | | |
| 8.4 | Correcting a slot with a reason; logged | | |
| 8.5 | Switch off "Correct a slot after scanning it" | | |

### 9. Client portal

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 9.1 | Buyer sees only their brand's products, no stock | | |
| 9.2 | Portal order → draft in Out-bounds | | |
| 9.3 | Delivery notice → Incoming, one line per pallet | | |
| 9.4 | Status shows in the portal | | |
| 9.5 | Client and warehouse logins don't cross | | |
| 9.6 | Owner makes, resets, turns off a client login | | |

### 10. Ops console

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 10.1 | Health and counts only; no stock, orders or messages | | |
| 10.2 | Warehouse login refused on the console | | |
| 10.3 | Support access: ask, owner approves, look-only, ended | | |
| 10.4 | Emergency access emails every owner | | |
| 10.5 | Create a new warehouse | | |
| 10.6 | Slot codes change only with no stock | | |
| 10.7 | Restore an owner's access | | |
| 10.8 | Invite to the console team | | |
| 10.9 | Activity and Errors pages | | |

### 11. Spanish

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 11.1 | Spanish on the sign-in screen | | |
| 11.2 | Every section in Spanish (list any English left) | | |
| 11.3 | Names, codes, messages, files stay untranslated | | |
| 11.4 | `window.__wmsMissing` list (local preview) | | |

### 12. Offline and sync

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 12.1 | "Simulate offline": changes wait, save pill shows them | | |
| 12.2 | Waiting changes survive a reload | | |
| 12.3 | Back online: changes send and show in the other tab | | |
| 12.4 | Same pallet moved in two places: ends up in one slot | | |
| 12.5 | Airplane mode on a real phone | | |

### 13. Isolation

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 13.1 | New warehouse has none of the demo's data | | |
| 13.2 | Client and brand-limited worker see only their brands | | |
| 13.3 | `npm test` incl. `isolation.test.ts` | | |

### 14. Everyday quality

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 14.1 | Phone layout | | |
| 14.2 | Dark theme, frost, moving background | | |
| 14.3 | Help, tour, "How do I…" guides | | |
| 14.4 | Speed on a phone over 10 minutes | | |

### 15. Home, account and managing the warehouse

| # | Feature / function | Result | Notes |
| --- | --- | --- | --- |
| 15.1 | Choosing and ordering home widgets | | |
| 15.2 | Home update cards match their screens | | |
| 15.3 | Tucking Messages away and back | | |
| 15.4 | "Stock by brand · live" updates by itself | | |
| 15.5 | "Sign out everywhere" | | |
| 15.6 | Changing the warehouse name | | |
| 15.7 | Adding a rack column; slot codes locked | | |
| 15.8 | Client contacts and email routing | | |
| 15.9 | Logs: owner sees all, coordinator the pallet log | | |
| 15.10 | Setup `.xlsx` template: bad rows pointed out | | |
| 15.11 | "Download a copy (.json)" | | |
| 15.12 | Landing page and its menu | | |
| 15.13 | "Book a visit" → console Visits (local preview) | | |

## 5. Bugs

**How bad is it?**

- **Blocker:** any critical check (C1–C3) failing, wrong stock numbers, data shown to someone who shouldn't see it, data lost, or you can't go on.
- **Major:** a feature doesn't work, but there's a way around it.
- **Minor:** works, but something is wrong or awkward.
- **Cosmetic:** looks off (spacing, colour, wording, a word left in English).

**Bug list**

| Bug # | Check # | How bad | What happened | Screenshot | Every time? | Status |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | | | | | yes / sometimes / once | open / fixed / won't fix |
| B2 | | | | | | |
| B3 | | | | | | |

**Bug details** (copy this block for each bug)

> **B__ · Check __ · How bad: ____**
>
> **Device and browser:**
>
> **Signed in as:** owner / coordinator / worker / buyer / console
>
> **Steps to make it happen again:**
> 1.
> 2.
> 3.
>
> **What should have happened:**
>
> **What happened instead:**
>
> **Screenshot(s):**
>
> **Error text on screen (copy it word for word):**
>
> **Fixed?** no / yes, on ____ (commit ____) · **Checked again after the fix:** ____

## 6. Feedback

Not bugs: things that work but could be better. Write down what people say in their own words.

| # | Screen | What was said or noticed | From (name, role) | Kind | Worth doing? |
| --- | --- | --- | --- | --- | --- |
| F1 | | | | confusing / slow / missing / idea / liked it | now / later / no |
| F2 | | | | | |
| F3 | | | | | |

**What people liked most:**

**What confused people most:**

**What they asked for that isn't there:**

## 7. Time: old way vs. Lattice

Use the middle of 2–3 tries. Say if the old-way time is measured or estimated.

| Task | Old way (Sheets) | Lattice | Saved | Mistakes old / new | Measured or estimated |
| --- | --- | --- | --- | --- | --- |
| Find every pallet of one product | | | | | |
| Receive a 5-pallet delivery and choose slots | | | | | |
| Pick list for a 5-line order, oldest first | | | | | |
| Case labels for that order | | | | | |
| Stock report for one brand | | | | | |
| Count one rack and find the differences | | | | | |
| Find who moved a pallet last week | | | | | |

## 8. Not built yet (don't mark as fails)

These are planned or only work on AWS, so the in-browser demo can't show them:

- Damage report PDF for the supplier (damaged cases are kept out of put-away and listed, but there's no PDF yet).
- Expiry alerts and urgent-message alerts by email or text (urgent alerts only go to the browser console for now).
- Real emails to the order inbox, and real invite emails (the demo shows them in the Preview pill).
- Nightly backups to the NAS.
- Safety broadcasts in Messages.
- Speed with the whole team at once on AWS.

## 9. Sign-off

| | Name | Date |
| --- | --- | --- |
| Tested by | | |
| Read by (supervisor) | | |

**Supervisor's comments:**
