// Cryptography for sign-in and data at rest, using only the browser's Web Crypto (no library).
//
//  - Passwords: PBKDF2-SHA256, 600,000 iterations, 16-byte random salt per account (OWASP's current recommendation).
//    The password itself is never stored; the derived key only unwraps that account's copy of the vault key.
//  - Data: AES-256-GCM (authenticated encryption) with a fresh 12-byte IV for every write.
//  - Sharing a key with someone without knowing their password: ECDH P-256 + HKDF-SHA256 + AES-256-GCM.
import { tenant } from "../tenant";

export const PBKDF2_ITERATIONS = 600_000;
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error("This browser can't do the encryption the app needs (it needs a secure https or localhost page).");
  return globalThis.crypto.subtle;
};

export const toB64 = (b: ArrayBuffer | Uint8Array) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
export const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export interface Sealed { iv: string; ct: string }
export interface SealedTo extends Sealed { eph: JsonWebKey }

/** SHA-256 of a username, so stored sign-in data doesn't list usernames in the clear */
export async function usernameId(username: string): Promise<string> {
  return toB64(await subtle().digest("SHA-256", enc.encode(`a3k-wms|user|${username.trim().toLowerCase()}`)));
}

/** The key a password unlocks: PBKDF2 (slow on purpose) then HKDF to a single-purpose AES-GCM key */
export async function passwordKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, 256);
  const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("a3k-wms|wrap|v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, data: Uint8Array): Promise<Sealed> {
  const iv = random(12);
  return { iv: toB64(iv), ct: toB64(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource)) };
}
/** Throws if the key is wrong or the data was changed (GCM checks both) */
export async function open(key: CryptoKey, s: Sealed): Promise<Uint8Array> {
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: fromB64(s.iv) as BufferSource }, key, fromB64(s.ct) as BufferSource));
}
export const sealJson = (key: CryptoKey, v: unknown) => seal(key, enc.encode(JSON.stringify(v)));
export const openJson = async <T>(key: CryptoKey, s: Sealed): Promise<T> => JSON.parse(dec.decode(await open(key, s))) as T;

/** An AES-GCM key from raw bytes. Session keys are non-extractable: scripts can use them but never read them out. */
export const aesKey = (raw: Uint8Array, extractable = false) => subtle().importKey("raw", raw as BufferSource, { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);

export async function ecdhPair() {
  const k = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  return { pub: await subtle().exportKey("jwk", k.publicKey), priv: new Uint8Array(await subtle().exportKey("pkcs8", k.privateKey)) };
}
const importPub = (jwk: JsonWebKey) => subtle().importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
const importPriv = (pkcs8: Uint8Array) => subtle().importKey("pkcs8", pkcs8 as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
async function sharedKey(priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> {
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("a3k-wms|share|v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
/** Encrypt for the holder of a private key, knowing only their public key */
export async function sealTo(pubJwk: JsonWebKey, data: Uint8Array): Promise<SealedTo> {
  const eph = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const key = await sharedKey(eph.privateKey, await importPub(pubJwk));
  return { ...(await seal(key, data)), eph: await subtle().exportKey("jwk", eph.publicKey) };
}
export async function openFrom(privPkcs8: Uint8Array, s: SealedTo): Promise<Uint8Array> {
  return open(await sharedKey(await importPriv(privPkcs8), await importPub(s.eph)), s);
}

// ---------- Password rules for new passwords ----------
const COMMON = new Set(["password", "password1", "password123", "123456", "12345678", "123456789", "1234567890", "qwerty", "qwerty123", "letmein", "welcome", "admin", "admin123", "iloveyou", "monkey", "dragon", "football", "baseball", "abc123", "111111", "000000", "warehouse", "passw0rd", "changeme"]);
/** The warehouse's own name, squeezed together ("a3kimports"): as guessable as "password" */
const ownNames = () => {
  try {
    const c = tenant().config, squeeze = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    return new Set([c.tenant.id, c.tenant.name, c.branding.appTitle, c.branding.mark].map(squeeze).filter(x => x.length >= 3));
  } catch { return new Set<string>(); }
};
const isCommon = (pw: string) => COMMON.has(pw.toLowerCase()) || ownNames().has(pw.toLowerCase().replace(/[^a-z0-9]/g, ""));
/** Problems with a new password (empty = fine). At least 12 characters, not common, not containing the username. */
export function passwordProblems(pw: string, username = ""): string[] {
  const out: string[] = [];
  if (pw.length < 12) out.push("at least 12 characters");
  if (isCommon(pw) || /^(.)\1+$/.test(pw)) out.push("not a common or repeated password");
  if (username.trim() && pw.toLowerCase().includes(username.trim().toLowerCase())) out.push("not containing your username");
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter(r => r.test(pw)).length;
  if (pw.length < 16 && kinds < 3) out.push("a mix of letters, numbers and symbols (or 16+ characters)");
  return out;
}
/** Rough strength 0–4 for the meter */
export function passwordStrength(pw: string): number {
  if (!pw) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter(r => r.test(pw)).length;
  const bits = pw.length * Math.log2(Math.max(10, [26, 26, 10, 33].slice(0, kinds).reduce((a, b) => a + b, 0)));
  return isCommon(pw) ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
}
