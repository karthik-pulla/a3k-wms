// The product's public page (<domain>): what the WMS does, how a warehouse gets started, and "Book a visit".
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "../styles/global.css";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Landing } from "./Landing";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Landing />
    </ErrorBoundary>
  </StrictMode>,
);
