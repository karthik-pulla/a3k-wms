// Sign-in on a real PostgreSQL (PGlite, in memory): invites, two-step sign-in, lockouts, sessions.
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./pg.ts";
import { TENANT_TABLES, createInvite, finishInvite, getSession, readInvite, setInvitePassword, signIn, signOut, verifyCode, confirmPassword, isConfirmed, type AuthEnv } from "../src/core/auth.ts";
import { checkTotp, fromBase32, hashPassword, totpAt, totpCounter, verifyPassword, seal, unseal } from "../src/core/crypto.ts";
import { ApiError } from "../src/core/errors.ts";

const PW = "Forklift-Blue-42!";
let clock = Date.parse("2026-10-16T12:00:00Z");

async function setup() {
  const { db } = await freshDb("tenant");
  const logs: string[] = [];
  const env: AuthEnv = {
    db, tables: TENANT_TABLES, appKey: new Uint8Array(32).fill(7), now: () => clock, issuer: "Test Warehouse", ownWords: ["testwarehouse"],
    log: async (_q, e) => { logs.push(e.action); },
  };
  const { rows } = await db.query("INSERT INTO people (username, name, role_id, created_by) VALUES ('omar', 'Omar', 'worker', 'test') RETURNING id");
  return { env, db, logs, personId: rows[0].id as string };
}
const code = async (secret: string, at = clock) => totpAt(secret, totpCounter(at));
const rejects = (p: Promise<unknown>, codeName: string) => assert.rejects(p, (e: ApiError) => e.code === codeName);

/** Invite → password → authenticator; returns the secret the person's app holds */
async function join(env: AuthEnv, personId: string) {
  const link = await createInvite(env, env.db, personId, "invite", "owner");
  const { secret } = await setInvitePassword(env, link, PW);
  await finishInvite(env, link, await code(secret), {});
  return secret;
}

test("RFC 6238 test vector, password hashes and sealed secrets", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
  assert.equal(new TextDecoder().decode(fromBase32(secret)), "12345678901234567890");
  assert.equal(await totpAt(secret, Math.floor(59 / 30)), "287082");
  assert.equal(await totpAt(secret, Math.floor(1111111109 / 30)), "081804");
  const h = await hashPassword("abc", 1000);
  assert.ok(await verifyPassword("abc", h));
  assert.ok(!(await verifyPassword("abd", h)));
  assert.ok(!(await verifyPassword("abc", null)));
  const key = new Uint8Array(32).fill(1);
  assert.equal(await unseal(key, await seal(key, "secret")), "secret");
  assert.equal(await checkTotp(secret, await totpAt(secret, 100), 100 * 30_000, 100), null, "a used step never works again");
});

test("an invite link sets a password and an authenticator, then the person is signed in", async () => {
  const { env, db, personId, logs } = await setup();
  const link = await createInvite(env, db, personId, "invite", "owner");
  assert.deepEqual((await readInvite(env, link)).step, "password");
  await rejects(setInvitePassword(env, link, "short"), "bad-request");
  await rejects(setInvitePassword(env, link, "omar-omar-omar-1"), "bad-request"); // contains the username
  const { secret, uri } = await setInvitePassword(env, link, PW);
  assert.match(uri, /^otpauth:\/\/totp\/Test%20Warehouse%3Aomar\?secret=/);
  assert.equal((await readInvite(env, link)).step, "authenticator");
  await rejects(finishInvite(env, link, "000000", {}), "wrong-code");
  const s = await finishInvite(env, link, await code(secret), { ip: "10.0.0.1" });
  assert.ok(await getSession(env, s.token));
  await rejects(readInvite(env, link), "expired");
  const { rows } = await db.query("SELECT status, password_hash IS NOT NULL AS has_pw, totp_secret IS NOT NULL AS has_totp FROM people WHERE id = $1", [personId]);
  assert.deepEqual(rows[0], { status: "active", has_pw: true, has_totp: true });
  assert.ok(logs.includes("joined (invite accepted)"));
});

test("sign-in takes the password, then a fresh code; a code can't be used twice", async () => {
  const { env, personId } = await setup();
  const secret = await join(env, personId);
  clock += 60_000;
  const { ticket } = await signIn(env, { username: "omar", password: PW, keep: false }, {});
  await rejects(verifyCode(env, { ticket, code: "123456" }, {}), "wrong-code");
  const c = await code(secret);
  const s = await verifyCode(env, { ticket, code: c }, {});
  assert.equal(s.personId, personId);
  assert.equal(s.maxAgeSec, 12 * 3600);
  // The same code again (a stolen one) doesn't work
  const second = await signIn(env, { username: "omar", password: PW, keep: true }, {});
  await rejects(verifyCode(env, { ticket: second.ticket, code: c }, {}), "wrong-code");
  clock += 30_000;
  assert.equal((await verifyCode(env, { ticket: second.ticket, code: await code(secret) }, {})).maxAgeSec, 30 * 24 * 3600);
  // A ticket is used once
  await rejects(verifyCode(env, { ticket: second.ticket, code: await code(secret, clock + 30_000) }, {}), "expired");
});

test("wrong passwords and unknown names get the same answer; 5 wrong tries lock the account", async () => {
  const { env, personId } = await setup();
  await join(env, personId);
  await rejects(signIn(env, { username: "nobody", password: PW, keep: false }, {}), "wrong-sign-in");
  for (let i = 0; i < 4; i++) await rejects(signIn(env, { username: "omar", password: "wrong-password-1A", keep: false }, {}), "wrong-sign-in");
  await rejects(signIn(env, { username: "omar", password: "wrong-password-1A", keep: false }, {}), "wrong-sign-in");
  // Locked now, even with the right password
  await assert.rejects(signIn(env, { username: "omar", password: PW, keep: false }, {}), (e: ApiError) => e.code === "locked" && e.info?.seconds === 30);
  clock += 31_000;
  assert.ok((await signIn(env, { username: "omar", password: PW, keep: false }, {})).ticket);
});

test("sessions end on sign-out, after 30 idle minutes, and can't be guessed", async () => {
  const { env, personId } = await setup();
  const secret = await join(env, personId);
  clock += 60_000;
  const { ticket } = await signIn(env, { username: "omar", password: PW, keep: false }, {});
  const s = await verifyCode(env, { ticket, code: await code(secret) }, {});
  assert.ok(await getSession(env, s.token));
  assert.equal(await getSession(env, "made-up-token"), null);
  clock += 31 * 60_000;
  assert.equal(await getSession(env, s.token), null, "idle too long");
  const again = await signIn(env, { username: "omar", password: PW, keep: false }, {});
  const s2 = await verifyCode(env, { ticket: again.ticket, code: await code(secret) }, {});
  await signOut(env, s2.token);
  assert.equal(await getSession(env, s2.token), null);
});

test("owner actions need the password again within 10 minutes", async () => {
  const { env, personId } = await setup();
  const secret = await join(env, personId);
  clock += 60_000;
  const { ticket } = await signIn(env, { username: "omar", password: PW, keep: false }, {});
  const s = await verifyCode(env, { ticket, code: await code(secret) }, {});
  let row = (await getSession(env, s.token))!;
  assert.equal(isConfirmed(env, row), false);
  await rejects(confirmPassword(env, row, "not it at all 1A", {}), "wrong-sign-in");
  await confirmPassword(env, row, PW, {});
  row = (await getSession(env, s.token))!;
  assert.equal(isConfirmed(env, row), true);
  clock += 11 * 60_000;
  row = (await getSession(env, s.token))!;
  assert.equal(isConfirmed(env, row), false);
});

test("a reset link replaces the password and phone, and ends every old session", async () => {
  const { env, db, personId } = await setup();
  const secret = await join(env, personId);
  clock += 60_000;
  const { ticket } = await signIn(env, { username: "omar", password: PW, keep: false }, {});
  const old = await verifyCode(env, { ticket, code: await code(secret) }, {});
  const link = await createInvite(env, db, personId, "reset", "owner");
  const { secret: newSecret } = await setInvitePassword(env, link, "Pallet-Green-77?x");
  clock += 30_000;
  await finishInvite(env, link, await code(newSecret), {});
  assert.equal(await getSession(env, old.token), null);
  clock += 60_000;
  await rejects(signIn(env, { username: "omar", password: PW, keep: false }, {}), "wrong-sign-in");
  const t2 = await signIn(env, { username: "omar", password: "Pallet-Green-77?x", keep: false }, {});
  await rejects(verifyCode(env, { ticket: t2.ticket, code: await code(secret) }, {}), "wrong-code"); // the old phone's code
});
