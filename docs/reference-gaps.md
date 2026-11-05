# The WMS against A3K's real paperwork

Checked on 3 Nov 2026 against the four reference documents described in CLAUDE.md ("Reference documents"): a brand's sales order / packing slip (PDF), a packing list of incoming containers (.xlsx) and two A3K inbound reports (.xlsx) for one container split between two target customers. The files themselves are real business data and stay in `data/source/reference/` (not on GitHub). **This page describes their formats only**: no names, addresses, quantities, container numbers or other details from them.

The proposed changes are at the end, ranked, in-bounds and inventory accuracy first. **Changes 1–3 are done** (3 Nov 2026, not yet committed): announced vs received on every delivery, "Split into pallets" (and the portal's split), and the reader fixes; the reference slip now reads every line, with the store, sales order # and date, no PO and no due date.

## 1. Sales order / packing slip → the PDF order reader

**How it was tested.** The slip was put through the app's own code outside the browser: the same pdf.js text grouping as `pdfText` and the real `readOrder` (`app/src/outbound/reader.ts`) with A3K's `products.json`, exactly as Out-bounds → New order → "Read from a PDF…" calls it. The same reader serves the Labels tab ("Read a PDF order…"), PDFs attached to inbox emails and delivery notices read into New delivery (`NewShipment.tsx`), so all of them behave the same.

**Format of the slip.**
- Header: sender (the brand) with address; `DATE` and `SALES ORDER #` as labels on one line and their values on the line below; `BILL TO` / `SHIP TO` / `PO #` / `SHIP METHOD` labels, with the bill-to and ship-to blocks side by side (name, street, city). In this slip the PO # and ship method are empty.
- Table `# · DESCRIPTION · WT. · QTY`. Each product takes **two text lines**: line number + full item text in bold (`<Category>:<Brand>:<size>:<code>` or `<Line>:<Variant>:<code>`; the code is always the last part), then the description with weight and quantity, both written with two decimals (`…00`).
- The table continues on page 2, where the whole header (sender, date, SO #, bill/ship to, column titles) is repeated. The last page ends with a `TOTAL WT.` line.

**Result: the reader reads none of the product lines.** The draft order would come out empty, with every product line in "needs a look". Checked point by point:

| Check | Result | Why |
| --- | --- | --- |
| Item code | ✗ not found | Codes are looked up as whole words; `Rice:…:1053` is one word, so the code inside it is never seen. |
| Cases | ✗ not found | Quantities are written `55.00`; only whole numbers are taken as cases. Worse: on a line where the code *was* found, the last whole number left is the line number (`1`, `2`…), so the order would quietly ask for 1 case. |
| Two-line rows | ✗ | The code is on one line, the quantity on the next; the reader looks at one line at a time. |
| Two-page continuation | ✗ (same causes) | Page 2's line isn't read either. The repeated header on page 2 adds its address lines to "needs a look" a second time. |
| `TOTAL WT.` line | ✓ | Not taken as a product and not listed (the word "total" is skipped). |
| Lowercase `20lbs` | ✓ once codes are read | Matching by code ignores the size text, so `20lbs*2` vs the product list's `20LBS*2` doesn't matter. |
| `NKB:Regular:<code>` vs the list's `NKBR:<size>:<code>:<Name>` | ✓ once codes are read | Same: matched by the code alone. Every code on the slip exists once in A3K's product list, all for one client. |
| Store | ✗ | The store is recognised only if it already appears on an earlier order in the WMS; a new store is never filled in, and the `SHIP TO` block isn't read. |
| Sales order # | ✗ | Not looked for. The value sits on the line *below* its label. Orders have no field for it (only `ref`, the store's PO). |
| PO # | ✗ wrong | With the PO # empty, the PO pattern takes the next word on the label line (`SHIP` from `SHIP METHOD`) as the PO number. |
| Date | ✗ wrong field | The slip's `DATE` (the order date) is taken as the **due date**. The slip has no due date. |
| Client | ✓ once codes are read | Decided by which client most codes belong to. |

**Experiment (not in the app).** Splitting the item text at `:` and joining each item line with the line after it, with `.00` dropped, made the reader find every line with the right code and quantity, the codes that differ in wording included. So the fix is small and contained in `reader.ts`.

## 2. Packing list of incoming containers → In-bounds → Incoming

**Format.** One sheet. A merged title cell top left. Then five header rows, with a value per container column (columns G onwards), labelled only by position:
1. the supplier's invoice / reference number,
2. a free-text order note (several columns can share it),
3. the shipping line,
4. the arrival (ETA) date, stored as an Excel day number,
5. the container number.

The left cells of rows 3–4 hold a colour legend: cell fill colours carry a meaning that plain values don't. Row 6 holds the column titles `# · Product Code · Category · Size · Brand · Product Name`. Then one row per product, with the cases for each container in that container's column (empty = none). A `Total` row follows, with totals for only some of the containers; **after** the total row there is one more product row, which has no product code (not a product the WMS keeps).

**Against A3K's product list.** Every code in the sheet exists and all belong to one client (the sheet's "Brand" column holds brands that A3K's list files under that client). Four codes are each shared by two products of that client (a normal pack and a BOGO pack with the same code); the sheet's size and name don't tell them apart, so a person must choose.

**Can Incoming be filled from it today? No.** New delivery (`NewShipment.tsx`) is typed in by hand, one line per pallet, or read from an email by the order reader (which doesn't read spreadsheets). There is no .xlsx import for deliveries. The app already has what an import needs: an .xlsx reader without a library (`utils/xlsxRead.ts`, with `excelDate`) and the row-by-row checking style of the setup template (`setup/importSheets.ts`).

**What an import needs.**
- Find the header rows and the product table by their labels and shape, not fixed row numbers (the title row and the legend move about).
- One delivery per container column: ETA → `expected`; container number → `ref` (Container / BOL); invoice/reference → a new "supplier reference" field (or `number`); shipping line and order note → notes (or a carrier field); cases per code → lines.
- Match codes within the client; when a code has several products (BOGO), ask, never guess. Rows with no code, unknown codes and blank cells are listed, not imported.
- Ignore the total row, but check each container's sum against it where there is one, and say so when they differ.
- A preview with a tick per container before anything is saved; importing the same file again must update the waiting deliveries for those containers, not add copies.
- Pallets are not on the packing list. Either leave the pallet split to arrival (see change 2 below) or estimate it from the product's cases per pallet.
- No lot or best-before on the packing list: they're filled in at receiving.

## 3. A3K inbound report → what the in-bound screens record

**Format.** One sheet per container per target customer (the file name carries the container number, the customer and DRY/FROZEN). A header block, a line table, then a footer of checks and signatures. The two reports checked are for **the same container split between two target customers**. Their items are written `Brand:Product` with **no item code**, from three brands (listed in CLAUDE.md) that **aren't in A3K's product list**, and the two target customers aren't A3K clients in the WMS either. Unit of count on the report: bags/cases. The new-palletization columns are formulas: full pallets = received ÷ per pallet (`QUOTIENT`), and the last column is the remainder (`MOD`), i.e. the cases on the one partial pallet.

| Inbound report field | In the WMS today | Gap |
| --- | --- | --- |
| Target customer | `client`, one per delivery | Customers must exist as clients (only the WMS team's config adds clients). One container across several customers = several deliveries with nothing tying them together. |
| Container # | `ref` (Container / BOL) | OK, but free text and not used to group or find deliveries. |
| SO/PO #, Ref # | none (only `number`, the WMS's own) | Missing. |
| Incoming date | `receivedAt` (set by "Mark as arrived") | OK. |
| Dry / frozen | none | Missing. Matters for where it may be stored. |
| Terms of delivery | none | Missing. |
| Delivery (trucker) | none on the delivery (carriers exist as contacts) | Missing. |
| Floor load | none | Missing (affects unloading time and new pallets). |
| 20 ft / 40 ft | none | Missing. |
| FDA hold | none | Missing, and important: goods on hold must not be pickable until released. |
| Demurrage | none | Missing. |
| Item | product (by id) | The report's items have no codes and aren't in the product list, so **these lines can't be received at all** today. |
| Lot / batch | `lot` per line | OK. |
| Best before | `bestBefore`, **month only** (YYYY-MM) | The report has a date column; the WMS keeps the month. |
| Pack size | product's size × units | OK (from the product). |
| Scheduled qty, per pallet, pallets | `cases` per line | The announced quantity is **overwritten** when Pending is edited; it survives only inside the Logs text. No scheduled-vs-received comparison. |
| Actual received qty, per pallet, pallets | the same `cases` field | See above. |
| Damages | `damaged` per line; "Some damage" on arrival | OK as numbers. The supplier damage report (photos, reason, PDF), an owner decision, isn't built: Pending only says the cases are "listed for the supplier's damage report". |
| New palletization: per pallet, TI × HI, full pallets, remainder | none; one line per pallet typed by hand. The product's `perPallet` exists (most A3K products have it) | No "split into pallets". The client portal splits a delivery **evenly** over the pallets asked for (e.g. three nearly equal pallets), which makes every pallet a partial one, against the owners' "keep partial pallets to a minimum". TI × HI isn't recorded. |
| Extra pallets used / new pallets used | none | Missing (a cost to the customer). |
| BOLs received | none | Missing. |
| Container inspection: roof, floor, debris, odour, pest activity | condition: all good / some damage | Missing. A food-safety record. |
| Received by | `receivedBy` | OK. |
| Final verification by | `confirmedBy` (the owner or coordinator who confirms) | OK. |
| Comments | `notes` | OK. |
| Crossdock or storage | none (only product codes containing CROSSDOCK sink in search) | Missing. A crossdock delivery shouldn't be put away into racks. |
| Tolls | none | Missing. |
| Full and partial pallets made / received | pallet count only | Missing as a summary. |
| The report itself | none | The WMS can't produce this report; it's filled in by hand today. |

## Proposed changes, ranked

In-bounds and keeping the inventory right come first (the warehouse's own priority).

1. **(done) Keep announced and received apart on every delivery line.** Add `expected` cases per line (set while the delivery is Incoming, frozen at "Mark as arrived"); Pending edits the received cases and damages. Show the difference per product on Pending and in the confirm step, require a reason when they differ, and log it as its own entry. This is the report's scheduled vs actual columns and the heart of receiving accurately. Needs a migration-free entity change, a reducer change, `ACTION_RULES` / `sync-checks.ts` updates and tests.
2. **(done) Split received cases into pallets the warehouse's way.** On Pending, "Split into pallets" per product: full pallets at the product's cases per pallet (editable, with optional TI × HI) plus one partial pallet for the remainder, exactly the report's QUOTIENT/MOD. Use the same rule in the client portal instead of the even split. Correct pallet sizes are what put-away, partial flags and the open-pallets-first picking rule depend on.
3. **(done) Fix the PDF order reader for brand sales orders** (`reader.ts`, used by New order, Labels, the inbox and delivery notices): look for codes inside `:`-separated item text (last part first); join a code line with the description/quantity line after it; read `55.00` as 55 and never take the line-number or weight column as cases; skip a header repeated on later pages; read `SALES ORDER #` (value on the next line) into a new "sales order #" field; leave the PO empty when its value is empty; take `DATE` as the order date, not the due date; take the store from `SHIP TO` (offering it as a new store). Add a test with a made-up slip in the same layout (no real data). With this, the reference slip reads fully.
4. **Receiving lines that aren't in the product list.** Today a container from a new customer or brand (items without codes) can't be received. Let a coordinator receive such a line as a provisional product (name and pack size as written), held on the receiving floor or put away with a flag, for an owner to complete (code, client, per pallet) in Inventory → Edit product; and let owners add a client in Manage warehouse → Clients instead of waiting for the WMS team's config.
5. **One container, several customers.** Group deliveries by container number: show the container with its deliveries (one per customer), mark it arrived once, and keep the dock and inspection details on the container.
6. **Container and receiving details on the delivery**: SO/PO #, ref #, dry/frozen, 20/40 ft, floor load, trucker, terms, FDA hold, demurrage, BOLs, new/extra pallets, tolls, crossdock or storage, and the container inspection checklist. FDA hold should keep the stock unpickable until an owner releases it (an inventory-accuracy rule, not just a note); crossdock should skip put-away and go straight to Out-bounds.
7. **Import the container packing list into Incoming** (section 2): one delivery per container column, with a preview and BOGO codes asked, re-import updates.
8. **Produce the inbound report and the supplier damage report** from a delivery (.xlsx like the warehouse's own, and a PDF with photos), per target customer, so nobody fills them in by hand.
9. **Best-before as a full date** where the paperwork gives one (keep month-only input for labels that only show a month). Small FEFO gain; needs a decision.
10. **Weight on orders** (per line and total, from the slip or from a product weight): useful for loading, not urgent.

Each of these touches the store, the server's action rules and checks, and tests; none needs a database migration except where a new server table is added (none of the above needs one: deliveries are synced pieces).
