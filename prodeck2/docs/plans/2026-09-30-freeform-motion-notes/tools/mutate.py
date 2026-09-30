#!/usr/bin/env python3
"""Mutation check: python3 mutate.py <list.json> <test files...>
list.json: [{"file": "<repo-relative path>", "name": "...", "find": "<exact text>", "replace": "<text>"}]
Each mutant: the exact text must occur once; the file is changed, the tests run, and the file is put back
(always, even on error). A mutant is caught when the tests fail. Prints a table and exits 1 if any survived."""
import json, subprocess, sys
REPO = "/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
muts = json.load(open(sys.argv[1]))
tests = sys.argv[2:]
rows, survived = [], 0
for m in muts:
    path = f"{REPO}/{m['file']}"
    src = open(path, encoding="utf-8").read()
    n = src.count(m["find"])
    if n != 1:
        rows.append((m["name"], f"SKIP (find occurs {n} times)")); survived += 1; continue
    try:
        open(path, "w", encoding="utf-8").write(src.replace(m["find"], m["replace"], 1))
        r = subprocess.run(["npx", "vitest", "run", *tests], cwd=REPO, capture_output=True, text=True, timeout=900)
        caught = r.returncode != 0
    finally:
        open(path, "w", encoding="utf-8").write(src)
    rows.append((m["name"], "caught" if caught else "SURVIVED"))
    if not caught: survived += 1
for name, state in rows: print(f"{state:28} {name}")
print(f"{len(rows) - survived}/{len(rows)} caught")
sys.exit(1 if survived else 0)
