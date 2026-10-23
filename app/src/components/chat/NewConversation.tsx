import { useMemo, useState } from "react";
import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { useChatBackend } from "../../chat/backend";
import { searchPeople } from "../../chat/selectors";
import { PresenceDot } from "./Presence";

const ROLE: Record<string, string> = { owner: "Owner", coordinator: "Coordinator", worker: "Worker" };

/**
 * The people directory: search anyone in the warehouse by name, role or group. One person → a direct message;
 * several → a group chat with a name (its creator can rename it, add or remove people, or delete it).
 */
export function NewConversation({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useStore();
  const { me } = useSession();
  const backend = useChatBackend();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const people = useMemo(() => searchPeople(state.chat.users.filter(u => u.id !== me.id), q), [state.chat.users, me.id, q]);
  const names = picked.map(id => state.chat.users.find(u => u.id === id)?.name ?? id);
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const start = () => {
    if (!picked.length) return;
    if (picked.length === 1) { onOpen(backend.startDm(picked[0])); return; }
    onOpen(backend.createGroup(title.trim() || names.slice(0, 3).join(", "), picked));
  };
  return (
    <div className="new-conv">
      <input className="input" type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search people by name, role or group" aria-label="Search people" />
      <ul className="people-dir" aria-label="People">
        {people.map(u => (
          <li key={u.id}>
            <label className="person-row">
              <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} aria-label={`Pick ${u.name}`} />
              <PresenceDot userId={u.id} />
              <span className="conv-main"><span className="conv-title" translate="no">{u.name}</span><small className="muted">{u.roleName ?? ROLE[u.role]}{u.groups.length ? ` · ${u.groups.map(g => `@${g}`).join(" ")}` : ""}{u.sample ? " · sample" : ""}</small></span>
            </label>
            <button className="btn small" onClick={() => onOpen(backend.startDm(u.id))}>Message</button>
          </li>
        ))}
        {!people.length && <li className="muted small">Nobody by that name.</li>}
      </ul>
      {picked.length > 0 && (
        <div className="new-conv-picked">
          <div className="chip-wrap">{picked.map((id, i) => <button key={id} className="chip-btn on" onClick={() => toggle(id)} aria-label={`Remove ${names[i]}`}>{names[i]} ×</button>)}</div>
          {picked.length > 1 && <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={`Group name (e.g. ${names.slice(0, 2).join(" & ")})`} aria-label="Group name" maxLength={60} />}
          <button className="btn primary" onClick={start}>{picked.length === 1 ? `Message ${names[0]}` : `Start group chat (${picked.length + 1} people)`}</button>
        </div>
      )}
    </div>
  );
}
