/* Leather Genius: homepage (home.js). The page works without it.
   Preselects the "Tell us the spec" form from ?hide=&lining=&hardware=&label=
   so the "change it" link on /sample/ comes back with the same choices. */
(function () {
  "use strict";
  var form = document.getElementById("spec");
  if (!form || !window.URLSearchParams) return;
  try {
    var qs = new URLSearchParams(window.location.search);
    ["hide", "lining", "hardware", "label"].forEach(function (key) {
      var v = qs.get(key);
      var sel = form.elements[key];
      if (!v || !sel) return;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === v) { sel.selectedIndex = i; break; }
      }
    });
  } catch (e) { /* keep defaults */ }
})();
