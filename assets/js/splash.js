// Paint-splash on click: clicking anywhere that isn't interactive bursts a few
// vibrant colour blobs and droplets that fade away. Drawn on a canvas behind
// the page content, so text stays crisp on top of it.
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var COLORS = ["#ff2e93", "#ff6b1a", "#ffd60a", "#2de1c2", "#2e7bff", "#8b5cf6", "#7cff4f"];

  // Anything that already does something on click (or sits on top of the page
  // as an overlay) is left alone.
  var INTERACTIVE =
    'a, button, input, textarea, select, label, summary, video, iframe, [role="button"], ' +
    '[contenteditable], [data-preview], [data-admin-trigger], [tabindex]:not([tabindex="-1"]), ' +
    ".chat-panel, .group-popover, .lightbox, .admin-modal-overlay, .password-gate";

  var BLOB_MS = 1700;
  var GROW_MS = 260;
  var GRAVITY = 0.0012;

  var canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:-1";
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  var width = 0;
  var height = 0;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  var blobs = [];
  var drops = [];
  var running = false;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pickColors(n) {
    var pool = COLORS.slice();
    var out = [];
    while (out.length < n) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  }

  function addBlob(x, y, radius, color, delay) {
    var points = [];
    for (var i = 0; i < 16; i++) points.push(rand(0.72, 1.22));
    blobs.push({ x: x, y: y, radius: radius, color: color, points: points, born: performance.now() + delay });
  }

  function splash(x, y) {
    var colors = pickColors(3);
    var base = Math.max(50, Math.min(95, Math.min(width, height) * 0.12));
    addBlob(x, y, base, colors[0], 0);
    addBlob(x + rand(-34, 34), y + rand(-28, 28), base * 0.6, colors[1], 70);
    addBlob(x + rand(-46, 46), y + rand(-40, 40), base * 0.4, colors[2], 140);

    var now = performance.now();
    var count = Math.round(rand(14, 20));
    for (var i = 0; i < count; i++) {
      var angle = rand(0, Math.PI * 2);
      var speed = rand(0.2, 0.85);
      drops.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.1,
        r: rand(2.5, 8),
        color: colors[i % 3],
        born: now,
        life: rand(800, 1400),
      });
    }

    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function drawBlob(b, scale, alpha) {
    var n = b.points.length;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = b.radius * scale * b.points[i];
      pts.push({ x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r });
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    var last = pts[n - 1];
    ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2);
    for (var j = 0; j < n; j++) {
      var p = pts[j];
      var next = pts[(j + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
    }
    ctx.closePath();
    ctx.fill();
  }

  var last = 0;
  function frame(now) {
    var dt = last ? Math.min(now - last, 50) : 16;
    last = now;
    ctx.clearRect(0, 0, width, height);

    blobs = blobs.filter(function (b) {
      var t = now - b.born;
      if (t < 0) return true;
      if (t > BLOB_MS) return false;
      var scale = easeOutCubic(Math.min(t / GROW_MS, 1));
      var alpha = t < GROW_MS ? 0.92 : 0.92 * (1 - (t - GROW_MS) / (BLOB_MS - GROW_MS));
      drawBlob(b, scale, alpha);
      return true;
    });

    drops = drops.filter(function (d) {
      var t = now - d.born;
      if (t > d.life) return false;
      d.vy += GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      ctx.globalAlpha = 0.95 * (1 - t / d.life);
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * (1 - 0.4 * (t / d.life)), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.globalAlpha = 1;
    if (blobs.length || drops.length) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      last = 0;
    }
  }

  document.addEventListener("click", function (e) {
    if (e.detail === 0) return;
    if (document.documentElement.classList.contains("admin-mode")) return;
    var target = e.target;
    if (!(target instanceof Element) || target.closest(INTERACTIVE)) return;
    var selection = window.getSelection && window.getSelection().toString();
    if (selection) return;
    splash(e.clientX, e.clientY);
  });
})();
