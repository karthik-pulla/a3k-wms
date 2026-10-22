// The public demo site (npm run build:site, published by .github/workflows/pages.yml): the landing page in front,
// the demo WMS and its console in demo/. The landing page is the demo build's own landing.html with its relative
// paths pointed into demo/, so both share one set of files.
import fs from "node:fs";
import path from "node:path";

const site = path.resolve(import.meta.dirname, "../dist-site");
const demo = path.join(site, "demo");
const landing = fs.readFileSync(path.join(demo, "landing.html"), "utf8");
const front = landing.replace(/(src|href)="\.\//g, '$1="./demo/');
if (front === landing) throw new Error("landing.html has no relative paths to point at demo/: was it built with a relative base?");
fs.writeFileSync(path.join(site, "index.html"), front);
fs.writeFileSync(path.join(site, ".nojekyll"), "");
console.log("Demo site: index.html (landing page) + demo/ (the WMS and its console)");
