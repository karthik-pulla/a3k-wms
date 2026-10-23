import { useEffect, useState } from "react";

export type Mode = "home" | "inbounds" | "inventory" | "outbounds" | "messages" | "account" | "tasks" | "logs" | "work" | "manage" | "help";
const MODES: Mode[] = ["home", "inbounds", "inventory", "outbounds", "messages", "account", "tasks", "logs", "work", "manage", "help"];
/** Older addresses: the Team page became Manage warehouse → People */
const ALIASES: Record<string, Mode> = { warehouse: "manage", team: "manage", managewarehouse: "manage" };

export interface Route {
  mode: Mode;
  /** Path after the mode, e.g. #/inbounds/pending/deccan-2930 -> ["pending", "deccan-2930"] */
  parts: string[];
}

const parse = (): Route => {
  const [first, ...rest] = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  // People type the names as they're written on screen: #/in-bounds, #/Out-bounds
  const raw = first?.toLowerCase().replace(/-/g, "") ?? "";
  const name = ALIASES[raw] ?? raw;
  const mode = MODES.includes(name as Mode) ? (name as Mode) : "home";
  // #/warehouse/roles (the old Team page) → #/manage/people/roles
  if (raw === "warehouse" || raw === "team") return { mode, parts: rest[0] && ["roles", "requests"].includes(rest[0]) ? ["people", rest[0]] : rest[0] === "log" ? ["logs", "security"] : rest.length ? rest : ["people"] };
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
