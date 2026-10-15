// Language: English (as written in the code) or Spanish.
//
// The screens are written in English. In Spanish, a translator watches the page and swaps every piece of interface
// text (and placeholder, tooltip, aria-label and alt) for its Spanish version from `es.ts`: exact phrases first, then
// patterns with numbers or names in them ("{0} cases in stock" → "{0} cajas en stock"). Switching back restores the
// English. User content is never translated: anything inside translate="no" (messages, product and store names in
// some places, email and PDF text). Dates and numbers switch to Spanish (US) formatting too.
import { useSyncExternalStore } from "react";
import { ES, ES_PATTERNS } from "./es";

export type Lang = "en" | "es";
const KEY = "wms.lang";
const read = (): Lang => { try { return localStorage.getItem(KEY) === "es" ? "es" : "en"; } catch { return "en"; } };
let lang: Lang = read();
const listeners = new Set<() => void>();
export const getLang = () => lang;
export const useLang = () => useSyncExternalStore(f => { listeners.add(f); return () => listeners.delete(f); }, getLang);

// ---------- Translating one piece of text ----------
interface Pattern { re: RegExp; es: string; weight: number; free: Set<number> }
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS: Pattern[] = ES_PATTERNS.map(([en, es]) => {
  const parts = en.split(/\{\d\}/);
  // A placeholder straight after a letter is a plural ending ("order{1}": "s" or "es") or an aside that starts with a
  // comma or a bracket ("Offline{0}": " (simulated)"), never the middle of a word, so "ordered" can't match "order{1}"
  const re = parts.map(escapeRe).reduce((acc, part, i) => acc + (/[A-Za-z]$/.test(parts[i - 1]) ? "(s|es|[,;] [\\s\\S]*?| \\([\\s\\S]*?|)" : "([\\s\\S]*?)") + part);
  // Placeholders in quotes or after "reason:" hold what someone typed, which stays as written
  const free = new Set(parts.slice(0, -1).flatMap((p, i) => (/(["“]|[Rr]eason: )$/.test(p) ? [i] : [])));
  return { re: new RegExp(`^${re}$`), es, weight: parts.join("").length, free };
}).sort((a, b) => b.weight - a.weight);

/** "{1?s:}" in a Spanish pattern: "s" when the English had something there (a plural), else "". Null when a placeholder
 * would keep English words (two lowercase words in a row): then the pattern matched text it wasn't written for. */
function fill(p: Pattern, groups: string[]): string | null {
  let ok = true;
  const out = p.es
    .replace(/\{(\d)\?([^:}]*):([^}]*)\}/g, (_, n, yes, no) => (groups[Number(n)] ? yes : no))
    .replace(/\{(\d)\}/g, (_, n) => {
      const g = groups[Number(n)] ?? "";
      const es = translateCore(g.trim()) === null ? null : translate(g);
      if (es === null && !p.free.has(Number(n)) && /\b[a-z]{2,} [a-z]{2,}\b/.test(g)) ok = false;
      return es ?? g;
    });
  return ok ? out : null;
}

const cache = new Map<string, string | null>();
function translateCore(core: string): string | null {
  if (!core) return null;
  const hit = ES[core];
  if (hit !== undefined) return hit;
  if (cache.has(core)) return cache.get(core)!;
  if (cache.size > 20000) cache.clear();
  cache.set(core, null); // while working on it: no endless recursion
  const out = matchPatterns(core);
  cache.set(core, out);
  return out;
}
function matchPatterns(core: string): string | null {
  for (const p of PATTERNS) {
    const m = p.re.exec(core);
    if (!m) continue;
    const groups = m.slice(1);
    // A name or number goes in a placeholder, never a sentence break: "No messages yet. Open the thread to start one."
    // is two texts side by side, not "{0} {1} to {2}"
    if (groups.some(g => /[.!?]\s+[A-Za-z]/.test(g))) continue;
    const out = fill(p, groups);
    if (out !== null) return out;
  }
  return core.includes(" · ") ? bySegment(core) : null;
}

/** "Offline · syncing later · On forklift · last synced 7:43 p.m.": the longest runs of " · " pieces that translate,
 * the rest (names, codes) as written; null if a piece left over is still English words */
function bySegment(core: string): string | null {
  const parts = core.split(" · ");
  const out: string[] = [];
  let any = false;
  for (let i = 0; i < parts.length;) {
    let j = parts.length;
    let es: string | null = null;
    for (; j > i; j--) { const run = parts.slice(i, j).join(" · "); if (j - i < parts.length && (es = translateCore(run)) !== null) break; }
    if (es !== null) { out.push(es); any = true; i = j; continue; }
    if (/\b[a-z]{2,} [a-z]{2,}\b/.test(parts[i])) return null;
    out.push(parts[i]); i++;
  }
  return any ? out.join(" · ") : null;
}

/** Spanish for a piece of interface text (keeps the spaces around it), or the text itself when there's none */
export function translate(text: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  const core = m[2].replace(/\s+/g, " ");
  const es = translateCore(core);
  return es === null ? text : m[1] + es + m[3];
}

/** For text that isn't on the page (confirm and prompt boxes): Spanish when the app is in Spanish */
export const t = (text: string) => (lang === "es" ? translateCore(text) ?? translate(text) : text);

// ---------- Translating the page ----------
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
interface Record_ { en: string; es: string }
const textRec = new WeakMap<Text, Record_>();
const attrRec = new WeakMap<Element, Map<string, Record_>>();
/** Missing translations seen on screen (for finding gaps: window.__wmsMissing in the browser console) */
const missing = new Set<string>();
(globalThis as unknown as { __wmsMissing: Set<string> }).__wmsMissing = missing;

function skipped(el: Element | null): boolean {
  if (!el) return true;
  if (el.closest('[translate="no"], pre.source-text, script, style, textarea, noscript')) return true;
  // An <option> without a value attribute uses its text as its value: translating it would change what's selected
  return el.tagName === "OPTION" && !el.hasAttribute("value");
}
const worth = (s: string) => /[A-Za-z]{2}/.test(s);

/** React writes `Show all {n} on map` as several text nodes side by side: translate them as one sentence when they match
 * as a whole (the Spanish goes in the first node, the rest are emptied), else one by one */
function joinedParent(node: Text): Element | null {
  const p = node.parentElement;
  if (!p || p.childNodes.length < 2) return null;
  for (const c of p.childNodes) if (c.nodeType !== Node.TEXT_NODE) return null;
  return p;
}
const englishOf = (n: Text) => { const r = textRec.get(n); return r && n.nodeValue === r.es ? r.en : n.nodeValue ?? ""; };

function doText(node: Text) {
  const parent = joinedParent(node);
  if (parent && !skipped(parent)) {
    const nodes = [...parent.childNodes] as Text[];
    const ens = nodes.map(englishOf);
    const full = ens.join("");
    if (worth(full)) {
      const es = translate(full);
      if (es !== full) {
        nodes.forEach((n, i) => { const v = i === 0 ? es : ""; textRec.set(n, { en: ens[i], es: v }); if (n.nodeValue !== v) n.nodeValue = v; });
        return;
      }
    }
    nodes.forEach(single);
    return;
  }
  single(node);
}
function single(node: Text) {
  const v = node.nodeValue ?? "";
  const rec = textRec.get(node);
  if (rec && v === rec.es) return; // already ours
  if (!worth(v) || skipped(node.parentElement)) return;
  const es = translate(v);
  textRec.set(node, { en: v, es });
  if (es !== v) node.nodeValue = es;
  else if (import.meta.env.DEV) missing.add(v.trim());
}
function doAttr(el: Element, name: string) {
  const v = el.getAttribute(name);
  if (v === null) return;
  let map = attrRec.get(el);
  const rec = map?.get(name);
  if (rec && v === rec.es) return;
  // A text box's placeholder is interface text even though what's typed in it isn't
  if (!worth(v) || el.closest('[translate="no"]') || (el.tagName === "OPTION" && !el.hasAttribute("value"))) return;
  const es = translate(v);
  if (!map) { map = new Map(); attrRec.set(el, map); }
  map.set(name, { en: v, es });
  if (es !== v) el.setAttribute(name, es);
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (!(root instanceof Element)) return;
  for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) doAttr(n as Element, a);
  }
}
/** Back to English: put the original text back wherever it's still our Spanish */
function restore(root: Element) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = root; n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) { const r = textRec.get(n as Text); if (r && n.nodeValue === r.es) n.nodeValue = r.en; }
    else { const map = attrRec.get(n as Element); if (map) for (const [a, r] of map) if ((n as Element).getAttribute(a) === r.es) (n as Element).setAttribute(a, r.en); }
  }
}

let observer: MutationObserver | null = null;
function startObserver() {
  if (observer) return;
  observer = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes") doAttr(m.target as Element, m.attributeName!);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  walk(document.body);
}
function stopObserver() { observer?.disconnect(); observer = null; restore(document.body); }

// ---------- Dates and numbers in Spanish (US) ----------
const LOCALE = "es-US";
const orig = {
  dDate: Date.prototype.toLocaleDateString, dTime: Date.prototype.toLocaleTimeString, dAll: Date.prototype.toLocaleString, num: Number.prototype.toLocaleString,
};
function patchLocale(on: boolean) {
  if (!on) { Object.assign(Date.prototype, { toLocaleDateString: orig.dDate, toLocaleTimeString: orig.dTime, toLocaleString: orig.dAll }); Number.prototype.toLocaleString = orig.num; return; }
  Date.prototype.toLocaleDateString = function (l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) { return orig.dDate.call(this, l ?? LOCALE, o); };
  Date.prototype.toLocaleTimeString = function (l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) { return orig.dTime.call(this, l ?? LOCALE, o); };
  Date.prototype.toLocaleString = function (l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) { return orig.dAll.call(this, l ?? LOCALE, o); };
  Number.prototype.toLocaleString = function (l?: Intl.LocalesArgument, o?: Intl.NumberFormatOptions) { return orig.num.call(this, l ?? LOCALE, o); };
}

function apply() {
  document.documentElement.lang = lang;
  patchLocale(lang === "es");
  if (lang === "es") startObserver(); else stopObserver();
}

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* this visit only */ }
  apply();
  listeners.forEach(f => f());
}

/** Call once before the app renders */
export function startI18n() { apply(); }
