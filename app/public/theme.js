// Start in the last theme used (or the system theme) so the page doesn't flash before React loads
try {
  var t = localStorage.getItem("wms.theme");
  document.documentElement.dataset.theme = t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch (e) { document.documentElement.dataset.theme = "dark"; }

// After an update the browser may still have the old start page, whose script files are gone (GitHub keeps the page
// for up to 10 minutes). If a script of ours fails to load, open the page again at a new address so it is fetched fresh.
// Once per minute at most, so a real outage can't loop.
window.addEventListener("error", function (e) {
  var el = e.target;
  if (!el || el.tagName !== "SCRIPT" || !/\/assets\//.test(el.src || "")) return;
  try {
    var last = Number(sessionStorage.getItem("wms.freshLoad") || 0);
    if (Date.now() - last < 60000) return;
    sessionStorage.setItem("wms.freshLoad", String(Date.now()));
  } catch (err) { return; }
  location.replace(location.pathname + "?v=" + Date.now() + location.hash);
}, true);
