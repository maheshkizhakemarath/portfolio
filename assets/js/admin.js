// Admin system: long-press login trigger, GitHub-backed persistence, and
// the editing UI (profile, case-study list, per-case-study block editor).
//
// Auth model: there is no separate "admin password" — the credential *is*
// a GitHub Personal Access Token scoped to this repo (Contents: read/write).
// If you have a token that can write to the repo, you are the admin. The
// token lives in this browser's localStorage only; it is never sent
// anywhere except api.github.com.
(function () {
  const GH_OWNER = "maheshkizhakemarath";
  const GH_REPO = "portfolio";
  const TOKEN_KEY = "mkm-admin-token";
  const BRANCH_KEY = "mkm-admin-branch";
  const LONG_PRESS_MS = 3000;

  const state = {
    token: null,
    branch: null,
    site: null, // populated once data has loaded on this page
  };

  try {
    state.token = localStorage.getItem(TOKEN_KEY) || null;
    state.branch = localStorage.getItem(BRANCH_KEY) || null;
  } catch (e) {}

  // ---------------------------------------------------------------------
  // GitHub API helpers
  // ---------------------------------------------------------------------
  function ghHeaders() {
    return {
      Authorization: "Bearer " + state.token,
      Accept: "application/vnd.github+json",
    };
  }

  async function ghRepoInfo() {
    const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`, {
      headers: ghHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? "That token was rejected (invalid or lacks access)."
          : `GitHub error (${res.status}) reading the repo.`
      );
    }
    return res.json();
  }

  async function ghGetFile(path) {
    // cache: "no-store" matters here — without it the browser can serve a
    // stale cached response for this exact URL, handing back an outdated
    // sha. GitHub then rejects the save that sha is used for with a 409
    // ("does not match"), even though nothing actually conflicted.
    const res = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${encodeURIComponent(state.branch || "main")}`,
      { headers: ghHeaders(), cache: "no-store" }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub error (${res.status}) reading ${path}.`);
    return res.json();
  }

  async function ghPutFile(path, base64Content, message) {
    async function attempt() {
      const existing = await ghGetFile(path).catch(() => null);
      const body = {
        message,
        content: base64Content,
        branch: state.branch || "main",
      };
      if (existing && existing.sha) body.sha = existing.sha;
      return fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
        method: "PUT",
        headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
        body: JSON.stringify(body),
      });
    }

    let res = await attempt();
    if (res.status === 409) {
      // Stale sha (usually a caching artifact, occasionally a genuine
      // concurrent edit) — re-read the real current version and retry once
      // before giving up.
      res = await attempt();
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const suffix =
        res.status === 409
          ? " Someone or something else changed this file — reload the page to get the latest version, then try your edit again."
          : "";
      throw new Error(
        `GitHub error (${res.status}) saving ${path}: ${detail.message || "unknown error"}.${suffix}`
      );
    }
    return res.json();
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result; // data:<mime>;base64,AAAA
        const comma = result.indexOf(",");
        resolve(result.slice(comma + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function saveSiteJson(site, message) {
    const dataUrl = document.body.dataset.dataUrl || "data/site.json";
    // Resolve the repo-relative path regardless of which page we're on
    // (index.html uses "data/site.json", case study pages use
    // "../data/site.json").
    const path = dataUrl.replace(/^(\.\.\/)+/, "");
    const content = utf8ToBase64(JSON.stringify(site, null, 2));
    await ghPutFile(path, content, message || "Update site content");
  }

  // Build a link to a case study's view page that works whether we're
  // currently at the site root (index.html) or already inside
  // case-studies/ (view.html) — same trick as saveSiteJson's path fix.
  function csUrl(slug, extraQuery) {
    const dataUrl = document.body.dataset.dataUrl || "data/site.json";
    const insideCaseStudies = dataUrl.startsWith("../");
    const base = insideCaseStudies ? "view.html" : "case-studies/view.html";
    return `${base}?slug=${encodeURIComponent(slug)}${extraQuery || ""}`;
  }

  function slugify(title) {
    let base = String(title)
      .toLowerCase()
      .trim()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!base) base = "case-study";
    return base;
  }

  function uniqueSlug(base, existingSlugs) {
    let slug = base;
    let n = 2;
    while (existingSlugs.includes(slug)) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  // ---------------------------------------------------------------------
  // Inline "+ Link" affordance for text fields.
  // Links are written as markdown-style "[label](https://...)" — render.js
  // (linkify()) turns that into a real <a> everywhere this text is shown.
  // Any input/textarea can get one: render a labelWithLink() row instead of
  // a plain <label>, then call wireLinkButtons(container) once after the
  // markup is in the DOM.
  // ---------------------------------------------------------------------
  function labelWithLink(text, targetSelector) {
    return `<label class="admin-label admin-label-row"><span>${text}</span><button type="button" class="admin-link-btn" data-insert-link="${targetSelector}">+ Link</button></label>`;
  }

  function insertLinkSnippet(field) {
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    const selected = field.value.slice(start, end);
    const label = window.prompt("Link text:", selected || "");
    if (label === null) return;
    const url = window.prompt("URL (https://…):", "https://");
    if (url === null) return;
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const snippet = `[${label.trim() || trimmedUrl}](${trimmedUrl})`;
    field.value = field.value.slice(0, start) + snippet + field.value.slice(end);
    field.focus();
    const pos = start + snippet.length;
    field.setSelectionRange(pos, pos);
  }

  // Wires every "+ Link" button within `container`. `data-insert-link` is a
  // CSS selector scoped to the SAME container (works when the field is
  // unique, e.g. the profile modal); pass `scopeSelector` to instead scope
  // each button to its closest matching ancestor (needed in the block
  // editor, where every block repeats the same [data-b-text] attribute).
  function wireLinkButtons(container, scopeSelector) {
    container.querySelectorAll("[data-insert-link]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetSelector = btn.getAttribute("data-insert-link");
        // Fields that repeat per-block (every block has a [data-b-text])
        // need scoping to their own card; a one-off field (like Subtitle,
        // which isn't inside any block card) falls back to the container.
        const scope = (scopeSelector && btn.closest(scopeSelector)) || container;
        insertLinkSnippet(scope.querySelector(targetSelector));
      });
    });
  }

  // ---------------------------------------------------------------------
  // Small UI helpers (toast, modal shell)
  // ---------------------------------------------------------------------
  function toast(message, isError) {
    let el = document.querySelector(".admin-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "admin-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle("admin-toast--error", !!isError);
    el.classList.add("is-visible");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("is-visible"), 3200);
  }

  function openModal(innerHTML, opts) {
    opts = opts || {};
    const overlay = document.createElement("div");
    overlay.className = "admin-modal-overlay";
    overlay.innerHTML = `<div class="admin-modal ${opts.wide ? "admin-modal--wide" : ""}">${innerHTML}</div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("admin-modal-open");
    function close() {
      overlay.remove();
      if (!document.querySelector(".admin-modal-overlay")) {
        document.body.classList.remove("admin-modal-open");
      }
      if (opts.onClose) opts.onClose();
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && !opts.persistent) close();
    });
    overlay.querySelectorAll("[data-modal-close]").forEach((btn) =>
      btn.addEventListener("click", close)
    );
    return { overlay, close };
  }

  // ---------------------------------------------------------------------
  // Auth: long-press trigger + login modal
  // ---------------------------------------------------------------------
  function isAdmin() {
    return !!state.token;
  }

  function enterAdminMode() {
    document.documentElement.classList.add("admin-mode");
    renderAdminBar();
  }

  function exitAdminMode() {
    state.token = null;
    state.branch = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(BRANCH_KEY);
    } catch (e) {}
    document.documentElement.classList.remove("admin-mode");
    const bar = document.querySelector(".admin-bar");
    if (bar) bar.remove();
    toast("Logged out of admin.");
  }

  function openLoginModal() {
    const { close } = openModal(
      `
      <h2>Admin login</h2>
      <p class="admin-modal-hint">
        Type your personal token to access, It's stored only in this browser.
      </p>
      <form data-login-form>
        <input type="password" name="token" placeholder="ghp_… or github_pat_…" autocomplete="off" class="admin-input" required />
        <p class="admin-form-error" data-login-error></p>
        <div class="admin-modal-actions">
          <button type="button" class="admin-btn admin-btn--ghost" data-modal-close>Cancel</button>
          <button type="submit" class="admin-btn">Connect</button>
        </div>
      </form>
    `,
      {}
    );
    const form = document.querySelector("[data-login-form]");
    const errorEl = form.querySelector("[data-login-error]");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = form.token.value.trim();
      if (!token) return;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Connecting…";
      state.token = token;
      try {
        const repo = await ghRepoInfo();
        state.branch = repo.default_branch || "main";
        try {
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(BRANCH_KEY, state.branch);
        } catch (err) {}
        close();
        enterAdminMode();
        toast("Logged in as admin.");
        if (window.MKM.onAdminEnabled) window.MKM.onAdminEnabled();
      } catch (err) {
        state.token = null;
        errorEl.textContent = err.message || "Login failed.";
        btn.disabled = false;
        btn.textContent = "Connect";
      }
    });
  }

  function wireLongPress() {
    document.querySelectorAll("[data-admin-trigger]").forEach((el) => {
      let timer = null;
      const start = () => {
        if (isAdmin()) return;
        clearTimeout(timer); // defensive: never stack timers from a stray extra pointerdown
        el.classList.add("admin-pressing");
        timer = setTimeout(() => {
          el.classList.remove("admin-pressing");
          openLoginModal();
        }, LONG_PRESS_MS);
      };
      const cancel = () => {
        clearTimeout(timer);
        el.classList.remove("admin-pressing");
      };
      el.addEventListener("pointerdown", start);
      el.addEventListener("pointerup", cancel);
      el.addEventListener("pointerleave", cancel);
      el.addEventListener("pointercancel", cancel);
      el.style.userSelect = "none";
      el.style.webkitUserSelect = "none";
    });
  }

  // ---------------------------------------------------------------------
  // Floating admin bar
  // ---------------------------------------------------------------------
  function renderAdminBar() {
    if (document.querySelector(".admin-bar")) return;
    const bar = document.createElement("div");
    bar.className = "admin-bar";
    const onCaseStudyPage = !!document.querySelector("[data-case-root]");
    bar.innerHTML = `
      <span class="admin-bar-tag">Admin</span>
      ${
        onCaseStudyPage
          ? '<button type="button" class="admin-btn admin-btn--sm" data-admin-edit-study>Edit this work</button>'
          : '<button type="button" class="admin-btn admin-btn--sm" data-admin-edit-profile>Edit profile</button><button type="button" class="admin-btn admin-btn--sm" data-admin-manage-studies>Manage Past Work</button>'
      }
      <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" data-admin-logout>Log out</button>
    `;
    document.body.appendChild(bar);

    bar.querySelector("[data-admin-logout]").addEventListener("click", exitAdminMode);
    const editProfileBtn = bar.querySelector("[data-admin-edit-profile]");
    if (editProfileBtn) editProfileBtn.addEventListener("click", () => openProfileEditor());
    const manageBtn = bar.querySelector("[data-admin-manage-studies]");
    if (manageBtn) manageBtn.addEventListener("click", () => openManageStudies());
    const editStudyBtn = bar.querySelector("[data-admin-edit-study]");
    if (editStudyBtn)
      editStudyBtn.addEventListener("click", () => {
        const slug = window.MKM.getSlugFromUrl();
        const cs = state.site.caseStudies.find((c) => c.slug === slug);
        if (cs) openCaseStudyEditor(cs);
      });
  }

  // ---------------------------------------------------------------------
  // Profile editor (About + Connect)
  // ---------------------------------------------------------------------
  function openProfileEditor() {
    const site = state.site;
    const about = site.about || {};
    const { overlay, close } = openModal(
      `
      <h2>Edit profile</h2>
      <label class="admin-label">Name</label>
      <input class="admin-input" type="text" data-f-name value="${window.MKM.esc(about.name || "")}" />
      ${labelWithLink("Role", "[data-f-role]")}
      <input class="admin-input" type="text" data-f-role value="${window.MKM.esc(about.role || "")}" />
      ${labelWithLink("About (one paragraph per line)", "[data-f-bio]")}
      <textarea class="admin-textarea" rows="4" data-f-bio>${window.MKM.esc((about.bio || []).join("\n"))}</textarea>
      <label class="admin-label">Connect links (one per line, "Label | URL")</label>
      <textarea class="admin-textarea" rows="3" data-f-connect>${window.MKM.esc(
        (site.connect || []).map((c) => `${c.label} | ${c.url}`).join("\n")
      )}</textarea>
      <p class="admin-modal-hint">Turn any text into a link by selecting it (or just placing your cursor) and pressing the "+ Link" button next to a field.</p>
      <p class="admin-form-error" data-profile-error></p>
      <div class="admin-modal-actions">
        <button type="button" class="admin-btn admin-btn--ghost" data-modal-close>Cancel</button>
        <button type="button" class="admin-btn" data-profile-save>Save</button>
      </div>
    `,
      {}
    );
    wireLinkButtons(overlay);
    document.querySelector("[data-profile-save]").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errorEl = document.querySelector("[data-profile-error]");
      const name = document.querySelector("[data-f-name]").value.trim();
      const role = document.querySelector("[data-f-role]").value.trim();
      const bio = document
        .querySelector("[data-f-bio]")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const connect = document
        .querySelector("[data-f-connect]")
        .value.split("\n")
        .map((line) => {
          const [label, ...rest] = line.split("|");
          return { label: (label || "").trim(), url: rest.join("|").trim() };
        })
        .filter((c) => c.label && c.url);

      site.about = { name, role, bio };
      site.connect = connect;
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        await saveSiteJson(site, "Admin: update profile");
        close();
        toast("Profile saved.");
        if (window.MKM.renderHome && document.querySelector("[data-home-root]")) {
          window.MKM.renderHome();
        }
      } catch (err) {
        errorEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = "Save";
      }
    });
  }

  // ---------------------------------------------------------------------
  // Manage case studies: groups (create/rename/delete/reorder) and, within
  // each group or standalone, the same per-study controls as before
  // (visibility, password, add, delete) plus a "Group" selector.
  //
  // Ordering model: every group and every *ungrouped* case study shares one
  // "top-level" order space (site.groups[].order / cs.order). A case study
  // that belongs to a group instead uses cs.order for its position *within*
  // that group. Moving a study between groups just re-appends it at the
  // end of its new scope.
  // ---------------------------------------------------------------------
  function openManageStudies() {
    const site = state.site;
    if (!site.groups) site.groups = [];

    function topLevelEntries() {
      const groupEntries = site.groups
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((g) => ({ type: "group", ref: g }));
      const studyEntries = site.caseStudies
        .filter((cs) => !cs.group)
        .map((cs) => ({ type: "study", ref: cs }));
      return groupEntries.concat(studyEntries).sort((a, b) => (a.ref.order ?? 0) - (b.ref.order ?? 0));
    }

    function groupMembers(groupId) {
      return site.caseStudies
        .filter((cs) => cs.group === groupId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    function groupOptionsHTML(selectedId) {
      return (
        `<option value="">— Ungrouped —</option>` +
        site.groups
          .map(
            (g) =>
              `<option value="${window.MKM.esc(g.id)}" ${g.id === (selectedId || "") ? "selected" : ""}>${window.MKM.esc(g.name)}</option>`
          )
          .join("")
      );
    }

    function studyRowHTML(cs, i, total) {
      return `
        <div class="admin-study-card" data-row data-entry-type="study" data-slug="${window.MKM.esc(cs.slug)}">
          <div class="admin-study-card-title">
            <span class="admin-reorder-controls">
              <button type="button" class="admin-icon-btn" data-move="-1" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
              <button type="button" class="admin-icon-btn" data-move="1" title="Move down" ${i === total - 1 ? "disabled" : ""}>↓</button>
            </span>
            ${window.MKM.esc(cs.title)}
          </div>
          <div class="admin-study-card-fields">
            <label class="admin-study-field">
              <span>Visible</span>
              <label class="admin-switch">
                <input type="checkbox" data-f-visible ${cs.visible !== false ? "checked" : ""} />
                <span></span>
              </label>
            </label>
            <label class="admin-study-field admin-study-field--grow">
              <span>Password</span>
              <input class="admin-input admin-input--sm" type="text" data-f-password value="${window.MKM.esc(cs.password || "")}" placeholder="(none)" />
            </label>
            <label class="admin-study-field">
              <span>Group</span>
              <select class="admin-input admin-input--sm" data-f-group>${groupOptionsHTML(cs.group)}</select>
            </label>
          </div>
          <div class="admin-row-actions">
            <a class="admin-link" href="${csUrl(cs.slug)}" target="_blank">View</a>
            <button type="button" class="admin-btn admin-btn--sm" data-open-editor="${window.MKM.esc(cs.slug)}">Edit content</button>
            <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-delete="${window.MKM.esc(cs.slug)}">Delete</button>
          </div>
        </div>`;
    }

    function groupCardHTML(g, i, total) {
      const members = groupMembers(g.id);
      return `
        <div class="admin-group-card" data-row data-entry-type="group" data-group-id="${window.MKM.esc(g.id)}">
          <div class="admin-study-card-title">
            <span class="admin-reorder-controls">
              <button type="button" class="admin-icon-btn" data-move="-1" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
              <button type="button" class="admin-icon-btn" data-move="1" title="Move down" ${i === total - 1 ? "disabled" : ""}>↓</button>
            </span>
            <input class="admin-input admin-input--sm" type="text" data-group-name value="${window.MKM.esc(g.name)}" />
            <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-delete-group="${window.MKM.esc(g.id)}">Delete group</button>
          </div>
          <div class="admin-group-members" data-group-members>
            ${
              members.length
                ? members.map((cs, j) => studyRowHTML(cs, j, members.length)).join("")
                : '<p class="admin-modal-hint">No case studies in this group yet — use the Group dropdown on a study below to add one.</p>'
            }
          </div>
        </div>`;
    }

    const { overlay, close } = openModal(
      `
      <h2>Manage Past Work</h2>
      <p class="admin-modal-hint">Use ↑ / ↓ to reorder groups and standalone work on the home page, and within a group. Give a case study a Group to move it into that group's popover.</p>
      <div class="admin-study-list" data-rows></div>
      <div class="admin-new-study">
        <input class="admin-input" type="text" placeholder="New group name…" data-new-group-name />
        <button type="button" class="admin-btn admin-btn--ghost" data-new-group>+ New group</button>
      </div>
      <div class="admin-new-study">
        <input class="admin-input" type="text" placeholder="New work title…" data-new-title />
        <button type="button" class="admin-btn" data-new-study>+ New work</button>
      </div>
      <p class="admin-form-error" data-manage-error></p>
      <div class="admin-modal-actions">
        <button type="button" class="admin-btn admin-btn--ghost" data-modal-close>Close</button>
        <button type="button" class="admin-btn" data-manage-save>Save changes</button>
      </div>
    `,
      { wide: true }
    );

    const rowsEl = overlay.querySelector("[data-rows]");

    // Read whatever the admin has typed/toggled back into the underlying
    // objects, so re-rendering after a move/delete/assign doesn't discard
    // in-progress (unsaved) edits elsewhere in the list.
    function syncFieldsToModel() {
      rowsEl.querySelectorAll("[data-entry-type='study']").forEach((row) => {
        const slug = row.getAttribute("data-slug");
        const cs = site.caseStudies.find((c) => c.slug === slug);
        if (!cs) return;
        cs.visible = row.querySelector("[data-f-visible]").checked;
        cs.password = row.querySelector("[data-f-password]").value.trim();
      });
      rowsEl.querySelectorAll("[data-entry-type='group']").forEach((row) => {
        const g = site.groups.find((x) => x.id === row.getAttribute("data-group-id"));
        if (!g) return;
        const name = row.querySelector("[data-group-name]").value.trim();
        if (name) g.name = name;
      });
    }

    function render() {
      const entries = topLevelEntries();
      rowsEl.innerHTML = entries
        .map((e, i) =>
          e.type === "group" ? groupCardHTML(e.ref, i, entries.length) : studyRowHTML(e.ref, i, entries.length)
        )
        .join("");
    }

    render();

    rowsEl.addEventListener("change", (e) => {
      const sel = e.target.closest("[data-f-group]");
      if (!sel) return;
      syncFieldsToModel();
      const slug = sel.closest("[data-slug]").getAttribute("data-slug");
      const cs = site.caseStudies.find((c) => c.slug === slug);
      const newGroupId = sel.value || null;
      if (cs.group === newGroupId) return;
      cs.group = newGroupId;
      if (newGroupId) {
        const members = groupMembers(newGroupId);
        cs.order = members.length ? Math.max(...members.map((m) => m.order ?? 0)) + 1 : 0;
      } else {
        const top = topLevelEntries();
        cs.order = top.length ? Math.max(...top.map((t) => t.ref.order ?? 0)) + 1 : 0;
      }
      render();
    });

    rowsEl.addEventListener("click", (e) => {
      const moveBtn = e.target.closest("[data-move]");
      if (moveBtn) {
        syncFieldsToModel();
        const dir = Number(moveBtn.getAttribute("data-move"));
        const withinGroupEl = moveBtn.closest("[data-group-members]");
        if (withinGroupEl) {
          const gid = moveBtn.closest("[data-entry-type='group']").getAttribute("data-group-id");
          const members = groupMembers(gid);
          const slug = moveBtn.closest("[data-slug]").getAttribute("data-slug");
          const i = members.findIndex((c) => c.slug === slug);
          const j = i + dir;
          if (j < 0 || j >= members.length) return;
          const tmp = members[i];
          members[i] = members[j];
          members[j] = tmp;
          members.forEach((c, k) => (c.order = k));
        } else {
          const entries = topLevelEntries();
          const row = moveBtn.closest("[data-row]");
          const ref =
            row.getAttribute("data-entry-type") === "group"
              ? site.groups.find((g) => g.id === row.getAttribute("data-group-id"))
              : site.caseStudies.find((c) => c.slug === row.getAttribute("data-slug"));
          const i = entries.findIndex((en) => en.ref === ref);
          const j = i + dir;
          if (j < 0 || j >= entries.length) return;
          const tmp = entries[i];
          entries[i] = entries[j];
          entries[j] = tmp;
          entries.forEach((en, k) => (en.ref.order = k));
        }
        render();
        return;
      }

      const delGroupBtn = e.target.closest("[data-delete-group]");
      if (delGroupBtn) {
        syncFieldsToModel();
        const gid = delGroupBtn.getAttribute("data-delete-group");
        const g = site.groups.find((x) => x.id === gid);
        if (!g) return;
        const members = groupMembers(gid);
        if (
          !confirm(
            `Delete "${g.name}"? Its ${members.length} case ${members.length === 1 ? "study" : "studies"} will become standalone (not deleted) — they'll still appear individually on the home page.`
          )
        )
          return;
        site.groups = site.groups.filter((x) => x.id !== gid);
        const remainingTop = topLevelEntries().map((en) => en.ref);
        members.forEach((cs) => (cs.group = null));
        const combined = remainingTop.concat(members);
        combined.forEach((ref, i) => (ref.order = i));
        render();
        return;
      }

      const delBtn = e.target.closest("[data-delete]");
      if (delBtn) {
        const slug = delBtn.getAttribute("data-delete");
        const cs = site.caseStudies.find((c) => c.slug === slug);
        if (!cs) return;
        if (!confirm(`Delete "${cs.title}"? This removes it from site.json (images stay in the repo). This can't be undone here.`)) return;
        syncFieldsToModel();
        site.caseStudies = site.caseStudies.filter((c) => c.slug !== slug);
        render();
        return;
      }

      const openBtn = e.target.closest("[data-open-editor]");
      if (openBtn) {
        syncFieldsToModel();
        location.href = csUrl(openBtn.getAttribute("data-open-editor"), "&edit=1");
      }
    });

    overlay.querySelector("[data-new-group]").addEventListener("click", () => {
      syncFieldsToModel();
      const input = overlay.querySelector("[data-new-group-name]");
      const name = input.value.trim();
      if (!name) return;
      const id = uniqueSlug(
        slugify(name),
        site.groups.map((g) => g.id)
      );
      const top = topLevelEntries();
      site.groups.push({ id, name, order: top.length ? Math.max(...top.map((t) => t.ref.order ?? 0)) + 1 : 0 });
      input.value = "";
      render();
    });

    overlay.querySelector("[data-new-study]").addEventListener("click", () => {
      syncFieldsToModel();
      const input = overlay.querySelector("[data-new-title]");
      const title = input.value.trim();
      if (!title) return;
      const slug = uniqueSlug(
        slugify(title),
        site.caseStudies.map((c) => c.slug)
      );
      const top = topLevelEntries();
      const cs = {
        slug,
        navTitle: title,
        title,
        subtitle: "",
        visible: false,
        password: "public",
        group: null,
        coverImage: null,
        order: top.length ? Math.max(...top.map((t) => t.ref.order ?? 0)) + 1 : 0,
        blocks: [],
      };
      site.caseStudies.push(cs);
      input.value = "";
      location.href = csUrl(slug, "&edit=1");
    });

    overlay.querySelector("[data-manage-save]").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errorEl = overlay.querySelector("[data-manage-error]");
      syncFieldsToModel();
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        await saveSiteJson(site, "Admin: update past work list");
        toast("Past work list saved.");
        close();
        if (window.MKM.renderHome && document.querySelector("[data-home-root]")) {
          window.MKM.renderHome();
        }
      } catch (err) {
        errorEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = "Save changes";
      }
    });
  }

  // ---------------------------------------------------------------------
  // Case study content editor (blocks)
  // ---------------------------------------------------------------------
  function blockEditorRowHTML(block, i) {
    const t = block.type;
    if (t === "heading" || t === "subheading") {
      return `
        <div class="admin-block" data-block-index="${i}" data-block-type="${t}">
          <div class="admin-block-head">
            <span class="admin-block-type">${t === "heading" ? "Section heading" : "Sub-heading"}</span>
            <span class="admin-block-head-actions">
              <button type="button" class="admin-link-btn" data-insert-link="[data-b-text]">+ Link</button>
              ${blockControls(i)}
            </span>
          </div>
          <input class="admin-input" type="text" data-b-text value="${window.MKM.esc(block.text || "")}" />
        </div>`;
    }
    if (t === "paragraph") {
      return `
        <div class="admin-block" data-block-index="${i}" data-block-type="${t}">
          <div class="admin-block-head">
            <span class="admin-block-type">Paragraph</span>
            <span class="admin-block-head-actions">
              <button type="button" class="admin-link-btn" data-insert-link="[data-b-text]">+ Link</button>
              ${blockControls(i)}
            </span>
          </div>
          <textarea class="admin-textarea" rows="3" data-b-text>${window.MKM.esc(block.text || "")}</textarea>
        </div>`;
    }
    if (t === "list") {
      return `
        <div class="admin-block" data-block-index="${i}" data-block-type="${t}">
          <div class="admin-block-head">
            <span class="admin-block-type">List (one item per line)</span>
            <span class="admin-block-head-actions">
              <button type="button" class="admin-link-btn" data-insert-link="[data-b-items]">+ Link</button>
              ${blockControls(i)}
            </span>
          </div>
          <textarea class="admin-textarea" rows="4" data-b-items>${window.MKM.esc((block.items || []).join("\n"))}</textarea>
        </div>`;
    }
    if (t === "image-row") {
      const imgs = block.images || [];
      return `
        <div class="admin-block" data-block-index="${i}" data-block-type="${t}">
          <div class="admin-block-head">
            <span class="admin-block-type">Image${imgs.length > 1 ? "s" : ""}</span>
            ${blockControls(i)}
          </div>
          <div class="admin-image-row" data-image-list>
            ${imgs
              .map(
                (img, j) => `
              <div class="admin-image-item" data-image-index="${j}">
                <img src="${window.MKM.esc(resolveImgSrc(img.src))}" alt="" />
                <input class="admin-input admin-input--sm" type="text" placeholder="Alt text" data-image-alt value="${window.MKM.esc(img.alt || "")}" />
                <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-remove-image>Remove</button>
              </div>`
              )
              .join("")}
          </div>
          <label class="admin-btn admin-btn--sm admin-btn--ghost admin-file-btn">
            + Add image
            <input type="file" accept="image/*" multiple data-add-image hidden />
          </label>
        </div>`;
    }
    return "";
  }

  function blockControls(i) {
    return `
      <span class="admin-block-controls">
        <button type="button" class="admin-icon-btn" data-move="-1" title="Move up">↑</button>
        <button type="button" class="admin-icon-btn" data-move="1" title="Move down">↓</button>
        <button type="button" class="admin-icon-btn admin-icon-btn--danger" data-remove-block title="Delete">✕</button>
      </span>`;
  }

  function resolveImgSrc(src) {
    if (!src) return "";
    if (src.startsWith("http") || src.startsWith("../") || src.startsWith("blob:")) return src;
    return "../assets/img/case-studies/" + src.replace(/^.*case-studies\//, "");
  }

  function openCaseStudyEditor(cs) {
    // Work on a deep clone so Cancel doesn't mutate state.site.
    const draft = JSON.parse(JSON.stringify(cs));
    const pendingUploads = new Map(); // blockIndex -> [{imageIndex, file}]
    let pendingCoverUpload = null; // File, if a new cover image was picked

    function render() {
      body.innerHTML = `
        <h2>Edit work</h2>
        <label class="admin-label">Title</label>
        <input class="admin-input" type="text" data-f-title value="${window.MKM.esc(draft.title || "")}" />
        ${labelWithLink("Subtitle", "[data-f-subtitle]")}
        <input class="admin-input" type="text" data-f-subtitle value="${window.MKM.esc(draft.subtitle || "")}" />
        <label class="admin-label">Home-page link text</label>
        <input class="admin-input" type="text" data-f-navtitle value="${window.MKM.esc(draft.navTitle || draft.title || "")}" />

        <label class="admin-label">Cover image</label>
        <div class="admin-cover-row" data-cover-row>
          ${
            draft.coverImage
              ? `<div class="admin-image-item" data-cover-preview>
                   <img src="${window.MKM.esc(resolveImgSrc(draft.coverImage))}" alt="" />
                   <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-remove-cover>Remove</button>
                 </div>`
              : ""
          }
          <label class="admin-btn admin-btn--sm admin-btn--ghost admin-file-btn">
            ${draft.coverImage ? "Replace image" : "+ Add cover image"}
            <input type="file" accept="image/*" data-cover-file hidden />
          </label>
        </div>
        <p class="admin-modal-hint">Shown as the thumbnail when this work appears in a group's popover. If left empty, the first image in the content below is used instead.</p>

        <div class="admin-blocks" data-blocks>
          ${draft.blocks.map((b, i) => blockEditorRowHTML(b, i)).join("")}
        </div>

        <div class="admin-add-block-row">
          <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" data-add="heading">+ Heading</button>
          <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" data-add="subheading">+ Sub-heading</button>
          <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" data-add="paragraph">+ Paragraph</button>
          <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" data-add="list">+ List</button>
          <button type="button" class="admin-btn admin-btn--sm admin-btn--ghost" data-add="image-row">+ Images</button>
        </div>

        <p class="admin-form-error" data-editor-error></p>
        <div class="admin-modal-actions">
          <button type="button" class="admin-btn admin-btn--ghost" data-modal-close>Cancel</button>
          <button type="button" class="admin-btn" data-editor-save>Save work</button>
        </div>
      `;
      wireCoverEvents();
      wireBlockEvents();
    }

    function wireCoverEvents() {
      const fileInput = body.querySelector("[data-cover-file]");
      if (fileInput) {
        fileInput.addEventListener("change", () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          draft.coverImage = URL.createObjectURL(file);
          pendingCoverUpload = file;
          render();
        });
      }
      const removeBtn = body.querySelector("[data-remove-cover]");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          draft.coverImage = null;
          pendingCoverUpload = null;
          render();
        });
      }
    }

    function syncTextFieldsToDraft() {
      draft.blocks.forEach((b, i) => {
        const el = body.querySelector(`[data-block-index="${i}"]`);
        if (!el) return;
        if (b.type === "heading" || b.type === "subheading" || b.type === "paragraph") {
          b.text = el.querySelector("[data-b-text]").value;
        } else if (b.type === "list") {
          b.items = el
            .querySelector("[data-b-items]")
            .value.split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      });
    }

    function wireBlockEvents() {
      body.querySelectorAll("[data-move]").forEach((btn) =>
        btn.addEventListener("click", () => {
          syncTextFieldsToDraft();
          const i = Number(btn.closest("[data-block-index]").dataset.blockIndex);
          const dir = Number(btn.getAttribute("data-move"));
          const j = i + dir;
          if (j < 0 || j >= draft.blocks.length) return;
          const tmp = draft.blocks[i];
          draft.blocks[i] = draft.blocks[j];
          draft.blocks[j] = tmp;
          render();
        })
      );
      body.querySelectorAll("[data-remove-block]").forEach((btn) =>
        btn.addEventListener("click", () => {
          syncTextFieldsToDraft();
          const i = Number(btn.closest("[data-block-index]").dataset.blockIndex);
          draft.blocks.splice(i, 1);
          pendingUploads.delete(i);
          render();
        })
      );
      body.querySelectorAll("[data-add]").forEach((btn) =>
        btn.addEventListener("click", () => {
          syncTextFieldsToDraft();
          const type = btn.getAttribute("data-add");
          const blank =
            type === "list"
              ? { type, items: [] }
              : type === "image-row"
              ? { type, images: [] }
              : { type, text: "" };
          draft.blocks.push(blank);
          render();
        })
      );
      body.querySelectorAll("[data-remove-image]").forEach((btn) =>
        btn.addEventListener("click", () => {
          syncTextFieldsToDraft();
          const blockEl = btn.closest("[data-block-index]");
          const i = Number(blockEl.dataset.blockIndex);
          const j = Number(btn.closest("[data-image-index]").dataset.imageIndex);
          draft.blocks[i].images.splice(j, 1);
          const q = pendingUploads.get(i);
          if (q) pendingUploads.set(i, q.filter((p) => p.imageIndex !== j));
          render();
        })
      );
      body.querySelectorAll("[data-add-image]").forEach((input) =>
        input.addEventListener("change", () => {
          syncTextFieldsToDraft();
          const blockEl = input.closest("[data-block-index]");
          const i = Number(blockEl.dataset.blockIndex);
          const files = Array.from(input.files || []);
          if (!draft.blocks[i].images) draft.blocks[i].images = [];
          files.forEach((file) => {
            const j = draft.blocks[i].images.length;
            draft.blocks[i].images.push({ src: URL.createObjectURL(file), alt: "", _pendingFile: file });
            if (!pendingUploads.has(i)) pendingUploads.set(i, []);
            pendingUploads.get(i).push({ imageIndex: j, file });
          });
          render();
        })
      );
      // Subtitle's button targets a single, unique field; each block's
      // button is scoped to its own block card (every block repeats the
      // same [data-b-text]/[data-b-items] attribute).
      wireLinkButtons(body, "[data-block-index]");
    }

    const { overlay, close } = openModal("", { wide: true, onClose: () => {} });
    const body = overlay.querySelector(".admin-modal");
    render();

    overlay.querySelector(".admin-modal").addEventListener("click", async (e) => {
      const saveBtn = e.target.closest("[data-editor-save]");
      if (!saveBtn) return;
      syncTextFieldsToDraft();
      draft.title = body.querySelector("[data-f-title]").value.trim();
      draft.subtitle = body.querySelector("[data-f-subtitle]").value.trim();
      draft.navTitle = body.querySelector("[data-f-navtitle]").value.trim() || draft.title;

      const errorEl = body.querySelector("[data-editor-error]");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        // Upload a newly-picked cover image first, if any.
        if (pendingCoverUpload) {
          const ext = (pendingCoverUpload.name.split(".").pop() || "jpg").toLowerCase();
          const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const filename = `cover-${stamp}.${ext}`;
          const path = `assets/img/case-studies/${draft.slug}/${filename}`;
          const base64 = await fileToBase64(pendingCoverUpload);
          await ghPutFile(path, base64, `Admin: set cover image for ${draft.slug}`);
          draft.coverImage = `../assets/img/case-studies/${draft.slug}/${filename}`;
          pendingCoverUpload = null;
        }

        // Upload any newly-added images first.
        for (const [blockIndex, uploads] of pendingUploads.entries()) {
          const block = draft.blocks[blockIndex];
          if (!block) continue;
          for (const { imageIndex, file } of uploads) {
            const img = block.images[imageIndex];
            if (!img || !img._pendingFile) continue;
            const ext = (file.name.split(".").pop() || "png").toLowerCase();
            const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const filename = `img-${stamp}.${ext}`;
            const path = `assets/img/case-studies/${draft.slug}/${filename}`;
            const base64 = await fileToBase64(file);
            await ghPutFile(path, base64, `Admin: add image to ${draft.slug}`);
            img.src = `../assets/img/case-studies/${draft.slug}/${filename}`;
            delete img._pendingFile;
          }
        }
        pendingUploads.clear();

        // Merge draft back into the live site object and persist.
        const site = state.site;
        const idx = site.caseStudies.findIndex((c) => c.slug === draft.slug);
        const cleanBlocks = draft.blocks.map((b) => {
          if (b.type === "image-row") {
            return { type: b.type, images: b.images.map((im) => ({ src: im.src, alt: im.alt || null })) };
          }
          return b;
        });
        const toSave = Object.assign({}, draft, { blocks: cleanBlocks });
        if (idx >= 0) site.caseStudies[idx] = toSave;
        else site.caseStudies.push(toSave);

        await saveSiteJson(site, `Admin: update work "${draft.title}"`);
        toast("Work saved.");
        close();
        if (window.MKM.renderCaseStudy && document.querySelector("[data-case-root]")) {
          window.MKM.renderCaseStudy();
        }
      } catch (err) {
        errorEl.textContent = err.message;
        saveBtn.disabled = false;
        saveBtn.textContent = "Save work";
      }
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  window.MKM = window.MKM || {};
  window.MKM.onDataLoaded = function (site) {
    state.site = site;
    if (isAdmin()) {
      enterAdminMode();
      const params = new URLSearchParams(location.search);
      if (params.get("edit") === "1") {
        const slug = window.MKM.getSlugFromUrl && window.MKM.getSlugFromUrl();
        const cs = slug && site.caseStudies.find((c) => c.slug === slug);
        if (cs) openCaseStudyEditor(cs);
      }
    }
  };

  document.addEventListener("DOMContentLoaded", wireLongPress);
})();
