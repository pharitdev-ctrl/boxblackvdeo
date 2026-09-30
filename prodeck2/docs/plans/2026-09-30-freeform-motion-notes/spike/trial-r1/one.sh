#!/bin/sh
# sh one.sh <round> <id> : one real writing call the way the app will make it, then lint, render and inspect
S=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad
T=$S/r050/trial; R=$1; id=$2
C="$T/contract-$R.md"
mkdir -p $T/$R && cd $T/empty
start=$(date +%s)
/opt/homebrew/bin/claude -p --model claude-opus-5-5 --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --exclude-dynamic-system-prompt-sections --system-prompt-file "$C" --output-format json < $T/b-$id.txt > $T/$R/out-$id.json 2> $T/$R/err-$id.txt
echo "call $id exit $? in $(( $(date +%s) - start )) s" > $T/$R/call-$id.txt
python3 - "$T/$R" "$id" <<'PY'
import json,sys,re
d,id=sys.argv[1],sys.argv[2]
try:
    o=json.load(open(f"{d}/out-{id}.json"))
    t=o.get("result","").strip()
    t=re.sub(r"^```[a-zA-Z]*\s*\n","",t); t=re.sub(r"\n```\s*$","",t)
    open(f"{d}/w-{id}.html","w",encoding="utf-8").write(t)
    open(f"{d}/call-{id}.txt","a").write(f"is_error {o.get('is_error')} out_tokens {o.get('usage',{}).get('output_tokens')} ms {o.get('duration_ms')} fenced {o.get('result','').strip().startswith('```')}\n")
except Exception as e:
    open(f"{d}/call-{id}.txt","a").write(f"no answer: {e}\n")
PY
