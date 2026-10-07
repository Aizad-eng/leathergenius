/* Leather Genius: small progressive enhancements. The site works without this file.
   - html.js flag (lets CSS collapse the mobile nav only when JS can reopen it)
   - mobile nav toggle
   - header compaction on scroll
   - aria-current on the nav link that matches the current page */
(function () {
  "use strict";
  var doc = document.documentElement;
  doc.classList.add("js");

  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");

  /* Mobile nav */
  if (header && toggle) {
    toggle.hidden = false;
    var setOpen = function (open) {
      header.classList.toggle("nav-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.querySelector(".nav-toggle__text").textContent = open ? "Close" : "Menu";
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("nav-open")) { setOpen(false); toggle.focus(); }
    });
    header.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".nav a")) setOpen(false);
    });
    var mq = window.matchMedia("(min-width: 900px)");
    var onMq = function () { if (mq.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
  }

  /* Header compaction */
  if (header) {
    var ticking = false;
    var update = function () {
      header.classList.toggle("is-compact", window.scrollY > 24);
      ticking = false;
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* Current page link */
  var norm = function (p) {
    p = p.replace(/index\.html$/, "");
    return p.charAt(p.length - 1) === "/" ? p : p + "/";
  };
  var here = norm(window.location.pathname);
  var links = document.querySelectorAll(".nav__link");
  for (var i = 0; i < links.length; i++) {
    var path = norm(links[i].getAttribute("href") || "");
    if (path !== "/" && here.indexOf(path) === 0) links[i].setAttribute("aria-current", "page");
  }
})();

/* Saddle stitching: swap the dashed CSS fallback on .stitched elements for an
   SVG thread, and sew stitched frames and .sew lines in as they scroll into
   view (a conic mask sweeps round the frame, see site.css section 25).
   Without JS, or with reduced motion, the stitches simply show. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canWatch = "IntersectionObserver" in window && !reduce;
  var mk = function (tag, cls, attrs) {
    var el = document.createElementNS(NS, tag);
    if (cls) el.setAttribute("class", cls);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };

  var frames = document.querySelectorAll(".stitched");
  for (var i = 0; i < frames.length; i++) {
    var host = frames[i];
    var rx = parseFloat(getComputedStyle(host).getPropertyValue("--stitch-r")) || 3;
    var geo = { x: 2, y: 2, width: "100%", height: "100%", rx: rx, ry: rx };
    var svg = mk("svg", "stitch-svg", { "aria-hidden": "true", focusable: "false" });
    svg.appendChild(mk("rect", "stitch-svg__shadow", geo));
    svg.appendChild(mk("rect", "stitch-svg__thread", geo));
    host.appendChild(svg);
    host.classList.add("has-stitch");
    if (canWatch) host.classList.add("sew-pending");
  }

  /* Stitch lines drawn by pseudo-elements: sew them in too. */
  var tag = function (sel, cls) {
    var els = document.querySelectorAll(sel);
    for (var t = 0; t < els.length; t++) els[t].classList.add(cls);
  };
  if (canWatch) {
    tag(".site-footer, .feature, .section--rule, .band--leather", "sew-before");
    tag(".page-hero, .band--leather", "sew-after");
  }
  var targets = document.querySelectorAll(".sew, .sew-before, .sew-after, .stitched");
  var finish = function (el) { el.classList.add("is-sewn"); el.classList.remove("sew-pending"); };
  if (!canWatch) {
    for (var j = 0; j < targets.length; j++) finish(targets[j]);
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { io.unobserve(en.target); finish(en.target); }
    });
  }, { threshold: 0.2, rootMargin: "0px 0px -6% 0px" });
  for (var k = 0; k < targets.length; k++) io.observe(targets[k]);
})();
