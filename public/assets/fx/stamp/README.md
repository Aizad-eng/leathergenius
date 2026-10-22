# LGFx.stamp

A machined brass die (Hallmark mark + wordmark in relief, cut mirrored like a real die, chamfered, worn) on a press arm comes down onto a piece of leather and presses the mark in. Fast descent, impact with a small bounce, hold, lift, a little spring-back in the leather. The impression is computed per pixel in the leather shader from a height map (crisp walls catching the raking light, darker burnished floor, compressed grain, cavity shading). Finishes: blind deboss, gold foil (a foil sheet drops on, is pressed, then peels away and leaves gold in the impression), heat (dark branded look with a slight scorch halo). Click or tap the leather to stamp again: the leather slides under the die to that spot.

three.js r169 from `/assets/vendor/three/` (shared vendored copy, loaded through an import map). Textures are procedural (numpy) WebP files in `tex/`.

## Drop-in

```html
<link rel="stylesheet" href="/assets/fx/stamp/module.css">
<script type="importmap">{"imports":{"three":"/assets/vendor/three/three.module.min.js","three/addons/":"/assets/vendor/three/addons/"}}</script>

<div id="stamp"></div>

<script type="module">
  import '/assets/fx/stamp/module.js';
  const fx = LGFx.stamp.mount(document.getElementById('stamp'), {
    leather: 'vegtan',   // 'vegtan' | 'oxblood'
    finish: 'blind',     // 'blind' | 'foil' | 'heat'
    text: null,          // null = Leather Genius die; or a visitor's text (max 16 chars, Alfa Slab One)
  });
</script>
```

Declarative alternative (auto-mounts when module.js loads):

```html
<div data-lgfx-stamp data-leather="oxblood" data-finish="foil"></div>
<script type="module" src="/assets/fx/stamp/module.js"></script>
```

Only one import map is allowed per page and it must come before any module script; if the page already has one, merge the two `three` entries into it.

The element gets `aspect-ratio: 16/10` (4/5 under 600px) from module.css; give it an explicit height if you want something else. The page should load Alfa Slab One (the site's Google Fonts link does) for custom text dies.

## API

- `LGFx.stamp.mount(el, opts)` returns an instance. Options: `leather`, `finish`, `text`, `autoplay` (default true), `camera` ({dist, el, az, ty, tz}, optional framing override).
- `instance.ready` promise, resolved once textures and the die are built.
- `instance.stamp(at?, {finish?})` stamp again; `at` = leather-local `{x, z}` in scene units (1 = 10 cm), omit for a free spot.
- `instance.setFinish('blind'|'foil'|'heat')` applies to the next stamp.
- `instance.setLeather('vegtan'|'oxblood')` swaps the hide (impressions stay; the other hide's textures are lazy-loaded).
- `instance.setText(str)` re-cuts the die (it rises out of frame, comes back with the new face) and stamps it at a free spot.
- `instance.seek(t)` / `LGFx.stamp.seek(t)` jump the current cycle to `t` seconds and render (pauses playback; for frame grabs). Blind cycle: impact at ~0.51 s, lift 1.06 to 1.66 s, done at 2.2 s. Foil: impact ~1.16 s, peel from 2.36 s, done 3.6 s.
- `instance.destroy()`.

Behaviour: starts when 35% of the element is in view (IntersectionObserver), renders only while animating and visible, devicePixelRatio capped at 2 and dropped once if frames are slow, prefers-reduced-motion shows the finished stamp (clicks stamp instantly). If WebGL2 is unavailable it shows `fallback-<leather>.webp`.

Demo: `/lab/stamp/` (query params for stills: `?frame&t=4&finish=foil&leather=oxblood&text=...`).

## Files

`module.js` (~48 KB), `module.css`, `logo.svg` (die artwork source), `tex/*.webp` (one hide's albedo + normal loads up front, roughness/granite/brass/foil shared), `fallback-*.webp`.
