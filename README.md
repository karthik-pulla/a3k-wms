# WMS

Everything built so far for the warehouse management system, in one place.

## What's here

- **Tools** (open in claude.ai):
  - [Warehouse Count](https://claude.ai/artifact/MWGTwdznXht8VpyEPsftQ9): count every rack slot with the keyboard and export to Excel in the stock-sheet format.
  - [Order Label Maker](https://claude.ai/artifact/BCMHj1WC8Dqw7hJPoWHVAS): make 3 × 2 in case labels from an order slip.
  - [Rack 6 Map](https://claude.ai/artifact/S3eUscK2fHuhEAp8CiHWFS): early map prototype.
- **Plan**: [Warehouse WMS Plan](https://claude.ai/code/artifact/a4a12e35-975f-4371-a3dc-90313c6c0a7e)
- **Files for printing**: `outputs/count-sheets/` (blank count workbook) and `outputs/labels/millet-bank/` (Orders 1–5, per-product sheets, alignment test).

## Rebuilding

Needs Python 3 with `openpyxl`, and Node 18 or newer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

`CLAUDE.md` has the warehouse facts, file layout and rules that Claude's agents follow when working in this folder. The `.claude/agents/` folder has the specialist agents.
