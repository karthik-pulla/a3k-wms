import { setLang, useLang } from "../i18n";
import { tenant } from "../tenant";

/** English / Español. The names stay as they are in either language. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const lang = useLang();
  if (tenant().config.languages.enabled.length < 2) return null; // the warehouse uses one language only
  return (
    <div className={`segment ${className}`} role="group" aria-label={lang === "es" ? "Idioma" : "Language"} translate="no">
      <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
      <button type="button" lang="es" aria-pressed={lang === "es"} onClick={() => setLang("es")}>Español</button>
    </div>
  );
}
