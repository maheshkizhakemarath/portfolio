# Mahesh Marath — Portfolio

Static HTML/CSS/JS portfolio site with a built-in admin panel. No build step,
no backend — plain files on GitHub Pages, with all content (About, Connect,
all case studies) driven by one JSON file that the admin panel edits and
commits straight to this repo via the GitHub API.

## Structure

```
index.html                    Home page shell — content is fetched from data/site.json at runtime
data/site.json                Single source of truth: about, connect links, all case studies
case-studies/
  view.html                   One template that renders any case study from data/site.json (?slug=...)
  <slug>.html                 Old direct links — each just redirects to view.html?slug=<slug>
  status-pages-demo.html      Static reference/demo page (not in site.json, not linked in nav)
  clinical-handoffs.html      Static leftover placeholder (not in site.json, not linked)
  distributed-planning.html   Static leftover placeholder (not in site.json, not linked)
assets/
  css/styles.css              All styles: design tokens, light/dark theme, admin UI
  js/render.js                Fetches data/site.json and renders the home page / a case study
  js/gate.js                  Per-case-study password gate (reads the password from site data)
  js/site.js                  Theme toggle (persisted) + image-preview lightbox
  js/admin.js                 Long-press login, GitHub-backed save, the whole editing UI
  img/case-studies/<slug>/    Case study images, referenced by path from data/site.json
  fonts/                      Geist variable fonts (regular + italic)
  img/logo.svg                Logo mark
```

## The admin panel

**Sign in:** press and hold the "© 2026 Mahesh Marath" text in the footer
for 3 seconds, on any page. That opens the admin login modal.

**Credential:** there's no separate admin password — the credential *is* a
GitHub Personal Access Token scoped to this repo. If you have a token that
can write to the repo, you're the admin. To create one:

1. On GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access:** "Only select repositories" → pick `portfolio`.
3. **Permissions → Repository permissions → Contents:** set to **Read and
   write**. Leave everything else as-is.
4. Generate, copy the token, paste it into the admin login modal.

The token is stored in `localStorage` on whatever device/browser you log in
on — it never goes anywhere except `api.github.com`. **Log out** (button in
the admin bar) clears it from that device. If a device is ever lost or
compromised, revoke the token on GitHub and issue a new one.

**Once logged in**, a small "Admin" bar appears bottom-left on every page:

- **On the home page:** *Edit profile* (name, role, About text, Connect
  links) and *Manage Past Work* (reorder with ↑ / ↓ — this is the order
  they appear in on the home page — toggle each one visible/hidden, set or
  change its password, delete it, or add a new one).
- **On a case study page:** *Edit this work* opens a block editor —
  add/remove/reorder headings, sub-headings, paragraphs, lists, and image
  blocks (upload images directly; they're committed into
  `assets/img/case-studies/<slug>/`), and edit the title/subtitle.

**Adding a link inside any text**: Role, About, a case study's Subtitle,
and every heading/sub-heading/paragraph/list block have a **+ Link**
button next to them. Click it, give it link text and a URL, and it
inserts `[label](https://example.com)` at your cursor — that markdown-
style syntax is what turns into a real, clickable link wherever the text
is displayed. You can also just type that syntax by hand.

Every "Save" writes straight to this GitHub repo (updating `data/site.json`
and, for new images, adding files under `assets/img/...`) as a commit on the
repo's default branch. GitHub Pages picks it up and redeploys automatically
— changes go live a minute or so after saving, no separate publish step.

**Visibility vs. password**, per case study:
- **Hidden** removes it from the home page's case-study list, but the page
  is still reachable by anyone with the direct link (and its password, if
  set) — handy for sharing one case study privately without listing it.
- **Password** gates the page itself (shows a password prompt before the
  content). Leave the password field blank for no gate at all.

**Security note:** like the password gate, this is real for keeping casual
visitors and search engines from stumbling onto things — it is not a secure
system. The token lives in browser storage and grants full write access to
this repo; treat it like any other credential, and only sign in on devices
you trust.

## Preview locally

```bash
cd portfolio
python3 -m http.server 8080
```

Then open http://localhost:8080. The admin panel works locally too (it
talks to the real GitHub API), so you can test edits before you've even
pushed the site anywhere.

## Publish to GitHub Pages

```bash
cd portfolio
git init
git add .
git commit -m "Initial portfolio site"
git branch -M main
git remote add origin https://github.com/maheshkizhakemarath/portfolio.git
git push -u origin main
```

Then in the repo on GitHub: **Settings → Pages → Source: Deploy from a
branch → `main` / `root`**. The site will be live at
`https://maheshkizhakemarath.github.io/portfolio/`. From then on, admin
edits (which commit to `main`) redeploy the live site automatically.

## Leftover static pages

`status-pages-demo.html`, `clinical-handoffs.html`, and
`distributed-planning.html` predate the data-driven rebuild and are not
part of `data/site.json` or linked from the nav. They still work standalone
if you open them directly; delete them whenever you don't need them as
reference.
