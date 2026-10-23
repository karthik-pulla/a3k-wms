// "Account" when signed in with the server: who you are, your role, signing out here or everywhere.
import { useState } from "react";
import { useIdentity } from "../../auth/identity";
import { initials } from "../../auth/accountUser";
import { api } from "../../server/client";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

export function ServerAccountPage() {
  const { account, me, signOut } = useIdentity();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const p = me!.person;
  return (
    <main className="section account">
      <header className="section-head"><h1>Account</h1><p className="crumb">{me!.tenant.appTitle}</p></header>
      <div className="account-grid">
        <section className="panel glass">
          <div className="avatar-row"><span className="avatar big" aria-hidden="true">{initials(account.name)}</span><div><b translate="no">{p.name}</b><p className="muted small" translate="no">@{p.username}</p></div></div>
          <dl className="facts-list">
            <div><dt>Role</dt><dd translate="no">{p.roleName}</dd></div>
            <div><dt>Brands</dt><dd translate="no">{p.base === "owner" || !p.clients ? "All" : p.clients.join(", ")}</dd></div>
            <div><dt>Email</dt><dd>{p.email ?? "—"}</dd></div>
            <div><dt>Sign-in</dt><dd>Password + authenticator app</dd></div>
          </dl>
          {me!.can["manage-people"] && <a className="link" href="#/manage/people">People, roles and access ›</a>}
        </section>
        <section className="panel glass">
          <h2 className="plain-h">Signing out</h2>
          <p className="muted small">On a shared device, sign out when you're done. Lost a phone or left yourself signed in somewhere? Sign out everywhere, then ask an owner to reset your sign-in if the phone with your authenticator app is gone.</p>
          <div className="btns">
            <button className="btn" disabled={busy} onClick={() => void signOut()}>Sign out</button>
            <button className="btn danger" disabled={busy || !!me!.support} onClick={async () => {
              if (!window.confirm(t("Sign out on every device, including this one?"))) return;
              setBusy(true);
              try { await api("auth.signOutEverywhere"); toast("Signed out everywhere."); await signOut(); } finally { setBusy(false); }
            }}>Sign out everywhere</button>
          </div>
        </section>
      </div>
    </main>
  );
}
