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
// The preview (and the demo site built from it) runs PostgreSQL as WebAssembly in the browser, which needs 'wasm-unsafe-eval'
const cspFor = (preview: boolean) => (preview ? CSP.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'") : CSP);
const csp = (): Plugin => ({
  name: "wms-csp",
  apply: "build",
  transformIndexHtml: html => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${cspFor(process.env.VITE_WMS_BACKEND === "preview")}" />\n    <meta name="referrer" content="no-referrer" />`),
});

/**
 * Demo builds (VITE_WMS_DEMO=1 VITE_TENANT=demo): the made-up demo warehouse, with relative paths so they work under any
 * folder (github.io/<repo>/). `npm run build:site` is the public demo site: the server version running in the browser
 * (the preview) with ready-made logins, the landing page in front (scripts/site.mjs). `npm run build:demo` is the
 * older device-only demo.
 */
const demo = process.env.VITE_WMS_DEMO === "1";

/**
 * A build serves one warehouse (VITE_TENANT, default a3k): the other warehouses' folders are left out of it, so the
 * demo site never carries A3K's files. (Until the server picks the warehouse from the address.)
 */
const tenant = process.env.VITE_TENANT || "a3k";
const backend = process.env.VITE_WMS_BACKEND ?? "local";
const withServer = backend !== "local";
const oneTenant = (): Plugin => {
  let outDir = "dist";
  return {
    name: "wms-one-tenant",
    apply: "build",
    configResolved: c => { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle: () => {
      const dir = path.join(outDir, "tenants");
      if (!fs.existsSync(dir)) return;
      // A server build gets every warehouse's settings from its database: no tenant files at all
      for (const t of fs.readdirSync(dir)) if (t !== tenant || backend === "server") fs.rmSync(path.join(dir, t), { recursive: true, force: true });
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
    },
  };
};

export default defineConfig({
  base: demo ? "./" : "/",
  plugins: [react(), csp(), oneTenant()],
  // Always a fixed value in the build, so code for the other ways of running (the preview's in-browser database) is left out
  define: { "import.meta.env.VITE_WMS_BACKEND": JSON.stringify(backend) },
  // With the server, three pages: the warehouse app, the WMS team's ops console (only at the console's address) and the
  // product's public page with "Book a visit" (only at the product's own address).
  // On-device builds (the demo site) have no console.
  build: { rollupOptions: { input: { app: path.resolve(import.meta.dirname, "index.html"), ...(withServer ? { ops: path.resolve(import.meta.dirname, "ops.html"), landing: path.resolve(import.meta.dirname, "landing.html") } : {}) } } },
  // The app shares the roles and the sign-in logic with the server (server/src/shared, server/src/core)
  server: { port, strictPort: true, fs: { allow: [".", "../server/src", "../server/migrations", "../server/templates"] } },
  // PGlite (the preview's in-browser PostgreSQL) ships its own WebAssembly; Vite mustn't pre-bundle it
  optimizeDeps: { exclude: ["@electric-sql/pglite", "@electric-sql/pglite/worker"] },
  // The preview shares its databases between tabs through a module worker (src/server/pgliteWorker.ts)
  worker: { format: "es" },
});
