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

// 3) Holds the page content back (html.is-loading) until the site data has rendered and the
// font is ready, then fades it in once, instead of text popping in and shifting as it arrives.
// A timer reveals it anyway if something is slow or fails, so the page can never stay blank.
(function () {
  var root = document.documentElement;
  root.classList.add("is-loading");
  var done = false;
  function reveal() {
    if (done) return;
    done = true;
    root.classList.remove("is-loading");
    root.classList.add("is-ready");
  }
  window.MKM_reveal = function () {
    var fonts = document.fonts;
    if (!fonts || !fonts.load) return reveal();
    Promise.race([
      Promise.all([fonts.load('400 16px "Geist"'), fonts.load('500 16px "Geist"')]),
      new Promise(function (r) { setTimeout(r, 500); }),
    ]).then(reveal, reveal);
  };
  setTimeout(reveal, 3000);
})();
