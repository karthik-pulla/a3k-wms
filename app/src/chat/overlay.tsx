import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { MapOverlay } from "../components/chat/MapOverlay";

/** What the map overlay shows. The same overlay opens from the home module and the full Messages screen. */
export type OverlayRequest =
  | { kind: "slots"; codes: string[]; snapshots?: Record<string, { productId: string; cases: number }[]>; onSend?: (codes: string[]) => void }
  | { kind: "product"; productId: string; snapshot?: { name: string; cases: number; locations: number }; onSend?: (codes: string[]) => void }
  /** Pick slots (rack → side → column → level → bay, or tap on the map) and hand them back */
  | { kind: "pick"; onSend: (codes: string[]) => void };

const Ctx = createContext<(r: OverlayRequest) => void>(() => {});

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<OverlayRequest | null>(null);
  const open = useCallback((r: OverlayRequest) => setReq(r), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {req && <MapOverlay request={req} onClose={() => setReq(null)} onSwitch={setReq} />}
    </Ctx.Provider>
  );
}

export const useOverlay = () => useContext(Ctx);
