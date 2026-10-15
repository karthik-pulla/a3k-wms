import { useStore } from "../../store/store";
import { useSession } from "../../session";
import { presenceView } from "../../chat/presence";

/** Presence dot for one person, with the label (and the detail the viewer may see) as its tooltip. */
export function PresenceDot({ userId, withLabel = false }: { userId: string; withLabel?: boolean }) {
  const { state } = useStore();
  const { me, settings } = useSession();
  const v = presenceView(me, state.chat.presence[userId], settings);
  const text = v.detail ? `${v.label} · ${v.detail}` : v.label;
  return (
    <>
      <span className={`pdot ${v.dot}`} title={text} role="img" aria-label={text} />
      {withLabel && <span className="plabel">{text}</span>}
    </>
  );
}
