// PREVIEW ONLY: a small panel in the corner with the emails the server would have sent (invite and reset links), a
// link to the ops console, and "start over". Never in a real build (shown only when VITE_WMS_BACKEND=preview).
import { useEffect, useState } from "react";
import type { PreviewMail } from "./preview";

export function PreviewTools({ console: inConsole = false }: { console?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mails, setMails] = useState<PreviewMail[]>([]);
  useEffect(() => {
    let off: (() => void) | undefined;
    void import("./preview").then(p => { setMails(p.previewOutbox.read()); off = p.previewOutbox.subscribe(() => setMails(p.previewOutbox.read())); });
    return () => off?.();
  }, []);
  const link = (text: string) => text.match(/https?:\/\/\S+/)?.[0];
  return (
    <aside className={`preview-tools glass${open ? " open" : ""}`} aria-label="Preview tools" translate="no">
      <button className="preview-tab" onClick={() => setOpen(o => !o)} aria-expanded={open}>Preview{mails.length ? ` · ${mails.length} email${mails.length === 1 ? "" : "s"}` : ""}</button>
      {open && (
        <div className="preview-body">
          <p className="muted small">Running the real server code in this browser. Nothing is sent: emails land here.</p>
          <ul className="preview-mails">
            {mails.map((m, i) => (
              <li key={i}>
                <b>{m.subject}</b><small className="muted">to {m.to} · {new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
                {link(m.text) && <a className="link" href={link(m.text)} onClick={() => setTimeout(() => location.reload(), 0)}>Open the link</a>}
              </li>
            ))}
            {!mails.length && <li className="muted small">No emails yet.</li>}
          </ul>
          <div className="preview-actions">
            {inConsole ? <a className="btn small" href="./">Open the warehouse app</a> : <a className="btn small" href="./ops.html">Open the ops console</a>}
            <button className="btn small" onClick={() => { if (window.confirm("Forget the preview's accounts and start over?")) void import("./preview").then(p => p.previewReset()); }}>Start over</button>
          </div>
        </div>
      )}
    </aside>
  );
}
