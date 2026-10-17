# Back Rehab Tracker — setup

## Step 1: put the app online (5 minutes, on your Mac)

The app is one file: **`back-rehab-app/index.html`** in this folder.

1. Go to **[app.netlify.com/drop](https://app.netlify.com/drop)**
2. Drag the whole **`back-rehab-app`** folder onto the drop zone — the folder, not the file.
3. You'll get a live URL like `https://random-name-123.netlify.app` within seconds.
4. Sign up (free, GitHub or email) so the URL doesn't expire after an hour. In Site settings you can rename it to something memorable like `asb-back-rehab.netlify.app`.
5. Send yourself the URL.

## Step 2: install it on your phone (2 minutes)

1. Open the URL in **Safari** on your iPhone.
2. Choose a passcode (4+ characters) and set your **programme start date** — the date week 1 of Phase 1 begins. Use today if you're starting now.
3. Tap **Share** → **Add to Home Screen**. Name it "Back Rehab".
4. Open it from the home screen. It runs full-screen with no browser chrome and stays logged in.

## What it does

**Log gym session** — pre-loaded with the right exercises for your current phase and day, and it suggests the next day in the A→B→C rotation. Loads are prefilled from last time, so you only touch what changed. Pick a traffic light, hit save. Under 30 seconds.

**Daily check-in** — this morning's traffic light, whether you did the 15-minute routine, and how far you walked. Six taps.

**Log a flare-up** — date, severity, symptoms, suspected cause, and the debrief field for what you'll change. If you log a red session, the home screen shows a flare-protocol reminder for the next 10 days.

**Benchmark test** — the six four-weekly tests, showing your previous numbers alongside so you can see the trend. Targets are printed at the top.

**The plan** — the programme itself, on your phone. Three tabs: *Gym sessions* (the exercises for your current phase, with the coaching cue for each and a day A/B/C switcher), *Daily routine* (the 15-minute home work and the nervous-system exercises), and *Rules* (traffic lights, the never-do list, and the emergency red flags). It only ever shows the phase you're actually in, so there's nothing to scroll past.

**History** — everything, with traffic lights as coloured dots.

It works out your phase and week automatically from the start date, and flags deload weeks (10, 18, 24) on the home screen.

## The passcode

It stays unlocked for **30 days after each use**, and every session you log pushes that forward — so with normal training you should never see the passcode screen again. Leave it untouched for a month and it re-locks, which is what you'd want if the phone went missing.

A failed network call no longer looks like a failed passcode: if Supabase is waking from its idle pause you'll get a "try again" screen rather than being asked to log in.

## Reviews

**Every 4 weeks** — do the benchmark tests, then tell me "time for a review". I read the data straight from the database, no exporting or copy-pasting. I'll look at whether loads are actually climbing, whether the traffic lights are trending the right way, whether the calf-raise asymmetry is closing, and whether you're ready for the next phase.

**Any time** — if you flare, or something feels off, just say so and I'll pull the data.

## How it's put together

The **page** is a single static HTML file on Netlify. It holds no keys and no data — it's just the interface, the same as any website's JavaScript.

The **data** lives in Supabase project **Back Rehab Tracker** (`mfzmyahruqghcnhjlkon`), eu-central-1, free tier. The tables are sealed: row-level security is on with no policies, so the public API key cannot read or write anything. All access goes through one edge function behind your passcode. Verified: anonymous reads return empty, anonymous writes are rejected.

*Why two hosts?* Supabase serves any HTML from `*.supabase.co` as plain text — an anti-phishing policy — so it can't host the page itself. It's an excellent database and API, just not a web host.

## Things worth knowing

**Forgotten passcode.** It's stored as a hash and can't be recovered. Tell me and I'll clear it so you can set a new one — your logged data is untouched.

**Supabase sleeps.** Free projects pause after about a week of no activity. Opening the app wakes it, but the first load after a pause takes a few seconds.

**Changing the app.** If you want an extra field or an interface tweak, say so — I'll edit `index.html` here and you re-drag the folder onto Netlify to update it.

## Changing the programme itself

The PDF and the app are both generated from one file: **`program-source/program.json`**.

Ask for an exercise change — added, removed, re-dosed, re-ordered — and I edit that file
and run `program-source/build.py`. It regenerates the PDF and rewrites the app's exercise
data in the same pass, so the document and the phone can't disagree. Every change is
logged in the revision history on the PDF's last page.

One thing follows from this: **don't hand-edit the exercise tables** in `index.html` —
the next build overwrites them.

`program-source/README.md` has the details if you ever want to make a change yourself.

## Automatic deployment

No more dragging folders onto Netlify. A background agent on your Mac watches
`back-rehab-app/` and pushes it to Netlify within seconds of anything changing, so a
programme change reaches your phone on its own.

**One-time setup**, in Terminal:

```bash
cd "path/to/Back Rehabilitation/program-source"
python3 deploy.py --set-token     # paste a Netlify token; it goes into your Keychain
python3 deploy.py                 # pick the site — it remembers
./install-watcher.sh              # start the watcher
```

Get the token at [app.netlify.com/user/applications](https://app.netlify.com/user/applications)
→ *New access token*. It's stored in the macOS login Keychain, never in this folder.

**Afterwards:**

```bash
./install-watcher.sh status       # is it running, and what did it last do
./install-watcher.sh uninstall    # turn it off
python3 deploy.py --force         # push right now regardless
```

Log: `~/Library/Logs/back-rehab-deploy.log`. If a deploy ever looks wrong, every previous
deploy is still in the Netlify dashboard and can be restored with one click.

macOS may ask once whether the agent can read the Keychain item — choose **Always Allow**,
or it will fail quietly every time after that.
