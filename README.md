# Murmur
A juicy, minimal habit app.

**Live:** https://brendantipney.github.io/Murmur/

A yes/no habit tracker PWA. Each habit has a lane of living Gray-Scott
reaction-diffusion; keep the habit and the pattern grows toward the end of the
lane. 27 days in a row fills it.

No build step: plain HTML/CSS/ES modules.

| File | What |
|---|---|
| `app.js` | state (localStorage), streaks, hex-column layout, sheets |
| `field.js` | shared WebGL2 context; per-habit sim + iridescent display shader |
| `fx.js` | particles, shock rings, springs, WebAudio chimes, haptics |
| `sw.js` | offline cache (stale-while-revalidate) |

## Run locally

```
python serve.py
```

Then open http://localhost:8765. (`serve.py` exists because Windows often
serves `.js` as `text/plain`, which breaks modules.)

To try it on the phone, use `http://<pc-ip>:8765` on the same Wi-Fi. You may need
to allow Python through Windows Firewall. The service worker only runs over HTTPS,
so offline mode won't work there.

## Put it on the iPhone

1. Push this folder to a GitHub repo and enable **Settings → Pages**, served from the branch root.
2. Open the `https://<you>.github.io/<repo>/` URL in Safari, tap **Share**, then **Add to Home Screen**.

Data lives in the browser's storage for that origin. Moving to a different URL
starts fresh, so use **… → Export backup / Import backup** to carry data across.

When you ship changes, bump `CACHE` in `sw.js` so installed copies pick them up.

## Tuning

- `PRESETS` in `field.js`: Gray-Scott (F, k) pairs; each habit picks one by id hash.
- `SIM_SCALE`: sim cells per CSS px (bigger means finer patterns).
- `RIPPLE_SPEED`, and the `feed`/`k` lines in `SIM_FS`: how the tap wave perturbs the chemistry.
