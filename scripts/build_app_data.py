"""Step 5: data for the WMS web app (app/src/data/generated/).

products.json    every product with its client (Deccan, Matco or Praj), code, name, size, units per case
                 and cases per pallet, from the label catalog and the stock-sheet product lists
layout.json      the owner's rack layout (CLAUDE.md, Oct 2026): every slot with its zero-padded code
sampleStock.json SAMPLE inventory for testing on localhost: the 27 Sep stock-sheet counts moved onto the
                 new codes (6A-01-L1-B1 -> 06A-01-L1-B1); slots that no longer exist are dropped
"""
import csv, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # the WMS folder
GEN = ROOT / "data" / "generated"
OUT = ROOT / "app" / "src" / "data" / "generated"
OUT.mkdir(parents=True, exist_ok=True)
norm = lambda s: re.sub(r"\s+", "", s or "").lower()

# ---------- products ----------
label = json.load(open(GEN / "label-catalog.json"))["catalog"]
count = json.load(open(GEN / "count.json"))
pallet_size = {norm(p["k"]): p.get("pl") for p in count["products"]}

def items_in(csv_name, col):
    rows = list(csv.reader(open(ROOT / "data" / "csv" / csv_name)))
    return {norm(r[col]) for r in rows if len(r) > col and r[col].strip()}
matco_items = items_in("MATCO__MATCO_PRODUCT_LIST.csv", 4)

products = []
for p in label["milletbank"]:
    products.append(dict(id=p["id"], client="Praj", brand=p["brand"], code=p["code"], name=p["name"], cat=p["cat"],
                         size=p["size"], units=p["units"], perPallet=None, item=None))
for group in ("deccan", "other"):
    for p in label[group]:
        client = "Matco" if norm(p["item"]) in matco_items else "Deccan"
        products.append(dict(id=p["id"], client=client, brand=p["brand"], code=p["code"], name=p["name"], cat=p["cat"],
                             size=p["size"], units=p["units"], perPallet=pallet_size.get(norm(p["item"])), item=p["item"]))
by_item = {norm(p["item"]): p["id"] for p in products if p["item"]}

# ---------- layout (owner's plan; see CLAUDE.md "Rack sides") ----------
def pad(rack):  # 6 -> "06", "D6" and junctions unchanged
    return rack if not rack.isdigit() or len(rack) > 2 else f"{int(rack):02d}"
SIDES = [("D6", "AB", 6), ("0", "ABC", 10)]
SIDES += [(str(r), "AB", 13) for r in (1, 3, 4, 5, 6, 7, 9, 10, 12, 13, 14)]
SIDES += [(str(r), "A", 13) for r in (2, 8, 11)]
SIDES += [(str(r), "AB", 10) for r in (15, 16, 18, 19)]
SIDES += [("17", "A", 8), ("20", "A", 6)]
JUNCTIONS = [("1518", "AB"), ("1619", "AB")]

def rack_sort(r):
    return (0, 0) if r == "D6" else ((2, int(r)) if len(r) > 2 else (1, int(r)))

faces = []
for rack, sides, ncols in sorted(SIDES, key=lambda s: rack_sort(s[0])):
    for side in sides:
        cols = []
        for c in range(1, ncols + 1):
            if ncols == 13 and c == 12:
                slots = [(l, b) for l in (3, 4) for b in (1, 2, 3)]  # column 12: levels 3-4, three bays
            else:
                slots = [(l, b) for l in (1, 2, 3, 4) for b in (1, 2)]
            cols.append([c, slots])
        faces.append(dict(id=f"{pad(rack)}{side}", rack=pad(rack), side=side, cols=cols))
for j, sides in JUNCTIONS:
    for side in sides:
        faces.append(dict(id=f"{j}{side}", rack=j, side=side, junction=True, cols=[[1, [(l, b) for l in (3, 4) for b in (1, 2, 3)]]]))
slot_codes = {f"{f['id']}-{c:02d}-L{l}-B{b}" for f in faces for c, s in f["cols"] for l, b in s}
areas = [dict(id=a, name=n) for a, n in count["areas"]]
assert len(slot_codes) == 3662, len(slot_codes)

# ---------- sample stock from the 27 Sep sheets ----------
def new_code(old):
    m = re.match(r"^(D6|\d+)([A-Z])-(.*)$", old)
    if not m: return old  # floor areas keep their names
    return f"{pad(m[1])}{m[2]}-{m[3]}"
stock, dropped = {}, 0
for old, lines in count["prev"].items():
    code = new_code(old)
    is_floor = "-FLOOR-" in code or not re.match(r"^\w+-\d\d-L\d-B\d$", code)
    if not is_floor and code not in slot_codes:
        dropped += 1; continue
    ls = [{"productId": by_item[norm(k)], "cases": q} for k, q in lines if q and norm(k) in by_item]
    if ls: stock[code] = ls

json.dump(products, open(OUT / "products.json", "w"), separators=(",", ":"))
json.dump(dict(faces=faces, areas=areas), open(OUT / "layout.json", "w"), separators=(",", ":"))
# Brand logos for case labels (the same images the Order Label Maker uses)
logos = json.load(open(ROOT / "data" / "generated" / "label-catalog.json"))["logos"]
json.dump(logos, open(OUT / "labelLogos.json", "w"), separators=(",", ":"))
json.dump(dict(asof="2026-09-27", note="SAMPLE: 27 Sep stock-sheet counts on the new codes", stock=stock), open(OUT / "sampleStock.json", "w"), separators=(",", ":"))
clients = {}
for p in products: clients[p["client"]] = clients.get(p["client"], 0) + 1
print(f"products {len(products)} {clients} · sides {len(faces)} · slots {len(slot_codes)} · sample stock {len(stock)} locations ({dropped} old slots no longer exist)")
