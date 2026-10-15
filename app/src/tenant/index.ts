// The warehouse (tenant) this copy of the app is serving: its settings, products and logos. Loaded once at startup,
// before any screen, so no warehouse's data is ever built into the app itself (docs/multi-tenant-design.md).
// Until the server exists the files come from public/tenants/<id>/; later the server picks the tenant from the address.
import { buildLayout, type Layout } from "./layout";
import { getLang, setLang, type Lang } from "../i18n";
import type { Logo, Product, TenantConfig } from "./types";

export interface Tenant {
  id: string;
  config: TenantConfig;
  products: Product[];
  logos: Record<string, Logo>;
  layout: Layout;
}

let current: Tenant | null = null;
// In development, a change to this file would forget the loaded warehouse while screens still use it: reload instead
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

/** Which warehouse to load. VITE_TENANT picks another one for testing; A3K is the only real one so far. */
export const tenantId = (): string => import.meta.env.VITE_TENANT || "a3k";

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
  const [config, products, logos] = await Promise.all([get<TenantConfig>("config.json"), get<Product[]>("products.json"), get<Record<string, Logo>>("logos.json")]);
  if (config.schemaVersion !== 1) throw new Error(`This app can't read settings version ${config.schemaVersion}`);
  current = { id, config, products, logos, layout: buildLayout(config.layout) };
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
