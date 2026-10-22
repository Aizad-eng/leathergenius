# LGFx.sewing

A WebGL close-up of an industrial walking-foot sewing machine stitching two layers of leather (painted edge) on a worn wood bench. The needle bar drives up and down with needle feed, the inner and outer feet alternate, the take-up lever pulls the thread (with a slight wobble), and a lockstitch line with chisel-point dimples grows on the leather. Background tools (round knife, awl, thread cones) sit out of focus.

Demo: `/lab/sewing/` (full-viewport hero, plus a section version below it).

## Drop it into a page

```html
<link rel="stylesheet" href="/assets/fx/sewing/module.css">

<div id="sewing" class="lgfx-sewing"></div>

<script src="/assets/fx/sewing/module.js" defer></script>
<script>
  window.addEventListener('DOMContentLoaded', function () {
    LGFx.sewing.mount('#sewing', { leather: 'oxblood', thread: 'cream', scrollLinked: true });
  });
</script>
```

The host element sets the size. `module.css` gives it `aspect-ratio: 16 / 10` (4 / 5 under 600px); override `height`/`aspect-ratio` as needed (for a hero, `height: 100vh; aspect-ratio: auto`).

No import map is needed. `module.js` is a classic script; on mount it lazy-loads `engine.js` (an ES module) and `/assets/vendor/three/three.module.min.js` (three.js r169) when the element comes within 600px of the viewport.

## API

`LGFx.sewing.mount(el, options)` returns a controller.

| option | values | default |
| --- | --- | --- |
| `leather` | `'oxblood'` or `'cognac'` | `'oxblood'` |
| `thread` | `'cream'` or `'black'` | `'cream'` |
| `scrollLinked` | `true`: scrolling through the element feeds the leather and grows the seam, and the camera eases in from the machine to the needle | `true` |
| `camera` | `'auto'` (scroll-driven), `'hero'`, `'mid'`, `'close'` | `'auto'` |
| `aperture` | depth-of-field strength multiplier | `1` |
| `eager` | load immediately instead of when near the viewport | `false` |

Behaviour: when in view and idle, the machine runs slowly. Tap or click it to run at full speed for about a second. The machine never runs backwards; scrolling up leaves the seam as it is. It pauses when off screen (IntersectionObserver).

`LGFx.sewing.seek(t)` positions every mounted instance at `t` in `[0, 1]` across the scroll range (0 = start of the seam, 1 = end) and stops the clock; it returns a promise that resolves after the frame is drawn. `seek(t, { T: 20.5, camera: 'close' })` sets the exact stitch cycle (needle bottom is `x.5`) and camera. `controller.play()` resumes.

Controller: `ready` (promise), `seek(t, o)`, `play()`, `camera(name)`, `destroy()`.

## Fallbacks

- No WebGL2 or a load error: `fallback.webp` (the finished seam) is shown instead.
- `prefers-reduced-motion: reduce`: one still frame of a nearly finished seam, no animation.

## Files and sizes

| file | size |
| --- | --- |
| module.js | 3 KB |
| module.css | 1 KB |
| engine.js | 57 KB (unminified) |
| fallback.webp | 33 KB |
| tex/ (leather albedo, normal, roughness; wood albedo, normal, roughness; enamel wear) | 650 KB |
| shared: /assets/vendor/three/three.module.min.js | 687 KB |

Textures are generated procedurally (numpy/pillow); the generator lives outside the repo. Machine, needle plate, thread and tools are modelled in code. 60 fps measured at 1440x900, devicePixelRatio 2, on an Apple M3 Pro.
