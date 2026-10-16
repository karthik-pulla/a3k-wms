// The ops console (ops.<domain>): the WMS team's own page, separate from every warehouse. See OpsApp.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/geist-mono";
import "../styles/global.css";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { OpsApp } from "./OpsApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <OpsApp />
    </ErrorBoundary>
  </StrictMode>,
);
