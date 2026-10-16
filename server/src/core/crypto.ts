// Sign-in cryptography on Web Crypto only, so the same code runs on the server (Node) and in the app's preview
// (the browser): password hashes, random tokens, authenticator-app codes (TOTP, RFC 6238) and sealed secrets.
const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

export const toB64u = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const bytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const copy = (b: Uint8Array) => Uint8Array.from(b) as Uint8Array<ArrayBuffer>;

/** A random token for links and sessions (256 bits) */
export const randomToken = () => toB64u(bytes(32));

/** What's stored instead of a token: its SHA-256, so a leaked database can't be used to sign in */
export async function tokenId(token: string): Promise<string> {
  return toB64u(new Uint8Array(await subtle().digest("SHA-256", enc.encode(token))));
}

// ---------- Passwords: PBKDF2-SHA256, 600,000 iterations (OWASP), random salt ----------
export const PBKDF2_ITERATIONS = 600_000;

async function pbkdf2(pw: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", enc.encode(pw.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: copy(salt), iterations }, key, 256));
}

export async function hashPassword(pw: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = bytes(16);
  return `pbkdf2-sha256$${iterations}$${toB64u(salt)}$${toB64u(await pbkdf2(pw, salt, iterations))}`;
}

/** Compares without leaking how much matched */
const sameBytes = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Unknown accounts still do the full work, so the answer takes as long either way
  const [kind, iter, salt, hash] = (stored ?? `pbkdf2-sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$`).split("$");
  if (kind !== "pbkdf2-sha256") return false;
  const got = await pbkdf2(pw, fromB64u(salt), Number(iter));
  return stored !== null && sameBytes(got, fromB64u(hash));
}

// ---------- Authenticator app codes (TOTP: 6 digits, 30 s, SHA-1, as every authenticator app expects) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(b: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const x of b) { value = (value << 8) | x; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(s: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/[\s=]/g, "").toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("Not a base32 secret");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

/** A new secret for an authenticator app (160 bits) */
export const newTotpSecret = () => base32(bytes(20));

export async function totpAt(secret: string, counter: number): Promise<string> {
  const key = await subtle().importKey("raw", copy(fromBase32(secret)), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const h = new Uint8Array(await subtle().sign("HMAC", key, msg));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const totpCounter = (nowMs: number) => Math.floor(nowMs / 30_000);

/**
 * The time step a code belongs to, or null. Accepts the step before and after (phone clocks drift), and never a step at
 * or before `lastUsed`, so a code can't be used twice.
 */
export async function checkTotp(secret: string, code: string, nowMs: number, lastUsed: number | null): Promise<number | null> {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = totpCounter(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsed !== null && step <= lastUsed) continue;
    if ((await totpAt(secret, step)) === c) return step;
  }
  return null;
}

/** What an authenticator app scans */
export const totpUri = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------- Sealed secrets (authenticator secrets at rest): AES-256-GCM with the server's app key ----------
const aesKey = (raw: Uint8Array) => subtle().importKey("raw", copy(raw), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function seal(appKey: Uint8Array, plain: string): Promise<string> {
  const iv = bytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, await aesKey(appKey), enc.encode(plain)));
  return `v1.${toB64u(iv)}.${toB64u(ct)}`;
}

export async function unseal(appKey: Uint8Array, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1") throw new Error("Unknown sealed format");
  return new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: copy(fromB64u(iv)) }, await aesKey(appKey), copy(fromB64u(ct))));
}
