import { createContext, useContext } from "react";
import type { HomeSettings } from "./settings";
import type { User } from "./store/types";

/** Who's signed in and their settings. Until real sign-in exists, "Signed in as" in Settings picks a sample user. */
export interface Session { me: User; settings: HomeSettings; update: (patch: Partial<HomeSettings>) => void }

export const SessionContext = createContext<Session | null>(null);
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionContext");
  return s;
}
