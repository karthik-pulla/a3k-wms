// Manage warehouse (#/manage/<tab>): where owners run the warehouse. The warehouse itself (name, picking rule,
// announcements), people and roles, racks and slot codes, clients and carriers (with email routing), the logs, and,
// with the server, support access and setup. Coordinators keep their Logs page (#/logs).
import { SubTabs } from "../../components/SubTabs";
import { useSession } from "../../session";
import { useIdentity } from "../../auth/identity";
import { can } from "../../auth/permissions";
import { tenant } from "../../tenant";
import { ConfirmProvider, useApiData } from "../warehouse/useApi";
import { LogTab, PeopleTab, RequestsTab, RolesTab, SupportTab } from "../warehouse/WarehousePage";
import { DataTab } from "../warehouse/DataTab";
import { LogsPage } from "../logs/LogsPage";
import { WarehouseTab } from "./WarehouseTab";
import { RacksTab } from "./RacksTab";
import { ClientsTab } from "./ClientsTab";
import { useStore } from "../../store/store";
import { warehouseName } from "../../store/warehouse";
import type { GrantView, RequestView } from "../../../../server/src/shared/api.ts";

const NAMES: Record<string, string> = { warehouse: "Warehouse", people: "People", racks: "Racks", clients: "Clients and carriers", logs: "Logs", support: "Support access", setup: "Setup" };

export function ManagePage({ parts }: { parts: string[] }) {
  const { me } = useSession();
  const { state } = useStore();
  const { kind, me: serverMe } = useIdentity();
  const server = kind === "server";
  const people = server && !!serverMe?.can["manage-people"];
  const [tab = "warehouse", sub] = parts;
  const requests = useApiData<RequestView[]>(people ? "requests.list" : null);
  const support = useApiData<GrantView[]>(people ? "support.list" : null);
  if (!can(me, "manage-settings")) return <main className="section"><div className="panel glass"><p>Managing the warehouse is for owners.</p>{can(me, "view-logs") && <a className="link" href="#/logs">Logs ›</a>}</div></main>;
  const waiting = (support.data ?? []).filter(g => g.status === "requested" || g.status === "active").length;
  const tabs = [
    { id: "warehouse", label: "Warehouse" }, { id: "people", label: "People", badge: requests.data?.length ?? 0 }, { id: "racks", label: "Racks" },
    { id: "clients", label: "Clients" }, { id: "logs", label: "Logs" },
    ...(people ? [{ id: "support", label: "Support", badge: waiting }, { id: "setup", label: "Setup" }] : []),
  ];
  const current = tabs.some(t => t.id === tab) ? tab : "warehouse";
  return (
    <ConfirmProvider>
      <main className="section manage">
        <header className="section-head">
          <h1>Manage warehouse</h1>
          <p className="crumb"><span translate="no">{warehouseName(state)}</span> · {NAMES[current]}</p>
        </header>
        <div className="team-body">
          {current === "warehouse" ? <WarehouseTab />
            : current === "racks" ? <RacksTab />
            : current === "clients" ? <ClientsTab />
            : current === "logs" ? <>
              {people && <Seg base="logs" cur={sub ?? "changes"} items={[["changes", "Every change"], ["security", "Security log"]]} />}
              {people && sub === "security" ? <LogTab /> : <LogsPage embedded />}
            </>
            : current === "support" ? <SupportTab data={support} />
            : current === "setup" ? <DataTab />
            : people ? <>
              <Seg base="people" cur={sub ?? "people"} items={[["people", "People"], ["roles", "Roles and switches"], ["requests", `Account requests${requests.data?.length ? ` · ${requests.data.length}` : ""}`]]} />
              {sub === "roles" ? <RolesTab /> : sub === "requests" ? <RequestsTab reload={requests.reload} /> : <PeopleTab />}
            </>
            : <DevicePeople />}
        </div>
        <SubTabs base="manage" current={current} tabs={tabs} />
      </main>
    </ConfirmProvider>
  );
}

/** A tab's own sections, as chips with addresses (#/manage/people/roles) */
function Seg({ base, cur, items }: { base: string; cur: string; items: [string, string][] }) {
  return (
    <div className="chip-wrap manage-seg" role="navigation" aria-label="Sections">
      {items.map(([id, label]) => <a key={id} className={`chip-btn${cur === id ? " on" : ""}`} aria-current={cur === id ? "page" : undefined} href={`#/manage/${base}${id === items[0][0] ? "" : `/${id}`}`}>{label}</a>)}
    </div>
  );
}

/** Without the server, accounts live on this device (Account page) */
function DevicePeople() {
  return (
    <section className="panel glass">
      <h2 className="plain-h">People on this device</h2>
      <p className="muted">On this device, people ask for an account on the sign-in screen and an owner approves it (choosing the role and the brands they see), resets passwords or turns accounts off on the Account page. With the server, people are invited by link from here, roles and switches can be changed, and everyone signs in with a code from their phone.</p>
      <p className="muted small">{tenant().config.clients.length} clients · roles: Owner, Coordinator, Worker</p>
      <a className="btn primary" href="#/account">Accounts and requests ›</a>
    </section>
  );
}
