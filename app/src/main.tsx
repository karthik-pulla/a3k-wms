import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts ship with the app so it looks the same offline and makes no outside requests
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/geist-mono";
import "./styles/global.css";
import App from "./App";
import { startI18n } from "./i18n";

startI18n();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
