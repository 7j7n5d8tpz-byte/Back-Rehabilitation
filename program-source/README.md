# program-source — how the program gets built

The PDF and the phone app are both generated from **`program.json`**. Nothing is
maintained in two places, so they cannot drift apart.

```
program.json        ← the only file you normally edit
template.html       ← the PDF's prose (Sections 1, 2, 6–10, cover, closing)
style.css           ← the PDF's look, sampled from the original 31 July 2026 document
build.py            ← runs the whole thing
deploy.py           ← pushes back-rehab-app to Netlify
install-watcher.sh  ← sets up automatic deployment (once)
backups/            ← timestamped copy of the PDF from before each build
_rendered.html      ← the last HTML the PDF was made from, kept for debugging
```

## Making a change

1. Edit `program.json`.
2. Run:

   ```bash
   cd "program-source"
   python3 build.py
   ```

That's it — the watcher pushes the app to Netlify a few seconds later.

`build.py` rewrites two things:

- `../L5-S1 Sustainable Strength Program.pdf` — regenerated from scratch
- `../back-rehab-app/index.html` — only the data block between the
  `// <<< GENERATED` and `// >>> END GENERATED` markers. All the app's logic,
  styling and Supabase wiring is left alone.

Flags: `--pdf-only`, `--app-only`, and `--deploy` to push immediately instead of
leaving it to the watcher.

## Adding an exercise

Add an object to the right `phases → N → days → A|B|C → exercises` array. Order in
the array is the order you do them in.

```json
{
  "name": "Cable lateral raise",
  "sets": "3 × 12–15",
  "rpe": "7–8",
  "cue": "Light enough that the torso stays still.",
  "app": { "sets": "3 x 12-15 @ RPE 7-8", "cue": "Shorter version for the phone." }
}
```

- `name`, `sets`, `rpe`, `cue` are what the PDF prints. `cue` may contain `<b>`.
- The optional `app` object overrides any of `name`, `sets`, `cue`, `unit`,
  `timed` for the phone. Leave it out and the PDF values are reused with the
  typography flattened (`×` → `x`, em dashes → hyphens, tags stripped).
- `"unit": "bw"` for bodyweight exercises — the app then shows no load field.
- `"timed": true` for carries and planks — the app labels the second box
  *sec* instead of *reps*.
- `"ss": 1` marks a superset. Exercises sharing a number must sit next to each
  other; the PDF shows an *SS1* tag and the app appends `, SS1` to the sets.
  `build.py` stops if a superset is split up or has only one exercise.

### One thing to be careful about

**`app.name` is the key the tracker uses to look up your last load.** Rename it and
that exercise starts with a blank load and loses its history. If you're only fixing
the wording, change `name` (the PDF one) and pin the old string in `app.name`.

## Adding to the other tables

`home_routine`, `nerve_work`, `benchmarks`, `substitutions` and `changelog` work the
same way. The first three also feed the app; `benchmarks` and `substitutions` are
PDF-only for now.

Log every real change in `changelog` — it prints as the revision history on the last
page, which is what makes the document safe to hand to a physio.

## Prose changes

Anything that isn't a table lives in `template.html` as plain HTML. Edit it there and
rebuild. The placeholders (`{{PHASE_SECTIONS}}`, `{{HOME_TABLE}}`, …) are filled by
`build.py`; it will stop with an error rather than ship a PDF with an unfilled one.

Page numbers are CSS counters, so the footer stays correct however long the document
gets.

## Deployment

`deploy.py` talks to Netlify's deploy API directly — no CLI, no npm, standard library
only. It hashes the files, asks Netlify which ones it doesn't already have, and uploads
just those. A deploy with nothing to send costs one request.

### One-time setup

```bash
cd "program-source"

# 1. a Netlify personal access token, from
#    https://app.netlify.com/user/applications  →  "New access token"
python3 deploy.py --set-token      # goes into the login Keychain, not into this folder

# 2. pick the site (it lists them; it auto-picks if you only have one)
python3 deploy.py

# 3. start the watcher
./install-watcher.sh
```

### After that

Nothing. A launchd agent watches `back-rehab-app/` and runs `deploy.py` whenever
anything in it changes, so a `build.py` run reaches your phone by itself.

```bash
./install-watcher.sh status      # loaded? when did it last deploy? last 20 log lines
./install-watcher.sh uninstall   # stop it
python3 deploy.py --force        # deploy even if nothing changed
python3 deploy.py --list-sites   # what the token can see
```

The log is at `~/Library/Logs/back-rehab-deploy.log`.

### Notes

- The token lives in the macOS login Keychain under the service name
  `netlify-back-rehab`. Nothing secret is written into this folder, so the project is
  safe to sync or share. `NETLIFY_AUTH_TOKEN` in the environment overrides the Keychain
  if you'd rather do it that way.
- `.netlify-site.json` (which site) and `.netlify-state.json` (what was last deployed)
  are generated. Delete either one to reset that part.
- The first time the agent reads the Keychain macOS may ask you to allow it. Say
  "Always Allow" or the watcher will fail silently every time.
- The deploy is a full site upload, not a patch, so a rolled-back file rolls the site
  back too. Netlify keeps every deploy — you can restore an old one from its dashboard.
- Deploys are skipped when the file digest is unchanged, so a save that doesn't alter
  anything doesn't burn a deploy.
- Netlify allows 3 deploys a minute and 100 a day. The watcher is throttled to one run
  per 30 seconds, so it can't get near either limit.
- Netlify's UI now calls sites "projects". The API still says `sites`, and so does this
  script — same thing.
- Personal access tokens have an expiry date. When it lapses, deploys start failing with
  a 401 in the log; generate a new token and re-run `deploy.py --set-token`.

## Requirements

```bash
pip install weasyprint
```

WeasyPrint 69.0 produced the original document; the stylesheet is tuned to it.
`deploy.py` and `install-watcher.sh` need nothing beyond macOS's own python3.
