/* Leather Genius FX: sewing machine close-up.
   Classic script. Defines window.LGFx.sewing with mount() and seek().
   The WebGL scene (engine.js + three.js) loads lazily on mount. */
(function () {
  'use strict';
  var script = document.currentScript;
  var base = script ? script.src.replace(/[^/]*$/, '') : '/assets/fx/sewing/';
  var LGFx = (window.LGFx = window.LGFx || {});
  var last = null;
  var all = [];

  function webglOK() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
    } catch (e) { return false; }
  }

  function fallback(el) {
    if (el.querySelector('.lgfx-sewing__still')) return;
    var img = new Image();
    img.className = 'lgfx-sewing__still';
    img.alt = 'An industrial walking-foot sewing machine stitching two layers of leather';
    img.decoding = 'async';
    img.src = base + 'fallback.webp';
    el.appendChild(img);
    el.classList.add('is-ready', 'is-fallback');
  }

  function mount(el, options) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) throw new Error('LGFx.sewing.mount: element not found');
    el.classList.add('lgfx-sewing');
    var ctrl = {
      el: el,
      instance: null,
      ready: null,
      seek: function (t, o) { return ctrl.ready.then(function (i) { return i ? i.seek(t, o) : null; }); },
      play: function () { ctrl.ready.then(function (i) { i && i.play(); }); },
      camera: function (n) { ctrl.ready.then(function (i) { i && i.camera(n); }); },
      destroy: function () { all = all.filter(function (c) { return c !== ctrl; }); if (last === ctrl) last = all[all.length - 1] || null; ctrl.ready.then(function (i) { i && i.destroy(); }); },
    };
    if (!webglOK()) { fallback(el); ctrl.ready = Promise.resolve(null); last = ctrl; return ctrl; }
    var start = function () {
      return import(base + 'engine.js?v=' + (window.LGFX_SEWING_V || '1')).then(function (m) {
        var inst = m.mount(el, options || {}, base);
        if (!inst) { fallback(el); return null; }
        ctrl.instance = inst;
        return inst.ready.then(function () { return inst; });
      }).catch(function (err) { console.warn('[LGFx.sewing]', err); fallback(el); return null; });
    };
    // load when the element is near the viewport
    ctrl.ready = new Promise(function (resolve) {
      if (!('IntersectionObserver' in window) || (options && options.eager)) { resolve(start()); return; }
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); resolve(start()); }
      }, { rootMargin: '600px' });
      io.observe(el);
    });
    last = ctrl;
    all.push(ctrl);
    return ctrl;
  }

  LGFx.sewing = {
    mount: mount,
    // t in [0,1]: position along the scroll range. Returns a promise resolved after the frame is drawn.
    seek: function (t, o) { return Promise.all(all.map(function (c) { return c.seek(t, o); })); },
    get current() { return last; },
  };
})();
