/* Leather Genius: inner-page enhancements (catalogue, capabilities, process).
   Every page works without this file.
   - Loupe: a magnifier over the hide swatches on /capabilities/ (fine pointers only)
   - Zipper: the brass zip between the four steps on /process/ opens as you scroll
     (static and fully closed under prefers-reduced-motion) */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Loupe ------------------------------------------------------------------ */
  var fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (fine) {
    var swatches = document.querySelectorAll("[data-loupe]");
    Array.prototype.forEach.call(swatches, function (el) {
      var img = el.querySelector("img");
      if (!img) return;
      var lens = document.createElement("span");
      lens.className = "loupe";
      lens.setAttribute("aria-hidden", "true");
      el.appendChild(lens);
      el.classList.add("has-loupe");
      var raf = 0, ev = null;
      var paint = function () {
        raf = 0;
        var r = img.getBoundingClientRect();
        var x = ev.clientX - r.left, y = ev.clientY - r.top;
        var inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
        el.classList.toggle("is-looking", inside);
        if (!inside) return;
        var z = 2.0, size = 170;
        lens.style.transform = "translate(" + (x - size / 2 + (r.left - el.getBoundingClientRect().left)) + "px," + (y - size / 2 + (r.top - el.getBoundingClientRect().top)) + "px)";
        lens.style.backgroundImage = "url(\"" + (img.currentSrc || img.src) + "\")";
        lens.style.backgroundSize = (r.width * z) + "px " + (r.height * z) + "px";
        lens.style.backgroundPosition = (-(x * z - size / 2)) + "px " + (-(y * z - size / 2)) + "px";
      };
      el.addEventListener("pointermove", function (e) { ev = e; if (!raf) raf = requestAnimationFrame(paint); });
      el.addEventListener("pointerleave", function () { el.classList.remove("is-looking"); });
    });
  }

  /* Zipper ----------------------------------------------------------------- */
  var zip = document.querySelector("[data-zip]");
  if (zip) {
    var host = zip.closest(".zip-steps") || zip.parentNode;
    if (reduce) return; /* static: fully closed, slider parked at the top */
    document.documentElement.classList.add("zip-live");
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = host.getBoundingClientRect();
      var vh = Math.min(window.innerHeight || 800, 1100);
      /* the slider rides at ~55% of the viewport while the steps pass by */
      var p = (vh * 0.55 - r.top) / Math.max(1, r.height);
      p = Math.max(0, Math.min(1, p));
      zip.style.setProperty("--zp", p.toFixed(4));
      var steps = host.querySelectorAll(".zip-step");
      for (var i = 0; i < steps.length; i++) {
        var sr = steps[i].getBoundingClientRect();
        steps[i].classList.toggle("is-open", sr.top < vh * 0.62);
      }
    };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
})();
