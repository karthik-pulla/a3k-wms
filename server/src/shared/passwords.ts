// Rules for new passwords, the same on the server (which enforces them) and in the app (which explains them as you type).
// No imports, so both can use it.

const COMMON = new Set(["password", "password1", "password123", "123456", "12345678", "123456789", "1234567890", "qwerty", "qwerty123", "letmein", "welcome", "admin", "admin123", "iloveyou", "monkey", "dragon", "football", "baseball", "abc123", "111111", "000000", "warehouse", "passw0rd", "changeme"]);
const squeeze = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Common passwords, and the warehouse's own name and words (e.g. "a3kimports"), are as guessable as "password" */
export const isCommonPassword = (pw: string, ownWords: string[] = []) =>
  COMMON.has(pw.toLowerCase()) || ownWords.map(squeeze).filter(w => w.length >= 3).includes(squeeze(pw));

/** Problems with a new password (empty = fine). At least 12 characters, not common, not containing the username. */
export function passwordProblems(pw: string, username = "", ownWords: string[] = []): string[] {
  const out: string[] = [];
  if (pw.length < 12) out.push("at least 12 characters");
  if (pw.length > 200) out.push("at most 200 characters");
  if (isCommonPassword(pw, ownWords) || /^(.)\1+$/.test(pw)) out.push("not a common or repeated password");
  if (username.trim() && pw.toLowerCase().includes(username.trim().toLowerCase())) out.push("not containing your username");
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter(r => r.test(pw)).length;
  if (pw.length < 16 && kinds < 3) out.push("a mix of letters, numbers and symbols (or 16+ characters)");
  return out;
}

/** Rough strength 0–4 for the meter */
export function passwordStrength(pw: string, ownWords: string[] = []): number {
  if (!pw) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter(r => r.test(pw)).length;
  const bits = pw.length * Math.log2(Math.max(10, [26, 26, 10, 33].slice(0, kinds).reduce((a, b) => a + b, 0)));
  return isCommonPassword(pw, ownWords) ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
}
