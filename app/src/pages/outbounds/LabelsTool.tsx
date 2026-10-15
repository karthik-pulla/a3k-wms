import { useEffect, useMemo, useRef, useState } from "react";
import { productById, type Product } from "../../data/catalog";
import { canSeeClient } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { ProductInput } from "../../components/ProductInput";
import { CloseIcon } from "../../components/icons";
import { download } from "../../utils/xlsx";
import { candidates, reservations, statusOf } from "../../outbound/plan";
import { pdfText, readOrder } from "../../outbound/reader";
import {
  BRANDS, DEFAULT_OPTIONS, brandKeyFor, buildAlignmentPdf, buildLabelsPdf, labelCount, pdfPreview, sheetCount,
  type BrandKey, type LabelLine, type LabelOptions,
} from "../../outbound/labelsPdf";
import type { StoreOrder } from "../../store/types";

const OPT_KEY = "wms.labels.options";
const loadOpts = (): LabelOptions => { try { return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(OPT_KEY) ?? "{}"), start: 1 }; } catch { return DEFAULT_OPTIONS; } };
let n = 0;
const fromProduct = (p: Product, labels: number, bestBefore?: string): LabelLine => ({
  key: `L${++n}-${Date.now().toString(36)}`, productId: p.id, name: p.name, size: p.size, units: p.units ? String(p.units) : "", labels,
  group: p.cat, code: p.code, brand: brandKeyFor(p.brand), bestBefore,
});

/** Label lines for an order: per product and best-before */
function linesForOrder(state: Parameters<typeof candidates>[0], o: StoreOrder): LabelLine[] {
  if (o.picks?.length) {
    // Group the picks by product and best-before: picked cases if picked, else the planned cases
    const m = new Map<string, LabelLine>();
    for (const pk of o.picks) {
      const p = productById(pk.productId); if (!p) continue;
      const k = `${pk.productId}|${pk.bestBefore ?? ""}`;
      const cases = pk.picked ? pk.picked.cases : pk.cases;
      const cur = m.get(k);
      if (cur) cur.labels += cases; else m.set(k, fromProduct(p, cases, pk.bestBefore));
    }
    return [...m.values()].filter(l => l.labels > 0);
  }
  // Not planned yet: the best-before of the oldest pallet it would come from
  const reserved = reservations(state, o.id);
  return o.lines.flatMap(l => { const p = productById(l.productId); return p ? [fromProduct(p, l.cases, candidates(state, l.productId, "fifo-open-first", reserved)[0]?.bestBefore)] : []; });
}

const lastName = (p: Product | null) => (p ? `${p.name} ${p.size}`.trim() : "");

/**
 * One label per case, for an order or for products you add. Each pallet's best-before goes on the labels of the cases
 * taken from it. Same sheet and layout as the Order Label Maker.
 */
export function LabelsTool({ orderId }: { orderId?: string }) {
  const { state } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const orders = useMemo(() => state.orders.filter(o => canSeeClient(me, o.client) && statusOf(o) !== "cancelled")
    .sort((a, b) => (statusOf(a) === "shipped" ? 1 : 0) - (statusOf(b) === "shipped" ? 1 : 0) || (a.due ?? "9").localeCompare(b.due ?? "9")), [state.orders, me]);
  const order = orderId ? orders.find(o => o.id === orderId) : undefined;
  const [lines, setLines] = useState<LabelLine[]>(() => (order ? linesForOrder(state, order) : []));
  const [title, setTitle] = useState(order ? `${order.id} – ${order.store}` : "Labels");
  const [opts, setOpts] = useState<LabelOptions>(loadOpts);
  const [pages, setPages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [pdf, setPdf] = useState<{ name: string; unread: string[]; hidden: number } | null>(null);
  const last = useRef<Product | null>(null);
  const run = useRef(0);
  useEffect(() => { try { const { start: _s, ...keep } = opts; void _s; localStorage.setItem(OPT_KEY, JSON.stringify(keep)); } catch { /* per visit */ } }, [opts]);
  useEffect(() => { if (order) { setLines(linesForOrder(state, order)); setTitle(`${order.id} – ${order.store}`); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderId]);

  const total = labelCount(lines), sheets = total ? sheetCount(lines, opts.start) : 0;
  // Live preview of the real PDF (first 4 sheets)
  useEffect(() => {
    const me = ++run.current;
    if (!total) { setPages([]); return; }
    const t = window.setTimeout(async () => {
      try {
        const doc = await buildLabelsPdf(lines, opts, title);
        const imgs = await pdfPreview(doc.output("arraybuffer"));
        if (me === run.current) setPages(imgs);
      } catch { if (me === run.current) setPages([]); }
    }, 350);
    return () => window.clearTimeout(t);
  }, [lines, opts, title, total]);

  const add = (p: Product) => { if (!canSeeClient(me, p.client)) return; last.current = p; setLines(ls => [...ls, fromProduct(p, 1)]); };
  // An order slip or packing list as a PDF: one label per case, best-before from the oldest pallet in stock
  const onPdf = async (f: File) => {
    setReading(true);
    try {
      const { text, pages: n } = await pdfText(f);
      if (!text.trim()) { setPdf(null); toast(`No text in ${f.name} (${n} page${n > 1 ? "s" : ""}): it's probably a scan or photo. Add the products by hand.`); return; }
      const read = readOrder(text, [...new Set(state.orders.map(o => o.store))]);
      const reserved = reservations(state);
      const mine = read.lines.filter(l => { const p = productById(l.productId); return p && canSeeClient(me, p.client); });
      const got = mine.flatMap(l => { const p = productById(l.productId)!; return [fromProduct(p, l.cases, candidates(state, p.id, "fifo-open-first", reserved)[0]?.bestBefore)]; });
      if (order) go("#/outbounds/labels");
      setLines(got);
      last.current = null;
      setTitle([read.ref ? `PO ${read.ref}` : "", read.store ?? ""].filter(Boolean).join(" – ") || f.name.replace(/\.pdf$/i, ""));
      setPdf({ name: f.name, unread: read.unread, hidden: read.lines.length - mine.length });
      toast(`Read ${got.length} line${got.length === 1 ? "" : "s"} from ${f.name}${read.unread.length ? `; ${read.unread.length} line${read.unread.length > 1 ? "s" : ""} need a look` : ""}. Check before printing.`);
    } catch { toast("That PDF couldn't be read."); } finally { setReading(false); }
  };
  // One footer box per logo in use ("Footer" when there's just one)
  const logos = [...new Set(lines.map(l => l.brand))];
  const set = (i: number, patch: Partial<LabelLine>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const file = `${title.replace(/[^\w–-]+/g, "-").replace(/-+/g, "-").toLowerCase() || "labels"}.pdf`;
  const save = async () => { setBusy(true); try { const doc = await buildLabelsPdf(lines, opts, title); download(doc.output("blob"), file); toast(`${total} labels on ${sheets} sheet${sheets === 1 ? "" : "s"}. Print at Actual size (100%).`); } finally { setBusy(false); } };
  const print = async (align = false) => {
    setBusy(true);
    try {
      const doc = align ? await buildAlignmentPdf(opts) : await buildLabelsPdf(lines, opts, title);
      const url = URL.createObjectURL(doc.output("blob"));
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
      frame.src = url;
      frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000); };
      document.body.appendChild(frame);
      toast("Choose Actual size (100%) in the print dialog, not Fit to page.");
    } finally { setBusy(false); }
  };

  return (
    <div className="labels">
      <div className="panel glass labels-form">
        <div className="panel-foot">
          <h2 className="plain-h">Case labels</h2>
          <label className="field inline small-field"><span>From order</span>
            <select className="input" value={order?.id ?? ""} onChange={e => go(`#/outbounds/labels${e.target.value ? `/${encodeURIComponent(e.target.value)}` : ""}`)}>
              <option value="">None: add products below</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.id} · {o.store}{statusOf(o) === "shipped" ? " (shipped)" : ""}</option>)}
            </select>
          </label>
        </div>
        <div className="label-src">
          <label className={`btn small${reading ? " busy" : ""}`}>
            {reading ? "Reading…" : "Read a PDF order…"}
            <input type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onPdf(f); }} />
          </label>
          <span className="muted small">A store's order slip or packing list: one label per case.</span>
        </div>
        {pdf && !order && (pdf.unread.length > 0 || pdf.hidden > 0) && (
          <div className="note warn">
            {pdf.hidden > 0 && <p>{pdf.hidden} line{pdf.hidden > 1 ? "s are" : " is"} for a client you don't have access to, so {pdf.hidden > 1 ? "they were" : "it was"} left out.</p>}
            {pdf.unread.length > 0 && <><b>Lines not read</b> (add them by hand if they're products):<ul translate="no">{pdf.unread.map((u, i) => <li key={i} className="mono">{u}</li>)}</ul></>}
          </div>
        )}
        {order && <p className="muted small">{order.picks?.length ? "One label per case, from the pallets planned or picked for this order; each label gets its pallet's best-before." : "One label per case ordered. The order isn't planned yet, so best-before comes from the oldest pallet in stock."} <a className="link" href={`#/outbounds/orders/${encodeURIComponent(order.id)}`}>Open {order.id} ›</a></p>}
        <label className="field"><span>Title (PDF name)</span><input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>

        <div className="label-lines">
          {lines.length > 0 && <div className="label-line head muted small" aria-hidden="true"><span>Name</span><span>Size</span><span>Units</span><span>Best before</span><span>Logo</span><span>Labels</span><span /></div>}
          {lines.map((l, i) => (
            <div key={l.key} className="label-line">
              <input className="input" value={l.name} onChange={e => set(i, { name: e.target.value })} aria-label="Name on label" />
              <input className="input" value={l.size} onChange={e => set(i, { size: e.target.value })} aria-label="Size" placeholder="Size" />
              <input className="input num-in" value={l.units} onChange={e => set(i, { units: e.target.value.replace(/\D/g, "") })} aria-label="Units per case" placeholder="Units" />
              <input className="input" type="month" value={l.bestBefore?.slice(0, 7) ?? ""} onChange={e => set(i, { bestBefore: e.target.value || undefined })} aria-label="Best before" disabled={opts.bbMode !== "stock"} />
              <select className="input" value={l.brand} onChange={e => set(i, { brand: e.target.value as BrandKey })} aria-label="Logo">{(Object.keys(BRANDS) as BrandKey[]).map(b => <option key={b} value={b}>{BRANDS[b].name}</option>)}</select>
              <input className="input num-in" type="number" min={0} value={l.labels} onChange={e => set(i, { labels: Math.max(0, parseInt(e.target.value) || 0) })} aria-label="Labels" />
              <button className="mini" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}><CloseIcon /></button>
            </div>
          ))}
          {!lines.length && <p className="muted small">No labels yet. Pick an order, read a PDF or add a product.</p>}
          <div className="label-add">
            <ProductInput productId={null} ariaLabel="Add a product" clearOnPick placeholder="Add a product: type its name or code"
              onChange={id => { const p = id ? productById(id) : undefined; if (p) add(p); }}
              onEnterEmpty={() => { if (last.current) add(last.current); }} />
            <button className="btn small" onClick={() => setLines(ls => [...ls, { key: `L${++n}`, productId: null, name: "New product", size: "", units: "", labels: 1, group: "", code: "", brand: "other" }])}>+ Product not in the list</button>
          </div>
          <p className="muted small label-hint">Enter or Tab adds the product and empties the box for the next one{lastName(last.current) ? <>; Enter in the empty box adds <b translate="no">{lastName(last.current)}</b> again</> : ""}.</p>
        </div>

        <fieldset className="label-opts">
          <legend>On the label</legend>
          <div className="segment s2" role="group" aria-label="Units per case">
            <button aria-pressed={opts.unitsMode === "print"} onClick={() => setOpts({ ...opts, unitsMode: "print" })}>Print units per case</button>
            <button aria-pressed={opts.unitsMode === "blank"} onClick={() => setOpts({ ...opts, unitsMode: "blank" })}>Blank to write in</button>
          </div>
          <div className="segment s3" role="group" aria-label="Best before">
            <button aria-pressed={opts.bbMode === "stock"} onClick={() => setOpts({ ...opts, bbMode: "stock" })}>Best before from stock</button>
            <button aria-pressed={opts.bbMode === "custom"} onClick={() => setOpts({ ...opts, bbMode: "custom" })}>Same date on all</button>
            <button aria-pressed={opts.bbMode === "off"} onClick={() => setOpts({ ...opts, bbMode: "off" })}>No best before</button>
          </div>
          {opts.bbMode === "custom" && <input className="input" value={opts.bbText} onChange={e => setOpts({ ...opts, bbText: e.target.value })} placeholder="e.g. MAR 2027 (blank line if empty)" aria-label="Best before text" />}
          <label className="toggle-row"><input type="checkbox" checked={opts.showGroup} onChange={e => setOpts({ ...opts, showGroup: e.target.checked })} /> Category above the name</label>
          <label className="toggle-row"><input type="checkbox" checked={opts.showCode} onChange={e => setOpts({ ...opts, showCode: e.target.checked })} /> Item code</label>
          {(logos.length ? logos : ["deccan" as BrandKey]).map(b => (
            <label key={b} className="field"><span>{logos.length > 1 ? `Footer · ${BRANDS[b].name}` : "Footer"}</span>
              <textarea className="input" rows={2} value={opts.footers[b] ?? BRANDS[b].footer} placeholder="Printed at the bottom of each label (optional)" onChange={e => setOpts({ ...opts, footers: { ...opts.footers, [b]: e.target.value } })} />
            </label>
          ))}
        </fieldset>
        <fieldset className="label-opts">
          <legend>Sheet</legend>
          <label className="field inline"><span>Start at label</span>
            <select className="input" value={opts.start} onChange={e => setOpts({ ...opts, start: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}{i === 0 ? " (full sheet)" : " (sheet already partly used)"}</option>)}</select>
          </label>
          <div className="nudge-row">
            <label>Move right <input className="input num-in" type="number" step={0.5} value={opts.nudge.x} onChange={e => setOpts({ ...opts, nudge: { ...opts.nudge, x: parseFloat(e.target.value) || 0 } })} /> mm</label>
            <label>Move down <input className="input num-in" type="number" step={0.5} value={opts.nudge.y} onChange={e => setOpts({ ...opts, nudge: { ...opts.nudge, y: parseFloat(e.target.value) || 0 } })} /> mm</label>
            <button className="btn small" disabled={busy} onClick={() => void print(true)}>Print alignment test</button>
          </div>
          <p className="muted small">US Letter, 10 labels of 3 × 2 in. Print at Actual size (100%). If the print sits off the labels, print the alignment test on plain paper and move it here.</p>
        </fieldset>
        <div className="panel-foot">
          <span className="muted small">{total} label{total === 1 ? "" : "s"} · {sheets} sheet{sheets === 1 ? "" : "s"}</span>
          <span className="btns">
            <button className="btn" disabled={!total || busy} onClick={() => void print()}>Print</button>
            <button className="btn primary" disabled={!total || busy} onClick={() => void save()}>Download PDF</button>
          </span>
        </div>
      </div>

      <div className="panel glass labels-preview" aria-label="Preview">
        <h2 className="plain-h">Preview</h2>
        {pages.length ? pages.map((src, i) => <img key={i} src={src} alt={`Sheet ${i + 1}`} className="label-page" />) : <p className="muted small">{total ? "Making the preview…" : "The labels appear here."}</p>}
        {sheets > pages.length && pages.length > 0 && <p className="muted small">Showing the first {pages.length} of {sheets} sheets.</p>}
      </div>
    </div>
  );
}
