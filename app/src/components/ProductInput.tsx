import { useCallback, useEffect, useState } from "react";
import { productById, productLabel, searchProducts, type Product } from "../data/catalog";
import { Autocomplete } from "./Autocomplete";

/** Product box that finishes the name from the product database as you type. */
export function ProductInput({ productId, onChange, client, autoFocus, ariaLabel = "Product", clearOnPick, onEnterEmpty, placeholder = "Type a product name or code" }: {
  productId: string | null;
  onChange: (productId: string | null) => void;
  /** The shipment's client; its products are suggested first */
  client?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  /** For "add" boxes: empty the box after each pick so the next product can be typed straight away */
  clearOnPick?: boolean;
  onEnterEmpty?: () => void;
  placeholder?: string;
}) {
  const chosen = productId ? productById(productId) : undefined;
  const [text, setText] = useState(chosen ? productLabel(chosen) : "");
  useEffect(() => { if (chosen) setText(productLabel(chosen)); }, [chosen]);
  const search = useCallback((q: string) => searchProducts(q, client), [client]);
  return (
    <Autocomplete<Product>
      value={text}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      onEnterEmpty={onEnterEmpty}
      autoFocus={autoFocus}
      invalid={!!text && !chosen}
      onInput={t => { setText(t); if (chosen) onChange(null); }}
      onPick={p => { setText(clearOnPick ? "" : productLabel(p)); onChange(p.id); }}
      search={search}
      itemKey={p => p.id}
      complete={p => (p.code.toLowerCase().startsWith(text.toLowerCase()) ? p.code : productLabel(p))}
      render={p => (
        <>
          <span className="ac-code">{p.code}</span>
          <span className="ac-name">{p.name}<small>{p.brand === p.client ? p.client : `${p.brand} · ${p.client}`}{/DONOTUSE/i.test(p.item ?? "") ? " · do not use" : /CROSSDOCK/i.test(p.item ?? "") ? " · cross-dock" : ""}</small></span>
          <span className="ac-size">{p.size}{p.units ? ` × ${p.units}` : ""}</span>
        </>
      )}
    />
  );
}
