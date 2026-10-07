/* Leather Genius: homepage enhancements (home.js). The page works without it.
   - Swatch book: mirrors the chosen hide onto the folio panel (fallback for
     browsers without :has), keeps a live spec summary, and reads ?hide= etc.
     so "Change in the swatch book" links from /sample/ land pre-selected.
   - Process: the brass zipper closes as the pattern sheet scrolls by. */
(function () {
  "use strict";

  /* Swatch book ------------------------------------------------------------ */
  var book = document.getElementById("specbook");
  if (book) {
    var NAMES = {
      hide: { "lambskin": "Lambskin", "cowhide": "Cowhide & steer", "goat-suede": "Goat & suede", "twill": "Twill & canvas" },
      lining: { "bemberg": "Bemberg", "quilted": "Quilted" },
      hardware: { "ykk-brass": "YKK, solid brass", "ykk-nickel": "YKK, antique nickel", "riri-brass": "RIRI, solid brass", "riri-nickel": "RIRI, antique nickel" },
      label: { "debossed": "Debossed", "hot-foil": "Hot-foiled", "laser-etched": "Laser-etched", "stitched": "Stitched", "woven": "Woven neck label" }
    };
    var sumEl = book.querySelector("[data-sum]");
    var picked = function (name) {
      var el = book.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : "";
    };
    var sync = function () {
      var hide = picked("hide");
      book.setAttribute("data-hide", hide);
      var sw = book.querySelectorAll(".fan__swatch");
      for (var i = 0; i < sw.length; i++) {
        var inp = sw[i].querySelector("input");
        sw[i].classList.toggle("is-on", !!(inp && inp.checked));
      }
      var info = book.querySelectorAll(".hidecard__info");
      for (var j = 0; j < info.length; j++) info[j].classList.toggle("is-on", info[j].getAttribute("data-for") === hide);
      if (sumEl) {
        sumEl.textContent = [NAMES.hide[hide], NAMES.lining[picked("lining")], NAMES.hardware[picked("hardware")], NAMES.label[picked("label")]]
          .filter(Boolean).join(" · ");
      }
    };
    /* Preselect from the query string (whitelisted values only) */
    try {
      var qs = new URLSearchParams(window.location.search);
      Object.keys(NAMES).forEach(function (key) {
        var v = qs.get(key);
        if (v && Object.prototype.hasOwnProperty.call(NAMES[key], v)) {
          var r = book.querySelector('input[name="' + key + '"][value="' + v + '"]');
          if (r) r.checked = true;
        }
      });
    } catch (e) { /* keep defaults */ }
    book.addEventListener("change", sync);
    sync();
  }

  /* Zipper progress ------------------------------------------------------- */
  var steps = document.querySelector(".zipsteps");
  if (steps) {
    var pieces = steps.querySelectorAll(".piece");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var mark = function (z) {
      steps.style.setProperty("--zip", z.toFixed(3));
      for (var i = 0; i < pieces.length; i++) {
        var at = parseFloat(pieces[i].style.getPropertyValue("--at")) || 0;
        pieces[i].classList.toggle("is-on", z >= at - 0.02);
      }
    };
    if (reduce) { mark(1); return; }
    steps.classList.add("is-live");
    var desktop = window.matchMedia("(min-width: 900px)");
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = steps.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var z;
      if (desktop.matches) {
        /* horizontal: close across the section while it passes the middle of the screen */
        z = (vh * 0.82 - r.top) / (r.height * 0.9 + vh * 0.25);
      } else {
        /* vertical: the pull follows a reading line 60% down the screen */
        z = (vh * 0.6 - r.top) / r.height;
      }
      mark(Math.max(0.04, Math.min(1, z)));
    };
    var onScroll = function () { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }
})();
