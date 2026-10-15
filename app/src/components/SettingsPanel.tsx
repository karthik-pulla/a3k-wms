import { useEffect, useRef } from "react";
import type { GlassStrength, HomeCardKind, HomeSettings, ThemeChoice } from "../settings";
import type { LastOnlineVisibility } from "../auth/permissions";
import { useAuth } from "../auth/AuthGate";
import { RoleSwitch } from "./RoleSwitch";
import { CloseIcon, DownIcon, UpIcon } from "./icons";
import { t } from "../i18n";
import { LangSwitch } from "./LangSwitch";

const CARD_NAMES: Record<HomeCardKind, string> = {
  messages: "Messages",
  outgoing: "Going out today",
  deadlines: "Due soon",
  ordersToApprove: "Orders to approve",
  incoming: "Arriving",
  toConfirm: "Waiting for confirmation",
  expiry: "Expiry alerts",
  returns: "Returns pending",
  changesToApprove: "Changes to approve",
};

interface Props {
  settings: HomeSettings;
  update: (patch: Partial<HomeSettings>) => void;
  reset: () => void;
  onResetData: () => void;
  onClose: () => void;
}

function Segment<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segment" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle" htmlFor={id}>
      <span>{label}</span>
      <span className="switch"><input id={id} type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} /><span /></span>
    </label>
  );
}

export function SettingsPanel({ settings, update, reset, onResetData, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const move = (i: number, d: -1 | 1) => {
    const cards = [...settings.cards];
    [cards[i], cards[i + d]] = [cards[i + d], cards[i]];
    update({ cards });
  };
  const setVisible = (i: number, visible: boolean) => update({ cards: settings.cards.map((c, j) => (j === i ? { ...c, visible } : c)) });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet glass" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="sheet-head">
          <h2 id="settings-title">Home settings</h2>
          <button ref={closeRef} className="iconbtn glass" onClick={onClose} aria-label="Close settings"><CloseIcon /></button>
        </div>

        <You />

        <section>
          <h3>Appearance</h3>
          <LangSwitch />
          <Segment<ThemeChoice> label="Theme" value={settings.theme} onChange={theme => update({ theme })}
            options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} />
          <Segment<GlassStrength> label="Glass" value={settings.glass} onChange={glass => update({ glass })}
            options={[["subtle", "Light frost"], ["frosted", "Frosted"], ["heavy", "Heavy frost"]]} />
          <Toggle id="set-bg" label="Moving background" checked={settings.movingBackground} onChange={movingBackground => update({ movingBackground })} />
        </section>

        <section>
          <h3>Home screen</h3>
          <Toggle id="set-summary" label="Summary line under your name" checked={settings.showSummary} onChange={showSummary => update({ showSummary })} />
          <Toggle id="set-ticker" label="Activity ticker (bottom right)" checked={settings.showTicker} onChange={showTicker => update({ showTicker })} />
          <p className="card-sub">Cards: tick to show, arrows to reorder. On wide screens Messages sits on the right instead.</p>
          <ul className="cardlist">
            {settings.cards.map((c, i) => (
              <li key={c.kind}>
                <input type="checkbox" id={`card-vis-${c.kind}`} checked={c.visible} onChange={e => setVisible(i, e.target.checked)} />
                <label htmlFor={`card-vis-${c.kind}`}>{CARD_NAMES[c.kind]}</label>
                <button className="mini" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${CARD_NAMES[c.kind]} up`}><UpIcon /></button>
                <button className="mini" disabled={i === settings.cards.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${CARD_NAMES[c.kind]} down`}><DownIcon /></button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Messages</h3>
          <div className="field">
            Exact "last online" times visible to
            <Segment<LastOnlineVisibility> label="Last online visible to" value={settings.lastOnlineVisibleTo} onChange={lastOnlineVisibleTo => update({ lastOnlineVisibleTo })}
              options={[["owners", "Owners"], ["owners-coordinators", "+ Coordinators"], ["everyone", "Everyone"]]} />
            <span className="card-sub">Everyone always sees the coloured dots; times are rough ("2h ago").</span>
          </div>
          <Toggle id="set-offshift" label="Hide presence outside shift hours" checked={settings.hidePresenceOffShift} onChange={hidePresenceOffShift => update({ hidePresenceOffShift })} />
          <div className="field-row">
            <label className="field">Shift starts<input className="textin" type="time" value={settings.shiftStart} onChange={e => update({ shiftStart: e.target.value || "07:00" })} /></label>
            <label className="field">Shift ends<input className="textin" type="time" value={settings.shiftEnd} onChange={e => update({ shiftEnd: e.target.value || "19:00" })} /></label>
          </div>
          <div className="field-row">
            <label className="field">Urgent escalates after (min)<input className="textin" type="number" min={1} max={240} value={settings.escalateMinutes} onChange={e => update({ escalateMinutes: Math.max(1, parseInt(e.target.value) || 15) })} /></label>
            <label className="field">"On break" clears after (min)<input className="textin" type="number" min={5} max={120} value={settings.breakMinutes} onChange={e => update({ breakMinutes: Math.max(5, parseInt(e.target.value) || 30) })} /></label>
          </div>
          <p className="card-sub">Escalation texts and emails are not connected yet; they're logged to the browser console.</p>
        </section>

        <section>
          <h3>Developer</h3>
          <Toggle id="set-offline" label="Simulate offline" checked={settings.simulateOffline} onChange={simulateOffline => update({ simulateOffline })} />
          <p className="card-sub">Messages wait on this device and the save pill shows them; they send when you switch this off.</p>
        </section>

        <section>
          <h3>Sample data</h3>
          <p className="card-sub">Deliveries, returns, stock and messages you've changed while testing are saved on this device.</p>
          <button className="btn" onClick={() => { if (window.confirm(t("Start over with the original sample deliveries, returns, stock and messages? Your test changes will be lost."))) onResetData(); }}>Reset sample data</button>
        </section>

        <div className="sheet-foot">
          <span>Saved on this device</span>
          <button className="btn" onClick={reset}>Reset settings</button>
        </div>
      </div>
    </>
  );
}

/** Your account, and (the admin account only) using the app as another role or person, for testing */
function You() {
  const { account } = useAuth();
  return (
    <section>
      <h3>You</h3>
      <p className="card-sub">Signed in as <b>{account.name}</b> (@{account.username}). <a className="link" href="#/account">Account, password and sign-out ›</a></p>
      {account.admin && (
        <label className="field">
          Use the app as (admin testing)
          <RoleSwitch />
          <span className="card-sub">Admin account only. Try any role as yourself, or any person (with their brand limits). Changes you make are logged under Admin, naming the role or person.</span>
        </label>
      )}
    </section>
  );
}
