import { setLang, useLang } from "../i18n";

/** English / Español. The names stay as they are in either language. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const lang = useLang();
  return (
    <div className={`segment ${className}`} role="group" aria-label={lang === "es" ? "Idioma" : "Language"} translate="no">
      <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
      <button type="button" lang="es" aria-pressed={lang === "es"} onClick={() => setLang("es")}>Español</button>
    </div>
  );
}
