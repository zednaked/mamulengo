#!/usr/bin/env bash
# Compila o pintor (pintor/): o motor de pincel ao lado do editor, para a pintura raster.
# O motor de pincel e o procraft-core (Apache-2.0), de um clone local do ProCraft:
# PROCRAFT=/caminho, ou ~/Projetos/procraft-local, ou ~/Projetos/procraft. O binario sai em
# ~/.cache/mamulengo/pintor/release/mamulengo-pintor (MAMULENGO_PINTOR aponta para outro).
set -euo pipefail
aqui="$(cd "$(dirname "$0")/.." && pwd)"
for p in "${PROCRAFT:-}" "$HOME/Projetos/procraft-local" "$HOME/Projetos/procraft"; do
  [ -n "$p" ] && [ -f "$p/crates/core/Cargo.toml" ] && { procraft="$p"; break; }
done
[ -n "${procraft:-}" ] || { echo "nao achei o ProCraft: clone github.com/artcraft-android/procraft e passe PROCRAFT=/caminho" >&2; exit 1; }
sed "s|@PROCRAFT@|$procraft|" "$aqui/pintor/Cargo.modelo.toml" > "$aqui/pintor/Cargo.toml"
# as mesmas versoes das dependencias que o ProCraft trava
[ -f "$aqui/pintor/Cargo.lock" ] || cp "$procraft/Cargo.lock" "$aqui/pintor/Cargo.lock"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/mamulengo/pintor}"
cargo build --release --manifest-path "$aqui/pintor/Cargo.toml" "$@"
echo "pintor: $CARGO_TARGET_DIR/release/mamulengo-pintor (ProCraft em $procraft, $(git -C "$procraft" rev-parse --short HEAD))"
