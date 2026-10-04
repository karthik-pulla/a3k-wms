# Warehouse Management System (WMS)

A warehouse stores goods for several brands (Deccan, Matco/Falak, Anaganaga, Karachi-NKB, Millet Bank via Praj Natural Foods, and others). Today it runs on Google Sheets: one workbook per brand, one tab per rack, recopied for every count. This project replaces that with a WMS. Only the warehouse owners use it; brands never log in and only receive printed or emailed reports.

The full plan (data model, workflows, reports, security, rollout) is a living doc: https://claude.ai/code/artifact/a4a12e35-975f-4371-a3dc-90313c6c0a7e
Where this file and the plan disagree, this file is newer.

## Folder map

| Path | What it is |
| --- | --- |
| `data/source/` | Real inputs: the stock workbooks, logos, order-slip photos, a Deccan label example. Business data. Never edit or delete. |
| `data/csv/` | One CSV per workbook tab, made by `scripts/dump_workbooks.py` |
| `data/generated/` | `count.json` (rack layout, products, last sheet counts) and `label-catalog.json` (label products + logos) |
| `scripts/` | Python build steps, run in order by `npm run build` |
| `scripts/legacy-labels/` | One-off Millet Bank label scripts, superseded by the Label Maker |
| `tools/<tool>/template.html` | Source of each published tool. Data goes in at the single `/*DATA*/` marker. |
| `tools/<tool>/dist/` | Built pages that get published. Never edit by hand. |
| `outputs/` | Files handed to the owners: count sheets, label PDFs |
| `tests/` | `node --test` tests |
| `docs/images/` | Photo of the label sheet and the fit check used to measure it |

## Commands

- `npm run build`: workbooks → CSV → generated JSON → `tools/*/dist/*.html`. The generated JSON must come out byte-identical unless the inputs or scripts changed; check with `git diff data/generated`.
- `npm test`: checks the count page's Excel export keeps the stock workbook layout.
- `python3 scripts/make_count_sheet.py`: blank count workbook with product dropdowns (non-Deccan products) in `outputs/count-sheets/`.
- Preview a tool locally: start the `tools` server in `.claude/launch.json` and open `/tools/<tool>/dist/<tool>.html`. Add `<meta charset="utf-8">` to a test copy, because the published skeleton supplies it, not the template.

## Published tools (claude.ai artifacts)

| Tool | Link | Notes |
| --- | --- | --- |
| Warehouse Count | https://claude.ai/artifact/MWGTwdznXht8VpyEPsftQ9 | Keyboard count entry for every slot. Capabilities `db` + `downloads`. Counts live in the artifact database at `sessions/<countId>/r-<rack>/<location>` and `sessions/<countId>/areas/<location>`. |
| Order Label Maker | https://claude.ai/artifact/BCMHj1WC8Dqw7hJPoWHVAS | Case labels from an order slip. Capabilities `sample` + `downloads`. |
| Rack 6 Map | https://claude.ai/artifact/S3eUscK2fHuhEAp8CiHWFS | Early prototype of the rack map |

To update a tool: edit its `template.html`, run `npm run build`, then republish `tools/<tool>/dist/<tool>.html` to the same link (from a new conversation, pass the link as the artifact `url` so it updates rather than creating a new one). Keep the capabilities as listed above.

## Warehouse facts (owner-confirmed; these win over the sheets)

- **Location code**: `<rack><side>-<column 2 digits>-L<level>-B<bay>`, e.g. `6B-08-L3-B1`. L1 is the bottom beam, L4 the top. "B1/B2" is the bay (sub-column), unrelated to side B. Door 6 sides are `D6A`, `D6B`.
- **Floor spots**: `<side>-FLOOR-Pnn` (e.g. `6B-FLOOR-P01`) plus areas `NEARCOOLER-01`…`05`, `LINE-2-3` (Between line 2 & 3), `LANE-7`, `DOOR-2-3`, `LOAD-AREA` (sheet label `LOAD_AREA_01`), `RECV-FLOOR` (`Recv Floor`).
- **Rack sides**: 40 sides, 3,604 slots.
    - Rack 0: sides A, B, C, 10 columns each.
    - Racks 1A, 2A, 5A: A side only, 13 columns; 1A has the same layout as 2A.
    - Racks 3, 4, 6–14: sides A and B, 13 columns; 7B has 12.
    - Rack 15: 15A 8 columns, 15B 7. Racks 16, 18, 19: A and B, 8 columns each.
    - Rack 17A: 8 columns. Rack 20A: 6 columns. Door 6: A and B, 13 columns.
- **Column shape**: 4 levels × 2 bays = 8 pallets. Column 12 on 13-column racks has levels 3–4 only, with bays B1–B3. 3A-12 has B1–B3 only (owner removed B4). 10B-13 L2 has extra bays B3/B4 taken from the sheet; not yet confirmed.
- **Units** are cases. A product is identified by its full item text, e.g. `Rice:Deccan:10LBS*4:1073:SurtiKolam`; the 4-digit item code is the usual short form.

## Stock workbook format (do not change)

- Tabs: `Rack00`, `RACK01`…`RACK20`, `DOOR6`, plus `Anaganaga`, `NearCooler`, `DOOR2N3`, `Front`, `CSFloor`. The owners' old `RACK` tab is a Google Sheets QUERY over these exact tab names, so never rename them.
- Columns: Location, Item, No. of Cases, Best Before Date, Batch No, Container. Side A in A–F, side B in H–M, side C in O–T. Grey (#B7B7B7) bold headers, thin borders.
- Rows go rack column by rack column: L1-B1, L2-B1, L3-B1, L4-B1, L1-B2… with a blank row after each column; floor rows at the bottom. A mixed pallet repeats its location on extra rows.

## Label sheets

- US Letter, 10 labels of 3 × 2 in (2 across, 5 down). Left margin 30.1625 mm, top 6.35 mm, 3.175 mm gaps. Measured from `docs/images/label-sheet-photo.jpg` and confirmed by a print. Print at Actual size (100%).
- Millet Bank's 23 products and full SKUs come from the Praj Natural Foods order form; see `scripts/build_label_catalog.py`. One label per case ordered.

## Rules for agents

1. `data/source/` is real business data. Don't send it to outside services, and never put one brand's stock in another brand's report or file.
2. Never hand-edit `dist/` or `data/generated/`. Change the template or script and rebuild.
3. Keep the stock workbook tabs, columns and row order exactly as above.
4. Run `npm run build` and `npm test` before saying work is done, and report the results honestly.
5. Ask before deleting anything in `outputs/` or `data/source/`.
6. Owner-confirmed facts (this file) beat what the sheets say. Record new confirmations here.

## Open questions

- Floor plan sketches (racks, aisles, coolers, dock doors) haven't arrived yet.
- Whether floor staff will use devices, or only the owners.
- Which rack sides belong to which brand, and where overflow goes.
- Is 10B-13 L2 really four bays wide?
- Tech stack and hosting for the full system: the plan proposes React + TypeScript, PostgreSQL and managed cloud hosting.
