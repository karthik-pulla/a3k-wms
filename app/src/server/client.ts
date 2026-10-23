// How the app talks to the server. Three ways to run the app (VITE_WMS_BACKEND):
//   "local"   (default) everything on this device: the encrypted vault, the on-device sign-in (the demo site, today)
//   "server"  the real server on AWS: two-step sign-in, accounts, roles and settings there (POST /api/<method>)
//   "preview" the same server code running inside this browser on an in-memory PostgreSQL (PGlite), to try the
//             server screens before AWS exists. Nothing leaves the browser.
import type { ApiErrorBody } from "../../../server/src/shared/api.ts";

export type Backend = "local" | "server" | "preview";
export const BACKEND: Backend = (import.meta.env.VITE_WMS_BACKEND as Backend | undefined) ?? "local";
export const usesServer = BACKEND !== "local";

/** An answer the server sent on purpose (wrong password, locked, needs the password again…) */
export class ApiCallError extends Error {
  readonly code: string;
  readonly status: number;
  readonly info?: Record<string, unknown>;
  constructor(status: number, body: ApiErrorBody) { super(body.error); this.name = "ApiCallError"; this.status = status; this.code = body.code; this.info = body.info; }
}

type Call = <T = any>(method: string, input?: Record<string, unknown>) => Promise<T>;

async function http(path: string, method: string, input: Record<string, unknown>) {
  let r: Response;
  try {
    r = await fetch(`${path}/${encodeURIComponent(method)}`, {
      method: "POST", credentials: "same-origin",
      // x-wms: another site can't send this header, so it can't act as the signed-in person
      headers: { "content-type": "application/json", "x-wms": "1" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiCallError(0, { error: "Can't reach the server. Check the connection and try again.", code: "offline" });
  }
  const body = await r.json().catch(() => ({ error: "The server sent something unexpected", code: "server" }));
  if (!r.ok) throw new ApiCallError(r.status, body as ApiErrorBody);
  return body;
}

/** The warehouse API (for the warehouse at this address) */
// The preview checks are written out in full so a real build drops the preview (and its in-browser database) entirely
export const api: Call = async (method, input = {}) => {
  if (import.meta.env.VITE_WMS_BACKEND === "preview") return (await import("./preview")).previewTenant(method, input);
  return http("/api", method, input);
};

/** The ops console API (only at the console's address) */
export const opsApi: Call = async (method, input = {}) => {
  if (import.meta.env.VITE_WMS_BACKEND === "preview") return (await import("./preview")).previewOps(method, input);
  return http("/ops/api", method, input);
};

/** The product's public page (landing.html at <domain>): its name, and "Book a visit" */
export const siteApi: Call = async (method, input = {}) => {
  if (import.meta.env.VITE_WMS_BACKEND === "preview") return (await import("./preview")).previewSite(method, input);
  return http("/api", method, input);
};

/** The client portal (portal.html at <warehouse address>/portal): clients' own logins, their own cookie */
export const portalApi: Call = async (method, input = {}) => {
  if (import.meta.env.VITE_WMS_BACKEND === "preview") return (await import("./preview")).previewPortal(method, input);
  return http("/portal/api", method, input);
};
