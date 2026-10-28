// "or ask me anything" chat.
//
// An inline link at the end of the page turns the whole page into a chat
// window (the header logo stays put). The conversation is kept for the rest of
// the browser session, so closing the chat or moving between pages doesn't
// lose it.
//
// Talks to a backend endpoint (a serverless function that holds the API key
// and the knowledge base - never put a key in this file; the site is public).
// Request:  POST { messages: [{ role: "user" | "assistant", content }] }
// Response: plain text, streamed or not; whatever arrives is the reply.
//
// The endpoint comes from <body data-chat-endpoint="...">. When it's empty the
// link stays hidden and the page behaves exactly as before, so the live site
// is unaffected until a backend is configured. On localhost it falls back to the
// local assistant dev server (http://localhost:8787) while developing.
(function () {
  var endpoint =
    document.body.dataset.chatEndpoint || (location.hostname === "localhost" ? "http://localhost:8787" : "");
  if (!endpoint) return;

  var root = document.documentElement;
  var shell = document.querySelector(".shell");
  var header = document.querySelector(".site-header");
  var main = shell && shell.querySelector("main");
  if (!shell || !header || !main) return;

  var MAX_LEN = 500;
  var HISTORY_LIMIT = 10;
  var STORAGE_KEY = "mkm-chat";
  var GREETING =
    "Hello and welcome! I'm an AI assistant answering on my behalf, a bit like a secretary who knows my CV by heart. What would you like to know?";
  var SUGGESTIONS = [
    "What measurable impact has your work had?",
    "How large a design team have you led?",
    "Have you designed AI products?",
    "How do you work with product and engineering?",
  ];


  var FIT_CHIP = "Check my fit for a job description";
  var JD_MIN = 200;
  var JD_MAX = 7900;
  var JD_FILE_MAX = 5 * 1024 * 1024;
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
  var FIT_LABEL = { strong: "Strong", partial: "Partial", none: "No evidence", unknown: "Can't judge" };

  var history = loadHistory();
  var pending = false;
  var rendered = false;
  var scrollBeforeOpen = 0;
  var trigger = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function loadHistory() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) return [];
      return saved
        .filter(function (m) {
          return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
        })
        .slice(-40);
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40)));
    } catch (e) {}
  }

  var view = el("section", "chat-view");
  view.hidden = true;
  view.setAttribute("aria-label", "Ask about Mahesh");

  var log = el("div", "chat-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  var composer = el("div", "chat-composer");
  var suggestions = el("div", "chat-suggestions");
  suggestions.setAttribute("aria-label", "Suggested questions");

  var form = el("form", "chat-form");
  var input = el("textarea", "chat-input");
  input.rows = 1;
  input.maxLength = MAX_LEN;
  input.placeholder = "Ask a question…";
  input.setAttribute("aria-label", "Your question");
  var sendBtn = el("button", "chat-send");
  sendBtn.type = "submit";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  form.appendChild(input);
  form.appendChild(sendBtn);

  var note = el(
    "p",
    "chat-note",
    "AI can make mistakes. For anything important, please contact me directly."
  );

  var fitLink = el("button", "chat-fit-link text-link", "Have a job description? Check my fit");
  fitLink.type = "button";

  var fitPanel = el("div", "chat-fit");
  fitPanel.hidden = true;
  fitPanel.setAttribute("role", "group");
  fitPanel.setAttribute("aria-label", "Check my fit for a job description");
  fitPanel.appendChild(el("p", "chat-fit-title", "Paste a job description, or upload it, and I'll estimate how well my background fits."));
  var fitText = el("textarea", "chat-fit-text");
  fitText.rows = 5;
  fitText.placeholder = "Paste the job description here…";
  fitText.setAttribute("aria-label", "Job description");
  fitPanel.appendChild(fitText);
  var fitFile = el("input", "chat-fit-file");
  fitFile.type = "file";
  fitFile.accept = ".pdf,.docx,.txt,.md,application/pdf,text/plain";
  fitFile.hidden = true;
  fitPanel.appendChild(fitFile);
  var fitActions = el("div", "chat-fit-actions");
  var fitUpload = el("button", "chat-fit-upload", "Upload PDF, Word or text");
  fitUpload.type = "button";
  var fitRun = el("button", "chat-fit-run", "Check fit");
  fitRun.type = "button";
  var fitCancel = el("button", "chat-fit-cancel text-link", "Cancel");
  fitCancel.type = "button";
  fitActions.appendChild(fitUpload);
  fitActions.appendChild(fitRun);
  fitActions.appendChild(fitCancel);
  fitPanel.appendChild(fitActions);
  var fitStatus = el("p", "chat-fit-status");
  fitStatus.setAttribute("aria-live", "polite");
  fitPanel.appendChild(fitStatus);
  fitPanel.appendChild(
    el("p", "chat-fit-privacy", "Your job description is not saved. It is sent to an AI model only to make this comparison.")
  );

  composer.appendChild(suggestions);
  composer.appendChild(fitPanel);
  composer.appendChild(form);
  composer.appendChild(fitLink);
  composer.appendChild(note);
  view.appendChild(log);
  view.appendChild(composer);
  main.after(view);

  var exitBtn = el("button", "chat-exit text-link", "Close");
  exitBtn.type = "button";
  exitBtn.hidden = true;
  header.appendChild(exitBtn);

  function isOpen() {
    return root.classList.contains("chat-mode");
  }

  function scrollToEnd() {
    window.scrollTo(0, document.documentElement.scrollHeight);
  }

  function addMessage(role, text) {
    var bubble = el("div", "chat-msg chat-msg--" + role, text);
    log.appendChild(bubble);
    return bubble;
  }

  function renderSuggestions() {
    var asked = history
      .filter(function (m) {
        return m.role === "user";
      })
      .map(function (m) {
        return m.content;
      });
    suggestions.textContent = "";
    var fitChip = el("button", "chat-chip chat-chip--fit", FIT_CHIP);
    fitChip.type = "button";
    fitChip.disabled = pending;
    fitChip.addEventListener("click", function () {
      openFit();
    });
    suggestions.appendChild(fitChip);
    SUGGESTIONS.filter(function (q) {
      return asked.indexOf(q) === -1;
    }).forEach(function (q) {
      var chip = el("button", "chat-chip", q);
      chip.type = "button";
      chip.disabled = pending;
      chip.addEventListener("click", function () {
        send(q);
      });
      suggestions.appendChild(chip);
    });
    // Suggestions are only for starting a conversation; once a question has been asked
    // (this visit or earlier in the session) they never come back.
    suggestions.hidden = !suggestions.children.length || history.length > 0;
  }

  // While reading back up the conversation the chips step out of the way; they return
  // when the view is back at the bottom (only relevant before any question is asked).
  function syncSuggestionsToScroll() {
    if (!isOpen()) return;
    var atBottom = document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 24;
    suggestions.classList.toggle("is-tucked", !atBottom);
  }
  window.addEventListener("scroll", syncSuggestionsToScroll, { passive: true });

  function enter() {
    if (isOpen()) return;
    scrollBeforeOpen = window.scrollY;
    trigger = document.activeElement;
    if (!rendered) {
      rendered = true;
      addMessage("assistant", GREETING);
      history.forEach(function (m) {
        addMessage(m.role, m.content);
      });
      renderSuggestions();
    }
    root.classList.add("chat-mode");
    view.hidden = false;
    exitBtn.hidden = false;
    scrollToEnd();
    input.focus({ preventScroll: true });
  }

  function exit() {
    if (!isOpen()) return;
    root.classList.remove("chat-mode");
    view.hidden = true;
    exitBtn.hidden = true;
    window.scrollTo(0, scrollBeforeOpen);
    if (trigger && trigger.focus) trigger.focus({ preventScroll: true });
  }

  document.querySelectorAll("[data-chat-cta]").forEach(function (wrap) {
    wrap.hidden = false;
  });
  document.querySelectorAll("[data-chat-open]").forEach(function (btn) {
    btn.addEventListener("click", enter);
  });
  exitBtn.addEventListener("click", exit);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) {
      if (!fitPanel.hidden) closeFit();
      else exit();
    }
  });
  var logoLink = header.querySelector("a");
  if (logoLink) {
    logoLink.addEventListener("click", function (e) {
      if (!isOpen()) return;
      e.preventDefault();
      exit();
    });
  }

  function setPending(on) {
    pending = on;
    sendBtn.disabled = on;
    input.disabled = on;
    fitLink.disabled = on;
    fitRun.disabled = on;
    fitUpload.disabled = on;
    Array.prototype.forEach.call(suggestions.children, function (chip) {
      chip.disabled = on;
    });
    if (!on) input.focus({ preventScroll: true });
  }

  async function send(text) {
    text = (text || "").trim().slice(0, MAX_LEN);
    if (!text || pending) return;

    addMessage("user", text);
    history.push({ role: "user", content: text });
    input.value = "";
    autoGrow();
    renderSuggestions();
    setPending(true);

    var bubble = addMessage("assistant", "");
    bubble.classList.add("is-typing");
    scrollToEnd();
    var reply = "";

    try {
      var res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-HISTORY_LIMIT) }),
      });
      if (!res.ok) {
        // The backend sends short, friendly text for "too many questions", "daily limit
        // reached" and "unavailable"; show that instead of a generic error.
        var failure = new Error("HTTP " + res.status);
        if (res.status === 429 || res.status === 502 || res.status === 503) {
          failure.userMessage = (await res.text()).slice(0, 300);
        }
        throw failure;
      }

      if (res.body && res.body.getReader) {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        for (;;) {
          var chunk = await reader.read();
          if (chunk.done) break;
          reply += decoder.decode(chunk.value, { stream: true });
          bubble.classList.remove("is-typing");
          bubble.textContent = reply;
          scrollToEnd();
        }
      } else {
        reply = await res.text();
        bubble.textContent = reply;
      }

      if (!reply.trim()) throw new Error("empty reply");
      bubble.classList.remove("is-typing");
      history.push({ role: "assistant", content: reply });
      saveHistory();
    } catch (err) {
      // A failed turn isn't kept in history, so a retry doesn't confuse the model.
      history.pop();
      bubble.classList.remove("is-typing");
      bubble.classList.add("chat-msg--error");
      bubble.textContent =
        (err && err.userMessage) || "Sorry, I couldn't reach the assistant just now. Please try again.";
    } finally {
      setPending(false);
      renderSuggestions();
      scrollToEnd();
    }
  }

  // ---------- Job description fit check ----------
  function openFit() {
    fitPanel.hidden = false;
    fitStatus.textContent = "";
    suggestions.classList.add("is-tucked");
    fitText.focus({ preventScroll: true });
    scrollToEnd();
  }

  function closeFit() {
    fitPanel.hidden = true;
    fitStatus.textContent = "";
    syncSuggestionsToScroll();
    input.focus({ preventScroll: true });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = function () {
        reject(new Error("load"));
      };
      document.head.appendChild(tag);
    });
  }

  // PDF and Word readers are only downloaded when someone actually uploads one.
  async function readFile(file) {
    var name = file.name.toLowerCase();
    if (file.size > JD_FILE_MAX) throw new Error("That file is over 5 MB. Please paste the text instead.");
    if (/\.(txt|md|text)$/.test(name) || file.type === "text/plain") return file.text();
    if (/\.pdf$/.test(name)) {
      if (!window.pdfjsLib) await loadScript(PDFJS);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      var out = [];
      for (var i = 1; i <= Math.min(pdf.numPages, 12); i++) {
        var content = await (await pdf.getPage(i)).getTextContent();
        out.push(
          content.items
            .map(function (it) {
              return it.str + (it.hasEOL ? "\n" : " ");
            })
            .join("")
        );
      }
      return out.join("\n");
    }
    if (/\.docx$/.test(name)) {
      if (!window.mammoth) await loadScript(MAMMOTH);
      return (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    }
    throw new Error("I can read PDF, Word (.docx) and text files. For anything else, please paste the text.");
  }

  fitUpload.addEventListener("click", function () {
    fitFile.click();
  });
  fitFile.addEventListener("change", async function () {
    var file = fitFile.files && fitFile.files[0];
    fitFile.value = "";
    if (!file) return;
    fitStatus.textContent = "Reading " + file.name + "…";
    try {
      var text = (await readFile(file)).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (text.length < 40) throw new Error("I couldn't find any text in that file (a scanned image, perhaps). Please paste the text instead.");
      fitText.value = text.slice(0, JD_MAX);
      fitStatus.textContent =
        text.length > JD_MAX ? "Loaded " + file.name + ". It was long, so I'll read the first part." : "Loaded " + file.name + ". Check it looks right, then press Check fit.";
    } catch (err) {
      fitStatus.textContent = (err && err.message) || "I couldn't read that file. Please paste the text instead.";
    }
  });
  fitCancel.addEventListener("click", closeFit);
  fitLink.addEventListener("click", function () {
    if (fitPanel.hidden) openFit();
    else closeFit();
  });
  fitRun.addEventListener("click", function () {
    runFit(fitText.value);
  });

  function fitHistoryText(m) {
    var lines = [
      m.score == null
        ? "Fit check for " + (m.role || "the role") + ": not enough information to put a number on it."
        : "Fit check for " + (m.role || "the role") + ": about " + m.score + "% (" + m.band + ").",
    ];
    if (m.summary) lines.push(m.summary);
    m.requirements.forEach(function (r) {
      lines.push("- " + r.text + ": " + r.fit);
    });
    return lines.join("\n").slice(0, 2900);
  }

  function renderFit(bubble, m) {
    bubble.textContent = "";
    bubble.classList.add("chat-msg--fit");
    var card = el("div", "fit-card");
    var head = el("div", "fit-head");
    if (m.score != null) {
      head.appendChild(el("span", "fit-score", "≈ " + m.score + "%"));
      head.appendChild(el("span", "fit-band", m.band));
    } else {
      head.appendChild(el("span", "fit-band", "Not enough to put a number on"));
    }
    card.appendChild(head);
    if (m.role || m.company) card.appendChild(el("p", "fit-role", [m.role, m.company].filter(Boolean).join(" · ")));
    if (m.score != null) {
      var meter = el("div", "fit-meter");
      var bar = el("div", "fit-meter-bar");
      bar.style.width = m.score + "%";
      meter.appendChild(bar);
      meter.setAttribute("role", "img");
      meter.setAttribute("aria-label", "Estimated fit " + m.score + " percent");
      card.appendChild(meter);
    }
    if (m.summary) card.appendChild(el("p", "fit-summary", m.summary));
    var list = el("ul", "fit-list");
    m.requirements.forEach(function (r) {
      var li = el("li", "fit-item");
      li.appendChild(el("span", "fit-tag fit-tag--" + r.fit, FIT_LABEL[r.fit] || r.fit));
      var body = el("span", "fit-item-body");
      body.appendChild(el("span", "fit-item-text", r.text + (r.priority === "must" ? "" : " (nice to have)")));
      if (r.evidence) body.appendChild(el("span", "fit-item-evidence", r.evidence));
      li.appendChild(body);
      list.appendChild(li);
    });
    card.appendChild(list);
    card.appendChild(
      el(
        "p",
        "fit-disclaimer",
        "This is an estimate from my CV and portfolio, not a hiring decision. Strong or partial means I can point to related work; it doesn't capture everything. For anything important, please contact me directly."
      )
    );
    bubble.appendChild(card);
  }

  async function runFit(raw) {
    var jd = (raw || "").trim();
    if (pending) return;
    if (jd.length < JD_MIN) {
      fitStatus.textContent = "That looks too short to be a job description. Please paste the full text.";
      return;
    }
    jd = jd.slice(0, JD_MAX);
    fitText.value = "";
    closeFit();

    var label = "Job description shared (" + jd.replace(/\s+/g, " ").slice(0, 70) + "…)";
    addMessage("user", label);
    history.push({ role: "user", content: label });
    renderSuggestions();
    setPending(true);

    var bubble = addMessage("assistant", "Reading the job description against my background…");
    bubble.classList.add("is-typing");
    scrollToEnd();

    try {
      var res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd: jd }),
      });
      if (!res.ok) {
        var failure = new Error("HTTP " + res.status);
        if ([400, 413, 429, 502, 503].indexOf(res.status) !== -1) failure.userMessage = (await res.text()).slice(0, 300);
        throw failure;
      }
      var match = await res.json();
      bubble.classList.remove("is-typing");
      if (match.notJobDescription) {
        bubble.textContent = "That doesn't look like a job description. Paste the role's description and I'll compare it with my background.";
        history.push({ role: "assistant", content: bubble.textContent });
      } else {
        renderFit(bubble, match);
        history.push({ role: "assistant", content: fitHistoryText(match) });
      }
      saveHistory();
    } catch (err) {
      history.pop();
      bubble.classList.remove("is-typing");
      bubble.classList.add("chat-msg--error");
      bubble.textContent = (err && err.userMessage) || "Sorry, I couldn't check that just now. Please try again.";
    } finally {
      setPending(false);
      renderSuggestions();
      scrollToEnd();
    }
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }

  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });
})();
