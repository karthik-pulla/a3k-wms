import csv, re, json, base64
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]  # the WMS folder
D = str(ROOT / 'data' / 'csv') + '/'
def num(v):
    try: return float(v)
    except: return None
def split_pack(pk):
    """'20 LBS * 2' -> ('20 LBS', 2); '10Lbs*4' -> ('10 LBS', 4); '275Gms' -> ('275 GMS', None)"""
    pk = (pk or '').strip()
    if not pk: return '', None
    m = re.match(r'^(.*?)\s*[*xX×]\s*(\d+)\s*$', pk)
    size, units = (m.group(1), int(m.group(2))) if m else (pk, None)
    size = re.sub(r'(?i)(\d)\s*(lbs?|gms?|g|kg|oz|ml|ltrs?|l)\b', lambda mm: mm.group(1) + ' ' + mm.group(2).upper(), size)
    return re.sub(r'\s+', ' ', size).strip().upper(), units
SIZE_TAIL = r'[\s\-–:]*\(?\d+(\.\d+)?\s*(lbs?|gms?|g|kg|oz|ml|ltrs?|l)\b.*$'
def clean_name(desc, brand):
    n = re.sub(r'\s+', ' ', desc or '').strip()
    for b in [brand, 'Deccan', 'Falak']:
        if b and n.lower().startswith(b.lower() + ' '): n = n[len(b) + 1:]
    n2 = re.sub(SIZE_TAIL, '', n, flags=re.I).strip(' -–:,')
    n = (n2 or n).strip()
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', n)  # 'CornFlakes' -> 'Corn Flakes'
deccan, other = [], []
R = list(csv.reader(open(D + 'DECCAN__DECCAN_PRODUCT_LIST.csv')))
for r in R[3:]:
    r = r + [''] * 14
    item = r[4].strip()
    if not item or 'USE FOR NEW PRODUCT' in item.upper(): continue
    brand = r[2].strip().title()
    size, units = split_pack(r[6])
    u2 = num(r[7]); units = int(u2) if u2 else units
    if not size:  # fall back to the size inside the item text, e.g. Rice:Deccan:20LBS*2:1001:...
        m = re.search(r':([\d.]+\s*(?:LBS?|GMS?|G|KG|OZ|ML|LTR)[^:]*)\s*:', item, re.I)
        if m: size, u3 = split_pack(m.group(1)); units = units or u3
    name = clean_name(r[5] or item.split(':')[-1], brand)
    rec = dict(code=r[3].strip(), name=name, cat=r[1].strip().title(), brand=brand, size=size, units=units, item=item)
    (deccan if brand.upper() == 'DECCAN' else other).append(rec)
R = list(csv.reader(open(D + 'MATCO__MATCO_PRODUCT_LIST.csv')))
for r in R[2:]:
    r = r + [''] * 12
    item = r[4].strip()
    if not item: continue
    brand = r[2].strip().title()
    size, units = split_pack(r[7])
    if not size:
        segs = item.split(':'); size, units = split_pack(segs[2] if len(segs) > 2 else '')
    short = r[5].strip()
    name = clean_name(short.title() if short else r[6], brand)
    other.append(dict(code=r[3].strip(), name=name, cat=r[1].strip().title(), brand=brand, size=size, units=units, item=item))
MB = [
 ("PNFNDLFXT","Millet Noodles","Foxtail Millet Noodles","180 G",10),("PNFNDLPRL","Millet Noodles","Pearl Millet Noodles","180 G",10),
 ("PNFNDLSRG","Millet Noodles","Sorghum Noodles","180 G",10),("PNFNDLMGM","Millet Noodles","Magic Masala Noodles","180 G",10),
 ("PNFNDLCHG","Millet Noodles","Chilli Garlic Noodles","180 G",10),("PNFNDLTTM","Millet Noodles","Tangy Tomato Noodles","180 G",10),
 ("PNFINSMGM","Instant Noodles","Magic Masala Instant","50 G",25),("PNFINSCLM","Instant Noodles","Classic Masala Instant","50 G",25),
 ("PNFSNKSCO","Millet Snacks","Sour Cream & Onion","30 G",25),("PNFSNKCHH","Millet Snacks","Cheese & Herbs","30 G",25),
 ("PNFSNKTTM","Millet Snacks","Tangy Tomato Snack","30 G",25),("PNFPSTMLT","Millet Pasta","Multi Millet Pasta","175 G",10),
 ("PNFPSTFXT","Millet Pasta","Foxtail Millet Pasta","175 G",10),("PNFPSTLTL","Millet Pasta","Little Millet Pasta","175 G",10),
 ("PNFPCKCHO","Pancake Mixes","Chocolate Pan Cake","150 G",10),("PNFPCKBLU","Pancake Mixes","Blueberry Pan Cake","150 G",10),
 ("PNFPCKBAN","Pancake Mixes","Banana Pan Cake","150 G",10),("PNFFILCHO","Chocolate Fills","Chocolate Fills","250 G",10),
 ("PNFFILBLF","Chocolate Fills","Blackforest Fills","250 G",10),("PNFMSLDAT","Millet Muesli","Dates Muesli","350 G",10),
 ("PNFMSLSTR","Millet Muesli","Strawberry Muesli","350 G",10),("PNFMSLCHO","Millet Muesli","Chocolate Muesli","350 G",10),
 ("PNFBEVCMM","Beverages","Chocolate Milk Mix","250 G",10)]
mb = [dict(id=f"M{i}", code=c, cat=g, name=n, size=s, units=u, brand="Millet Bank") for i, (c, g, n, s, u) in enumerate(MB, 1)]
for i, p in enumerate(deccan, 1): p['id'] = f"D{i}"
for i, p in enumerate(other, 1): p['id'] = f"O{i}"
cat = {'milletbank': mb, 'deccan': deccan, 'other': other}
b64 = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
logos = {'milletbank': dict(src=b64(ROOT / 'data/source/logos/millet-bank.png'), w=380, h=262), 'deccan': dict(src=b64(ROOT / 'data/source/logos/deccan.png'), w=710, h=432)}
json.dump(dict(catalog=cat, logos=logos), open(ROOT / 'data/generated/label-catalog.json', 'w'), separators=(',', ':'))
print({k: len(v) for k, v in cat.items()})
for p in deccan[:4] + deccan[150:153] + other[:3] + other[100:103] + other[-3:]: print(p['id'], '|', p['code'], '|', p['name'], '|', p['size'], '|', p['units'], '|', p['brand'])
print('no size:', sum(1 for p in deccan + other if not p['size']), 'no units:', sum(1 for p in deccan + other if not p['units']))
