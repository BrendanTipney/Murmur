# Murmur
A juicy, minimal habit app.

Progress is a running score, not a streak: a kept day adds one, a missed day
takes one back (floored at zero, capped at 27). Today only ever adds. The lane's
chemistry follows that score — starved and sparse at the start (dots), fed and
dense near the goal — so the pattern itself is the progress bar.

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
| `sync.js` | optional Supabase sync over plain REST (no SDK) |
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

## Sync (optional)

Without a Supabase project Murmur is local-only and the sync UI stays hidden.
To turn it on:

1. In Supabase, open **SQL Editor -> New Query**, paste `supabase-setup.sql`, Run.
   Safe to use the same project as other apps; these are their own tables.
2. **Settings -> API**: copy the Project URL and the anon key into `config.js`.
   The anon key is public by design; row-level security is what protects the data.
3. **Authentication -> Emails -> Magic Link template**: include the code as well
   as the link, or an installed app cannot sign in (see below):

   ```html
   <h2>Sign in to Murmur</h2>
   <p>Your code is <strong>{{ .Token }}</strong></p>
   <p>Or <a href="{{ .ConfirmationURL }}">sign in here</a> if you are on a computer.</p>
   ```
4. **Authentication -> URL Configuration**: add the Pages URL
   (`https://<you>.github.io/Murmur/`) as Site URL and as a redirect URL, so the
   link in that mail works too.
5. Commit `config.js`, push, then use **… -> Email me a code** in the app.

On iOS a link from Mail always opens in Safari, which has its own storage
separate from the installed app, so following the link signs in the wrong copy.
Two ways around it, and the app accepts either in the same box:

- **Emailed code** — needs `{{ .Token }}` in the template. Note that Supabase
  picks the template by account state: a new or unconfirmed user gets **Confirm
  signup**, an existing one gets **Magic Link**, so put the code in both.
- **Transfer code** — needs no template change. Follow the link in the browser;
  it signs in there, shows a transfer code and explains what to do. Copy it,
  open the home-screen app, and paste it into the same code box.

How it works: the device stays the source of truth, so the app works offline and
syncs when it can. Each sync pushes everything it holds and merges what comes
back, last-write-wins per habit and per day using client timestamps. Un-ticking a
day stores `done = false` and deleting a habit stores a tombstone, so undoes and
deletes travel between devices instead of being resurrected.

Free-tier projects pause after about a week with no requests; wake it from the
dashboard. A paused project doesn't lock you out, it just stops syncing.

## Tuning

- `PATH` in `field.js`: the (F, k) waypoints progress walks along, sparse to dense.
  Measured coverage runs about 0.10 / 0.34 / 0.51 / 0.67 / 0.86 across it; keep it
  monotonic and away from regimes that die out.
- `SIM_SCALE`: sim cells per CSS px (bigger means finer patterns).
- `GOAL` and `FIRST_DAY` in `app.js`: days to master, and how far day one is
  cheated forward so it reads as progress.
- `RIPPLE_SPEED`, and the `feed`/`k` lines in `SIM_FS`: how the tap wave perturbs the chemistry.
