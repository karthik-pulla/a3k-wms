// Team → Setup (owners, signed in with the server): putting a warehouse's data in, usually with the WMS team on
// site. The warehouse files our team prepared (config.json, products.json, logos.json), and the .xlsx template for
// products and the opening stock. Everything is checked row by row before anything is saved (server: core/setup.ts).
import { useMemo, useState } from "react";
import { useApiData, useAction } from "./useApi";
import { useToast } from "../../components/Toast";
import { buildXlsx, download } from "../../utils/xlsx";
import { readXlsx } from "../../utils/xlsxRead";
import { readProducts, readStock, templateSheets, type Problem, type ProductIn, type StockIn, type KnownProduct } from "../../setup/importSheets";
import { CLIENTS, EXAMPLE_FLOOR, EXAMPLE_SLOT, normalizeLocation } from "../../data/catalog";
import { buildLayout } from "../../tenant/layout";
import { tenant } from "../../tenant";
import { useSync } from "../../sync/context";

interface Status { config: { at: string; by: string } | null; logos: { at: string; by: string } | null; products: number; stockLocations: number; stockLines: number; people: number }
interface Files { config?: Record<string, any>; products?: unknown[]; logos?: Record<string, unknown>; names: string[]; problem?: string }

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);

export function DataTab() {
  const status = useApiData<Status>("setup.status");
  const s = status.data;
  return (
    <div className="data-tab">
      <section className="panel glass">
        <h2 className="plain-h">This warehouse so far</h2>
        {!s ? <p className="muted small">{status.error ?? "Loading…"}</p> : (
          <dl className="facts-list">
            <div><dt>Settings</dt><dd>{s.config ? `Saved ${day(s.config.at)} by ${s.config.by}` : "Not saved yet"}</dd></div>
            <div><dt>Logos</dt><dd>{s.logos ? `Saved ${day(s.logos.at)}` : "None"}</dd></div>
            <div><dt>Products</dt><dd>{s.products.toLocaleString()}</dd></div>
            <div><dt>Stock</dt><dd>{s.stockLines ? `${s.stockLines.toLocaleString()} lines in ${s.stockLocations.toLocaleString()} locations` : "None yet"}</dd></div>
            <div><dt>People</dt><dd>{s.people}</dd></div>
          </dl>
        )}
      </section>
      <Export />
      <TeamFiles onDone={() => void status.reload()} />
      <Template onDone={() => void status.reload()} />
      <section className="panel glass">
        <h2 className="plain-h">Or count it in the WMS</h2>
        <p className="muted small">For the go-live count, start a count under Inventory → Count, count every slot (several people at once), then apply it: applying a count sets each counted slot's stock. Uncounted slots stay as they are.</p>
        <a className="link" href="#/inventory/count">Inventory → Count ›</a>
      </section>
    </div>
  );
}

/**
 * A copy of everything: settings, products, people (no sign-in details) and every piece of the warehouse's data
 * this owner may see (other people's direct messages stay theirs). The nightly backups on AWS hold everything.
 */
function Export() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { api } = await import("../../server/client");
      const rows: unknown[] = [];
      for (let since = 0; ;) {
        const r = await api<{ rows: unknown[]; seq: number; more: boolean }>("sync.pull", { since });
        rows.push(...r.rows); since = r.seq;
        if (!r.more) break;
      }
      const [settings, products, people] = await Promise.all([api("tenant.config"), api("tenant.products"), api("people.list")]);
      const out = { warehouse: tenant().config.branding.appTitle, exportedAt: new Date().toISOString(), format: "wms-export-1", settings, products, people, data: rows };
      download(new Blob([JSON.stringify(out)], { type: "application/json" }), `${tenant().id}-wms-copy-${today()}.json`);
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't make the copy"); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel glass">
      <h2 className="plain-h">A copy of this warehouse's data</h2>
      <p className="muted small">Settings, products, people and everything in the WMS, as one file. Keep it somewhere safe: it holds all of the warehouse's stock and orders. (The WMS also backs every warehouse up each night.)</p>
      <button className="btn small file-btn" disabled={busy} onClick={() => void run()}>{busy ? "Making the copy…" : "Download a copy (.json)"}</button>
    </section>
  );
}

/** The warehouse's own files, as our team prepared them (the a3k folder for A3K) */
function TeamFiles({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const toast = useToast();
  const [files, setFiles] = useState<Files | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    const out: Files = { names: [] };
    for (const f of [...list]) {
      try {
        const v = JSON.parse(await f.text());
        out.names.push(f.name);
        if (Array.isArray(v)) out.products = v;
        else if (v && typeof v === "object" && v.layout && v.clients) out.config = v;
        else if (v && typeof v === "object" && Object.values(v).every((x: any) => x && typeof x.src === "string")) out.logos = v;
        else out.problem = `${f.name} isn't a settings, products or logos file`;
      } catch { out.problem = `${f.name} isn't a JSON file`; }
    }
    setFiles(out);
  };
  const summary = useMemo(() => {
    if (!files?.config) return null;
    try { return { name: files.config.branding?.appTitle ?? files.config.tenant?.name ?? "?", clients: (files.config.clients ?? []).length, slots: buildLayout(files.config.layout).slots.length }; } catch { return { name: "?", clients: 0, slots: 0, broken: true }; }
  }, [files]);
  const save = async () => {
    if (!files) return;
    setBusy(true);
    try {
      if (files.config || files.logos) {
        const r = await act("setup.saveSettings", { ...(files.config ? { config: files.config } : {}), ...(files.logos ? { logos: files.logos } : {}) });
        if (!r.ok) { toast(r.error); return; }
      }
      if (files.products) {
        const r = await act<{ added: number; skipped: number }>("setup.importProducts", { products: files.products });
        if (!r.ok) { toast(r.error); return; }
        toast(`${r.value.added} products added${r.value.skipped ? ` (${r.value.skipped} were already there)` : ""}.`);
      } else toast("Saved.");
      setFiles(null);
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <section className="panel glass">
      <h2 className="plain-h">Warehouse files from the WMS team</h2>
      <p className="muted small">The settings (racks, location codes, clients, labels), product list and logos our team prepared for this warehouse: <span className="mono" translate="no">config.json</span>, <span className="mono" translate="no">products.json</span>, <span className="mono" translate="no">logos.json</span>. Choose one or all of them.</p>
      <label className="btn small file-btn">Choose files…<input type="file" accept=".json,application/json" multiple hidden onChange={e => { void pick(e.target.files); e.target.value = ""; }} /></label>
      {files && (
        <div className="import-preview">
          {files.problem && <p className="note warn">{files.problem}</p>}
          <ul className="plain-list small">
            {summary && <li>Settings: <b translate="no">{summary.name}</b> · {summary.clients} clients · {summary.slots.toLocaleString()} slots{"broken" in summary ? " (the layout couldn't be read)" : ""}</li>}
            {files.products && <li>Products: <b>{files.products.length.toLocaleString()}</b></li>}
            {files.logos && <li>Logos: <b>{Object.keys(files.logos).length}</b></li>}
          </ul>
          {summary && tenant().config.branding.appTitle !== summary.name && <p className="note">These settings are for <b translate="no">{summary.name}</b>; this warehouse is <b translate="no">{tenant().config.branding.appTitle}</b>. Check it's the right file.</p>}
          <div className="btns">
            <button className="btn small" onClick={() => setFiles(null)}>Cancel</button>
            <button className="btn small primary" disabled={busy || !!files.problem || (!files.config && !files.products && !files.logos)} onClick={() => void save()}>{busy ? "Saving…" : "Save to this warehouse"}</button>
          </div>
          <p className="muted small">Every device uses new settings and products the next time it opens the WMS.</p>
        </div>
      )}
    </section>
  );
}

/** The .xlsx template: products and the opening stock */
function Template({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const toast = useToast();
  const sync = useSync();
  const known = useApiData<KnownProduct[]>("tenant.products");
  const [sheets, setSheets] = useState<Awaited<ReturnType<typeof readXlsx>> | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useMemo(() => {
    if (!sheets) return null;
    const products = readProducts(sheets, CLIENTS);
    const stock = readStock(sheets, { products: known.data ?? [], normalize: normalizeLocation, today: today() });
    return { products, stock };
  }, [sheets, known.data]);
  // Stock rows can name products from this same file: those are checked again once the products are in
  const newProducts = (read?.products.products ?? []).filter(p => !(known.data ?? []).some(k => k.client === p.client && (k.item ?? k.name).toLowerCase() === p.item.toLowerCase()));

  const open = async (f: File | undefined) => {
    if (!f) return;
    setError(""); setFileName(f.name);
    try { setSheets(await readXlsx(await f.arrayBuffer())); } catch (e) { setSheets(null); setError(e instanceof Error ? e.message : "Couldn't read that file"); }
  };
  const importProducts = async (list: ProductIn[]) => {
    setBusy(true);
    try {
      const r = await act<{ added: number; skipped: number }>("setup.importProducts", { products: list });
      if (!r.ok) { toast(r.error); return; }
      toast(`${r.value.added} products added${r.value.skipped ? ` (${r.value.skipped} were already there)` : ""}.`);
      await known.reload();
      onDone();
    } finally { setBusy(false); }
  };
  const loadStock = async (lines: StockIn[]) => {
    setBusy(true);
    try {
      const r = await act<{ locations: number; lines: number; replaced: number }>("setup.importStock", { lines, replace });
      if (!r.ok) { toast(r.error); return; }
      toast(`Opening stock loaded: ${r.value.lines} lines in ${r.value.locations} locations.`);
      await sync?.pullNow();
      onDone();
    } finally { setBusy(false); }
  };

  const problems: Problem[] = read ? [...read.products.problems, ...read.stock.problems] : [];
  const productProblems = read?.products.problems.length ?? 0;
  const stockLocations = new Set(read?.stock.lines.map(l => l.location)).size;
  return (
    <section className="panel glass">
      <h2 className="plain-h">Products and opening stock (.xlsx)</h2>
      <p className="muted small">Fill in the template on the site visit (or from the warehouse's own sheets): one sheet of products, one of what's on each pallet. Every row is checked before anything is saved.</p>
      <div className="btns">
        <button className="btn small" onClick={() => download(buildXlsx(templateSheets({ clients: CLIENTS, exampleSlot: EXAMPLE_SLOT, exampleFloor: EXAMPLE_FLOOR })), "wms-setup-template.xlsx")}>Download the template</button>
        <label className="btn small file-btn">Choose a filled-in file…<input type="file" accept=".xlsx" hidden onChange={e => { void open(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
      {error && <p className="note warn" role="alert">{error}</p>}
      {read && (
        <div className="import-preview">
          <p className="small"><b translate="no">{fileName}</b>: {read.products.products.length} product row{read.products.products.length === 1 ? "" : "s"} ({newProducts.length} new), {read.stock.lines.length} stock line{read.stock.lines.length === 1 ? "" : "s"} ready in {stockLocations} location{stockLocations === 1 ? "" : "s"}.</p>
          {problems.length > 0 && (
            <div className="note warn">
              <b>{problems.length} row{problems.length > 1 ? "s" : ""} to fix first</b>
              <ul className="plain-list small">{problems.slice(0, 40).map((p, i) => <li key={i}><span translate="no">{p.sheet}</span>, row {p.row}: <span translate="no">{p.text}</span></li>)}</ul>
              {problems.length > 40 && <p className="small">…and {problems.length - 40} more.</p>}
            </div>
          )}
          <div className="btns">
            {read.products.products.length > 0 && <button className="btn small primary" disabled={busy || productProblems > 0 || !newProducts.length} onClick={() => void importProducts(newProducts)}>{newProducts.length ? `Add ${newProducts.length} product${newProducts.length > 1 ? "s" : ""}` : "Products are all in"}</button>}
            {read.stock.lines.length > 0 && <>
              <label className="toggle-row small"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> Replace what's there</label>
              <button className="btn small primary" disabled={busy || read.stock.problems.length > 0} onClick={() => void loadStock(read.stock.lines)}>Load the opening stock</button>
            </>}
          </div>
          {newProducts.length > 0 && read.stock.problems.some(p => p.text.startsWith("No product")) && <p className="muted small">Add the new products first: stock rows naming them are checked again straight after.</p>}
        </div>
      )}
    </section>
  );
}
