import fs from "node:fs";
import path from "node:path";
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
 * Demo build (VITE_WMS_DEMO=1 VITE_TENANT=demo, `npm run build:demo`): the public site on GitHub Pages, serving the
 * made-up demo warehouse. Paths are relative so it works under any folder (github.io/<repo>/).
 */
const demo = process.env.VITE_WMS_DEMO === "1";

/**
 * A build serves one warehouse (VITE_TENANT, default a3k): the other warehouses' folders are left out of it, so the
 * demo site never carries A3K's files. (Until the server picks the warehouse from the address.)
 */
const tenant = process.env.VITE_TENANT || "a3k";
const oneTenant = (): Plugin => {
  let outDir = "dist";
  return {
    name: "wms-one-tenant",
    apply: "build",
    configResolved: c => { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle: () => {
      const dir = path.join(outDir, "tenants");
      if (!fs.existsSync(dir)) return;
      for (const t of fs.readdirSync(dir)) if (t !== tenant) fs.rmSync(path.join(dir, t), { recursive: true, force: true });
    },
  };
};

export default defineConfig({
  base: demo ? "./" : "/",
  plugins: [react(), csp(), oneTenant()],
  server: { port, strictPort: true },
});
