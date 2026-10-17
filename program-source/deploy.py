#!/usr/bin/env python3
"""
Deploy back-rehab-app to Netlify. Standard library only — nothing to install.

    python3 deploy.py --set-token     store your Netlify token in the macOS Keychain (once)
    python3 deploy.py --list-sites    show the sites your token can reach
    python3 deploy.py --site NAME     pick the site and remember it (once)
    python3 deploy.py                 deploy if anything changed
    python3 deploy.py --force         deploy even if nothing changed

Uses Netlify's file-digest deploy API: we send a list of SHA1s, Netlify replies with the
ones it doesn't already have, and we upload only those. A no-op deploy costs one request.

The token lives in the login Keychain under the service name "netlify-back-rehab", never
in this folder. NETLIFY_AUTH_TOKEN in the environment overrides it if you prefer that.
"""

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.netlify.com/api/v1"
KEYCHAIN_SERVICE = "netlify-back-rehab"

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
APP_DIR = ROOT / "back-rehab-app"
SITE_FILE = HERE / ".netlify-site.json"     # site id — not secret
STATE_FILE = HERE / ".netlify-state.json"   # last deployed digest

SKIP_NAMES = {".DS_Store", ".netlify", "Thumbs.db"}


# --------------------------------------------------------------------------
# token + site
# --------------------------------------------------------------------------

def get_token():
    tok = os.environ.get("NETLIFY_AUTH_TOKEN", "").strip()
    if tok:
        return tok
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    sys.exit(
        "No Netlify token found.\n"
        "  Get one at https://app.netlify.com/user/applications  (Personal access tokens)\n"
        "  Then run:  python3 deploy.py --set-token"
    )


def set_token():
    import getpass
    tok = getpass.getpass("Paste your Netlify personal access token (hidden): ").strip()
    if not tok:
        sys.exit("Nothing entered.")
    r = subprocess.run(
        ["security", "add-generic-password", "-U",
         "-s", KEYCHAIN_SERVICE, "-a", os.environ.get("USER", "user"), "-w", tok],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit("Keychain write failed: " + r.stderr.strip())
    print("Stored in the login Keychain as '{}'.".format(KEYCHAIN_SERVICE))
    try:
        who = api("GET", "/sites?per_page=1", tok)
        print("Token works — it can see {} site(s).".format(len(who)))
    except Exception as e:
        print("Warning: token stored but the test call failed:", e)


def api(method, path, token, body=None, raw=None, content_type="application/json"):
    url = API + path
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        raise SystemExit("Netlify API {} {} -> {} {}\n{}".format(
            method, path, e.code, e.reason, detail))
    except urllib.error.URLError as e:
        raise SystemExit("Could not reach Netlify: {}".format(e.reason))
    if not payload:
        return None
    return json.loads(payload)


def list_sites(token):
    sites = api("GET", "/sites?per_page=100", token)
    return [(s["name"], s["id"], s.get("ssl_url") or s.get("url", "")) for s in sites]


def choose_site(token, wanted=None):
    sites = list_sites(token)
    if not sites:
        sys.exit("This token can't see any Netlify sites.")
    if wanted:
        for name, sid, url in sites:
            if wanted in (name, sid) or wanted == url:
                return name, sid, url
        sys.exit("No site matching '{}'. Try --list-sites.".format(wanted))
    if len(sites) == 1:
        return sites[0]
    print("Which site is the back rehab app?")
    for i, (name, sid, url) in enumerate(sites, 1):
        print("  {}. {}  ({})".format(i, name, url))
    pick = input("Number: ").strip()
    if not pick.isdigit() or not 1 <= int(pick) <= len(sites):
        sys.exit("Cancelled.")
    return sites[int(pick) - 1]


def remembered_site(token, wanted=None):
    if wanted is None and SITE_FILE.exists():
        d = json.loads(SITE_FILE.read_text())
        return d["name"], d["id"], d.get("url", "")
    name, sid, url = choose_site(token, wanted)
    SITE_FILE.write_text(json.dumps({"name": name, "id": sid, "url": url}, indent=2))
    print("Remembered site: {} ({})".format(name, url))
    return name, sid, url


# --------------------------------------------------------------------------
# deploy
# --------------------------------------------------------------------------

def collect_files():
    files = {}
    for p in sorted(APP_DIR.rglob("*")):
        if not p.is_file() or p.name in SKIP_NAMES or p.name.startswith("."):
            continue
        rel = "/" + p.relative_to(APP_DIR).as_posix()
        blob = p.read_bytes()
        files[rel] = (hashlib.sha1(blob).hexdigest(), blob)
    if not files:
        sys.exit("Nothing to deploy — {} is empty.".format(APP_DIR))
    return files


def digest(files):
    joined = "".join(k + ":" + v[0] for k, v in sorted(files.items()))
    return hashlib.sha1(joined.encode()).hexdigest()


def deploy(force=False, site_arg=None, quiet=False):
    def say(*a):
        if not quiet:
            print(*a, flush=True)

    token = get_token()
    name, site_id, url = remembered_site(token, site_arg)
    files = collect_files()
    dg = digest(files)

    if not force and STATE_FILE.exists():
        try:
            if json.loads(STATE_FILE.read_text()).get("digest") == dg:
                say("No change since the last deploy — skipping.")
                return 0
        except (ValueError, OSError):
            pass

    say("Deploying {} file(s) to {} ...".format(len(files), name))
    dep = api("POST", "/sites/{}/deploys".format(site_id), token,
              body={"files": {k: v[0] for k, v in files.items()}})

    required = set(dep.get("required") or [])
    dep_id = dep["id"]

    uploaded = 0
    for rel, (sha, blob) in files.items():
        if sha not in required:
            continue
        api("PUT", "/deploys/{}/files{}".format(dep_id, rel), token,
            raw=blob, content_type="application/octet-stream")
        uploaded += 1
        say("  uploaded {}".format(rel))

    if uploaded == 0:
        say("  (Netlify already had every file)")

    state = dep.get("state")
    for _ in range(40):
        if state in ("ready", "current"):
            break
        time.sleep(1.5)
        state = api("GET", "/deploys/{}".format(dep_id), token).get("state")
        if state == "error":
            sys.exit("Netlify reported a deploy error. Check the Netlify dashboard.")

    STATE_FILE.write_text(json.dumps(
        {"digest": dg, "deploy_id": dep_id, "at": time.strftime("%Y-%m-%d %H:%M:%S")}, indent=2))

    say("Live: {}  (state: {})".format(url or dep.get("ssl_url", ""), state))
    return 0


# --------------------------------------------------------------------------

def main():
    args = sys.argv[1:]

    if "--set-token" in args:
        return set_token()

    if "--list-sites" in args:
        for nm, sid, url in list_sites(get_token()):
            print("{:28} {}  {}".format(nm, sid, url))
        return

    if "--watch-mode" in args:
        # launchd can fire while a file is still being written, and can fire more than
        # once for a single logical change. Settle first, then let the digest check
        # collapse the duplicates.
        time.sleep(3)

    site = None
    if "--site" in args:
        i = args.index("--site")
        if i + 1 >= len(args):
            sys.exit("--site needs a name.")
        site = args[i + 1]

    return deploy(force="--force" in args, site_arg=site, quiet="--quiet" in args)


if __name__ == "__main__":
    sys.exit(main() or 0)
