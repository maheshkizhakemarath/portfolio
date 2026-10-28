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
    "Hi, this is an AI assistant that answers on my behalf, using my CV and portfolio. What would you like to know?";
  var SUGGESTIONS = [
    "What measurable impact has your work had?",
    "How large a design team have you led?",
    "Have you designed AI products?",
    "How do you work with product and engineering?",
  ];


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

  composer.appendChild(suggestions);
  composer.appendChild(form);
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
    suggestions.hidden = !suggestions.children.length || asked.length > 0;
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
    if (e.key === "Escape" && isOpen()) exit();
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
