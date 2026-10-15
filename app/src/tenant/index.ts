// The warehouse (tenant) this copy of the app is serving: its settings, products and logos. Loaded once at startup,
// before any screen, so no warehouse's data is ever built into the app itself (docs/multi-tenant-design.md).
// Until the server exists the files come from public/tenants/<id>/; later the server picks the tenant from the address.
import { buildLayout, type Layout } from "./layout";
import { getLang, setLang, type Lang } from "../i18n";
import type { Logo, Product, Seed, TenantConfig } from "./types";
import type { StockLine } from "../store/types";

export interface Tenant {
  id: string;
  config: TenantConfig;
  products: Product[];
  logos: Record<string, Logo>;
  layout: Layout;
  /** Sample data a new vault starts with (testing and the demo); a real warehouse has none */
  seed: Seed | null;
  /** Stock to start a new vault with, e.g. A3K's last stock sheets for testing on this computer (never on GitHub) */
  stock: Record<string, StockLine[]> | null;
}

// In development, hot reload runs this file again: keep the loaded warehouse (screens still use it), then reload the page
let current: Tenant | null = (import.meta.hot?.data.tenant as Tenant | undefined) ?? null;
if (import.meta.hot) {
  import.meta.hot.dispose(d => { d.tenant = current; });
  import.meta.hot.accept(() => location.reload());
}

/** Which warehouse to load. VITE_TENANT picks another one for testing; A3K is the only real one so far. */
export const tenantId = (): string => import.meta.env.VITE_TENANT || "a3k";

/**
 * The name of something this warehouse saves on the device (vault, sign-in, session), so two warehouses opened in
 * the same browser (the demo and a real one, or testing) never read each other's data.
 */
export const storageKey = (base: string) => (tenant().config.storage?.unscopedKeys ? base : `${base}:${tenant().id}`);

export function tenant(): Tenant {
  if (!current) throw new Error("The warehouse's settings haven't loaded yet");
  return current;
}

export async function loadTenant(id = tenantId()): Promise<Tenant> {
  if (current?.id === id) return current;
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Not a warehouse ID: ${id}`);
  const base = `${import.meta.env.BASE_URL}tenants/${id}/`;
  // no-cache: check with the server each time, so a changed layout or product list shows on the next load
  const get = async <T,>(file: string): Promise<T> => {
    const r = await fetch(base + file, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Couldn't load the warehouse's ${file} (${r.status})`);
    return r.json() as Promise<T>;
  };
  // Optional files: a missing one comes back as the app's own page (dev server) or a 404
  const optional = async <T,>(file: string): Promise<T | null> => {
    const r = await fetch(base + file, { cache: "no-cache" }).catch(() => null);
    return r?.ok && r.headers.get("content-type")?.includes("json") ? (r.json() as Promise<T>) : null;
  };
  const [config, products, logos, seed, stock] = await Promise.all([
    get<TenantConfig>("config.json"), get<Product[]>("products.json"), get<Record<string, Logo>>("logos.json"),
    optional<Seed>("seed.json"), optional<{ stock: Record<string, StockLine[]> }>("stock.json"),
  ]);
  if (config.schemaVersion !== 1) throw new Error(`This app can't read settings version ${config.schemaVersion}`);
  current = { id, config, products, logos, layout: buildLayout(config.layout), seed, stock: stock?.stock ?? null };
  document.title = config.branding.appTitle;
  // The language chosen on this device, if the warehouse offers it; otherwise the warehouse's default
  const { enabled, default: fallback } = config.languages;
  let saved: string | null = null;
  try { saved = localStorage.getItem("wms.lang"); } catch { /* storage blocked */ }
  const want: Lang = saved && enabled.includes(saved as Lang) ? (saved as Lang) : fallback;
  if (getLang() !== want) setLang(want);
  // Rack drawings have one row per level (styles/global.css)
  document.documentElement.style.setProperty("--levels", String(current.layout.levels.length));
  return current;
}
