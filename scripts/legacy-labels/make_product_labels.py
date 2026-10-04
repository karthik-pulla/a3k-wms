import base64, html, os, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]  # the WMS folder
# Superseded by tools/label-maker. Writes its HTML next to the outputs; print to PDF with Chrome headless.
os.makedirs(ROOT / 'outputs/labels/millet-bank/build', exist_ok=True); os.chdir(ROOT / 'outputs/labels/millet-bank/build')
# From the Praj Natural Foods order form: (group, product, grams, units per case, cases ordered)
ORDER = [
 ("Millet Noodles", "Foxtail Millet Noodles", 180, 10, 1),
 ("Millet Noodles", "Pearl Millet Noodles", 180, 10, 1),
 ("Millet Noodles", "Sorghum Noodles", 180, 10, 1),
 ("Millet Noodles", "Magic Masala Noodles", 180, 10, 1),
 ("Millet Noodles", "Chilli Garlic Noodles", 180, 10, 1),
 ("Millet Noodles", "Tangy Tomato Noodles", 180, 10, 1),
 ("Instant Noodles", "Magic Masala Instant", 50, 25, 1),
 ("Instant Noodles", "Classic Masala Instant", 50, 25, 1),
 ("Millet Snacks", "Sour Cream & Onion", 30, 25, 1),
 ("Millet Snacks", "Cheese & Herbs", 30, 25, 1),
 ("Millet Snacks", "Tangy Tomato Snack", 30, 25, 1),
 ("Millet Pasta", "Multi Millet Pasta", 175, 10, 1),
 ("Millet Pasta", "Foxtail Millet Pasta", 175, 10, 1),
 ("Millet Pasta", "Little Millet Pasta", 175, 10, 1),
 ("Pancake Mixes", "Chocolate Pan Cake", 150, 10, 1),
 ("Pancake Mixes", "Blueberry Pan Cake", 150, 10, 1),
 ("Pancake Mixes", "Banana Pan Cake", 150, 10, 1),
 ("Chocolate Fills", "Chocolate Fills", 250, 10, 1),
 ("Chocolate Fills", "Blackforest Fills", 250, 10, 1),
 ("Millet Muesli", "Dates Muesli", 350, 10, 1),
 ("Millet Muesli", "Strawberry Muesli", 350, 10, 1),
 ("Millet Muesli", "Chocolate Muesli", 350, 10, 1),
 ("Beverages", "Chocolate Milk Mix", 250, 10, 1),
]
# US Letter label sheet (measured from a photo of the actual sheet): 10 labels of 3 x 2 in,
# 2 across x 5 down, 1/8 in gaps, top margin 1/4 in, left margin 1 3/16 in
PAGE_W, PAGE_H = 215.9, 279.4
LW, LH = 76.2, 50.8
COLS, ROWS = 2, 5
GAP_X, GAP_Y = 3.175, 3.175
LEFT, TOP = 30.1625, 6.35
logo = base64.b64encode(open(ROOT / 'data/source/logos/millet-bank.png', 'rb').read()).decode()

labels = [row for row in ORDER for _ in range(row[4])]

CSS = f"""
@page {{ size: letter; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {PAGE_W}mm; }}
body {{ font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.page {{ position: relative; width: {PAGE_W}mm; height: {PAGE_H}mm; page-break-after: always; overflow: hidden; }}
.page:last-child {{ page-break-after: auto; }}
.label {{ position: absolute; width: {LW}mm; height: {LH}mm; padding: 3.2mm 4.5mm 3mm;
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 1.1mm; }}
.label img {{ height: 12.5mm; width: auto; }}
.group {{ font-size: 7.5pt; letter-spacing: .14em; text-transform: uppercase; color: #4b5d27; font-weight: 600; margin-top: .6mm; }}
.name {{ font-size: 13pt; line-height: 1.08; font-weight: 800; text-transform: uppercase; }}
.pack {{ font-size: 15pt; font-weight: 800; letter-spacing: .02em; line-height: 1; }}
.qty {{ font-size: 9pt; color: #222; display: flex; align-items: flex-end; gap: 1.5mm; margin-top: 1mm; }}
.blank {{ display: inline-block; width: 18mm; height: 5mm; border-bottom: .3mm solid #222; }}
.outline {{ border: .25mm dashed #888; }}
.note {{ position: absolute; left: 0; right: 0; top: 6mm; text-align: center; font-size: 10pt; color: #444; }}
"""

def page(items, outline=False):
    out = ['<div class="page">']
    if outline:
        out.append('<div class="note">Alignment test: print this on plain paper and hold it against a label sheet up to the light. Each dashed box should sit on a label.</div>')
    for i, it in enumerate(items):
        r, c = divmod(i, COLS)
        x = LEFT + c * (LW + GAP_X); y = TOP + r * (LH + GAP_Y)
        cls = "label outline" if outline else "label"
        if it is None:
            out.append(f'<div class="{cls}" style="left:{x:.2f}mm;top:{y:.2f}mm"></div>'); continue
        g, n, grams, per, _ = it
        out.append(f'''<div class="{cls}" style="left:{x:.2f}mm;top:{y:.2f}mm">
  <img src="data:image/png;base64,{logo}" alt="Millet Bank">
  <div class="group">{html.escape(g)}</div>
  <div class="name">{html.escape(n)}</div>
  <div class="pack">{grams} G</div>
  <div class="qty">Units per case: <span class="blank"></span></div>
</div>''')
    out.append('</div>')
    return "\n".join(out)

per_page = COLS * ROWS
doc = lambda body: f'<!doctype html><html><head><meta charset="utf-8"><title>Millet Bank labels</title><style>{CSS}</style></head><body>{body}</body></html>'
import os
os.makedirs('per_product', exist_ok=True)
names = []
for n, row in enumerate(ORDER, 1):
    slug = re.sub(r'[^A-Za-z0-9]+', '', row[1].title())
    fn = f"per_product/{n:02d}_MilletBank_{slug}"
    open(fn + '.html', 'w').write(doc(page([row] * per_page)))
    names.append(fn)
open('per_product/list.txt', 'w').write("\n".join(names))
print(len(names), 'product sheets')
