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
        out.push(`<section class="case-section"><h2>${esc(b.text)}</h2>`);
        inSection = true;
      } else if (b.type === "subheading") {
        openSection();
        out.push(`<h3>${esc(b.text)}</h3>`);
      } else if (b.type === "paragraph") {
        openSection();
        out.push(`<p>${esc(b.text)}</p>`);
      } else if (b.type === "list") {
        openSection();
        out.push("<ul>" + (b.items || []).map((i) => `<li>${esc(i)}</li>`).join("") + "</ul>");
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

  // ---------- home page ----------
  async function renderHome() {
    const root = document.querySelector("[data-home-root]");
    if (!root) return null;
    const site = await loadSite();
    const about = site.about || {};
    root.querySelector("[data-name]").textContent = about.name || "";
    root.querySelector("[data-role]").textContent = about.role || "";
    const bioEl = root.querySelector("[data-bio]");
    bioEl.innerHTML = (about.bio || []).map((p) => `<p>${esc(p)}</p>`).join("");

    const isAdmin = document.documentElement.classList.contains("admin-mode");
    const studies = (site.caseStudies || [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((cs) => isAdmin || cs.visible !== false);

    const listEl = root.querySelector("[data-case-study-list]");
    listEl.innerHTML = studies
      .map((cs) => {
        const hiddenTag = cs.visible === false ? ' <span class="admin-hidden-tag">hidden</span>' : "";
        return `<li data-slug="${esc(cs.slug)}"><a class="text-link" href="case-studies/view.html?slug=${encodeURIComponent(cs.slug)}">${esc(cs.navTitle || cs.title)}</a>${hiddenTag}</li>`;
      })
      .join("");

    const connectEl = root.querySelector("[data-connect-list]");
    connectEl.innerHTML = (site.connect || [])
      .map(
        (c) =>
          `<li><a class="text-link" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label)}</a></li>`
      )
      .join("");

    return site;
  }

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
      root.innerHTML = '<p class="case-not-found">Case study not found.</p>';
      document.title = "Not found — Mahesh Marath";
      return { site, caseStudy: null };
    }

    document.title = `${cs.title} — Mahesh Marath`;
    root.querySelector("[data-cs-title]").textContent = cs.title;
    const subEl = root.querySelector("[data-cs-subtitle]");
    if (cs.subtitle) {
      subEl.textContent = cs.subtitle;
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
