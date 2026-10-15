import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts ship with the app so it looks the same offline and makes no outside requests
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/geist-mono";
import "./styles/global.css";
import App from "./App";
import { startI18n } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { freshLoad } from "./utils/freshLoad";

startI18n();
// A screen's file is gone because the app was updated while open: load the latest version
window.addEventListener("vite:preloadError", e => { if (freshLoad()) e.preventDefault(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
