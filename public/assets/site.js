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
