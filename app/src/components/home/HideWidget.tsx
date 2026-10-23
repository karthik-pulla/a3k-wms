import { useSession } from "../../session";
import { useToast } from "../Toast";
import type { HomeCardKind } from "../../settings";
import { WIDGETS } from "./WidgetPicker";

/** The × on a home widget: takes it off this person's home (bring it back with "Widgets" or Settings → Home screen) */
export function HideWidget({ kind }: { kind: HomeCardKind }) {
  const { settings, update } = useSession();
  const toast = useToast();
  const name = WIDGETS[kind].name;
  return (
    <button type="button" className="iconbtn small widget-hide" aria-label={`Hide ${name} from home`} title="Hide from home"
      onClick={e => { e.preventDefault(); e.stopPropagation(); update({ cards: settings.cards.map(c => (c.kind === kind ? { ...c, visible: false } : c)) }); toast(`${name} hidden. Bring it back with "Widgets".`); }}>×</button>
  );
}
