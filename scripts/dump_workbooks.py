"""Step 1: read every stock workbook in data/source and write one CSV per tab to data/csv.

File names are <WORKBOOK PREFIX>__<tab name>.csv, e.g. DECCAN__RACK06.csv.
"""
import csv
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]  # the WMS folder
SRC, OUT = ROOT / "data" / "source", ROOT / "data" / "csv"
OUT.mkdir(parents=True, exist_ok=True)

for xlsx in sorted(SRC.glob("*_STOCK_*.xlsx")):
    prefix = xlsx.name.split("_")[0]
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    for ws in wb.worksheets:
        n = 0
        with open(OUT / f"{prefix}__{ws.title.replace(' ', '_')}.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            for row in ws.iter_rows(values_only=True):
                vals = ["" if v is None else str(v) for v in row]
                while vals and vals[-1] == "":
                    vals.pop()
                if vals:
                    w.writerow(vals); n += 1
        print(f"{prefix:7} {ws.title:22} {n} rows")
