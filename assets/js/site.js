// Theme toggle (Light / Dark) with persistence
(function () {
  var root = document.documentElement;
  var stored = null;
  try {
    stored = localStorage.getItem("mkm-theme");
  } catch (e) {}

  if (stored === "dark") {
    root.setAttribute("data-theme", "dark");
  }

  function setTheme(theme) {
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem("mkm-theme", theme);
    } catch (e) {}
    syncButtons();
  }

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function syncButtons() {
    var theme = currentTheme();
    document.querySelectorAll("[data-theme-btn]").forEach(function (btn) {
      var pressed = btn.getAttribute("data-theme-btn") === theme;
      btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-btn]");
    if (!btn) return;
    setTheme(btn.getAttribute("data-theme-btn"));
  });

  document.addEventListener("DOMContentLoaded", syncButtons);
})();

// Lightbox / image preview overlay
// Clones the clicked preview element's content into an enlarged modal card —
// mirrors the Figma "Image preview" page (node 1-32): dimmed background, a
// white card with the same content shown larger, and an X to close.
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var lightbox = document.querySelector("[data-lightbox]");
    if (!lightbox) return;

    var body = lightbox.querySelector("[data-lightbox-body]");
    var closeBtn = lightbox.querySelector("[data-lightbox-close]");

    function open(sourceEl) {
      body.innerHTML = "";
      var clone = sourceEl.cloneNode(true);
      clone.removeAttribute("data-preview");
      body.appendChild(clone);
      lightbox.classList.add("is-open");
      document.body.classList.add("lightbox-active");
    }

    function close() {
      lightbox.classList.remove("is-open");
      document.body.classList.remove("lightbox-active");
      body.innerHTML = "";
    }

    // Delegate so it also works for buttons rendered dynamically from data.
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-preview]");
      if (!el) return;
      open(el);
    });

    closeBtn.addEventListener("click", close);
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
  });
})();
