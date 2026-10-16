// Errors the API sends back on purpose. Anything else is a 500 with no details.

export type ErrorCode =
  | "bad-request" | "not-signed-in" | "wrong-sign-in" | "locked" | "wrong-code" | "expired" | "forbidden"
  | "confirm" | "not-found" | "conflict" | "read-only" | "busy";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /** Extra facts for the screen (e.g. seconds until a lock ends) */
  readonly info?: Record<string, unknown>;
  constructor(status: number, code: ErrorCode, message: string, info?: Record<string, unknown>) {
    super(message); this.name = "ApiError"; this.status = status; this.code = code; this.info = info;
  }
}

export const bad = (m: string) => new ApiError(400, "bad-request", m);
export const forbidden = (m = "You don't have permission for this") => new ApiError(403, "forbidden", m);
export const notFound = (m = "Not found") => new ApiError(404, "not-found", m);

// ---------- Checking what the browser sent (never trust its shape) ----------
export function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("Expected an object");
  return v as Record<string, unknown>;
}
export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === "") { if (opts.optional) return ""; throw bad(`${name} is missing`); }
  if (typeof v !== "string") throw bad(`${name} must be text`);
  const s = v.trim();
  if (s.length < (opts.min ?? 1) || s.length > (opts.max ?? 200)) throw bad(`${name} must be ${opts.min ?? 1}–${opts.max ?? 200} characters`);
  return s;
}
export function bool(v: unknown, fallback = false): boolean { return typeof v === "boolean" ? v : fallback; }
export function int(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return v;
}
export function strList(v: unknown, name: string, max = 50): string[] {
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== "string" || x.length > 80)) throw bad(`${name} must be a list of text`);
  return [...new Set(v.map(x => (x as string).trim()).filter(Boolean))];
}
export const USERNAME = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export function username(v: unknown): string {
  const u = str(v, "Username", { min: 2, max: 40 }).toLowerCase();
  if (!USERNAME.test(u)) throw bad("A username is 2–40 letters, numbers, dots, dashes or underscores");
  return u;
}
export function email(v: unknown, optional = true): string | null {
  const e = str(v, "Email", { max: 200, optional }).toLowerCase();
  if (!e) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad("That doesn't look like an email address");
  return e;
}
