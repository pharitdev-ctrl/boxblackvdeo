#!/bin/sh
# sh round.sh <round> [ids...] : the writing calls three at a time, then lint, render and inspect each in turn
S=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad
T=$S/r050/trial; R=$1; shift
ids="${*:-1 2 3 4 5 6 7 8}"
cd $T
printf '%s\n' $ids | xargs -P 3 -I{} sh one.sh $R {}
cat $R/call-*.txt
python3 - "$R" $ids <<'PY' > $R/e2e.sh
import json,sys
R=sys.argv[1]; ids=sys.argv[2:]
S="/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad"
for b in json.load(open("briefs.json")):
    if b["id"] in ids:
        times=json.dumps([w[1] for w in b["words"]])
        print(f"node {S}/r050/e2e.mts {R}-{b['id']} {S}/r050/trial/{R}/w-{b['id']}.html {b['w']} {b['h']} {b['d']} '{times}'")
PY
sh $R/e2e.sh > $R/results.jsonl 2> $R/e2e-err.txt
cat $R/results.jsonl
