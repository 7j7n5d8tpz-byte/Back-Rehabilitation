#!/usr/bin/env python3
"""
Build the Back Rehabilitation program from a single source of truth.

    python3 build.py

Reads   program.json + template.html + style.css
Writes  ../L5-S1 Sustainable Strength Program.pdf   (regenerated from scratch)
        ../back-rehab-app/index.html                (data block rewritten in place)

Deployment normally happens by itself: the launchd watcher (see install-watcher.sh)
notices index.html change and pushes it to Netlify a few seconds later. Pass --deploy
to push immediately instead of waiting, e.g. when running over SSH with no agent loaded.

Everything that appears in both the PDF and the phone app lives in program.json.
Change it there, run this, and the two can never drift apart.

Requires: pip install weasyprint
"""

import html
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = HERE / "program.json"
TEMPLATE = HERE / "template.html"
PDF_OUT = ROOT / "L5-S1 Sustainable Strength Program.pdf"
APP = ROOT / "back-rehab-app" / "index.html"
BACKUP_DIR = HERE / "backups"

START = "// <<< GENERATED FROM program-source/program.json - DO NOT EDIT BY HAND"
END = "// >>> END GENERATED"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def plain(s):
    """HTML fragment -> plain text, for strings that go into the app."""
    s = re.sub(r"<[^>]+>", "", s or "")
    s = html.unescape(s)
    return s.replace("—", "-").replace("–", "-").replace("×", "x")


def js(s):
    """Quote a Python string as a JS double-quoted literal."""
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def app_field(item, key, default=None):
    """Read an app override, falling back to the PDF value."""
    over = item.get("app", {})
    if key in over:
        return over[key]
    return default


def esc(s):
    return s if s else ""


# --------------------------------------------------------------------------
# PDF rendering
# --------------------------------------------------------------------------

def check_supersets(d):
    """Exercises sharing an 'ss' number must sit next to each other, at least two of them."""
    for pnum, ph in d["phases"].items():
        for letter, day in ph["days"].items():
            tags = [e.get("ss") for e in day["exercises"]]
            for t in set(tags) - {None}:
                run = [j for j, u in enumerate(tags) if u == t]
                if len(run) < 2 or run != list(range(run[0], run[0] + len(run))):
                    sys.exit("Phase {} Day {}: superset {} is not a run of 2+ adjacent exercises"
                             .format(pnum, letter, t))


def render_exercise_table(day):
    rows = []
    for e in day["exercises"]:
        tag = '<span class="ss">SS{}</span>'.format(e["ss"]) if e.get("ss") else ""
        rows.append(
            '  <tr><td class="n">{t}{n}</td><td>{s}</td><td>{r}</td><td>{c}</td></tr>'.format(
                t=tag, n=e["name"], s=e["sets"], r=e.get("rpe", ""), c=esc(e.get("cue"))
            )
        )
    return (
        '<table class="ex">\n'
        '<thead><tr><th class="c1">Exercise</th><th class="c2">Sets &times; Reps</th>'
        '<th class="c3">RPE</th><th>Key coaching point</th></tr></thead>\n'
        "<tbody>\n" + "\n".join(rows) + "\n</tbody></table>"
    )


def render_phase(num, ph):
    parts = [
        '<div class="section">',
        '  <div class="kicker">Section {}</div>'.format(ph["section"]),
        "  <h1>{}</h1>".format(ph["heading"]),
        "  <p><b>Goal:</b> {}</p>".format(ph["goal_pdf"]),
        '  <div class="rules"><p>{}</p></div>'.format(ph["rules_pdf"]),
    ]
    for letter in ("A", "B", "C"):
        day = ph["days"][letter]
        parts.append('  <div class="dayblock">')
        parts.append(
            '    <div class="daybar"><b>DAY {L}</b> <span>&mdash; {lab} &middot; {m}</span></div>'.format(
                L=letter, lab=day["label"], m=day["mins"]
            )
        )
        parts.append(render_exercise_table(day))
        parts.append("  </div>")
    if ph.get("footer_pdf"):
        parts.append('  <div class="phasefoot"><p>{}</p></div>'.format(ph["footer_pdf"]))
    parts.append("</div>")
    return "\n".join(parts)


def render_data_table(headers, rows, widths=None, first_col_key=True):
    w = widths or [None] * len(headers)
    th = "".join(
        "<th{}>{}</th>".format(' style="width:{}"'.format(x) if x else "", h)
        for h, x in zip(headers, w)
    )
    body = []
    for r in rows:
        cells = []
        for i, c in enumerate(r):
            cls = ' class="k"' if (i == 0 and first_col_key) else ""
            cells.append("<td{}>{}</td>".format(cls, c))
        body.append("  <tr>" + "".join(cells) + "</tr>")
    return (
        '<table class="data">\n<thead><tr>'
        + th
        + "</tr></thead>\n<tbody>\n"
        + "\n".join(body)
        + "\n</tbody></table>"
    )


def render_numbered_table(headers, rows):
    """Home routine table: leading # column."""
    th = '<th class="num">#</th>' + "".join("<th>{}</th>".format(h) for h in headers)
    body = []
    for i, r in enumerate(rows, 1):
        cells = '<td class="num">{}</td><td class="k">{}</td>'.format(i, r[0])
        cells += "".join("<td>{}</td>".format(c) for c in r[1:])
        body.append("  <tr>" + cells + "</tr>")
    return (
        '<table class="data">\n<thead><tr>'
        + th
        + "</tr></thead>\n<tbody>\n"
        + "\n".join(body)
        + "\n</tbody></table>"
    )


def build_pdf(d):
    tpl = TEMPLATE.read_text(encoding="utf-8")

    phase_html = "\n\n".join(render_phase(n, d["phases"][n]) for n in ("1", "2", "3"))

    subs = render_data_table(
        ["If this hurts", "Swap to", "Why it works"],
        [(s["from"], s["to"], s["why"]) for s in d["substitutions"]],
        widths=["27%", "28%", None],
    )

    home = render_numbered_table(
        ["Exercise", "Dose", "Notes"],
        [(h["name"], h["dose"], h["cue"]) for h in d["home_routine"]],
    )

    nerve = render_data_table(
        ["Exercise", "Dose", "Notes"],
        [(n["name"], n["dose"], n["cue"]) for n in d["nerve_work"]],
        widths=["24%", "16%", None],
    )

    bench = render_data_table(
        ["Test", "How", "Target"],
        [(b["test"], b["how"], b["target"]) for b in d["benchmarks"]],
        widths=["24%", None, "26%"],
    )

    changelog = render_data_table(
        ["Date", "Change"],
        [(c["date"], c["note"]) for c in d["changelog"]],
        widths=["16%", None],
    )

    ps = d["pain_scale"]
    tl_rows = []
    for x in ps["bands"]:
        rng = ("{}-{}/10".format(x["from"], x["to"]) if x["light"] != "red"
               else "{}+/10, or any leg symptom".format(x["from"]))
        tl_rows.append(
            '    <tr class="{cls}">\n'
            '      <td class="lab">{lab}<span class="rng">{rng}</span></td>\n'
            '      <td><b>{crit}</b><br>{act}</td>\n'
            '    </tr>'.format(cls=x["light"][0], lab=x["light"].upper(), rng=rng,
                              crit=x["criteria"], act=x["action"]))
    traffic_html = (
        '<p>Log the number, not the colour. You record your worst back pain since the last entry on a '
        '0&ndash;10 scale &mdash; the same scale your physio uses &mdash; plus whether anything is '
        'happening below the knee. The band below follows from those two answers, and it is the band '
        'that drives the flare protocol and the phase-progression rules.</p>\n'
        '<p class="anchors">' + ' &middot; '.join(
            "<b>{}</b> {}".format(a["n"], a["t"]) for a in ps["anchors"]) + '</p>\n'
        '<table class="tl">\n' + "\n".join(tl_rows) + '\n  </table>\n'
        '<p>' + ps["note"] + '</p>')

    fp = d["flare_protocol"]
    flare_parts = []
    for x in fp["stages"]:
        when = ("From the moment it starts" if x["clear_days"] == 0
                else "After {} consecutive clear days".format(x["clear_days"]))
        head = "Stage {n} &mdash; {t}".format(n=x["n"], t=x["title"])
        meta = []
        if x.get("load_pct"):
            meta.append("{}% of pre-flare loads".format(x["load_pct"]))
        if x.get("sets_cap"):
            meta.append("max {} working sets".format(x["sets_cap"]))
        if x.get("rpe"):
            meta.append("RPE {}".format(x["rpe"]))
        if x.get("pool_phase") == 1:
            meta.append("Phase 1 exercises")
        elif x.get("pool_phase") == 0:
            meta.append("your current phase")
        if not x["gym"]:
            meta.append("no gym")
        flare_parts.append(
            "<h2>{h}</h2>\n<p><b>{w}.</b> {s}{m}</p>\n<ul>{li}</ul>".format(
                h=head, w=when, s=x["summary"],
                m=(" <i>(" + " &middot; ".join(meta) + ")</i>" if meta else ""),
                li="".join("<li>{}</li>".format(y) for y in x["do"])))
    flare_html = "\n".join(flare_parts) + (
        '\n<p>The phone app applies this ladder for you: log the flare and it rebuilds each session '
        'to the stage you are on, prefilling the reduced loads. {}</p>'.format(fp["clear_day_rule"]))

    dl = d["deloads"]
    deload_txt = ", ".join(str(x) for x in dl[:-1]) + " and " + str(dl[-1])

    out = tpl
    for k, v in d["meta"].items():
        out = out.replace("{{META_" + k.upper() + "}}", v)
    out = out.replace("{{PHASE_SECTIONS}}", phase_html)
    out = out.replace("{{SUBS_TABLE}}", subs)
    out = out.replace("{{HOME_TABLE}}", home)
    out = out.replace("{{NERVE_TABLE}}", nerve)
    out = out.replace("{{BENCH_TABLE}}", bench)
    out = out.replace("{{CHANGELOG_TABLE}}", changelog)
    out = out.replace("{{DELOADS}}", deload_txt)
    out = out.replace("{{FLARE_STAGES}}", flare_html)
    out = out.replace("{{TRAFFIC_TABLE}}", traffic_html)

    leftover = re.findall(r"\{\{[A-Z_]+\}\}", out)
    if leftover:
        sys.exit("Unfilled placeholders in template: " + ", ".join(sorted(set(leftover))))

    rendered = HERE / "_rendered.html"
    rendered.write_text(out, encoding="utf-8")

    from weasyprint import HTML  # imported late so --app-only works without it

    if PDF_OUT.exists():
        BACKUP_DIR.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(PDF_OUT, BACKUP_DIR / "program-{}.pdf".format(stamp))

    HTML(string=out, base_url=str(HERE)).write_pdf(str(PDF_OUT))
    return PDF_OUT


# --------------------------------------------------------------------------
# app data block
# --------------------------------------------------------------------------

def exercise_js(e):
    name = app_field(e, "name", e["name"])
    sets = app_field(e, "sets", plain(e["sets"]))
    cue = app_field(e, "cue", plain(e.get("cue", "")))
    unit = app_field(e, "unit", "kg")
    timed = app_field(e, "timed", False)
    if e.get("ss"):
        # suffix, not prefix: the app's flare mode rewrites a leading "N x"
        sets += ", SS{}".format(e["ss"])

    bits =["n:" + js(name), "s:" + js(sets), "u:" + js(unit)]
    if timed:
        bits.append("t:1")
    if e.get("group"):
        bits.append("g:" + js(e["group"]))
    if e.get("spine"):
        bits.append("sp:" + str(e["spine"]))
    if cue:
        bits.append("c:" + js(plain(cue)))
    return "{" + ",".join(bits) + "}"


def build_app_block(d):
    lines = [START]

    # PROGRAM
    lines.append("var PROGRAM = {")
    for pi, pnum in enumerate(("1", "2", "3")):
        ph = d["phases"][pnum]
        lines.append(" {}:{{".format(pnum))
        for di, letter in enumerate(("A", "B", "C")):
            ex = ph["days"][letter]["exercises"]
            body = ",\n     ".join(exercise_js(e) for e in ex)
            tail = "]" if di == 2 else "],"
            lines.append("  {}:[{}{}".format(letter, body, tail))
        lines.append(" }" + ("," if pi < 2 else ""))
    lines.append("};")
    lines.append("")

    # PHASES
    lines.append("var PHASES = {")
    for pi, pnum in enumerate(("1", "2", "3")):
        ph = d["phases"][pnum]
        rules = ",".join(js(plain(r)) for r in ph["rules_app"])
        lines.append(
            " {n}:{{t:{t},w:{w},\n    g:{g},\n    r:[{r}]}}{c}".format(
                n=pnum,
                t=js(ph["title"]),
                w=js(ph["weeks"]),
                g=js(plain(ph["goal_app"])),
                r=rules,
                c="," if pi < 2 else "",
            )
        )
    lines.append("};")
    lines.append("")

    # HOME
    lines.append("var HOME = [")
    items = []
    for h in d["home_routine"]:
        items.append(
            " {{n:{},s:{},c:{}}}".format(
                js(app_field(h, "name", h["name"])),
                js(app_field(h, "dose", plain(h["dose"]))),
                js(plain(app_field(h, "cue", h["cue"]))),
            )
        )
    lines.append(",\n".join(items))
    lines.append("];")
    lines.append("")

    # NERVE
    lines.append("var NERVE = [")
    items = []
    for n in d["nerve_work"]:
        items.append(
            " {{n:{},s:{},c:{}}}".format(
                js(app_field(n, "name", n["name"])),
                js(app_field(n, "dose", plain(n["dose"]))),
                js(plain(app_field(n, "cue", n["cue"]))),
            )
        )
    lines.append(",\n".join(items))
    lines.append("];")
    lines.append("")

    # GROUPS
    lines.append("var GROUPS = [")
    lines.append(",\n".join(
        " {{k:{},l:{}}}".format(js(g["key"]), js(g["label"])) for g in d["muscle_groups"]))
    lines.append("];")
    lines.append("")

    # FLARE
    fp = d["flare_protocol"]
    lines.append("var FLARE = {")
    lines.append("  closeAfter:{},".format(fp["close_after_clear_days"]))
    lines.append("  clearRule:{},".format(js(plain(fp["clear_day_rule"]))))
    lines.append("  debrief:{},".format(js(plain(fp["debrief"]))))
    lines.append("  stages:[")
    st = []
    for x in fp["stages"]:
        bits = [
            "n:" + str(x["n"]),
            "t:" + js(x["title"]),
            "d:" + str(x["clear_days"]),
            "gym:" + ("1" if x["gym"] else "0"),
            "sum:" + js(plain(x["summary"])),
            "sp:" + str(x["max_spine"]),
        ]
        if x.get("load_pct"):
            bits.append("pct:" + str(x["load_pct"]))
        if x.get("sets_cap"):
            bits.append("sets:" + str(x["sets_cap"]))
        if x.get("rpe"):
            bits.append("rpe:" + js(x["rpe"]))
        if x.get("pool_phase") is not None:
            bits.append("pool:" + str(x["pool_phase"]))
        bits.append("do:[" + ",".join(js(plain(y)) for y in x["do"]) + "]")
        st.append("   {" + ",".join(bits) + "}")
    lines.append(",\n".join(st))
    lines.append("  ]")
    lines.append("};")
    lines.append("")

    # PAIN
    ps = d["pain_scale"]
    lines.append("var PAIN = {")
    lines.append("  min:{},max:{},".format(ps["min"], ps["max"]))
    lines.append("  prompt:{},".format(js(ps["prompt"])))
    lines.append("  note:{},".format(js(plain(ps["note"]))))
    lines.append("  anchors:[" + ",".join(
        "{{n:{},t:{}}}".format(a["n"], js(a["t"])) for a in ps["anchors"]) + "],")
    lines.append("  bands:[")
    lines.append(",\n".join(
        "   {{l:{},f:{},t:{},s:{},\n    c:{},\n    a:{}}}".format(
            js(x["light"]), x["from"], x["to"], js(x["short"]),
            js(plain(x["criteria"])), js(plain(x["action_app"])))
        for x in ps["bands"]))
    lines.append("  ]")
    lines.append("};")
    lines.append("")

    lines.append("var DELOADS = [{}];".format(",".join(str(x) for x in d["deloads"])))
    lines.append(END)
    return "\n".join(lines)


def patch_app(d):
    src = APP.read_text(encoding="utf-8")
    block = build_app_block(d)

    if START in src and END in src:
        pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
        new = pattern.sub(lambda m: block, src, count=1)
    else:
        # first run: replace the legacy hand-written span
        pattern = re.compile(r"var PROGRAM = \{.*?var DELOADS = \[[^\]]*\];", re.S)
        if not pattern.search(src):
            sys.exit("Could not find the data block in index.html - patch manually once.")
        new = pattern.sub(lambda m: block, src, count=1)

    if new == src:
        return False
    APP.write_text(new, encoding="utf-8")
    return True


# --------------------------------------------------------------------------

def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    check_supersets(d)
    args = set(sys.argv[1:])

    if "--app-only" not in args:
        pdf = build_pdf(d)
        print("PDF   ->", pdf.name)

    changed = False
    if "--pdf-only" not in args:
        changed = patch_app(d)
        print("App   ->", "updated" if changed else "already current")

    if "--deploy" in args:
        import deploy as deployer
        deployer.deploy(force="--force" in args)
    elif changed:
        watcher = Path.home() / "Library/LaunchAgents/dk.brendstrup.backrehab.deploy.plist"
        if watcher.exists():
            print("Deploy-> watcher will push this to Netlify in a few seconds")
        else:
            print("Deploy-> not set up; run ./install-watcher.sh, or python3 deploy.py")

    # a quick sanity report
    for pnum in ("1", "2", "3"):
        counts = {
            L: len(d["phases"][pnum]["days"][L]["exercises"]) for L in ("A", "B", "C")
        }
        print("Phase {}: A={A} B={B} C={C} exercises".format(pnum, **counts))


if __name__ == "__main__":
    main()
