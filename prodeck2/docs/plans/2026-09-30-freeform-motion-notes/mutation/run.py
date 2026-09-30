#!/usr/bin/env python3
"""python3 run.py <list.json> : each mutant has its own "tests". The file is changed, its tests run, and the file is
always put back. Caught = the tests fail. Writes results.txt beside the list and exits 1 if any survived."""
import json, subprocess, sys, os
REPO = "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
muts = json.load(open(sys.argv[1]))
rows, survived = [], 0
for m in muts:
    path = f"{REPO}/{m['file']}"
    src = open(path, encoding="utf-8").read()
    if src.count(m["find"]) != 1:
        rows.append((m["file"], m["name"], "SKIP (find not once)")); survived += 1; continue
    try:
        open(path, "w", encoding="utf-8").write(src.replace(m["find"], m["replace"], 1))
        r = subprocess.run(["npx", "vitest", "run", *m["tests"]], cwd=REPO, capture_output=True, text=True, timeout=900)
        caught = r.returncode != 0
    finally:
        open(path, "w", encoding="utf-8").write(src)
    rows.append((m["file"], m["name"], "caught" if caught else "SURVIVED"))
    if not caught: survived += 1
    print(f"{rows[-1][2]:10} {m['file'].split('/')[-1]:24} {m['name']}", flush=True)
out = os.path.join(os.path.dirname(sys.argv[1]), "results.txt")
open(out, "w").write("\n".join(f"{s:10} {f}  {n}" for f, n, s in rows) + f"\n{len(rows) - survived}/{len(rows)} caught\n")
print(f"{len(rows) - survived}/{len(rows)} caught")
sys.exit(1 if survived else 0)
