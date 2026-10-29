// Runs first, synchronously, in <head> of every page.
// 1) Sends http:// visits to https:// (GitHub Pages is not forcing it for this domain).
// 2) Applies the saved/OS theme before first paint, so there's no flash of the wrong theme.
(function () {
  var h = location.hostname;
  if (location.protocol === "http:" && h !== "localhost" && h !== "127.0.0.1") {
    location.replace("https:" + location.href.substring(location.protocol.length));
    return;
  }
  var stored = null;
  try {
    stored = localStorage.getItem("mkm-theme");
  } catch (e) {}
  var dark = stored ? stored === "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
})();
