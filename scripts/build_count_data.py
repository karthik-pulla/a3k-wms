import csv,glob,re,collections,json,os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]  # the WMS folder
D=str(ROOT/'data'/'csv')+'/'
def rows(f): return list(csv.reader(open(D+f)))
norm=lambda s: re.sub(r'\s+','',s).lower()
def num(v):
    try: return float(v)
    except: return None
# ---------- products
products=[]; seen={}
def add(item,code,name,cat,brand,pack,pallet,src):
    item=item.strip()
    if not item or norm(item) in seen: return
    segs=[s.strip() for s in item.split(':')]
    if not code:
        code=next((s for s in segs if re.fullmatch(r'(M\s?\d+(\.\d+)?|\d{3,5}(-[A-Z])?|[A-Z]{1,3}\d{2,4})',s)),'')
    if not name: name=re.sub(r'(?<=[a-z])(?=[A-Z])',' ',segs[-1]) if segs else item
    p=dict(k=item,c=code.strip(),n=re.sub(r'\s+',' ',name).strip(),cat=cat.strip().title(),b=brand.strip().title(),pk=pack.strip(),pl=pallet,src=src)
    seen[norm(item)]=p; products.append(p)
R=rows('DECCAN__DECCAN_PRODUCT_LIST.csv')
for r in R[3:]:
    r=r+['']*14
    if not r[4].strip(): continue
    pl=num(r[8]); add(r[4],r[3],r[5],r[1],r[2],r[6],int(pl) if pl else None,'list')
R=rows('MATCO__MATCO_PRODUCT_LIST.csv')
for r in R[2:]:
    r=r+['']*12
    if not r[4].strip(): continue
    pl=num(r[8]); code=r[3].strip()
    add(r[4],code,r[6] or r[5],r[1],r[2],r[7],int(pl) if pl else None,'list')
# duplicate display codes -> use code segment from item string
cc=collections.Counter(p['c'] for p in products)
for p in products:
    if cc[p['c']]>1 or not p['c']:
        segs=[s.strip() for s in p['k'].split(':')]
        alt=next((s for s in segs if re.fullmatch(r'(M\s?\d+(\.\d+)?|\d{3,5}|[A-Z]{1,3}\d{2,4}|XXXX)',s)),p['c'])
        if p['k'].upper().endswith(('DONOTUSE','CROSSDOCK')): alt=p['c'] or alt
        p['c']=alt.replace(' ','')
# ---------- locations
pat=re.compile(r'^\s*(D?)(\d+)\s*([A-Za-z])\s*-\s*(\d+)\s*-\s*L\s*(\d+)\s*-\s*B\s*(\d+)\s*$')
def code(m): return f"{m[1]}{int(m[2])}{m[3].upper()}-{int(m[4]):02d}-L{int(m[5])}-B{int(m[6])}"
skip={'DECCAN__RACK.csv','MATCO__RACK.csv','DECCAN__DECCAN_PRODUCT_LIST.csv','MATCO__MATCO_PRODUCT_LIST.csv','DECCAN__OUTBOUND.csv','DECCAN__Sheet91.csv','DECCAN__Sheet92.csv','MATCO__Sheet68.csv','DECCAN__Excess_Inv.csv','DECCAN__by_BBD.csv'}
obs=collections.defaultdict(lambda: collections.defaultdict(set))
AREAS=[('NEARCOOLER-01','Near cooler 1'),('NEARCOOLER-02','Near cooler 2'),('NEARCOOLER-03','Near cooler 3'),('NEARCOOLER-04','Near cooler 4'),('NEARCOOLER-05','Near cooler 5'),
       ('LINE-2-3','Between line 2 & 3'),('LANE-7','Lane 7'),('DOOR-2-3','Door 2 & 3'),('LOAD-AREA','Load area (front)'),('RECV-FLOOR','Receiving floor')]
def areaOf(v):
    u=v.strip().upper()
    m=re.match(r'NEARCOOLER-0?(\d)',u)
    if m: return f'NEARCOOLER-0{m[1]}'
    if 'LINE 2' in u: return 'LINE-2-3'
    if u.startswith('LANE 7'): return 'LANE-7'
    if 'DOOR 2' in u: return 'DOOR-2-3'
    if u.startswith('LOAD_AREA'): return 'LOAD-AREA'
    if u.startswith('RECV FLOOR'): return 'RECV-FLOOR'
    return None
prev=collections.defaultdict(list)   # loc -> [[item,qty]]
floorprev=collections.defaultdict(list) # area/face floor -> list of [item,qty]
unknown_items=collections.Counter()
def lookup(item):
    p=seen.get(norm(item))
    if p: return p['k']
    unknown_items[item.strip()]+=1
    add(item,'','','','','',None,'sheet')
    return item.strip()
for f in sorted(glob.glob(D+'*.csv')):
    f=os.path.basename(f)
    if f in skip: continue
    R=rows(f)
    lastloc={}; lastface={}; rackno=re.search(r'(?i)rack0*(\d+)|DOOR(6)',f)
    for r in R[1:]:
        for i,v in enumerate(r):
            m=pat.match(v)
            if m:
                c=code(m); face=c.split('-')[0]
                obs[face][int(m[4])].add((int(m[5]),int(m[6])))
                lastloc[i]=('slot',c); lastface[i]=face
        for i,v in enumerate(r):
            if ':' not in v or i==0: continue
            locv=r[i-1].strip()
            if pat.match(locv): tgt=lastloc.get(i-1)
            elif locv and num(locv) is None:
                a=areaOf(locv)
                if a: tgt=('area',a)
                elif 'floor' in locv.lower():
                    face=lastface.get(i-1)
                    mm=re.search(r'(\d+)\s*([AB])',locv.upper())
                    if mm: face=f"{int(mm[1])}{mm[2]}"
                    elif not face and rackno: face=f"{int(rackno[1] or 0)}A"
                    tgt=('floor',face) if face else None
                else: tgt=None
                lastloc[i-1]=tgt
            elif not locv: tgt=lastloc.get(i-1)
            else: tgt=None
            if not tgt: continue
            q=num(r[i+1]) if i+1<len(r) else None
            k=lookup(v)
            line=[k,int(q) if q is not None else None]
            if tgt[0]=='slot': prev[tgt[1]].append(line)
            else: floorprev[(tgt[0],tgt[1])].append(line)
# Matco summary tab: only locations the rack tabs don't already cover
extra=collections.defaultdict(list); last=None
for r in rows('MATCO__RACK.csv')[2:]:
    r=r+['']*3
    m=pat.match(r[0])
    if m: last=code(m)
    elif r[0].strip(): last=None
    if last and ':' in r[1] and last not in prev:
        q=num(r[2]); extra[last].append([lookup(r[1]),int(q) if q is not None else None])
prev.update(extra); print('matco summary locs',len(extra))
# Rack sides not in the stock sheets, as described by the owner
import copy
std=lambda n:{c:{(l,b) for l in range(1,5) for b in (1,2)} for c in range(1,n+1)}
obs['0C']=copy.deepcopy(obs['0A'])     # 0C: same as 0A and 0B
obs['1A']=copy.deepcopy(obs['2A'])     # 1A: same as 2A
obs['17A']=std(8)                       # 17A: 8 columns
obs['19A']=copy.deepcopy(obs['18A'])   # 19A/19B: same as 18A/18B
obs['19B']=copy.deepcopy(obs['18B'])
obs['20A']=std(6)                       # 20A: 6 columns
# faces
def fkey(f): return (f.startswith('D'), int(re.sub(r'\D','',f)), f)
faces=[]
for face in sorted(obs,key=fkey):
    cols=obs[face]; mx=max(cols)
    special12 = 12 in cols and all(l>=3 for l,b in cols[12])
    out=[]
    for c in range(1,mx+1):
        s=set(cols.get(c,set()))
        if not (c==12 and special12): s|={(l,b) for l in range(1,5) for b in (1,2)}
        if face=='3A' and c==12: s={x for x in s if x[1]<=3}   # 3A-12 has bays B1-B3 only
        out.append([c,sorted(s)])
    faces.append(dict(id=face,cols=out))
# floor prev -> P01..
fp={}
for (kind,key),lines in floorprev.items():
    base=(key+'-FLOOR') if kind=='floor' else key
    for n,l in enumerate(lines,1): fp[f"{base}-P{n:02d}"]=[l]
valid={f"{f['id']}-{c:02d}-L{l}-B{b}" for f in faces for c,s in f['cols'] for l,b in s}
prevall={k:v for k,v in prev.items() if k in valid}; prevall.update(fp)
data=dict(products=products,faces=faces,areas=AREAS,prev=prevall,asof={'DECCAN':'2026-09-27','MATCO':'2026-09-30'})
json.dump(data,open(ROOT/'data'/'generated'/'count.json','w'),separators=(',',':'))
print('products',len(products),'from sheets',sum(1 for p in products if p['src']=='sheet'))
print('faces',len(faces),'slots',sum(len(s) for f in faces for c,s in f['cols']))
print('prev locs',len(prev),'floor prev',len(fp), sorted({k.rsplit('-P',1)[0] for k in fp}))
print('unknown items sample',unknown_items.most_common(15))
dup=collections.Counter(p['c'] for p in products); print('dup codes',[k for k,v in dup.items() if v>1][:20])
print('wrote data/generated/count.json', os.path.getsize(ROOT/'data'/'generated'/'count.json'), 'bytes')
