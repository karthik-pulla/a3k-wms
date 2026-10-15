import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useStore } from "../store/store";
import type { Conversation, ManualStatus, Message, MessageRef, State, User } from "../store/types";
import type { HomeSettings } from "../settings";
import { finalize } from "./refs";
import { useConnection } from "./connection";
import { stubNotifier, type Notifier } from "./notify";
import { canSeeClient } from "../auth/permissions";

/**
 * Everything the Messages screens may ask of the server. This local version runs on the sample store, simulates
 * other people's presence with a fake heartbeat, and queues messages while offline. A real backend
 * (AWS + PostgreSQL + WebSockets) implements the same interface and pushes events into the store instead.
 */
export interface ChatBackend {
  send(input: { conversationId: string; text: string; refs: MessageRef[]; photos: string[]; urgent: boolean }): void;
  /** Called only when a message has actually been on screen */
  markRead(conversationId: string, at: string): void;
  setManualStatus(status: ManualStatus | undefined): void;
  /** The thread for an order or delivery, created if it doesn't exist yet */
  ensureThread(link: { type: "order" | "shipment"; id: string }): string;
  rename(name: string): void;
}

const Ctx = createContext<ChatBackend | null>(null);
export function useChatBackend(): ChatBackend {
  const b = useContext(Ctx);
  if (!b) throw new Error("useChatBackend outside ChatBackendProvider");
  return b;
}

const IDLE_MS = 5 * 6e4;
const HEARTBEAT_MS = 15e3;
const now = () => new Date().toISOString();

export function ChatBackendProvider({ me, settings, notifier = stubNotifier, children }: { me: User; settings: HomeSettings; notifier?: Notifier; children: ReactNode }) {
  const { state, dispatch } = useStore();
  const { online, lastSyncedAt } = useConnection();
  const stateRef = useRef<State>(state);
  stateRef.current = state;
  const onlineRef = useRef(online);
  onlineRef.current = online;

  // ----- Sending, with an offline queue -----
  const deliverSoon = useCallback((ids: string[]) => {
    window.setTimeout(() => dispatch({ type: "chat/status", ids, status: "delivered" }), 900);
  }, [dispatch]);

  const send: ChatBackend["send"] = useCallback(({ conversationId, text, refs, photos, urgent }) => {
    const s = stateRef.current;
    const fin = finalize(s, text, refs);
    const id = `m${s.chat.seq + 1}-${Date.now().toString(36)}`;
    const mentions = fin.refs.some(r => r.type === "user" || r.type === "group");
    const message: Message = {
      id, conversationId, authorId: me.id, text: fin.text, refs: fin.refs, photos, createdAt: now(),
      status: onlineRef.current ? "sent" : "queued",
      ...(urgent && mentions ? { urgent: true, escalateAt: new Date(Date.now() + settings.escalateMinutes * 6e4).toISOString() } : {}),
    };
    dispatch({ type: "chat/add", message });
    dispatch({ type: "chat/read", userId: me.id, conversationId, at: message.createdAt });
    if (onlineRef.current) deliverSoon([id]);
  }, [dispatch, me.id, settings.escalateMinutes, deliverSoon]);

  // When the connection comes back, send everything that was waiting
  useEffect(() => {
    if (!online) return;
    const queued = stateRef.current.chat.messages.filter(m => m.status === "queued").map(m => m.id);
    if (!queued.length) return;
    dispatch({ type: "chat/status", ids: queued, status: "sent" });
    deliverSoon(queued);
  }, [online, dispatch, deliverSoon]);

  // ----- My presence: online, away (idle or app in background), syncing later (no connection) -----
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const bump = () => { lastActive.current = Date.now(); };
    window.addEventListener("pointerdown", bump); window.addEventListener("keydown", bump); window.addEventListener("pointermove", bump, { passive: true });
    return () => { window.removeEventListener("pointerdown", bump); window.removeEventListener("keydown", bump); window.removeEventListener("pointermove", bump); };
  }, []);
  const updateMine = useCallback(() => {
    const cur = stateRef.current.chat.presence[me.id];
    const idle = document.hidden || Date.now() - lastActive.current > IDLE_MS;
    const next = !onlineRef.current ? "syncing" : idle ? "away" : "online";
    const patch: Record<string, unknown> = {};
    if (cur?.state !== next) patch.state = next;
    if (next === "syncing") patch.lastSyncedAt = lastSyncedAt;
    if (next !== "syncing" && (!cur || Date.now() - new Date(cur.lastSeenAt).getTime() > 6e4 || cur.state !== next)) patch.lastSeenAt = now();
    if (cur?.manual?.kind === "break" && cur.manual.until < now()) patch.manual = undefined;
    if (Object.keys(patch).length) dispatch({ type: "chat/presence", userId: me.id, patch });
  }, [dispatch, me.id, lastSyncedAt]);
  const updateMineRef = useRef(updateMine);
  updateMineRef.current = updateMine;
  useEffect(() => { updateMine(); }, [online, updateMine]);
  useEffect(() => {
    const vis = () => updateMineRef.current();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  // ----- Fake heartbeat for the other (sample) people, simulated reads, and urgent escalation -----
  const escalatedIds = useRef(new Set<string>()); // never text twice for one message, even if a tick runs before the store updates
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      updateMineRef.current();
      const s = stateRef.current;
      for (const u of s.chat.users) {
        if (u.id === me.id) continue;
        const p = s.chat.presence[u.id];
        if (!p) continue;
        if (p.manual?.kind === "break" && p.manual.until < now()) dispatch({ type: "chat/presence", userId: u.id, patch: { manual: undefined } });
        if (p.state === "online" || p.state === "away") {
          const flip = Math.random() < 0.12;
          const state = flip ? (p.state === "online" ? "away" : "online") : p.state;
          const stale = Date.now() - new Date(p.lastSeenAt).getTime() > 6e4;
          if (flip || (state === "online" && stale)) dispatch({ type: "chat/presence", userId: u.id, patch: { state, ...(state === "online" ? { lastSeenAt: now() } : {}) } });
          // People who are online catch up on their conversations, so "Read" ticks appear on what you sent
          if (state === "online" && Math.random() < 0.6) {
            for (const c of s.chat.conversations) {
              if (!c.members.includes(u.id)) continue;
              const last = [...s.chat.messages].reverse().find(m => m.conversationId === c.id && m.status !== "queued");
              if (last) dispatch({ type: "chat/read", userId: u.id, conversationId: c.id, at: last.createdAt });
            }
          }
        }
      }
      // Urgent mentions still unread past their time get marked and handed to the (stub) notifier
      const due = s.chat.messages.filter(m => m.urgent && !m.escalatedAt && !escalatedIds.current.has(m.id) && m.escalateAt && m.escalateAt <= now());
      const escalated: string[] = [];
      for (const m of due) {
        const conv = s.chat.conversations.find(c => c.id === m.conversationId);
        const targets = (conv?.members ?? []).filter(id => id !== m.authorId && m.refs.some(r =>
          (r.type === "user" && r.userId === id) || (r.type === "group" && s.chat.users.find(x => x.id === id)?.groups.includes(r.group))));
        const unread = targets.filter(id => (s.chat.reads[id]?.[m.conversationId] ?? "") < m.createdAt);
        if (!unread.length) continue;
        escalated.push(m.id);
        escalatedIds.current.add(m.id);
        for (const id of unread) void notifier.text(id, `Urgent message waiting: "${m.text.slice(0, 80)}"`);
      }
      if (escalated.length) dispatch({ type: "chat/escalated", ids: escalated, at: now() });
    };
    tick();
    const t = window.setInterval(tick, HEARTBEAT_MS);
    return () => window.clearInterval(t);
  }, [dispatch, me.id, notifier]);

  const api = useMemo<ChatBackend>(() => ({
    send,
    markRead: (conversationId, at) => dispatch({ type: "chat/read", userId: me.id, conversationId, at }),
    setManualStatus: status => dispatch({ type: "chat/presence", userId: me.id, patch: { manual: status } }),
    ensureThread: link => {
      const s = stateRef.current;
      const existing = s.chat.conversations.find(c => c.link?.type === link.type && c.link.id === link.id);
      if (existing) return existing.id;
      const record = link.type === "shipment" ? s.shipments.find(x => x.id === link.id) : s.orders.find(x => x.id === link.id);
      const client = record?.client;
      const conversation: Conversation = {
        id: `${link.type === "shipment" ? "ship" : "order"}-${link.id.replace(/\s+/g, "-").toLowerCase()}`,
        kind: link.type, link, createdAt: now(),
        title: link.type === "shipment" && record && "number" in record ? `${record.client} ${record.number}` : link.id,
        members: s.chat.users.filter(u => !client || canSeeClient(u, client)).map(u => u.id),
      };
      dispatch({ type: "chat/conversation", conversation });
      return conversation.id;
    },
    rename: name => dispatch({ type: "chat/rename", userId: me.id, name }),
  }), [send, dispatch, me.id]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
