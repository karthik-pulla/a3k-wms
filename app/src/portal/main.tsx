// The client portal (<warehouse address>/portal): a warehouse's clients order and announce deliveries. See PortalApp.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/geist-mono";
import "../styles/global.css";
import { startI18n } from "../i18n";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { PortalApp } from "./PortalApp";

startI18n();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <PortalApp />
    </ErrorBoundary>
  </StrictMode>,
);
