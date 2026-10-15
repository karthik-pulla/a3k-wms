import { useStore } from "../../store/store";
import { useToast } from "../../components/Toast";
import type { CountSession } from "../../store/types";
import { t } from "../../i18n";

/** Asks first; deleting removes the count and its entries, but corrections already applied stay in stock and the history. */
export function useDeleteCount() {
  const { dispatch } = useStore();
  const toast = useToast();
  return (c: CountSession) => {
    const n = Object.keys(c.entries).length;
    const applied = Object.values(c.decided ?? {}).filter(d => d === "applied").length;
    const msg = `Delete "${c.name}"?\n\n${n ? `The ${n} location${n === 1 ? "" : "s"} counted in it will be removed. ` : ""}This can't be undone.${applied ? `\n\n${applied} correction${applied === 1 ? " was" : "s were"} already applied; ${applied === 1 ? "it stays" : "they stay"} in stock and in the history.` : ""}`;
    if (!window.confirm(t(msg))) return false;
    dispatch({ type: "count/delete", id: c.id });
    toast(`Deleted "${c.name}".`);
    return true;
  };
}
