#!/usr/bin/env bash
# Compila a GDExtension do .boneco para uma plataforma (o mesmo script no CI e na maquina):
#   nucleo/godot/compilar.sh linux|windows|macos [alvo...]
# alvo: template_debug e/ou template_release (sem alvo, os dois).
# Ambiente:
#   GODOT_CPP  pasta do godot-cpp; sem ela, clona em nucleo/godot/godot-cpp no commit abaixo.
#              No Linux, o godot-cpp tem de ser compilado pelos embrulhos do zig: use uma pasta
#              so para isso.
#   JOBS       processos do scons (padrao: os nucleos, no maximo 6)
#   SCONS      o comando do scons (padrao: scons)
# Linux: zig no PATH (0.14), glibc 2.28 (zig/zigcc.py). Windows: mingw-w64 (x86_64-w64-mingw32-g++).
# macOS: Xcode (clang), binario universal (arm64 e x86_64) dentro de um framework.
set -euo pipefail

# a branch 4.5 do godot-cpp (compatibility_minimum 4.5); mudar aqui muda no CI
GODOT_CPP_REPO=https://github.com/godotengine/godot-cpp.git
GODOT_CPP_COMMIT=27d9dd23c83871e0619fca5dc2cddfbfd69e926a

aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plataforma="${1:-}"
shift || true
alvos=("$@")
[ ${#alvos[@]} -eq 0 ] && alvos=(template_debug template_release)

nucleos=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)
JOBS="${JOBS:-$(( nucleos < 6 ? nucleos : 6 ))}"
SCONS="${SCONS:-scons}"

if [ -z "${GODOT_CPP:-}" ]; then
  GODOT_CPP="$aqui/godot-cpp"
  if [ ! -d "$GODOT_CPP/.git" ]; then
    git init -q "$GODOT_CPP"
    git -C "$GODOT_CPP" remote add origin "$GODOT_CPP_REPO"
  fi
  if [ "$(git -C "$GODOT_CPP" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$GODOT_CPP_COMMIT" ]; then
    git -C "$GODOT_CPP" fetch -q --depth 1 origin "$GODOT_CPP_COMMIT"
    git -C "$GODOT_CPP" checkout -q --detach FETCH_HEAD
  fi
fi
echo "godot-cpp: $GODOT_CPP"

comum=(-C "$aqui" "-j$JOBS" "godot_cpp=$GODOT_CPP" disable_exceptions=no)
case "$plataforma" in
  linux)
    export PATH="$aqui/zig:$PATH"
    extra=(platform=linux arch=x86_64 use_llvm=yes)
    ;;
  windows)
    extra=(platform=windows arch=x86_64 use_mingw=yes)
    ;;
  macos)
    # o minimo do Godot 4.5 no macOS; sem isso o binario pede o macOS do runner
    extra=(platform=macos arch=universal macos_deployment_target=10.13)
    ;;
  *)
    echo "uso: $0 linux|windows|macos [template_debug] [template_release]" >&2
    exit 2
    ;;
esac

for alvo in "${alvos[@]}"; do
  "$SCONS" "${comum[@]}" "${extra[@]}" "target=$alvo"
  if [ "$plataforma" = macos ]; then
    # o framework como o Godot e o export do macOS esperam: o binario e o Info.plist
    nome="libboneco.macos.$alvo"
    fw="$aqui/bin/$nome.framework"
    mkdir -p "$fw/Resources"
    cat > "$fw/Resources/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>$nome</string>
	<key>CFBundleIdentifier</key>
	<string>org.mamulengo.boneco.$alvo</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$nome</string>
	<key>CFBundlePackageType</key>
	<string>FMWK</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0.0</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>MacOSX</string>
	</array>
	<key>CFBundleVersion</key>
	<string>1.0.0</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.13</string>
</dict>
</plist>
PLIST
    # assinatura ad hoc do binario: o macOS em arm64 nao carrega codigo sem assinatura
    # nenhuma (quem exporta o jogo assina de novo com a propria identidade)
    if command -v codesign >/dev/null; then
      codesign --force --sign - "$fw/$nome"
      lipo -info "$fw/$nome"
    fi
  fi
done
ls -la "$aqui/bin"
