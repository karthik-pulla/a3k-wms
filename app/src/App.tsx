import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Background } from "./components/Background";
import { ModeNav } from "./components/ModeNav";
import { StatusPill } from "./components/StatusPill";
import { SettingsPanel } from "./components/SettingsPanel";
import { Ticker } from "./components/Ticker";
import { SettingsIcon, HomeIcon } from "./components/icons";
import { ToastProvider } from "./components/Toast";
import { HomeMessages } from "./components/chat/HomeMessages";
import { Home } from "./pages/Home";
import { initials } from "./auth/accountUser";
import { AuthGate } from "./auth/AuthGate";
import { identityUser, useIdentity, IdentityContext, type Identity } from "./auth/identity";
import { canManageAccounts } from "./auth/permissions";
import { groupsFor } from "./auth/accountUser";
import type { State } from "./store/types";
import { RoleSwitch } from "./components/RoleSwitch";
import { pendingCount } from "./auth/vault";
import { can } from "./auth/permissions";
import { useRoute } from "./router";
import { useAppearance, useSettings } from "./settings";
import { SessionContext, useSession } from "./session";
import { StoreProvider, useStore } from "./store/store";
import { ConnectionProvider } from "./chat/connection";
import { ChatBackendProvider } from "./chat/backend";
import { OverlayProvider } from "./chat/overlay";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useLang } from "./i18n";

// Each screen is downloaded when first opened, so phones start faster; the rest load quietly once signed in
const screens = {
  outbounds: () => import("./pages/outbounds/OutboundsPage").then(m => ({ default: m.OutboundsPage })),
  inbounds: () => import("./pages/inbounds/InboundsPage").then(m => ({ default: m.InboundsPage })),
  messages: () => import("./pages/messages/MessagesPage").then(m => ({ default: m.MessagesPage })),
  account: () => import("./pages/account/AccountPage").then(m => ({ default: m.AccountPage })),
  tasks: () => import("./pages/tasks/TasksPage").then(m => ({ default: m.TasksPage })),
  work: () => import("./pages/work/WorkPage").then(m => ({ default: m.WorkPage })),
  logs: () => import("./pages/logs/LogsPage").then(m => ({ default: m.LogsPage })),
  inventory: () => import("./pages/inventory/InventoryPage").then(m => ({ default: m.InventoryPage })),
  warehouse: () => import("./pages/warehouse/WarehousePage").then(m => ({ default: m.WarehousePage })),
  serverAccount: () => import("./pages/account/ServerAccountPage").then(m => ({ default: m.ServerAccountPage })),
};
const OutboundsPage = lazy(screens.outbounds);
const InboundsPage = lazy(screens.inbounds);
const MessagesPage = lazy(screens.messages);
const AccountPage = lazy(screens.account);
const TasksPage = lazy(screens.tasks);
const WorkPage = lazy(screens.work);
const LogsPage = lazy(screens.logs);
const InventoryPage = lazy(screens.inventory);
const WarehousePage = lazy(screens.warehouse);
const ServerAccountPage = lazy(screens.serverAccount);

/** Signed in with the server (server/ServerRoot.tsx): who it is, and the data to start with */
export interface ServerStart { identity: Identity; initial: State }

export default function App({ server }: { server?: ServerStart }) {
  const settingsApi = useSettings();
  const { settings } = settingsApi;
  useLang(); // re-render on a language change, so dates and numbers already on screen switch format too
  useAppearance(settings.theme, settings.glass);
  return (
    <ToastProvider>
      <Background moving={settings.movingBackground} />
      {server ? (
        // Stock, orders and messages aren't on the server yet: they live in this page until it's reloaded
        <IdentityContext.Provider value={server.identity}>
          <StoreProvider initial={server.initial} onChange={() => {}}>
            <Session {...settingsApi} />
          </StoreProvider>
        </IdentityContext.Provider>
      ) : (
        <AuthGate>
          {(initial, onChange) => (
            <StoreProvider initial={initial} onChange={onChange}>
              <Session {...settingsApi} />
            </StoreProvider>
          )}
        </AuthGate>
      )}
    </ToastProvider>
  );
}

/** Who's signed in (their account), the connection, and the chat backend. Owners can view the app as a sample person for testing. */
function Session({ settings, update, reset }: ReturnType<typeof useSettings>) {
  const { account } = useIdentity();
  const { state, dispatch, setActor } = useStore();
  const own = useMemo(() => identityUser(account), [account]);
  // The account appears in the app as a person (Messages, history), with the team channel and the threads it may see
  const present = state.chat.users.some(u => u.id === own.id);
  useEffect(() => { dispatch({ type: "account/user", user: own }); }, [own, present, dispatch]);
  // The admin account only (testing and debugging): use the app as another person, or with another role as yourself
  const admin = !!account.admin;
  const viewAs = admin && settings.userId ? state.chat.users.find(u => u.id === settings.userId && u.id !== own.id) : undefined;
  const self = state.chat.users.find(u => u.id === own.id) ?? own;
  const testRole = admin && !viewAs && settings.testRole && settings.testRole !== self.role ? settings.testRole : undefined;
  const me = useMemo(() => viewAs ?? (testRole ? { ...self, role: testRole, groups: groupsFor(testRole) } : self), [viewAs, testRole, self]);
  // Every change is logged under the signed-in account, naming the person or role being tested
  setActor({ id: account.uid, name: viewAs ? `${account.name} (viewing as ${viewAs.name})` : testRole ? `${account.name} (testing as ${testRole})` : account.name });
  const session = useMemo(() => ({ me, settings, update }), [me, settings, update]);
  return (
    <SessionContext.Provider value={session}>
      <ConnectionProvider simulateOffline={settings.simulateOffline}>
        <ChatBackendProvider me={me} settings={settings}>
          <OverlayProvider>
            <Shell reset={reset} viewingAs={!!viewAs || !!testRole} />
          </OverlayProvider>
        </ChatBackendProvider>
      </ConnectionProvider>
    </SessionContext.Provider>
  );
}

function Shell({ reset, viewingAs }: { reset: () => void; viewingAs: boolean }) {
  const { account, kind } = useIdentity();
  const { me, settings, update } = useSession();
  const { dispatch } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const route = useRoute();
  useAppearance(settings.theme, settings.glass);
  const wide = useMediaQuery("(min-width: 1300px)");
  const lead = can(me, "use-inbounds");
  // Workers' home is their Work screen, so the home rail (Messages and ticker) is for owners and coordinators
  const home = route.mode === "home" && lead;
  const messagesCard = settings.cards.find(c => c.kind === "messages")?.visible ?? false;
  // Wide screens: Messages and the ticker share a right-hand rail; narrower, Messages joins the update cards
  const rail = home && wide && (messagesCard || settings.showTicker);
  const showTicker = settings.showTicker && home;
  useEffect(() => { const t = window.setTimeout(() => Object.values(screens).forEach(load => load().catch(() => {})), 1500); return () => window.clearTimeout(t); }, []);

  return (
    <>
      <div className={`shell${rail ? " has-rail" : showTicker ? " has-ticker" : ""}${route.mode === "messages" ? " on-messages" : ""}${route.mode === "work" && route.parts[0] === "forklift" ? " fk" : ""}`}>
        <ModeNav current={route.mode} />
        <Suspense fallback={<main className="page-loading muted" aria-busy="true">Loading…</main>}>
        {route.mode === "home" ? (lead ? <Home messagesInRail={rail && messagesCard} /> : <WorkPage parts={[]} />)
          : route.mode === "work" ? <WorkPage parts={route.parts} />
          : route.mode === "inventory" ? <InventoryPage parts={route.parts} />
          : route.mode === "messages" ? <MessagesPage parts={route.parts} />
          : route.mode === "account" ? (kind === "server" ? <ServerAccountPage /> : <AccountPage />)
          : route.mode === "warehouse" ? <WarehousePage parts={route.parts} />
          : route.mode === "tasks" ? <TasksPage />
          : route.mode === "logs" ? <LogsPage />
          : !lead ? <NoAccess />
          : route.mode === "inbounds" ? <InboundsPage parts={route.parts} />
          : <OutboundsPage parts={route.parts} />}
        </Suspense>
        {rail ? (
          <aside className="rail" aria-label="Messages and activity">
            {messagesCard && <HomeMessages placement="rail" />}
            {settings.showTicker && <Ticker />}
          </aside>
        ) : showTicker && <Ticker />}
        <div className="topbar">
          <StatusPill />
          {account.admin && <RoleSwitch compact />}
          {viewingAs && <button className="chip role-chip" onClick={() => update({ userId: "", testRole: "" })} title="Back to your own account">{me.id === account.uid ? `Testing as ${me.role}` : `Viewing as ${me.name} · ${me.role}`} ✕</button>}
          <a className={`iconbtn glass avatar-btn${account.mustChange ? " alert" : ""}`} href="#/account" aria-label={`Account: ${account.name}${account.mustChange ? ", change your password" : ""}`} title={`${account.name} · account and sign-out`}>
            <span className="avatar">{initials(account.name)}</span>
            {(account.mustChange || (kind === "device" && canManageAccounts(identityUser(account)) && pendingCount() > 0)) && <span className="badge nav-badge mention" aria-hidden="true">!</span>}
          </a>
          {route.mode !== "home" && <a className="iconbtn glass" href="#/" aria-label="Home"><HomeIcon /></a>}
          <button className="iconbtn glass" onClick={() => setSettingsOpen(true)} aria-label="Settings"><SettingsIcon /></button>
        </div>
      </div>
      {settingsOpen && <SettingsPanel settings={settings} update={update} reset={reset} onResetData={() => dispatch({ type: "reset" })} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

function NoAccess() {
  return <main className="section"><div className="panel glass"><p>This section is for coordinators and owners. Your pallet tasks and orders to pack are on your Work screen.</p><a className="link" href="#/work">Work ›</a></div></main>;
}
