import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const Ctx = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 3800);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toast glass" role="status" aria-live="polite" hidden={!msg}>{msg}</div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
