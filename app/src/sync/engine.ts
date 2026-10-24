// Keeps this device's copy of the warehouse's data in step with the server (server/src/shared/sync.ts).
//
// - confirmed: the data as the server last said it is
// - waiting: changes made here that the server hasn't saved yet (kept on the device, so going offline or reloading
//   loses nothing); what the screens show is the confirmed data with the waiting changes worked out on top
// - sending: the oldest waiting change is worked out again on the confirmed data, and the pieces it changes are sent
//   with the versions they had. If someone else changed one of them first, the device catches up and tries again,
//   so the change is always made on the newest data. A change the server refuses (no permission) is dropped and
//   the person is told.
// - catching up: every 2 s while the app is in front (15 s behind), and right after a refused or conflicting change.
// - starting over: when a backup was swapped in on the server (its number is below this device's, or its database
//   is a new copy), what's kept here is forgotten and everything is caught up from the start; waiting changes stay
//   and are sent again on the restored data (the server refuses any that no longer make sense).
// - on the device: the confirmed pieces and the waiting changes, encrypted with the person's key from the server.
//
// Everything outside (the server, storage, the app's own logic) is passed in, so this file runs in tests too.
import type { State } from "../store/types";
import type { PullResult, PushInput, PushResult, SyncRow } from "../../../server/src/shared/sync.ts";
import { ACTION_RULES } from "../../../server/src/shared/sync.ts";
import { applyRows, blankState, diff, type EntityRow } from "./entities.ts";

/** An action as the app dispatches it (store/store.tsx Logged) */
export interface SyncAction { type: string; at?: string; [k: string]: unknown }
export interface SyncStatus {
  /** saved: nothing waiting; saving: sending now; offline: no connection, changes wait here; problem: the last change was refused */
  state: "saved" | "saving" | "offline";
  waiting: number;
  /** The last time the server answered */
  lastSyncedAt: string | null;
  /** First catch-up still running (nothing saved on this device yet) */
  loading: boolean;
}
export interface SyncStorage { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; del(key: string): Promise<void> }
export interface SyncDeps {
  /** The server: sync.push / sync.pull through the app's API */
  call: <T>(method: string, input: Record<string, unknown>) => Promise<T>;
  /** The app's own logic (store/store.tsx root) */
  reduce: (s: State, a: SyncAction) => State;
  /** The data this device starts from before anything arrives (people list, team channel) */
  base: State;
  storage?: SyncStorage;
  /** Where on the device: per warehouse and person */
  storageKey: string;
  /** Encrypts what's kept on the device; without one nothing is kept (support sessions) */
  cacheKey: string | null;
  deviceId: string;
  /** A change the server refused or that couldn't be made: tell the person */
  onRefused?: (message: string, action: SyncAction) => void;
  /** Called with errors that mean the person must sign in again */
  onSignedOut?: () => void;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  /** Whether the app is in front (catch up faster) */
  visible?: () => boolean;
  /** A request with no answer after this long counts as no connection (default 20 s; it's sent again later) */
  timeoutMs?: number;
}

/** A change waiting to be saved. clientId + clientSeq name it for the server, so sending it again saves it once. */
interface Waiting { clientId: string; clientSeq: number; action: SyncAction; tries: number }
interface Piece { v: number; c: number; data: unknown }
interface Saved { cursor: number; pieces: [string, Piece][]; copy?: string }

/** An answer from the server about one change, or no answer at all */
interface CallError { status: number; code: string; message: string }
const asCallError = (e: unknown): CallError => ({ status: (e as { status?: number })?.status ?? 0, code: (e as { code?: string })?.code ?? "offline", message: e instanceof Error ? e.message : String(e) });

const ruleOf = (type: string) => ACTION_RULES[type] ?? "local";
const BACKGROUND = new Set(["chat/presence", "chat/read"]);

export class SyncEngine {
  private confirmed: State;
  private pieces = new Map<string, Piece>();
  private cursor = 0;
  /** Which copy of the server's database the kept pieces came from (PullResult.copy) */
  private copy: string | null = null;
  /** The server's numbers went back (seen on a save): the next catch-up starts over */
  private stale = false;
  /** Started over and not told the person yet (once the catch-up is done) */
  private restarted = false;
  private waiting: Waiting[] = [];
  private nextSeq = 1;
  /** This page's own id for its changes (a new one each time the page opens; changes kept from before keep theirs) */
  private readonly clientId: string;
  private view: State;
  private listeners = new Set<() => void>();
  private status: SyncStatus = { state: "saved", waiting: 0, lastSyncedAt: null, loading: true };
  private forcedOffline = false;
  private netDown = false;
  private pushing = false;
  private pulling: Promise<void> | null = null;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private key: CryptoKey | null = null;
  private readonly t: NonNullable<SyncDeps["timers"]>;
  private readonly d: SyncDeps;

  constructor(deps: SyncDeps) {
    this.d = deps;
    const d = deps;
    this.clientId = `${d.deviceId}-${Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 80);
    this.confirmed = blankState(d.base);
    this.view = this.confirmed;
    this.t = d.timers ?? { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  }

  // ---------- For the screens ----------
  private noticeListeners = new Set<(message: string) => void>();
  /** Changes the server refused, for a toast */
  onNotice = (f: (message: string) => void) => { this.noticeListeners.add(f); return () => { this.noticeListeners.delete(f); }; };
  private notice(message: string, action: SyncAction) { this.d.onRefused?.(message, action); for (const f of this.noticeListeners) f(message); }
  getState = () => this.view;
  getStatus = () => this.status;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };

  /** A change made on this device */
  dispatch = (a: SyncAction) => {
    const action = { ...a, at: a.at ?? new Date().toISOString() };
    const rule = ruleOf(action.type);
    if (rule === "refused") { this.notice("That can only be done in the device-only app.", action); return; }
    if (rule === "local") {
      // Only this device's view changes (delivery ticks, names from the people list)
      this.confirmed = this.d.reduce(this.confirmed, action);
      this.refresh();
      return;
    }
    this.waiting.push({ clientId: this.clientId, clientSeq: this.nextSeq++, action, tries: 0 });
    this.refresh();
    void this.saveWaiting();
    void this.push();
  };

  /** The people list and anything else this device adds to what the server sends (kept across catch-ups) */
  setLocal(f: (s: State) => State) { this.confirmed = f(this.confirmed); this.refresh(); }

  /** "Simulate offline", or the browser saying there's no network */
  setOnline(online: boolean) {
    const was = this.forcedOffline;
    this.forcedOffline = !online;
    this.refresh();
    if (was && online) { this.netDown = false; void this.push(); void this.pullNow(); }
  }

  // ---------- Starting and stopping ----------
  /** Opens what this device kept (if anything), then catches up. Resolves once there's data to show. */
  async open(): Promise<void> {
    if (this.d.cacheKey) this.key = await importKey(this.d.cacheKey);
    await this.load();
    const first = this.pullNow();
    // With nothing kept here, wait for the first catch-up; otherwise show what's kept and catch up behind it
    if (!this.pieces.size) await first; else void first;
    void this.push();
  }

  stop() {
    this.stopped = true;
    for (const t of [this.pullTimer, this.retryTimer, this.saveTimer]) if (t) this.t.clearTimeout(t);
  }

  /** Signing out on a shared device: forget everything kept here */
  async forget() {
    this.stop();
    await this.d.storage?.del(`${this.d.storageKey}:data`);
    await this.d.storage?.del(`${this.d.storageKey}:waiting`);
  }

  // ---------- Catching up ----------
  /** Catches up now (and keeps catching up every few seconds) */
  pullNow(): Promise<void> {
    if (this.pulling) return this.pulling;
    this.pulling = this.pullAll().finally(() => { this.pulling = null; this.schedulePull(); });
    return this.pulling;
  }

  private schedulePull() {
    if (this.stopped) return;
    if (this.pullTimer) this.t.clearTimeout(this.pullTimer);
    const ms = this.netDown ? 5000 : (this.d.visible?.() ?? true) ? 2000 : 15000;
    this.pullTimer = this.t.setTimeout(() => { void this.pullNow(); }, ms);
  }

  private async pullAll() {
    if (this.offline()) return;
    try {
      for (;;) {
        if (this.stale) this.startOver();
        const since = this.cursor;
        const r = await this.call<PullResult>("sync.pull", { since });
        this.answered();
        // A save showed the server went back while this was on its way: start over before taking it
        if (this.stale) continue;
        // At 0 there's nothing kept to forget, so this can't go round forever
        if (since > 0 && (r.reset || (this.copy !== null && r.copy !== this.copy))) { this.stale = true; continue; }
        this.copy = r.copy;
        this.take(r.rows);
        this.cursor = r.seq;
        if (!r.more) break;
      }
      this.status = { ...this.status, loading: false };
      this.refresh();
      this.saveSoon();
      if (this.restarted) {
        this.restarted = false;
        for (const f of this.noticeListeners) f("This warehouse's data was restored from a backup, so this device loaded it again.");
        void this.push();
      }
    } catch (e) { this.failed(asCallError(e)); }
  }

  /** Pieces from the server: newer versions replace what's here */
  private take(rows: SyncRow[]) {
    const fresh: EntityRow[] = [];
    for (const r of rows) {
      const cur = this.pieces.get(r.key);
      if (cur && cur.v > r.v) continue;
      this.pieces.set(r.key, { v: r.v, c: cur?.c ?? r.c, data: r.data });
      fresh.push({ key: r.key, data: r.data, c: r.c });
    }
    if (fresh.length) this.confirmed = applyRows(this.confirmed, fresh, this.orderOf, this.pieces);
  }
  private orderOf = (key: string) => this.pieces.get(key)?.c ?? Number.MAX_SAFE_INTEGER;

  /** The server's data went back (a backup was swapped in): forget its pieces, keep this device's own (the people list)
   * and the waiting changes. The screens keep showing the old data until the catch-up from 0 is done. */
  private startOver() {
    this.stale = false; this.restarted = true;
    this.pieces = new Map(); this.cursor = 0; this.copy = null;
    this.confirmed = blankState(this.confirmed);
  }

  // ---------- Sending ----------
  private async push() {
    if (this.pushing || this.stopped) return;
    this.pushing = true;
    try {
      while (this.waiting.length && !this.offline()) {
        const w = this.waiting[0];
        // Worked out again on the newest confirmed data, every time it's sent
        const next = this.d.reduce(this.confirmed, w.action);
        const changes = diff(this.confirmed, next);
        if (!changes.length) { this.waiting.shift(); continue; }
        const input: PushInput = {
          clientId: w.clientId, clientSeq: w.clientSeq, type: w.action.type, at: w.action.at!,
          changes: changes.map(c => ({ key: c.key, base: this.pieces.get(c.key)?.v ?? 0, data: c.data })),
        };
        this.status = { ...this.status, state: "saving" };
        this.emit();
        let r: PushResult;
        const since = this.cursor;
        try { r = await this.call<PushResult>("sync.push", input as unknown as Record<string, unknown>); }
        catch (e) {
          const err = asCallError(e);
          if (err.status === 0 || err.status >= 500 || err.code === "busy") { this.failed(err); break; }
          if (err.code === "not-signed-in") { this.failed(err); break; }
          // Refused: no permission, or not a change the server takes. Dropped, and the person is told.
          this.waiting.shift();
          this.notice(`Not saved: ${err.message}`, w.action);
          await this.saveWaiting();
          await this.pullNow();
          continue;
        }
        this.answered();
        if (r.ok) {
          const rows: SyncRow[] = changes.map(c => ({ key: c.key, v: r.ok ? r.versions[c.key] ?? 0 : 0, s: r.ok ? r.seq : 0, c: this.pieces.get(c.key)?.c ?? (r.ok ? r.seq : 0), data: c.data }));
          this.take(rows);
          this.waiting.shift();
          await this.saveWaiting();
          this.saveSoon();
          // A new save is numbered above every number the server had given out, unless a backup was swapped in
          if (!r.again && r.seq <= since) { this.stale = true; await this.pullNow(); }
        } else if (++w.tries > 8) {
          this.waiting.shift();
          this.notice("Someone else kept changing the same thing, so this change wasn't saved. Check it and try again.", w.action);
          await this.saveWaiting();
        } else {
          // Someone else got there first: catch up, then work it out again
          await this.pullNow();
        }
        this.refresh();
      }
    } finally {
      this.pushing = false;
      this.refresh();
    }
  }

  private offline() { return this.forcedOffline || this.stopped; }

  /** The server, but never waiting forever: no answer in time counts as no connection (a change sent again is saved once) */
  private call<T>(method: string, input: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = this.t.setTimeout(() => reject(Object.assign(new Error("No answer from the server"), { status: 0, code: "offline" })), this.d.timeoutMs ?? 20_000);
      this.d.call<T>(method, input).then(v => { this.t.clearTimeout(t); resolve(v); }, e => { this.t.clearTimeout(t); reject(e); });
    });
  }

  private answered() {
    this.netDown = false;
    this.status = { ...this.status, lastSyncedAt: new Date().toISOString() };
  }

  private failed(err: CallError) {
    if (err.code === "not-signed-in") { this.stop(); this.d.onSignedOut?.(); return; }
    this.netDown = true;
    this.refresh();
    // Try again in a moment (the catch-up timer runs anyway)
    if (this.retryTimer) this.t.clearTimeout(this.retryTimer);
    if (!this.stopped) this.retryTimer = this.t.setTimeout(() => { this.netDown = false; void this.push(); }, 5000);
  }

  // ---------- What the screens see ----------
  private refresh() {
    this.view = this.waiting.reduce((s, w) => this.d.reduce(s, w.action), this.confirmed);
    // Online status and "read" markers go out all the time in the background: they don't count as unsaved work
    const work = this.waiting.filter(w => !BACKGROUND.has(w.action.type)).length;
    const state: SyncStatus["state"] = this.forcedOffline || this.netDown ? "offline" : work ? "saving" : "saved";
    this.status = { ...this.status, state, waiting: work };
    this.emit();
  }
  private emit() { for (const f of this.listeners) f(); }

  // ---------- Kept on this device, encrypted ----------
  private async load() {
    if (!this.key || !this.d.storage) return;
    try {
      const data = await this.d.storage.get(`${this.d.storageKey}:data`);
      if (data) {
        const saved = JSON.parse(await decrypt(this.key, data)) as Saved;
        this.pieces = new Map(saved.pieces);
        this.cursor = saved.cursor;
        this.copy = saved.copy ?? null;
        this.confirmed = applyRows(this.confirmed, saved.pieces.map(([key, p]) => ({ key, data: p.data, c: p.c })), this.orderOf, this.pieces);
      }
      const waiting = await this.d.storage.get(`${this.d.storageKey}:waiting`);
      if (waiting) {
        // Changes kept from before keep their own ids, so one the server already has is saved once
        this.waiting = (JSON.parse(await decrypt(this.key, waiting)) as { list: Waiting[] }).list.filter(w => w.clientId);
      }
      this.status = { ...this.status, loading: !this.pieces.size };
    } catch {
      // Made with an older key (signed out everywhere, or reset): start again from the server
      this.pieces = new Map(); this.cursor = 0; this.copy = null; this.waiting = [];
      this.confirmed = blankState(this.d.base);
    }
    this.refresh();
  }

  private async saveWaiting() {
    if (!this.key || !this.d.storage) return;
    await this.d.storage.set(`${this.d.storageKey}:waiting`, await encrypt(this.key, JSON.stringify({ list: this.waiting })));
  }

  private dirty = false;
  private saveSoon() {
    this.dirty = true;
    if (!this.key || !this.d.storage || this.saveTimer) return;
    this.saveTimer = this.t.setTimeout(() => { this.saveTimer = null; void this.flush(); }, 3000);
  }

  /** Saves the copy on this device now (the app calls it when it goes into the background) */
  async flush() {
    if (!this.key || !this.d.storage || !this.dirty) return;
    if (this.saveTimer) { this.t.clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.dirty = false;
    const saved: Saved = { cursor: this.cursor, pieces: [...this.pieces], copy: this.copy ?? undefined };
    try { await this.d.storage.set(`${this.d.storageKey}:data`, await encrypt(this.key, JSON.stringify(saved))); } catch { this.dirty = true; /* storage full: tried again next time */ }
  }
}

// ---------- AES-GCM with the person's key ----------
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function importKey(cacheKey: string) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`wms-device-cache:${cacheKey}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  // Big blobs: built in chunks (String.fromCharCode can't take millions of arguments)
  let bin = "";
  for (let i = 0; i < ct.length; i += 0x8000) bin += String.fromCharCode(...ct.subarray(i, i + 0x8000));
  return `${b64u(iv)}.${btoa(bin)}`;
}
async function decrypt(key: CryptoKey, blob: string): Promise<string> {
  const [iv, ct] = blob.split(".");
  const bytes = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(iv) }, key, bytes));
}
