// Start in the last theme used (or the system theme) so the page doesn't flash before React loads
try {
  var t = localStorage.getItem("wms.theme");
  document.documentElement.dataset.theme = t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch (e) { document.documentElement.dataset.theme = "dark"; }
