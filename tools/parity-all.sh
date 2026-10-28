#!/bin/sh
# Gate de paridade 3 no corpus inteiro: tools/parity.ts para cada asset Spine.
#   tools/parity-all.sh <raiz> <saida> [frames]
ROOT=$1; OUT=$2; FRAMES=${3:-2}
mkdir -p "$OUT"; : > "$OUT/summary.txt"
npx tsx -e "import('./server/godot.ts').then(m=>m.scanSpineAssets(process.argv[1]).forEach(a=>console.log(a.tres)))" "$ROOT" > "$OUT/assets.txt"
n=0
while read -r tres; do
  n=$((n+1))
  name=$(echo "$tres" | sed "s|$ROOT/||; s|/|_|g; s|-data.tres||")
  res=$(npx tsx tools/parity.ts "$tres" --frames "$FRAMES" --out "$OUT/$name" 2>&1 | grep -E "erro medio|PASSOU|FALHOU|Error|ERRO" | tr '\n' ' ')
  echo "$n $name :: $res" | tee -a "$OUT/summary.txt"
done < "$OUT/assets.txt"
echo "passaram: $(grep -c PASSOU "$OUT/summary.txt") / $(wc -l < "$OUT/summary.txt")"
