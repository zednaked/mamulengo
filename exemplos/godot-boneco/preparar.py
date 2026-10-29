#!/usr/bin/env python3
# Copia os tres personagens CC0 de tests/boneco para personagens/ e poe um evento em cada
# animacao de acao (o exemplo mostra o evento na tela). Os de tests/ nao mudam.
#   python3 exemplos/godot-boneco/preparar.py
import json
import os
import shutil

aqui = os.path.dirname(os.path.abspath(__file__))
origem = os.path.join(aqui, "..", "..", "tests", "boneco")
licencas = os.path.join(aqui, "..", "..", "tests", "assets")
destino = os.path.join(aqui, "personagens")

# personagem: (animacao, evento, tempo em segundos, texto)
EVENTOS = {
    "aventureiro": ("susto", "scared", 0.15, "Whoa!"),
    "monstro": ("ganhou", "jump", 0.35, "Yay!"),
    "pessoa": ("acenar", "wave", 0.45, "Hello!"),
}

for nome, (animacao, evento, tempo, texto) in EVENTOS.items():
    pasta = os.path.join(destino, nome)
    os.makedirs(pasta, exist_ok=True)
    with open(os.path.join(origem, nome, nome + ".boneco"), encoding="utf-8") as f:
        d = json.load(f)
    d["eventos"] = {evento: {"texto": texto}}
    d["animacoes"][animacao]["eventos"] = [{"tempo": tempo, "nome": evento}]
    with open(os.path.join(pasta, nome + ".boneco"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    for pg in d["paginas"]:
        shutil.copyfile(os.path.join(origem, nome, pg["arquivo"]), os.path.join(pasta, pg["arquivo"]))
    # a licenca original do pacote (CC0 1.0), sem alteracao
    shutil.copyfile(os.path.join(licencas, nome, "License.txt"), os.path.join(pasta, "License.txt"))
    print(nome, animacao, evento, tempo)
