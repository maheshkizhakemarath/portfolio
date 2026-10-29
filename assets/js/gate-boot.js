// Case-study page only, synchronous in <head>: assume locked unless this exact case study was
// already unlocked in this browser. render.js + gate.js reconcile this once the real data
// loads (e.g. instantly unlock a study that turns out to need no password at all).
(function () {
  var slug = new URLSearchParams(location.search).get("slug") || "";
  var unlocked = false;
  try {
    unlocked = localStorage.getItem("mkm-unlocked-" + slug) === "true";
  } catch (e) {}
  if (!unlocked) document.documentElement.classList.add("gate-locked");
})();
