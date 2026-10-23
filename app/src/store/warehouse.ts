// The warehouse's own settings as screens read them (Manage warehouse → Warehouse): its name, picking rule, contacts.
import { tenant } from "../tenant";
import type { State } from "./types";

/** The name on screens: the one an owner set on this device (vault), else the warehouse's settings */
export const warehouseName = (state: Pick<State, "settings">) => state.settings?.name?.trim() || tenant().config.branding.appTitle;
let rid = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++rid).toString(36)}`;
