#!/usr/bin/env bash
# Monta o addon pronto para baixar: addons/boneco do repositorio mais as bibliotecas de bin/.
#   nucleo/godot/montar-addon.sh <pasta de saida> [versao] [pasta das bibliotecas]
# Sai <saida>/mamulengo-boneco/addons/boneco/ e <saida>/mamulengo-boneco-<versao>.zip. A pasta
# de cima (mamulengo-boneco/) e a que o instalador da Asset Library tira ("ignore asset
# root"); quem instala a mao copia o addons/ dela para o projeto.
# Sem as seis bibliotecas (Linux, Windows e macOS, debug e release) falha; PARCIAL=1 monta com
# as que houver (na maquina, sem o macOS).
set -euo pipefail

aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
raiz="$(cd "$aqui/../.." && pwd)"
saida="${1:?uso: $0 <pasta de saida> [versao] [pasta das bibliotecas]}"
versao="${2:-dev}"
libs="${3:-$aqui/bin}"

esperadas=(
  libboneco.linux.template_debug.x86_64.so
  libboneco.linux.template_release.x86_64.so
  libboneco.windows.template_debug.x86_64.dll
  libboneco.windows.template_release.x86_64.dll
  libboneco.macos.template_debug.framework
  libboneco.macos.template_release.framework
)

mkdir -p "$saida"
saida="$(cd "$saida" && pwd)"
pacote="$saida/mamulengo-boneco"
addon="$pacote/addons/boneco"
rm -rf "$pacote"
mkdir -p "$addon/bin"
for f in boneco.gdextension boneco_loader.gd icon.svg README.md LICENSE; do
  cp "$raiz/addons/boneco/$f" "$addon/"
done

faltam=0
for f in "${esperadas[@]}"; do
  if [ -e "$libs/$f" ]; then
    cp -R "$libs/$f" "$addon/bin/"
  else
    echo "falta $f" >&2
    faltam=1
  fi
done
if [ "$faltam" = 1 ] && [ "${PARCIAL:-0}" != 1 ]; then
  echo "bibliotecas faltando (PARCIAL=1 monta assim mesmo)" >&2
  exit 1
fi

zip_="$saida/mamulengo-boneco-$versao.zip"
rm -f "$zip_"
(cd "$saida" && zip -qr -X "$zip_" mamulengo-boneco)
echo "$zip_"
(cd "$saida" && unzip -l "$zip_")
