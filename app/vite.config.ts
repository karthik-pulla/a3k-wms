import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// PORT lets a preview tool run its own copy beside one already on 5173; without it, use 5173.
const port = Number(process.env.PORT) || 5173;

/**
 * Content-Security-Policy for the built app: scripts, styles, fonts and workers only from the app itself, no outside
 * requests, no plugins, no inline scripts. (Not in dev: Vite's dev server injects inline scripts for hot reload.)
 * blob: is for the PDF preview and printing; data: for logos and photos. On the server, send it as an HTTP header too,
 * with frame-ancestors 'none' (a meta tag can't set that).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const csp = (): Plugin => ({
  name: "wms-csp",
  apply: "build",
  transformIndexHtml: html => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`),
});

/**
 * Demo build (VITE_WMS_DEMO=1, `npm run build:demo`): the public site on GitHub Pages. The real sheet stock is replaced
 * by nothing (the app then makes up demo stock), so no real stock can end up in it, and paths are relative so it
 * works under any folder (github.io/<repo>/).
 */
const demo = process.env.VITE_WMS_DEMO === "1";
const noSheetStock = (): Plugin => ({
  name: "wms-no-sheet-stock",
  enforce: "pre",
  load: id => (id.endsWith("/data/generated/sampleStock.json") ? "null" : undefined),
});

export default defineConfig({
  base: demo ? "./" : "/",
  plugins: [react(), csp(), ...(demo ? [noSheetStock()] : [])],
  server: { port, strictPort: true },
});
