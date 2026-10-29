# A pagina do robo em 3x, rasterizada do vetor do pacote "Toon Characters 1" da Kenney (CC0;
# Robot/Vector/character_robot.svg), no mesmo layout do atlas de tests/boneco/robo: cada parte
# nasce do grupo dela no SVG, com o transparente cortado, e vai para o retangulo do atlas em 3x.
# O SVG tem metade da escala dos PNG "Parts HD", entao 6x no SVG da 3x no atlas.
#
#   python3 exemplos/vitrine/robo-hd.py <character_robot.svg>    (precisa de rsvg-convert e magick)
import json, os, re, subprocess, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
ROBO = os.path.join(AQUI, "..", "..", "tests", "boneco", "robo", "robo.boneco")
FATOR = 3

svg = open(sys.argv[1]).read()
defs = svg[svg.index("<defs>") : svg.index("</defs>") + 7]
b = json.load(open(ROBO))
largura, altura = (v * FATOR for v in b["paginas"][0]["tamanho"])

with tempfile.TemporaryDirectory() as tmp:
    camadas = []
    for im in b["imagens"]:
        nome = im["nome"]
        x, y, w, h = (v * FATOR for v in im["ret"])
        ids = sorted(set(re.findall(r'id="(%s_0_Layer0_\d+_FILL)"' % nome, svg)), key=lambda s: int(s.split("_")[3]))
        uses = "".join('<use xlink:href="#%s"/>' % i for i in ids)
        esc = FATOR * 2
        doc = (
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="%d" height="%d">%s'
            '<g transform="scale(%d) translate(300,300)">%s</g></svg>' % (600 * esc, 600 * esc, defs, esc, uses)
        )
        fonte, png = os.path.join(tmp, nome + ".svg"), os.path.join(tmp, nome + ".png")
        open(fonte, "w").write(doc)
        subprocess.run(["rsvg-convert", fonte, "-o", png], check=True)
        # sem o transparente e no tamanho exato do retangulo (a borda suavizada pode sobrar 1 px)
        subprocess.run(["magick", png, "-trim", "+repage", "-resize", "%dx%d!" % (w, h), png], check=True)
        camadas += [png, "-geometry", "+%d+%d" % (x, y), "-composite"]
    subprocess.run(["magick", "-size", "%dx%d" % (largura, altura), "xc:none", *camadas, "-define", "webp:lossless=true", os.path.join(AQUI, "robo-hd.webp")], check=True)
print("robo-hd.webp: %dx%d" % (largura, altura))
