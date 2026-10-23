// Signing in, sessions and invite links, the same for a warehouse's people and its clients' portal logins (its own
// database) and the WMS team's operators (the platform database); only the table names differ.
//
// Sign-in is two steps: username + password gives a 5-minute ticket; the ticket + a code from the person's
// authenticator app gives a session. Five wrong tries lock the account for 30 s, doubling up to 15 minutes. Unknown
// usernames take as long as known ones and get the same answer.
import { checkTotp, hashPassword, newTotpSecret, randomToken, seal, tokenId, totpUri, unseal, verifyPassword } from "./crypto.ts";
import type { Db, Sql } from "./db.ts";
import { ApiError } from "./errors.ts";
import { passwordProblems } from "../shared/passwords.ts";

export interface AuthTables { people: string; tickets: string; sessions: string; invites: string }
// Constants only (never anything a person typed), so they're safe to put into SQL
export const TENANT_TABLES: AuthTables = { people: "people", tickets: "sign_in_tickets", sessions: "sessions", invites: "invites" };
export const OPS_TABLES: AuthTables = { people: "operators", tickets: "operator_tickets", sessions: "operator_sessions", invites: "operator_invites" };
/** The client portal's logins (a client's own people), kept apart from the warehouse's people (core/portal-api.ts) */
export const CLIENT_TABLES: AuthTables = { people: "client_accounts", tickets: "client_tickets", sessions: "client_sessions", invites: "client_invites" };

export interface AuthEnv {
  db: Db;
  tables: AuthTables;
  /** The server's app key: seals authenticator secrets (Secrets Manager on AWS) */
  appKey: Uint8Array;
  now: () => number;
  /** Shown in the authenticator app above the code, e.g. "A3K Warehouse" */
  issuer: string;
  /** Words that count as common passwords here (the warehouse's own name) */
  ownWords: string[];
  log: (q: Sql, e: { actor: string; action: string; target?: string; detail?: Record<string, unknown>; ip?: string }) => Promise<void>;
}

export interface Meta { ip?: string; userAgent?: string }

export const LIMITS = {
  ticketMin: 5,
  idleMin: 30, idleKeepMin: 7 * 24 * 60,
  maxHours: 12, maxKeepHours: 30 * 24,
  confirmMin: 10,
  freeTries: 5, lockBaseS: 30, lockMaxS: 15 * 60,
  inviteDays: 7, resetHours: 24,
} as const;

const iso = (ms: number) => new Date(ms).toISOString();
const lockSeconds = (fails: number) => (fails < LIMITS.freeTries ? 0 : Math.min(LIMITS.lockBaseS * 2 ** (fails - LIMITS.freeTries), LIMITS.lockMaxS));
const lockedFor = (lockedUntil: string | Date | null, now: number) => (lockedUntil ? Math.max(0, Math.ceil((new Date(lockedUntil).getTime() - now) / 1000)) : 0);

const wrongSignIn = () => new ApiError(401, "wrong-sign-in", "That username and password don't match");

async function failed(env: AuthEnv, q: Sql, personId: string, fails: number, why: string, meta: Meta) {
  const lock = lockSeconds(fails);
  await q.query(`UPDATE ${env.tables.people} SET failed_count = $2, locked_until = $3 WHERE id = $1`, [personId, fails, lock ? iso(env.now() + lock * 1000) : null]);
  await env.log(q, { actor: "system", action: why, target: personId, detail: lock ? { lockedSeconds: lock } : {}, ip: meta.ip });
}

// ---------- Step 1: username + password → ticket ----------
export async function signIn(env: AuthEnv, input: { username: string; password: string; keep: boolean }, meta: Meta): Promise<{ ticket: string }> {
  const { rows } = await env.db.query(`SELECT id, password_hash, status, failed_count, locked_until FROM ${env.tables.people} WHERE username = $1`, [input.username]);
  const p = rows[0];
  const wait = p ? lockedFor(p.locked_until, env.now()) : 0;
  // Do the password work even when locked or unknown, so the answer always takes as long
  const ok = await verifyPassword(input.password, p?.password_hash ?? null);
  if (wait) throw new ApiError(429, "locked", "Too many wrong tries. Wait a moment and try again.", { seconds: wait });
  if (!p || !ok || p.status !== "active") {
    if (p) await failed(env, env.db, p.id, p.failed_count + 1, "sign-in: wrong password", meta);
    throw wrongSignIn();
  }
  const ticket = randomToken();
  await env.db.query(`INSERT INTO ${env.tables.tickets} (id, person_id, keep, expires_at) VALUES ($1, $2, $3, $4)`,
    [await tokenId(ticket), p.id, input.keep, iso(env.now() + LIMITS.ticketMin * 60_000)]);
  return { ticket };
}

// ---------- Step 2: ticket + authenticator code → session ----------
export async function verifyCode(env: AuthEnv, input: { ticket: string; code: string }, meta: Meta): Promise<{ token: string; maxAgeSec: number; personId: string }> {
  return env.db.tx(async q => {
    const { rows } = await q.query(
      `SELECT t.person_id, t.keep, p.totp_secret, p.totp_last_step, p.failed_count, p.locked_until, p.status
         FROM ${env.tables.tickets} t JOIN ${env.tables.people} p ON p.id = t.person_id
        WHERE t.id = $1 AND t.used_at IS NULL AND t.expires_at > $2 FOR UPDATE OF t`, [await tokenId(input.ticket), iso(env.now())]);
    const r = rows[0];
    if (!r || r.status !== "active") throw new ApiError(401, "expired", "That took too long. Sign in again.");
    const wait = lockedFor(r.locked_until, env.now());
    if (wait) throw new ApiError(429, "locked", "Too many wrong tries. Wait a moment and try again.", { seconds: wait });
    const step = r.totp_secret ? await checkTotp(await unseal(env.appKey, r.totp_secret), input.code, env.now(), r.totp_last_step === null ? null : Number(r.totp_last_step)) : null;
    if (step === null) {
      await failed(env, q, r.person_id, r.failed_count + 1, "sign-in: wrong code", meta);
      throw new ApiError(401, "wrong-code", "That code isn't right. Use the newest code in your authenticator app.");
    }
    await q.query(`UPDATE ${env.tables.tickets} SET used_at = $2 WHERE id = $1`, [await tokenId(input.ticket), iso(env.now())]);
    await q.query(`UPDATE ${env.tables.people} SET totp_last_step = $2, failed_count = 0, locked_until = NULL, last_sign_in_at = $3 WHERE id = $1`, [r.person_id, step, iso(env.now())]);
    const s = await createSession(env, q, { personId: r.person_id, keep: r.keep }, meta);
    await env.log(q, { actor: r.person_id, action: "signed in", target: r.person_id, ip: meta.ip });
    return { ...s, personId: r.person_id };
  });
}

// ---------- Sessions ----------
export async function createSession(env: AuthEnv, q: Sql, s: { personId?: string; supportGrantId?: string; keep: boolean; maxMinutes?: number }, meta: Meta) {
  const token = randomToken();
  const maxMin = s.maxMinutes ?? (s.keep ? LIMITS.maxKeepHours : LIMITS.maxHours) * 60;
  const values = [await tokenId(token), s.personId ?? null, s.keep, iso(env.now()), iso(env.now() + maxMin * 60_000), meta.ip ?? null, (meta.userAgent ?? "").slice(0, 300)];
  if (env.tables.sessions === TENANT_TABLES.sessions) {
    // Only a warehouse has support sessions (an operator looking in through a grant)
    await q.query(`INSERT INTO sessions (id, person_id, keep, created_at, last_seen_at, expires_at, ip, user_agent, support_grant_id) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)`, [...values, s.supportGrantId ?? null]);
  } else {
    await q.query(`INSERT INTO ${env.tables.sessions} (id, person_id, keep, created_at, last_seen_at, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`, values);
  }
  return { token, maxAgeSec: maxMin * 60 };
}

export interface SessionRow { id: string; person_id: string | null; support_grant_id?: string | null; keep: boolean; confirmed_at: string | null; created_at: string }

/** The session for a cookie, or null if it's unknown, signed out, too old or idle too long. Keeps it alive. */
export async function getSession(env: AuthEnv, token: string | undefined): Promise<SessionRow | null> {
  if (!token || token.length > 100) return null;
  const id = await tokenId(token);
  const cols = env.tables.sessions === TENANT_TABLES.sessions ? ", support_grant_id" : "";
  const { rows } = await env.db.query(
    `SELECT id, person_id${cols}, keep, confirmed_at, created_at, last_seen_at FROM ${env.tables.sessions}
      WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2`, [id, iso(env.now())]);
  const s = rows[0];
  if (!s) return null;
  const idleMs = (s.keep ? LIMITS.idleKeepMin : LIMITS.idleMin) * 60_000;
  const seen = new Date(s.last_seen_at).getTime();
  if (env.now() - seen > idleMs) {
    await env.db.query(`UPDATE ${env.tables.sessions} SET revoked_at = $2 WHERE id = $1`, [id, iso(env.now())]);
    return null;
  }
  // Writing on every request isn't needed: once a minute is plenty for the idle limit
  if (env.now() - seen > 60_000) await env.db.query(`UPDATE ${env.tables.sessions} SET last_seen_at = $2 WHERE id = $1`, [id, iso(env.now())]);
  return { id: s.id, person_id: s.person_id, support_grant_id: s.support_grant_id ?? null, keep: s.keep, confirmed_at: s.confirmed_at, created_at: s.created_at };
}

export async function signOut(env: AuthEnv, token: string | undefined): Promise<void> {
  if (token) await env.db.query(`UPDATE ${env.tables.sessions} SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [await tokenId(token), iso(env.now())]);
}

/** Ends every session of a person (lost phone, access reset, account turned off) */
export async function endSessions(env: AuthEnv, q: Sql, personId: string): Promise<void> {
  await q.query(`UPDATE ${env.tables.sessions} SET revoked_at = $2 WHERE person_id = $1 AND revoked_at IS NULL`, [personId, iso(env.now())]);
}

/** Owners give their password again before account changes; that counts for 10 minutes */
export const isConfirmed = (env: AuthEnv, s: SessionRow) => !!s.confirmed_at && env.now() - new Date(s.confirmed_at).getTime() < LIMITS.confirmMin * 60_000;
export function needConfirmed(env: AuthEnv, s: SessionRow) {
  if (!isConfirmed(env, s)) throw new ApiError(403, "confirm", "Enter your password again to do this");
}

export async function confirmPassword(env: AuthEnv, s: SessionRow, password: string, meta: Meta): Promise<void> {
  if (!s.person_id) throw new ApiError(403, "forbidden", "Support sessions can't confirm owner actions");
  const { rows } = await env.db.query(`SELECT password_hash, failed_count, locked_until FROM ${env.tables.people} WHERE id = $1`, [s.person_id]);
  const p = rows[0];
  const ok = await verifyPassword(password, p?.password_hash ?? null);
  const wait = p ? lockedFor(p.locked_until, env.now()) : 0;
  if (wait) throw new ApiError(429, "locked", "Too many wrong tries. Wait a moment and try again.", { seconds: wait });
  if (!ok) { await failed(env, env.db, s.person_id, (p?.failed_count ?? 0) + 1, "confirm: wrong password", meta); throw new ApiError(401, "wrong-sign-in", "That password isn't right"); }
  await env.db.query(`UPDATE ${env.tables.people} SET failed_count = 0, locked_until = NULL WHERE id = $1`, [s.person_id]);
  await env.db.query(`UPDATE ${env.tables.sessions} SET confirmed_at = $2 WHERE id = $1`, [s.id, iso(env.now())]);
}

// ---------- Invite and reset links: set a password, then connect an authenticator app ----------
/** A link for a new person (7 days) or an access reset (24 hours). Older open links of the same person stop working. */
export async function createInvite(env: AuthEnv, q: Sql, personId: string, kind: "invite" | "reset", createdBy: string): Promise<string> {
  const token = randomToken();
  await q.query(`UPDATE ${env.tables.invites} SET used_at = $2 WHERE person_id = $1 AND used_at IS NULL`, [personId, iso(env.now())]);
  const ttl = kind === "invite" ? LIMITS.inviteDays * 24 * 3_600_000 : LIMITS.resetHours * 3_600_000;
  await q.query(`INSERT INTO ${env.tables.invites} (id, person_id, kind, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [await tokenId(token), personId, kind, createdBy, iso(env.now() + ttl)]);
  return token;
}

export interface InviteView { kind: "invite" | "reset"; name: string; username: string; step: "password" | "authenticator"; expiresAt: string }

async function openInvite(env: AuthEnv, q: Sql, token: string, lock = false) {
  const { rows } = await q.query(
    `SELECT i.id, i.kind, i.expires_at, i.pending_password, i.pending_totp, p.id AS person_id, p.name, p.username, p.status
       FROM ${env.tables.invites} i JOIN ${env.tables.people} p ON p.id = i.person_id
      WHERE i.id = $1 AND i.used_at IS NULL AND i.expires_at > $2${lock ? " FOR UPDATE OF i" : ""}`, [await tokenId(token), iso(env.now())]);
  const r = rows[0];
  if (!r || r.status === "disabled") throw new ApiError(404, "expired", "This link has expired or was already used. Ask your manager for a new one.");
  return r;
}

export async function readInvite(env: AuthEnv, token: string): Promise<InviteView> {
  const r = await openInvite(env, env.db, token);
  return { kind: r.kind, name: r.name, username: r.username, step: r.pending_totp ? "authenticator" : "password", expiresAt: new Date(r.expires_at).toISOString() };
}

/** Step 1: the new password (kept aside until step 2) and a new authenticator secret to scan */
export async function setInvitePassword(env: AuthEnv, token: string, password: string): Promise<{ secret: string; uri: string }> {
  const r = await openInvite(env, env.db, token);
  const problems = passwordProblems(password, r.username, env.ownWords);
  if (problems.length) throw new ApiError(400, "bad-request", `The password needs: ${problems.join(", ")}`, { problems });
  const secret = newTotpSecret();
  await env.db.query(`UPDATE ${env.tables.invites} SET pending_password = $2, pending_totp = $3 WHERE id = $1`,
    [r.id, await hashPassword(password), await seal(env.appKey, secret)]);
  return { secret, uri: totpUri(env.issuer, r.username, secret) };
}

/** Step 2: a code from the app proves it's set up; the account is active and signed in */
export async function finishInvite(env: AuthEnv, token: string, code: string, meta: Meta): Promise<{ token: string; maxAgeSec: number; personId: string }> {
  return env.db.tx(async q => {
    const r = await openInvite(env, q, token, true);
    if (!r.pending_totp) throw new ApiError(400, "bad-request", "Choose a password first");
    const step = await checkTotp(await unseal(env.appKey, r.pending_totp), code, env.now(), null);
    if (step === null) throw new ApiError(401, "wrong-code", "That code isn't right. Check the app shows this warehouse, and use the newest code.");
    await q.query(`UPDATE ${env.tables.people} SET password_hash = $2, totp_secret = $3, totp_last_step = $4, status = 'active', failed_count = 0, locked_until = NULL, last_sign_in_at = $5 WHERE id = $1`,
      [r.person_id, r.pending_password, r.pending_totp, step, iso(env.now())]);
    await q.query(`UPDATE ${env.tables.invites} SET used_at = $2 WHERE id = $1`, [r.id, iso(env.now())]);
    // A reset ends every session the old password or phone had
    await endSessions(env, q, r.person_id);
    const s = await createSession(env, q, { personId: r.person_id, keep: false }, meta);
    await env.log(q, { actor: r.person_id, action: r.kind === "invite" ? "joined (invite accepted)" : "access reset finished", target: r.person_id, ip: meta.ip });
    return { ...s, personId: r.person_id };
  });
}
