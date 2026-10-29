#!/usr/bin/env python3
# clang e clang++ de mentira: o zig compilando para o glibc 2.28, para a GDExtension do Linux
# abrir no Ubuntu do CI e em Linux antigos (o .so feito num Linux novo pede o glibc dele).
# Os links `clang` e `clang++` ao lado apontam para este arquivo; o nome chamado escolhe
# `zig cc` ou `zig c++`. Com esta pasta no PATH, o scons do godot-cpp com use_llvm=yes usa o zig.
#
# O que muda nos argumentos do scons:
# - tira o --target (o alvo e o do zig, fixo abaixo);
# - troca -march=x86-64 por -mcpu=x86_64 (o zig chama a cpu pelo nome dele);
# - o objeto `.os` (o scons chama assim o objeto de biblioteca) ganha um link `.o` ao lado: o
#   zig so liga objeto com extensao que ele conhece.
# O scons limpa o ambiente (fica so o PATH), e o zig precisa de uma pasta de cache: ZIG_CACHE,
# se chegar, ou `cache/` ao lado deste arquivo.
import os
import shutil
import sys

ALVO = "x86_64-linux-gnu.2.28"

aqui = os.path.dirname(os.path.realpath(__file__))
cache = os.environ.get("ZIG_CACHE") or os.path.join(aqui, "cache")
os.environ.setdefault("ZIG_GLOBAL_CACHE_DIR", cache)
os.environ.setdefault("ZIG_LOCAL_CACHE_DIR", cache)

modo = "c++" if os.path.basename(sys.argv[0]).endswith("++") else "cc"
args, pula = [], False
for a in sys.argv[1:]:
    if pula:
        pula = False
    elif a == "-target":
        pula = True
    elif a.startswith("--target="):
        pass
    elif a == "-march=x86-64":
        args.append("-mcpu=x86_64")
    elif a.endswith(".os") and os.path.exists(a):
        o = a + ".o"
        if not os.path.lexists(o):
            os.symlink(os.path.basename(a), o)
        args.append(o)
    else:
        args.append(a)

zig = os.environ.get("ZIG") or shutil.which("zig")
if not zig:
    sys.exit("zigcc: zig nao esta no PATH")
# a versao (o godot-cpp pergunta para escolher opcoes) sai sem o alvo: com ele o clang reclama
# do ".2.28" no triplo
if any(a in ("--version", "-dumpversion", "-dumpfullversion") for a in args):
    os.execv(zig, [zig, modo] + args)
os.execv(zig, [zig, modo, "-target", ALVO] + args)
