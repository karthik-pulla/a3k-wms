import { useState } from "react";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { can } from "../../auth/permissions";
import { activeNotices } from "../../store/notices";
import { storageKey } from "../../tenant";

// Per warehouse: two warehouses opened in one browser number their announcements the same way (N1, N2…)
const hiddenKey = () => storageKey("wms.notices.hidden");
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(hiddenKey()) ?? "[]"); } catch { return []; } };

/** Owners' announcements, on top of the home and Work screens. Each person may hide one on their device (urgent ones stay). */
export function Announcements() {
  const { state } = useStore();
  const { me } = useSession();
  const [hidden, setHidden] = useState(readHidden);
  const list = activeNotices(state).filter(n => n.urgent || !hidden.includes(n.id));
  if (!list.length) return null;
  const hide = (id: string) => { const next = [...hidden, id].slice(-200); setHidden(next); try { localStorage.setItem(hiddenKey(), JSON.stringify(next)); } catch { /* storage blocked: hidden for this visit */ } };
  return (
    <section className="notices" aria-label="Announcements">
      {list.map(n => (
        <div key={n.id} className={`notice glass${n.urgent ? " urgent" : ""}`} role={n.urgent ? "alert" : undefined}>
          <span className="notice-ic" aria-hidden="true">{n.urgent ? "!" : "📣"}</span>
          <p><span translate="no">{n.text}</span><small className="muted block">{n.by} · {new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{n.until ? ` · until ${new Date(`${n.until}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</small></p>
          <span className="notice-acts">
            {can(me, "manage-settings") && <a className="link small" href="#/manage/warehouse">Edit</a>}
            {!n.urgent && <button className="iconbtn small" onClick={() => hide(n.id)} aria-label="Hide this announcement">×</button>}
          </span>
        </div>
      ))}
    </section>
  );
}
