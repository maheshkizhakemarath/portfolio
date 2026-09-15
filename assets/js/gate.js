// Per-case-study password gate.
// NOTE: like before, this is a soft client-side gate on a static site — the
// markup and images are reachable by anyone with the URL who reads the
// page source. It keeps casual visitors out; it is not real access control.
//
// The <head> of case-studies/view.html carries a small synchronous script
// that adds "gate-locked" to <html> based on localStorage alone (so there is
// no flash of content before we know whether a password is required). Once
// the case study's data has loaded, setupGate() reconciles that guess: if
// the study turns out to need no password, it unlocks immediately.
(function () {
  function storageKey(slug) {
    return "mkm-unlocked-" + slug;
  }

  function setupGate(caseStudy) {
    var root = document.documentElement;
    var lightbox = document.querySelector("[data-lightbox]");
    var gate = document.querySelector("[data-password-gate]");
    if (!caseStudy) return;

    var slug = caseStudy.slug;
    var required = !!(caseStudy.password && String(caseStudy.password).trim());

    function unlock(persist) {
      root.classList.remove("gate-locked");
      if (persist) {
        try {
          localStorage.setItem(storageKey(slug), "true");
        } catch (e) {}
      }
    }

    if (!required) {
      unlock(true);
      return;
    }

    var already = false;
    try {
      already = localStorage.getItem(storageKey(slug)) === "true";
    } catch (e) {}
    if (already) {
      unlock(false);
      return;
    }

    // Still locked: wire up the form against this study's real password.
    var form = gate ? gate.querySelector("[data-password-gate-form]") : null;
    if (!form) return;
    var errorEl = form.querySelector("[data-password-gate-error]");
    var input = form.querySelector("input[name='password']");

    function attempt() {
      var value = (input.value || "").trim().toLowerCase();
      var expected = String(caseStudy.password || "").trim().toLowerCase();
      if (value && value === expected) {
        if (errorEl) errorEl.textContent = "";
        unlock(true);
      } else {
        if (errorEl) errorEl.textContent = "Incorrect password.";
        input.value = "";
        input.focus();
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      attempt();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        attempt();
      }
    });
  }

  window.MKM = window.MKM || {};
  window.MKM.setupGate = setupGate;
})();
