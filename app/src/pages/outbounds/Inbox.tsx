import { useMemo, useState } from "react";
import { PRODUCTS, productById } from "../../data/catalog";
import { tenant } from "../../tenant";
import { canSeeClient } from "../../auth/permissions";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { go } from "../../router";
import { useToast } from "../../components/Toast";
import { nextOrderId } from "../../outbound/plan";
import { readOrder } from "../../outbound/reader";
import { fmtDay } from "../../inventory/selectors";
import type { InboxMail, StoreOrder } from "../../store/types";

/** The warehouse's order email address (tenant config) */
export const ORDER_INBOX = tenant().config.orders.inbox;
/** What a pasted order looks like, with two of the warehouse's own products */
const EMAIL_EXAMPLE = ["Paste the email, e.g.", ...PRODUCTS.filter(p => !/DONOTUSE|CROSSDOCK/i.test(p.item ?? "")).slice(0, 2).map((p, i) => `${p.code} ${p.name} - ${i ? "10 cs" : "20 cases"}`)].join("\n");

/**
 * Emails sent to the order inbox. Each can become a draft order (read from the email text and any PDF attachments)
 * or be ignored. Until the server exists, mail can't arrive by itself: the sample emails and "Paste an email" stand in.
 */
export function Inbox() {
  const { state, dispatch } = useStore();
  const { me } = useSession();
  const toast = useToast();
  const [show, setShow] = useState<"new" | "all">("new");
  const [pasting, setPasting] = useState(false);
  const [from, setFrom] = useState(""), [subject, setSubject] = useState(""), [body, setBody] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const stores = useMemo(() => [...new Set(state.orders.map(o => o.store))], [state.orders]);
  const mails = state.inbox.filter(m => show === "all" || m.status === "new");

  const draft = async (m: InboxMail) => {
    // PDFs that came in by email are kept as they are (server: core/inbound.ts); their text is read here, when needed
    const texts = await Promise.all(m.attachments.map(async a => {
      if (a.text || !a.pdf) return a.text;
      try { const { pdfText } = await import("../../outbound/reader"); return (await pdfText(new File([Uint8Array.from(atob(a.pdf), c => c.charCodeAt(0))], a.name, { type: "application/pdf" }))).text; }
      catch { return ""; }
    }));
    const text = [m.subject, m.body, ...texts].join("\n");
    const r = readOrder(text, stores);
    if (!r.lines.length) { toast("No product codes found in this email. Open a new order and type it in."); return; }
    if (r.client && !canSeeClient(me, r.client)) { toast(`This order is for ${r.client}, which you don't have access to.`); return; }
    const id = nextOrderId(state.orders);
    const merged = new Map<string, number>();
    for (const l of r.lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.cases);
    const order: StoreOrder = {
      id, store: r.store ?? m.from.replace(/<.*>/, "").trim(), client: r.client ?? productById(r.lines[0].productId)!.client,
      date: new Date().toISOString().slice(0, 10), due: r.due, ref: r.ref, lines: [...merged].map(([productId, cases]) => ({ productId, cases })),
      status: "draft", source: "email", sourceName: `${m.subject} (from ${m.from})`, sourceText: text,
      notes: r.unread.length ? `Lines not read from the email:\n${r.unread.join("\n")}` : undefined,
      createdBy: "Order inbox", createdAt: new Date().toISOString(),
    };
    dispatch({ type: "order/save", order });
    dispatch({ type: "inbox/status", id: m.id, status: "drafted", orderId: id });
    toast(`${id} drafted from the email: ${r.lines.length} line${r.lines.length === 1 ? "" : "s"}. Check it, then approve.`);
    go(`#/outbounds/orders/${encodeURIComponent(id)}/edit`);
  };
  const addPasted = () => {
    if (!body.trim()) { toast("Paste the email text first."); return; }
    const mail: InboxMail = { id: `mail-${Date.now().toString(36)}`, from: from.trim() || "Pasted email", subject: subject.trim() || "(no subject)", receivedAt: new Date().toISOString(), body, attachments: [], status: "new" };
    dispatch({ type: "inbox/add", mail });
    setPasting(false); setFrom(""); setSubject(""); setBody("");
    draft(mail);
  };

  return (
    <div className="stack">
      <div className="panel glass">
        <div className="panel-foot">
          <div>
            <h2 className="plain-h">Order inbox</h2>
            <p className="muted small">Stores email their orders and packing lists to <b>{ORDER_INBOX}</b>; each email becomes a draft for approval. Not connected yet: it needs the server (receiving mail on AWS). Until then the sample emails and pasting stand in.</p>
          </div>
          <button className="btn small" onClick={() => setPasting(p => !p)} aria-expanded={pasting}>Paste an email…</button>
        </div>
        {pasting && (
          <div className="paste-mail">
            <input className="input" value={from} onChange={e => setFrom(e.target.value)} placeholder="From (optional)" aria-label="From" />
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)" aria-label="Subject" />
            <textarea className="input" rows={6} value={body} onChange={e => setBody(e.target.value)} placeholder={EMAIL_EXAMPLE} aria-label="Email text" />
            <div className="btns"><button className="btn primary" onClick={addPasted}>Read and draft the order</button><button className="btn" onClick={() => setPasting(false)}>Cancel</button></div>
          </div>
        )}
      </div>
      <div className="chip-wrap">
        <button className={`chip-btn${show === "new" ? " on" : ""}`} onClick={() => setShow("new")}>New · {state.inbox.filter(m => m.status === "new").length}</button>
        <button className={`chip-btn${show === "all" ? " on" : ""}`} onClick={() => setShow("all")}>All · {state.inbox.length}</button>
      </div>
      <div className="rows">
        {mails.map(m => (
          <div key={m.id} className={`row glass mail-row${m.status === "new" ? " unread" : ""}`}>
            <button className="mail-main" onClick={() => setOpenId(o => (o === m.id ? null : m.id))} aria-expanded={openId === m.id}>
              <span className="row-title">{m.subject}{m.sample && <span className="tag">sample</span>}</span>
              <span className="row-sub">{m.from} · {fmtDay(m.receivedAt)}{m.attachments.length ? ` · 📎 ${m.attachments.map(a => a.name).join(", ")}` : ""}</span>
            </button>
            <span className="row-fig">{m.status === "new" ? "New" : m.status === "drafted" ? <a className="link" href={`#/outbounds/orders/${encodeURIComponent(m.orderId ?? "")}`}>{m.orderId} ›</a> : "Ignored"}</span>
            <span className="btns">
              {m.status === "new" && <><button className="btn small primary" onClick={() => void draft(m)}>Draft order</button><button className="btn small" onClick={() => dispatch({ type: "inbox/status", id: m.id, status: "ignored" })}>Ignore</button></>}
              {m.status === "ignored" && <button className="btn small" onClick={() => dispatch({ type: "inbox/status", id: m.id, status: "new" })}>Move back</button>}
            </span>
            {openId === m.id && <pre className="source-text mail-body">{[m.body, ...m.attachments.map(a => `── ${a.name} ──\n${a.text}`)].join("\n\n")}</pre>}
          </div>
        ))}
        {!mails.length && <p className="muted panel glass">No new emails.</p>}
      </div>
    </div>
  );
}
