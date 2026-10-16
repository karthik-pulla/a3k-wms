import { StrictMode, Suspense, lazy } from "react";
import { createRoot, type Root } from "react-dom/client";
// Fonts ship with the app so it looks the same offline and makes no outside requests
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/geist-mono";
import "./styles/global.css";
import { startI18n } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { freshLoad } from "./utils/freshLoad";
import { loadTenant } from "./tenant";
import { usesServer } from "./server/client";

startI18n();
// A screen's file is gone because the app was updated while open: load the latest version
window.addEventListener("vite:preloadError", e => { if (freshLoad()) e.preventDefault(); });

// On this device (default): the warehouse's settings and products load first, since every screen reads them
// (data/catalog.ts) when its file loads. With the server: sign-in first, then the settings from its database.
const App = usesServer ? lazy(() => import("./server/ServerRoot")) : lazy(() => loadTenant().then(() => import("./App")));

// In development, hot reload can run this file again: render into the same root instead of mounting a second one
const root: Root = (import.meta.hot?.data.root as Root | undefined) ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.dispose(d => { d.root = root; });
root.render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div className="auth-loading" role="status">Opening…</div>}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
