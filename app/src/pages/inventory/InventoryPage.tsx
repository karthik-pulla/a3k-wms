import { useStore } from "../../store/store";
import { SubTabs } from "../../components/SubTabs";
import { productById } from "../../data/catalog";
import { ProductsTab } from "./ProductsTab";
import { StockTab } from "./StockTab";
import { CountTab } from "./CountTab";

/** Inventory: Products (find every pallet of a product or brand), Inventory (every rack, slot and floor spot), Count. */
export function InventoryPage({ parts }: { parts: string[] }) {
  const { state } = useStore();
  const [tab = "products", a, b] = parts;
  const openCounts = state.counts.filter(c => c.status !== "closed").length;
  const count = tab === "count" && a ? state.counts.find(c => c.id === a) : undefined;
  const crumb = tab === "products" ? (a ? (a.startsWith("brand:") ? `Products / ${a.slice(6)}` : `Products / ${productById(a)?.name ?? a}`) : "Products")
    : tab === "stock" ? (a ? `Inventory / ${a}` : "Inventory")
    : count ? `Count / ${count.name}${b === "review" ? " / review" : ""}` : "Count";
  return (
    <main className={`section inventory${tab === "count" && a && b !== "review" ? " counting" : ""}`}>
      <header className="section-head">
        <h1>Inventory</h1>
        <p className="crumb">{crumb}</p>
      </header>
      {tab === "stock" ? <StockTab openCode={a} /> : tab === "count" ? <CountTab id={a} sub={b} /> : <ProductsTab selection={a} />}
      <SubTabs base="inventory" current={tab}
        tabs={[{ id: "products", label: "Products" }, { id: "stock", label: "Inventory" }, { id: "count", label: "Count", badge: openCounts }]} />
    </main>
  );
}
