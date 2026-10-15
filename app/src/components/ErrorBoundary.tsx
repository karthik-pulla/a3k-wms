import { Component, type ReactNode } from "react";
import { freshLoad, isLoadError } from "../utils/freshLoad";

/** Shows what went wrong instead of a blank screen. A missing screen file (the app was updated) reloads by itself. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { if (isLoadError(error)) freshLoad(); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="auth-loading">
        <div className="glass crash-card">
          <h2>Something went wrong</h2>
          <p className="muted">{isLoadError(error) ? "The app was updated or the connection dropped. Reload to get the latest version." : "The app hit an error on this screen. Reloading usually fixes it."}</p>
          <p className="muted small" translate="no">{error.message}</p>
          <button className="btn primary" onClick={() => { if (!freshLoad()) location.reload(); }}>Reload</button>
        </div>
      </main>
    );
  }
}
