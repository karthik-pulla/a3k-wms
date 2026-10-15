// Sign-in and encrypted storage, all on this device until the server exists.
//
// One random 256-bit "vault key" encrypts everything the app saves (stock, orders, messages, accounts, the security log).
// Each account holds its own copy of the vault key, encrypted with a key derived from that account's password, so the
// password is never stored and a wrong password simply can't decrypt anything. New-account requests are encrypted to
// the vault's public key, so only someone already signed in (an admin) can read them. Approving gives the new account a
// copy of the vault key encrypted to the new account's own public key (made from their password when they asked), which
// their first sign-in turns into a password-protected copy.
//
// What this can't do without a server: stop someone who controls this device and the app's code; two-factor sign-in;
// revoking an account's knowledge of the vault key (disabling blocks sign-in on this app, it doesn't change the key).
import {
  aesKey, ecdhPair, fromB64, open, openFrom, openJson, passwordKey, random, seal, sealJson, sealTo, toB64, usernameId,
  PBKDF2_ITERATIONS, type Sealed, type SealedTo,
} from "./crypto";
import type { Client } from "../data/catalog";
import type { Role, State } from "../store/types";

const AUTH = "wms.auth.v1";
const VAULT = "wms.vault.v1";
/** Before sign-in existed the app saved its data unencrypted here; it's moved into the vault and deleted */
const LEGACY = "wms.store.v1";
/** The only account at first. Change its password after the first sign-in. */
const DEFAULT_ADMIN = { username: "admin", password: "password", name: "Admin" };

const IDLE_MIN = 30, IDLE_MIN_KEEP = 7 * 24 * 60;
const MAX_HOURS = 12, MAX_HOURS_KEEP = 30 * 24;
const FREE_TRIES = 5, LOCK_BASE_S = 30, LOCK_MAX_S = 15 * 60;

export interface Account {
  uid: string;
  username: string;
  name: string;
  email?: string;
  role: Role;
  clients?: Client[];
  status: "active" | "disabled";
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  lastSignIn?: string;
  passwordChangedAt?: string;
  /** Still the default or a temporary password: asked to change it */
  mustChange?: boolean;
  admin?: boolean;
}
export type AuthEventKind = "created" | "sign-in" | "failed-attempts" | "request" | "approved" | "rejected" | "password-changed" | "password-reset" | "disabled" | "enabled" | "role-changed";
export interface AuthEvent { at: string; kind: AuthEventKind; who?: string; detail?: string }
export interface VaultData { version: 1; state: State | null; accounts: Account[]; log: AuthEvent[]; vaultPriv: string }
/** What someone asking for an account says about themselves. The role is not theirs to choose: the admin assigns it when approving. */
export interface RequestInfo { name: string; username: string; email?: string; role?: Role; note?: string; at: string }
export interface PendingRequest extends RequestInfo { id: string }

interface Entry {
  uid: string;
  salt: string;
  iterations: number;
  status: "pending" | "approved" | "active" | "disabled";
  /** Vault key under this account's password key */
  wrapped?: Sealed;
  /** This account's key pair; the private half under its password key */
  userKey: { pub: JsonWebKey; priv: Sealed };
  /** Vault key for userKey.pub, until the first sign-in after approval or a re-enable */
  grant?: SealedTo;
  /** Pending: who's asking, for the vault's key */
  request?: SealedTo;
  createdAt: string;
}
interface AuthFile { version: 1; vaultPub: JsonWebKey; entries: Record<string, Entry>; attempts: Record<string, { n: number; until?: string; since?: string }> }

export interface Session { key: CryptoKey; uid: string; keep: boolean; started: string; lastActive: string }

/** Accounts saved before "supervisor" was renamed "coordinator" */
function upgrade(d: VaultData): VaultData {
  return d.accounts.some(a => (a.role as string) === "supervisor") ? { ...d, accounts: d.accounts.map(a => ((a.role as string) === "supervisor" ? { ...a, role: "coordinator" } : a)) } : d;
}

const now = () => new Date().toISOString();
const readAuth = (): AuthFile | null => { try { const r = localStorage.getItem(AUTH); return r ? JSON.parse(r) as AuthFile : null; } catch { return null; } };
const writeAuth = (a: AuthFile) => localStorage.setItem(AUTH, JSON.stringify(a));
const readVault = (): Sealed | null => { try { const r = localStorage.getItem(VAULT); return r ? JSON.parse(r) as Sealed : null; } catch { return null; } };

// ---------- Session kept in IndexedDB: a non-extractable key, so a reload doesn't need the password ----------
const DB = "wms-auth", STORE = "session";
function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { resolve(r.result as T); req.result.close(); };
      tx.onerror = () => { reject(tx.error); req.result.close(); };
    };
  });
}
const saveSession = (s: Session) => idb<void>("readwrite", st => st.put(s, "current"));
const loadSession = () => idb<Session | undefined>("readonly", st => st.get("current")).catch(() => undefined);
export const clearSession = () => idb<void>("readwrite", st => st.delete("current")).catch(() => undefined);
export const sessionLimits = (s: Session) => ({ idleMin: s.keep ? IDLE_MIN_KEEP : IDLE_MIN, maxHours: s.keep ? MAX_HOURS_KEEP : MAX_HOURS });
function expired(s: Session): boolean {
  const { idleMin, maxHours } = sessionLimits(s);
  const t = Date.now();
  return t - new Date(s.lastActive).getTime() > idleMin * 6e4 || t - new Date(s.started).getTime() > maxHours * 36e5;
}
export async function touchSession(s: Session) { s.lastActive = now(); await saveSession(s).catch(() => undefined); }

// ---------- First run ----------
/** Creates the vault with the default admin the first time, moving any unencrypted data saved before sign-in existed into it. */
export async function ensureVault(sampleState: () => State): Promise<void> {
  if (readAuth() && readVault()) return;
  const raw = random(32);
  const vk = await aesKey(raw);
  const pair = await ecdhPair();
  const salt = random(16);
  const pk = await passwordKey(DEFAULT_ADMIN.password, salt);
  const adminKey = await ecdhPair();
  const id = await usernameId(DEFAULT_ADMIN.username);
  let legacy: State | null = null;
  try { const r = localStorage.getItem(LEGACY); if (r) legacy = JSON.parse(r) as State; } catch { /* start fresh */ }
  const admin: Account = { uid: "admin", username: DEFAULT_ADMIN.username, name: DEFAULT_ADMIN.name, role: "owner", status: "active", createdAt: now(), mustChange: true, admin: true };
  const data: VaultData = { version: 1, state: legacy ?? sampleState(), accounts: [admin], vaultPriv: toB64(pair.priv),
    log: [{ at: now(), kind: "created", who: "admin", detail: legacy ? "Vault created; the data already on this device was encrypted into it" : "Vault created" }] };
  const auth: AuthFile = { version: 1, vaultPub: pair.pub, attempts: {}, entries: {
    [id]: { uid: "admin", salt: toB64(salt), iterations: PBKDF2_ITERATIONS, status: "active", wrapped: await seal(pk, raw),
      userKey: { pub: adminKey.pub, priv: await seal(pk, adminKey.priv) }, createdAt: now() },
  } };
  localStorage.setItem(VAULT, JSON.stringify(await sealJson(vk, data)));
  writeAuth(auth);
  localStorage.removeItem(LEGACY);
}

// ---------- Signing in ----------
export type SignInResult =
  | { ok: true; session: Session; data: VaultData; failedSince?: number }
  | { ok: false; reason: "wrong" | "pending" | "disabled" | "locked"; until?: string };

const DUMMY_SALT = new Uint8Array(16);
function lockFor(n: number) { return n < FREE_TRIES ? 0 : Math.min(LOCK_MAX_S, LOCK_BASE_S * 2 ** (n - FREE_TRIES)); }

export async function signIn(username: string, password: string, keep: boolean): Promise<SignInResult> {
  const auth = readAuth();
  if (!auth) return { ok: false, reason: "wrong" };
  const id = await usernameId(username);
  const att = auth.attempts[id];
  if (att?.until && att.until > now()) return { ok: false, reason: "locked", until: att.until };
  const entry = auth.entries[id];
  const fail = (reason: "wrong" | "disabled" = "wrong"): SignInResult => {
    const n = (auth.attempts[id]?.n ?? 0) + 1, secs = lockFor(n);
    auth.attempts[id] = { n, since: auth.attempts[id]?.since ?? now(), ...(secs ? { until: new Date(Date.now() + secs * 1e3).toISOString() } : {}) };
    writeAuth(auth);
    return secs ? { ok: false, reason: "locked", until: auth.attempts[id].until } : { ok: false, reason };
  };
  // Unknown usernames take as long as known ones, so timing doesn't reveal which usernames exist
  if (!entry) { await passwordKey(password, DUMMY_SALT); return fail(); }
  const pk = await passwordKey(password, fromB64(entry.salt), entry.iterations);
  let raw: Uint8Array;
  try {
    if (entry.status === "active" && entry.wrapped) raw = await open(pk, entry.wrapped);
    else {
      const priv = await open(pk, entry.userKey.priv); // proves the password even before approval
      if (entry.status === "pending") return { ok: false, reason: "pending" };
      if (entry.status === "disabled" || !entry.grant) return fail("disabled");
      raw = await openFrom(priv, entry.grant);
      // First sign-in after approval: keep the vault key under the password from now on
      entry.wrapped = await seal(pk, raw);
      entry.grant = undefined;
      entry.status = "active";
    }
  } catch { return fail(); }
  const key = await aesKey(raw);
  raw.fill(0);
  const sealed = readVault();
  if (!sealed) return { ok: false, reason: "wrong" };
  const data = upgrade(await openJson<VaultData>(key, sealed));
  const acct = data.accounts.find(a => a.uid === entry.uid);
  if (!acct || acct.status !== "active") return fail("disabled");
  const failedSince = auth.attempts[id]?.n;
  delete auth.attempts[id];
  writeAuth(auth);
  acct.lastSignIn = now();
  data.log.unshift({ at: now(), kind: "sign-in", who: acct.username });
  if (failedSince) data.log.unshift({ at: now(), kind: "failed-attempts", who: acct.username, detail: `${failedSince} failed attempt${failedSince > 1 ? "s" : ""} before this sign-in` });
  const session: Session = { key, uid: acct.uid, keep, started: now(), lastActive: now() };
  await saveSession(session).catch(() => undefined);
  await persist(session, data);
  return { ok: true, session, data, failedSince };
}

/** The signed-in session from before a reload, unless it timed out */
export async function restore(): Promise<{ session: Session; data: VaultData } | null> {
  const s = await loadSession();
  const sealed = readVault();
  if (!s || !sealed) return null;
  if (expired(s)) { await clearSession(); return null; }
  try {
    const data = upgrade(await openJson<VaultData>(s.key, sealed));
    const acct = data.accounts.find(a => a.uid === s.uid);
    if (!acct || acct.status !== "active") { await clearSession(); return null; }
    await touchSession(s);
    return { session: s, data };
  } catch { await clearSession(); return null; }
}

/** Encrypts and saves everything (fresh IV every time) */
export async function persist(s: Session, data: VaultData): Promise<void> {
  localStorage.setItem(VAULT, JSON.stringify(await sealJson(s.key, data)));
}

/** The vault key itself, only after the signed-in person types their password again (for approving and resetting) */
async function reauth(s: Session, data: VaultData, password: string): Promise<Uint8Array> {
  const auth = readAuth()!;
  const acct = data.accounts.find(a => a.uid === s.uid)!;
  const entry = auth.entries[await usernameId(acct.username)];
  if (!entry?.wrapped) throw new Error("wrong");
  try { return await open(await passwordKey(password, fromB64(entry.salt), entry.iterations), entry.wrapped); } catch { throw new Error("Your password isn't right."); }
}

// ---------- Asking for an account ----------
export async function requestAccount(info: Omit<RequestInfo, "at">, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = readAuth();
  if (!auth) return { ok: false, error: "The app isn't set up yet. Ask the admin to sign in once first." };
  const id = await usernameId(info.username);
  if (auth.entries[id]) return { ok: false, error: "That username is taken or already requested." };
  const salt = random(16);
  const pk = await passwordKey(password, salt);
  const pair = await ecdhPair();
  const req: RequestInfo = { ...info, username: info.username.trim(), at: now() };
  auth.entries[id] = {
    uid: `u-${toB64(random(9)).replace(/[+/=]/g, "")}`, salt: toB64(salt), iterations: PBKDF2_ITERATIONS, status: "pending",
    userKey: { pub: pair.pub, priv: await seal(pk, pair.priv) },
    request: await sealTo(auth.vaultPub, new TextEncoder().encode(JSON.stringify(req))), createdAt: now(),
  };
  pair.priv.fill(0);
  writeAuth(auth);
  return { ok: true };
}

/** Pending requests, readable only with the vault open */
export async function pendingRequests(data: VaultData): Promise<PendingRequest[]> {
  const auth = readAuth();
  if (!auth) return [];
  const priv = fromB64(data.vaultPriv);
  const out: PendingRequest[] = [];
  for (const [id, e] of Object.entries(auth.entries)) {
    if (e.status !== "pending" || !e.request) continue;
    try { out.push({ id, ...JSON.parse(new TextDecoder().decode(await openFrom(priv, e.request))) as RequestInfo }); } catch { /* unreadable: skip */ }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Approve a request: needs the approver's password again. The account can sign in with the password it chose. */
export async function approve(s: Session, data: VaultData, approverPassword: string, req: PendingRequest, role: Role, clients: Client[] | undefined): Promise<VaultData> {
  const raw = await reauth(s, data, approverPassword);
  const auth = readAuth()!;
  const e = auth.entries[req.id];
  if (!e || e.status !== "pending") throw new Error("This request is gone.");
  e.grant = await sealTo(e.userKey.pub, raw);
  raw.fill(0);
  e.status = "approved";
  e.request = undefined;
  writeAuth(auth);
  const me = data.accounts.find(a => a.uid === s.uid)!;
  const acct: Account = { uid: e.uid, username: req.username, name: req.name, email: req.email, role, clients, status: "active", createdAt: req.at, approvedBy: me.username, approvedAt: now() };
  const next: VaultData = { ...data, accounts: [...data.accounts, acct], log: [{ at: now(), kind: "approved", who: me.username, detail: `${req.username} as ${role}${clients?.length ? ` (${clients.join(", ")} only)` : ""}` }, ...data.log] };
  await persist(s, next);
  return next;
}

export async function reject(s: Session, data: VaultData, req: PendingRequest): Promise<VaultData> {
  const auth = readAuth()!;
  delete auth.entries[req.id];
  writeAuth(auth);
  const me = data.accounts.find(a => a.uid === s.uid)!;
  const next = { ...data, log: [{ at: now(), kind: "rejected" as const, who: me.username, detail: req.username }, ...data.log] };
  await persist(s, next);
  return next;
}

/** Change your own password: the vault key and your private key are re-encrypted under the new one */
export async function changePassword(s: Session, data: VaultData, current: string, next: string): Promise<VaultData> {
  const auth = readAuth()!;
  const acct = data.accounts.find(a => a.uid === s.uid)!;
  const id = await usernameId(acct.username);
  const e = auth.entries[id];
  const oldKey = await passwordKey(current, fromB64(e.salt), e.iterations);
  let raw: Uint8Array, priv: Uint8Array;
  try { raw = await open(oldKey, e.wrapped!); priv = await open(oldKey, e.userKey.priv); } catch { throw new Error("Your current password isn't right."); }
  const salt = random(16);
  const nk = await passwordKey(next, salt);
  auth.entries[id] = { ...e, salt: toB64(salt), iterations: PBKDF2_ITERATIONS, wrapped: await seal(nk, raw), userKey: { ...e.userKey, priv: await seal(nk, priv) } };
  raw.fill(0); priv.fill(0);
  writeAuth(auth);
  const out: VaultData = { ...data, accounts: data.accounts.map(a => (a.uid === s.uid ? { ...a, passwordChangedAt: now(), mustChange: false } : a)), log: [{ at: now(), kind: "password-changed", who: acct.username }, ...data.log] };
  await persist(s, out);
  return out;
}

/** Admin: set a temporary password for someone who forgot theirs (they're asked to change it when they sign in) */
export async function resetPassword(s: Session, data: VaultData, approverPassword: string, uid: string, temp: string): Promise<VaultData> {
  const raw = await reauth(s, data, approverPassword);
  const auth = readAuth()!;
  const acct = data.accounts.find(a => a.uid === uid)!;
  const id = await usernameId(acct.username);
  const salt = random(16);
  const nk = await passwordKey(temp, salt);
  const pair = await ecdhPair();
  auth.entries[id] = { ...auth.entries[id], uid, salt: toB64(salt), iterations: PBKDF2_ITERATIONS, status: acct.status === "active" ? "active" : "disabled",
    wrapped: acct.status === "active" ? await seal(nk, raw) : undefined, grant: undefined, userKey: { pub: pair.pub, priv: await seal(nk, pair.priv) } };
  raw.fill(0); pair.priv.fill(0);
  writeAuth(auth);
  const me = data.accounts.find(a => a.uid === s.uid)!;
  const out: VaultData = { ...data, accounts: data.accounts.map(a => (a.uid === uid ? { ...a, mustChange: true } : a)), log: [{ at: now(), kind: "password-reset", who: me.username, detail: acct.username }, ...data.log] };
  await persist(s, out);
  return out;
}

/** Admin: block or allow an account's sign-in. Blocking deletes its copy of the vault key on this device. */
export async function setDisabled(s: Session, data: VaultData, approverPassword: string, uid: string, disabled: boolean): Promise<VaultData> {
  const auth = readAuth()!;
  const acct = data.accounts.find(a => a.uid === uid)!;
  const id = await usernameId(acct.username);
  const e = auth.entries[id];
  if (disabled) { e.status = "disabled"; e.wrapped = undefined; e.grant = undefined; }
  else { const raw = await reauth(s, data, approverPassword); e.grant = await sealTo(e.userKey.pub, raw); raw.fill(0); e.status = "approved"; }
  writeAuth(auth);
  const me = data.accounts.find(a => a.uid === s.uid)!;
  const out: VaultData = { ...data, accounts: data.accounts.map(a => (a.uid === uid ? { ...a, status: disabled ? "disabled" : "active" } : a)), log: [{ at: now(), kind: disabled ? "disabled" : "enabled", who: me.username, detail: acct.username }, ...data.log] };
  await persist(s, out);
  return out;
}

export async function setRole(s: Session, data: VaultData, uid: string, role: Role, clients: Client[] | undefined): Promise<VaultData> {
  const me = data.accounts.find(a => a.uid === s.uid)!;
  const acct = data.accounts.find(a => a.uid === uid)!;
  const out: VaultData = { ...data, accounts: data.accounts.map(a => (a.uid === uid ? { ...a, role, clients } : a)), log: [{ at: now(), kind: "role-changed", who: me.username, detail: `${acct.username}: ${role}${clients?.length ? ` (${clients.join(", ")} only)` : ""}` }, ...data.log] };
  await persist(s, out);
  return out;
}

/** Waiting requests count, without opening anything (for the badge) */
export const pendingCount = () => Object.values(readAuth()?.entries ?? {}).filter(e => e.status === "pending").length;

/** Your own name and email */
export async function updateProfile(s: Session, data: VaultData, patch: { name: string; email?: string }): Promise<VaultData> {
  const out: VaultData = { ...data, accounts: data.accounts.map(a => (a.uid === s.uid ? { ...a, name: patch.name, email: patch.email } : a)) };
  await persist(s, out);
  return out;
}

/** A random temporary password (for a reset), easy to read out: four groups of letters and digits */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  // Rejection sampling, so every character is equally likely (no modulo bias)
  const limit = 256 - (256 % alphabet.length);
  const chars: string[] = [];
  while (chars.length < 16) for (const b of random(32)) if (b < limit && chars.length < 16) chars.push(alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map(i => chars.slice(i, i + 4).join("")).join("-");
}
