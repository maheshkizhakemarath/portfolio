// Data-driven rendering for the home page and the case-study template.
// Both pages fetch ../data/site.json (or ./data/site.json from the root)
// and render their content from it, so the admin panel can edit that one
// JSON file and have every page reflect the change.

(function () {
  const DATA_URL = document.body.dataset.dataUrl || "data/site.json";

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // Lightweight markdown-style links: "[label](https://example.com)" inside
  // any admin-editable text becomes a real link. Text is HTML-escaped first
  // so this is the only way to get a tag into the output — a "[...](...)"
  // that isn't a safe http(s)/mailto URL is left as plain (escaped) text.
  const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
  function linkify(s) {
    return esc(s).replace(
      LINK_PATTERN,
      (_, label, url) => `<a class="text-link" href="${url}" target="_blank" rel="noopener">${label}</a>`
    );
  }

  async function loadSite() {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load site data (" + res.status + ")");
    return res.json();
  }

  // ---------- shared block renderer (used by case-study pages) ----------
  // Mirrors the structure produced by the import pipeline: a flat, ordered
  // list of blocks. A top-level "heading" starts a new <section>.
  function renderBlocksHTML(blocks, imgBase) {
    let out = [];
    let inSection = false;

    function openSection() {
      if (!inSection) {
        out.push('<section class="case-section">');
        inSection = true;
      }
    }

    for (const b of blocks || []) {
      if (b.type === "heading") {
        if (inSection) out.push("</section>");
        out.push(`<section class="case-section"><h2>${linkify(b.text)}</h2>`);
        inSection = true;
      } else if (b.type === "subheading") {
        openSection();
        out.push(`<h3>${linkify(b.text)}</h3>`);
      } else if (b.type === "paragraph") {
        openSection();
        out.push(`<p>${linkify(b.text)}</p>`);
      } else if (b.type === "list") {
        openSection();
        out.push("<ul>" + (b.items || []).map((i) => `<li>${linkify(i)}</li>`).join("") + "</ul>");
      } else if (b.type === "image-row") {
        openSection();
        const imgs = (b.images || []).filter((i) => i.src);
        if (!imgs.length) continue;
        const cls = imgs.length > 1 ? "case-image-row" : "case-hero-inline";
        out.push(`<div class="${cls}">`);
        for (const img of imgs) {
          const src = img.src.startsWith("http") || img.src.startsWith("../")
            ? img.src
            : (imgBase || "") + img.src;
          const alt = img.alt || "";
          out.push(
            `<button type="button" class="case-shot case-photo" data-preview data-preview-alt="${esc(alt)}">` +
              `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></button>`
          );
        }
        out.push("</div>");
      }
    }
    if (inSection) out.push("</section>");
    return out.join("\n");
  }

  // Finds the first image in a case study's blocks, to use as its thumbnail
  // in the group popover. Paths are stored relative to case-studies/ (e.g.
  // "../assets/img/...") since that's the only place they're normally
  // rendered from; strip the leading "../" when using them from the root.
  // An explicit coverImage always wins over a block image.
  function firstThumbSrc(cs) {
    if (cs.coverImage) return cs.coverImage.replace(/^\.\.\//, "");
    for (const b of cs.blocks || []) {
      if (b.type === "image-row") {
        const img = (b.images || []).find((i) => i.src);
        if (img) return img.src.replace(/^\.\.\//, "");
      }
    }
    return null;
  }

  // ---------- home page ----------
  async function renderHome() {
    const root = document.querySelector("[data-home-root]");
    if (!root) return null;
    const site = await loadSite();
    const about = site.about || {};
    root.querySelector("[data-name]").textContent = about.name || "";
    root.querySelector("[data-role]").innerHTML = linkify(about.role || "");
    const bioEl = root.querySelector("[data-bio]");
    bioEl.innerHTML = (about.bio || []).map((p) => `<p>${linkify(p)}</p>`).join("");

    const isAdmin = document.documentElement.classList.contains("admin-mode");
    const allStudies = site.caseStudies || [];
    const groups = (site.groups || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Merge groups and ungrouped case studies into one ordered top-level
    // list (both use the same "order" field to occupy a shared position
    // space on the home page).
    const groupEntries = groups.map((g) => ({
      type: "group",
      order: g.order ?? 0,
      group: g,
      studies: allStudies
        .filter((cs) => cs.group === g.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .filter((cs) => isAdmin || cs.visible !== false),
    }));
    const studyEntries = allStudies
      .filter((cs) => !cs.group)
      .filter((cs) => isAdmin || cs.visible !== false)
      .map((cs) => ({ type: "study", order: cs.order ?? 0, study: cs }));

    const entries = groupEntries
      .filter((e) => e.studies.length || isAdmin)
      .concat(studyEntries)
      .sort((a, b) => a.order - b.order);

    const listEl = root.querySelector("[data-case-study-list]");
    listEl.innerHTML = entries
      .map((e) => {
        if (e.type === "group") {
          const emptyTag = !e.studies.length ? ' <span class="admin-hidden-tag">empty</span>' : "";
          return `<li data-group-id="${esc(e.group.id)}"><button type="button" class="text-link past-work-group-btn" data-open-group="${esc(e.group.id)}">${esc(e.group.name)}</button>${emptyTag}</li>`;
        }
        const cs = e.study;
        const hiddenTag = cs.visible === false ? ' <span class="admin-hidden-tag">hidden</span>' : "";
        return `<li data-slug="${esc(cs.slug)}"><a class="text-link" href="case-studies/view.html?slug=${encodeURIComponent(cs.slug)}">${esc(cs.navTitle || cs.title)}</a>${hiddenTag}</li>`;
      })
      .join("");

    listEl.querySelectorAll("[data-open-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = groups.find((x) => x.id === btn.getAttribute("data-open-group"));
        const entry = groupEntries.find((x) => x.group.id === g.id);
        if (g && entry) openGroupPopover(g, entry.studies);
      });
    });

    const connectEl = root.querySelector("[data-connect-list]");
    connectEl.innerHTML = (site.connect || [])
      .map(
        (c) =>
          `<li><a class="text-link" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label)}</a></li>`
      )
      .join("");

    return site;
  }

  // ---------- group popover (fanned, animated card deck) ----------
  const ADVANCE_MS = 460;

  function openGroupPopover(group, studies) {
    if (!studies.length) return;
    let overlay = document.querySelector("[data-group-popover]");
    if (!overlay) return; // markup not present on this page
    const stackEl = overlay.querySelector("[data-group-popover-stack]");
    const labelEl = overlay.querySelector("[data-group-popover-label]");
    const countEl = overlay.querySelector("[data-group-popover-count]");
    const titleEl = overlay.querySelector("[data-group-popover-title]");
    const ctaEl = overlay.querySelector("[data-group-popover-cta]");

    labelEl.textContent = `Cases from ${group.name}`.toUpperCase();

    const total = studies.length;
    let current = 0;
    let busy = false;

    // A fanned deck of up to 3 real cards — left = previous, center =
    // current, right = next — not just decorative depth. With exactly 2
    // studies there's no distinct "next", so only left + center render;
    // with 1, only center.
    const roles = total >= 3 ? ["left", "center", "right"] : total === 2 ? ["left", "center"] : ["center"];
    stackEl.innerHTML = "";
    const layers = roles.map((role) => {
      const el = document.createElement("div");
      el.className = "group-popover-layer";
      el.dataset.role = role;
      el.innerHTML = '<img alt="" />';
      stackEl.appendChild(el);
      return el;
    });

    function fillLayer(el, studyIndex) {
      const cs = studies[((studyIndex % total) + total) % total];
      const src = firstThumbSrc(cs);
      const img = el.querySelector("img");
      if (src) {
        img.src = src;
        img.alt = cs.title || "";
        img.style.display = "";
      } else {
        img.style.display = "none";
      }
    }

    const textEl = overlay.querySelector("[data-group-popover-text]");

    function renderText() {
      const cs = studies[current];
      countEl.textContent = total > 1 ? `${current + 1}/${total}` : "";
      titleEl.textContent = cs.navTitle || cs.title || "";
      ctaEl.href = `case-studies/view.html?slug=${encodeURIComponent(cs.slug)}`;
    }

    function layout() {
      layers.forEach((el) => {
        const offset = el.dataset.role === "center" ? 0 : el.dataset.role === "right" ? 1 : total === 2 ? 1 : -1;
        fillLayer(el, current + offset);
      });
      renderText();
    }

    layout();

    function fadeText() {
      if (!textEl) {
        renderText();
        return;
      }
      textEl.classList.add("is-fading");
      setTimeout(renderText, ADVANCE_MS * 0.4);
      setTimeout(() => textEl.classList.remove("is-fading"), ADVANCE_MS * 0.55);
    }

    // A modern "swipe + settle" transition. With 2 cards, the two visible
    // layers simply swap slots. With 3+, the old left card swipes off, the
    // center and right cards promote one slot to the left, and the
    // recycled card grows in as the new right card from a small, faded
    // starting point off to the side.
    function advance() {
      if (busy || total < 2) return;
      busy = true;
      current = (current + 1) % total;

      if (total === 2) {
        const leftEl = layers.find((l) => l.dataset.role === "left");
        const centerEl = layers.find((l) => l.dataset.role === "center");
        leftEl.dataset.role = "center";
        centerEl.dataset.role = "left";
        fadeText();
        setTimeout(() => {
          busy = false;
        }, ADVANCE_MS);
        return;
      }

      const leaving = layers.find((l) => l.dataset.role === "left");
      const wasCenter = layers.find((l) => l.dataset.role === "center");
      const wasRight = layers.find((l) => l.dataset.role === "right");
      leaving.classList.add("is-leaving");
      wasCenter.dataset.role = "left";
      wasRight.dataset.role = "center";
      fadeText();
      setTimeout(() => {
        leaving.classList.remove("is-leaving");
        leaving.classList.add("no-anim", "pre-enter-right");
        fillLayer(leaving, current + 1);
        // eslint-disable-next-line no-unused-expressions
        leaving.offsetHeight; // force reflow so the grow-in below actually transitions
        leaving.dataset.role = "right";
        leaving.classList.remove("no-anim", "pre-enter-right");
        busy = false;
      }, ADVANCE_MS);
    }

    stackEl.onclick = advance;
    overlay.classList.add("is-open");
    document.body.classList.add("admin-modal-open");
  }

  function closeGroupPopover() {
    const overlay = document.querySelector("[data-group-popover]");
    if (overlay) overlay.classList.remove("is-open");
    if (!document.querySelector(".admin-modal-overlay")) {
      document.body.classList.remove("admin-modal-open");
    }
  }

  function wireGroupPopover() {
    const overlay = document.querySelector("[data-group-popover]");
    if (!overlay) return;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeGroupPopover();
    });
    overlay.querySelectorAll("[data-group-popover-close]").forEach((btn) =>
      btn.addEventListener("click", closeGroupPopover)
    );
  }
  document.addEventListener("DOMContentLoaded", wireGroupPopover);

  // ---------- case-study page ----------
  function getSlugFromUrl() {
    const params = new URLSearchParams(location.search);
    return params.get("slug");
  }

  async function renderCaseStudy() {
    const root = document.querySelector("[data-case-root]");
    if (!root) return null;
    const site = await loadSite();
    const slug = getSlugFromUrl();
    const cs = (site.caseStudies || []).find((c) => c.slug === slug);

    if (!cs) {
      root.innerHTML = '<p class="case-not-found">Work not found.</p>';
      document.title = "Not found — Mahesh Marath";
      return { site, caseStudy: null };
    }

    document.title = `${cs.title} — Mahesh Marath`;
    root.querySelector("[data-cs-title]").textContent = cs.title;
    const subEl = root.querySelector("[data-cs-subtitle]");
    if (cs.subtitle) {
      subEl.innerHTML = linkify(cs.subtitle);
      subEl.hidden = false;
    } else {
      subEl.hidden = true;
    }
    root.querySelector("[data-cs-body]").innerHTML = renderBlocksHTML(cs.blocks, "");

    return { site, caseStudy: cs };
  }

  window.MKM = window.MKM || {};
  window.MKM.loadSite = loadSite;
  window.MKM.renderHome = renderHome;
  window.MKM.renderCaseStudy = renderCaseStudy;
  window.MKM.renderBlocksHTML = renderBlocksHTML;
  window.MKM.getSlugFromUrl = getSlugFromUrl;
  window.MKM.esc = esc;
})();
