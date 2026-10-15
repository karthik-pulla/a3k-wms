import { useEffect, useState } from "react";

export type Mode = "home" | "inbounds" | "inventory" | "outbounds" | "messages" | "account" | "tasks" | "logs" | "work";
const MODES: Mode[] = ["home", "inbounds", "inventory", "outbounds", "messages", "account", "tasks", "logs", "work"];

export interface Route {
  mode: Mode;
  /** Path after the mode, e.g. #/inbounds/pending/deccan-2930 -> ["pending", "deccan-2930"] */
  parts: string[];
}

const parse = (): Route => {
  const [first, ...rest] = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const mode = MODES.includes(first as Mode) ? (first as Mode) : "home";
  return { mode, parts: mode === "home" ? [] : rest };
};

export const go = (path: string) => { window.location.hash = path; };

/** Hash-based routes (#/inbounds/…) so the app works from any static host and offline. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => { const next = parse(); setRoute(next); if (next.mode !== "messages") window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
