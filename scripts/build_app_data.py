"""Step 5: data for the WMS web app, as A3K's tenant files (app/public/tenants/a3k/, loaded by the app at startup).

products.json    every product with its client (Deccan, Matco or Praj), code, name, size, units per case
                 and cases per pallet, from the label catalog and the stock-sheet product lists
logos.json       brand logos for case labels (the same images the Order Label Maker uses)
stock.json       SAMPLE inventory for testing on localhost (never on GitHub, see .gitignore): the 27 Sep stock-sheet
                 counts moved onto the new codes (6A-01-L1-B1 -> 06A-01-L1-B1); slots that no longer exist are dropped.
                 A new vault starts with it; without it the app makes up stock (app/src/store/demoStock.ts)

The rack layout is not made here: it is A3K's tenant config (app/public/tenants/a3k/config.json), written by hand
from the owner's plan, and the app works out the slots from it (app/src/tenant/layout.ts).
"""
import csv, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # the WMS folder
GEN = ROOT / "data" / "generated"
TENANT = ROOT / "app" / "public" / "tenants" / "a3k"
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

# ---------- slots, from the tenant config (same rules as app/src/tenant/layout.ts) ----------
layout = json.load(open(TENANT / "config.json"))["layout"]
fmt = layout["codeFormat"]
def pad(rack):  # 6 -> "06", "D6" and junctions unchanged
    return f"{int(rack):0{fmt['rackDigits']}d}" if rack.isdigit() and len(rack) <= fmt["rackDigits"] else rack
slot_codes = set()
for r in layout["racks"]:
    for side in r["sides"]:
        for c in range(1, r["columns"] + 1):
            shape = layout["shapes"][r.get("columnShapes", {}).get(str(c), r.get("shape", layout["defaultShape"]))]
            for l in shape["levels"]:
                for b in range(1, shape["bays"] + 1):
                    slot_codes.add(fmt["slot"].format(face=f"{pad(r['id'])}{side}", col=f"{c:0{fmt['colDigits']}d}", level=l, bay=b))
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

json.dump(products, open(TENANT / "products.json", "w"), separators=(",", ":"))
logos = json.load(open(GEN / "label-catalog.json"))["logos"]
json.dump(logos, open(TENANT / "logos.json", "w"), separators=(",", ":"))
json.dump(dict(asof="2026-09-27", note="SAMPLE: 27 Sep stock-sheet counts on the new codes", stock=stock), open(TENANT / "stock.json", "w"), separators=(",", ":"))
clients = {}
for p in products: clients[p["client"]] = clients.get(p["client"], 0) + 1
print(f"products {len(products)} {clients} · slots {len(slot_codes)} · sample stock {len(stock)} locations ({dropped} old slots no longer exist)")
