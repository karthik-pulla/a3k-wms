// Editing a product's code, name and full description (Inventory → Products → a product → Edit product).
// Edit, then review the change with a reason, then save. The id never changes, so stock, orders and messages
// keep pointing at the product; labels, searches and the order reader use the new text from then on.
import { useState } from "react";
import { PRODUCTS, productText, type Product } from "../../data/catalog";
import { useStore } from "../../store/store";
import { useToast } from "../Toast";
import { api, ApiCallError, usesServer } from "../../server/client";
import { useSync } from "../../sync/context";
import { cleanProductText, itemWithCode, productEditProblems, PRODUCT_LIMITS, type ProductText } from "../../../../server/src/shared/products.ts";

export function EditProduct({ product, onDone }: { product: Product; onDone: () => void }) {
  const { dispatch } = useStore();
  const sync = useSync();
  const toast = useToast();
  const [before] = useState<ProductText>(() => productText(product));
  const [t, setT] = useState<ProductText>(before);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const after = cleanProductText(t);
  const same = after.code === before.code && after.name === before.name && after.item === before.item;
  const fieldsOk = productEditProblems(after, "ok, fine").length === 0;
  const sharing = after.code ? PRODUCTS.filter(p => p.id !== product.id && p.client === product.client && p.code === after.code) : [];
  // A new code also replaces the old one inside the full description ("Anaganaga:170gms*24:1108:…")
  const setCode = (code: string) => setT(x => ({ ...x, code, item: itemWithCode(x.item, x.code.trim(), code.trim()) }));

  const save = async () => {
    setBusy(true); setError("");
    try {
      let saved = after;
      if (usesServer) {
        // Saved and logged on the server; every device (this one too) gets it with the next catch-up
        const p = await api<Product>("products.update", { id: product.id, ...after, reason: reason.trim(), expect: before });
        saved = productText(p);
        await sync?.pullNow();
      } else dispatch({ type: "product/edit", id: product.id, before, after: saved, reason: reason.trim() });
      toast(usesServer ? `${saved.code || saved.name} saved.` : `${saved.code || saved.name} saved. It's in Logs.`);
      onDone();
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "Couldn't save the product. Try again.");
    } finally { setBusy(false); }
  };

  const row = (label: string, a: string, b: string) => a === b ? null : <div key={label}><dt>{label}</dt><dd><s className="muted">{a || "(none)"}</s><br />{b}</dd></div>;
  return (
    <div className="adjust glass edit-product">
      <p className="note">Labels, searches and orders use the new text from now on. Stock and orders stay with this product; old messages and Logs keep what they said.</p>
      {step === "edit" ? (
        <>
          <label className="field"><span>Code</span>
            <input className="input mono" value={t.code} maxLength={PRODUCT_LIMITS.code} onChange={e => setCode(e.target.value)} autoFocus spellCheck={false} translate="no" />
          </label>
          {sharing.length > 0 && <p className="muted small">Also the code of {sharing.map(p => p.item || p.name).join(", ")}. That's allowed (BOGO packs, placeholder codes).</p>}
          <label className="field"><span>Name</span>
            <input className="input" value={t.name} maxLength={PRODUCT_LIMITS.name} onChange={e => setT({ ...t, name: e.target.value })} translate="no" />
          </label>
          <label className="field"><span>Full code description</span>
            <input className="input mono" value={t.item} maxLength={PRODUCT_LIMITS.item} onChange={e => setT({ ...t, item: e.target.value })} spellCheck={false} translate="no" />
            <small className="muted">The full item text, as on the stock sheets and labels</small>
          </label>
          <div className="btns">
            <span className="grow" />
            <button className="btn small" onClick={onDone}>Cancel</button>
            <button className="btn small primary" disabled={same || !fieldsOk} onClick={() => setStep("review")}>Review change</button>
          </div>
        </>
      ) : (
        <>
          <dl className="adjust-diff" translate="no">{row("Code", before.code, after.code)}{row("Name", before.name, after.name)}{row("Full code description", before.item, after.item)}</dl>
          <label className="field"><span>Reason (required)</span>
            <input className="input" autoFocus value={reason} maxLength={PRODUCT_LIMITS.reason} onChange={e => setReason(e.target.value)} placeholder="e.g. the brand changed the code on its price list" onKeyDown={e => { if (e.key === "Enter" && reason.trim().length >= 4 && !busy) void save(); }} />
          </label>
          {error && <p className="note warn" role="alert">{error}</p>}
          <div className="btns">
            <button className="btn small" disabled={busy} onClick={() => { setStep("edit"); setError(""); }}>Back</button>
            <span className="grow" />
            <button className="btn small primary" disabled={busy || reason.trim().length < 4} onClick={() => void save()}>{busy ? "Saving…" : "Save product"}</button>
          </div>
        </>
      )}
    </div>
  );
}
