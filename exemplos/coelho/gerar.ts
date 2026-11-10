// O coelho: a tela de um joguinho montada sem Godot, so com o modo de layout do Mamulengo (ancoras,
// texto com traducao, nove-fatias e papeis). Este gerador e "quem monta a tela": escreve o
// coelho-jogo.boneco, a pagina de imagens e o manifesto. A logica do jogo (jogo/jogo.ts) e escrita
// depois, so pelo manifesto e pela API, como faria quem recebe a tela pronta.
//
// A arte base e um celular em pe (700 x 1370); cada grupo de pecas e um osso preso a um ponto da
// janela (docs/NUCLEO.md "Tela"):
//
//   fundo, veu     centro, esticando nos dois eixos (o ceu; o escuro da pausa e do fim)
//   chao           embaixo, esticando na largura (a grama)
//   topo           em cima, esticando na largura (a barra do placar)
//   placar         canto de cima e da esquerda (a moeda e os pontos)
//   tempo, aviso   em cima, no meio (os segundos; o aviso da missao cumprida)
//   pausa          canto de cima e da direita (o botao)
//   heroi          centro (a ilha, o coelho, as moedas, a cenoura e os espinhos)
//   botao, dica    embaixo, no meio (JOGAR; "toque para pular")
//   painel         meio da direita (as missoes)
//   fim, pausa_titulo   centro (o resultado; PAUSA)
//
// O que se repete (6 moedas, 2 espinhos) vai pre-montado: o Mamulengo ainda nao cria copias em tempo
// de jogo (docs/ROADMAP.md, "lista"). Cada item tem a animacao "passa" (entra flutuando pela direita
// e sai pela esquerda, na altura dele: baixo ou alto) e a de ser pego; a logica escolhe qual toca.
// Os estados sao animacoes (a lista com a trilha de cada um esta no README). Os eventos das animacoes
// (pulo, moeda, cenoura, ai, missao, fim) sao os ganchos do som.
// Os textos sao texto de verdade (translations.csv, 12 idiomas), com a fonte Kenney Future e, de
// reserva, a Noto Sans Arabic e a Noto Sans Devanagari (OFL, em fontes/). Arte da Kenney (CC0, em
// kenney/ com o License.txt; sons em sons/); o ceu, a grama, as nuvens, as estrelas do brilho e os
// icones da pausa saem daqui.
//
//   npx tsx exemplos/coelho/gerar.ts   (escreve coelho-jogo.boneco, coelho-jogo.png e coelho-jogo.manifesto.json)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Document } from "../../src/core/document.ts";
import { executeAsync } from "../../src/core/commands/index.ts";
import { exportarSpine, importarSpine } from "../../src/boneco/spine.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const KENNEY = join(AQUI, "kenney");
const NOME = "coelho-jogo";
const HD = 2; // pixels da textura por unidade
const W = 700,
  H = 1370;

// ---- imagens
type Img = { nome: string; buf: Buffer; w: number; h: number };
const imgs: Img[] = [];
async function poe(nome: string, buf: Buffer) {
  const m = await sharp(buf).metadata();
  imgs.push({ nome, buf, w: m.width!, h: m.height! });
}
// as pecas da Kenney: `larg` unidades de largura (a textura em HD); escala: a mesma conta para quadros
// de tamanhos diferentes (o coelho em pe, pronto, pulando e ferido)
async function peca(nome: string, arq: string, larg: number, escala?: number) {
  const m = await sharp(join(KENNEY, arq)).metadata();
  const k = escala ?? larg / m.width!;
  const buf = await sharp(join(KENNEY, arq))
    .resize(Math.round(m.width! * k * HD), Math.round(m.height! * k * HD), { kernel: "lanczos3" })
    .png()
    .toBuffer();
  await poe(nome, buf);
}
const svg = (nome: string, w: number, h: number, corpo: string) => poe(nome, Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * HD}" height="${h * HD}" viewBox="0 0 ${w} ${h}">${corpo}</svg>`));

await svg("ceu", W, H, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb7f0"/><stop offset="0.65" stop-color="#bfe7ff"/><stop offset="1" stop-color="#e9f8ff"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`);
await svg("nuvem", 220, 90, `<g fill="#fff" opacity="0.9"><ellipse cx="70" cy="58" rx="60" ry="30"/><ellipse cx="120" cy="40" rx="55" ry="36"/><ellipse cx="165" cy="60" rx="50" ry="26"/></g>`);
await svg("grama", W, 200, `<rect y="26" width="${W}" height="174" fill="#7a5a3a"/><rect y="0" width="${W}" height="40" fill="#6cc04a"/><rect y="30" width="${W}" height="10" fill="#4f9a35"/>`);
await svg("pausa", 24, 30, `<rect x="0" width="8" height="30" rx="2" fill="#fff"/><rect x="16" width="8" height="30" rx="2" fill="#fff"/>`);
await svg("tocar", 26, 30, `<path d="M3 1 L25 15 L3 29 Z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`);
// o escuro e uma imagem pequena esticada: maior que a tela, para a borda (onde o filtro mistura com o
// transparente em volta) ficar fora da janela
await svg("escuro", 16, 16, `<rect width="16" height="16" fill="#0b1020"/>`);
// a estrela do brilho: quatro pontas, branca com o miolo amarelo
await svg("estrela", 40, 40, `<path d="M20 0 C22 14 26 18 40 20 C26 22 22 26 20 40 C18 26 14 22 0 20 C14 18 18 14 20 0 Z" fill="#fff6c8"/><circle cx="20" cy="20" r="5" fill="#ffd23f"/>`);
// o coelho: os quatro quadros na mesma escala (o em pe com 120 de largura, como a arte)
for (const q of ["stand", "ready", "jump", "hurt"]) await peca(`coelho_${q}`, `bunny1_${q}.png`, 0, 1);
// a moeda girando: os quatro quadros da Kenney na mesma escala (a de frente com 58)
for (const q of [1, 2, 3, 4]) await peca(`moeda_${q}`, `gold_${q}.png`, 0, 58 / 84);
await peca("cenoura", "carrot.png", 70);
await peca("espinho", "spikeBall1.png", 92);
await peca("ilha", "ground_grass.png", 300);
// as do UI Pack para nove-fatias, no dobro do tamanho original (os cantos ficam assim na tela)
await peca("botao", "botao_verde.png", 192);
await peca("painel", "painel_azul.png", 128);
await peca("titulo", "titulo_azul.png", 192);
await peca("barra", "barra_cinza.png", 192);
await peca("redondo", "redondo_azul.png", 84);
await peca("marcado", "marcado.png", 34);
await peca("vazio", "vazio.png", 34);

// ---- a pagina: prateleiras numa largura fixa
const LARG = 2048;
let [px, py, alt] = [0, 0, 0];
const imagens: any[] = [];
const comp: sharp.OverlayOptions[] = [];
for (const im of [...imgs].sort((a, b) => b.h - a.h)) {
  if (px + im.w > LARG) [px, py, alt] = [0, py + alt + 4, 0];
  imagens.push({ nome: im.nome, pagina: 0, ret: [px, py, im.w, im.h] });
  comp.push({ input: im.buf, left: px, top: py });
  px += im.w + 4;
  alt = Math.max(alt, im.h);
}
await sharp({ create: { width: LARG, height: py + alt, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png().toFile(join(AQUI, `${NOME}.png`));
const tam = (n: string) => {
  const im = imgs.find((i) => i.nome === n)!;
  return [im.w / HD, im.h / HD];
};

// ---- o esqueleto (JSON do editor): um osso por grupo, a arte base com o meio de baixo na origem
type Texto = { chave?: string; livre?: string; tam: number; caixa: [number, number]; cor?: string; alinhar?: "left" | "center" | "right"; sombra?: string };
// fatias: a caixa [largura, altura], as margens [esquerda, cima, direita, baixo] e o texto que ela acompanha
type Fatias = { caixa: [number, number]; m: [number, number, number, number]; acompanha?: { slot: string; respiro: [number, number] } };
// img: a parte do setup; trocas: as outras imagens do slot (os quadros); y0: a imagem com o pe na
// origem do osso (o coelho); tam: o tamanho da parte (a imagem esticada); cor: a do slot no setup
type Peca = { slot: string; img?: string; trocas?: string[]; texto?: Texto; x?: number; y?: number; cor?: string; fatias?: Fatias; pe?: boolean; tam?: [number, number] };
type Grupo = { osso: string; x: number; y: number; pecas: Peca[]; pai?: string };
const top = H,
  dir = W / 2;
const SOME = "ffffff00"; // o slot comeca escondido (aparece por um estado)
// as alturas dos itens (no osso heroi, com o pe do coelho em 0): baixo pega parado, alto so no pulo
const BAIXO = 85,
  ALTO = 330,
  ENTRA = 460; // de onde os itens entram (e ate onde saem, do outro lado)
const MOEDAS = [1, 2, 3, 4, 5, 6]; // as impares embaixo, as pares no alto
const ESPINHOS = [1, 2];
const grupos: Grupo[] = [
  { osso: "fundo", x: 0, y: H / 2, pecas: [{ slot: "ceu", img: "ceu" }] },
  { osso: "nuvens", x: 0, y: 1000, pecas: [{ slot: "nuvem_1", img: "nuvem", x: -190, y: 0 }, { slot: "nuvem_2", img: "nuvem", x: 170, y: -120, cor: "ffffffcc" }] },
  { osso: "chao", x: 0, y: 100, pecas: [{ slot: "grama", img: "grama" }] },
  { osso: "heroi", x: 0, y: 640, pecas: [{ slot: "ilha", img: "ilha", y: -30 }] },
  { osso: "coelho", pai: "heroi", x: 0, y: 0, pecas: [{ slot: "coelho", img: "coelho_stand", trocas: ["coelho_ready", "coelho_jump", "coelho_hurt"], pe: true }] },
  // o meio do corpo: e dele que a logica mede a distancia ate cada item
  { osso: "corpo", pai: "coelho", x: 0, y: 85, pecas: [] },
  { osso: "brilho", pai: "corpo", x: 0, y: 30, pecas: [] },
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ osso: `brilho_${i + 1}`, pai: "brilho", x: 0, y: 0, pecas: [{ slot: `brilho_${i + 1}`, img: "estrela", cor: SOME }] })),
  ...MOEDAS.map((n) => ({ osso: `moeda${n}`, pai: "heroi", x: ENTRA, y: n % 2 ? BAIXO : ALTO, pecas: [{ slot: `moeda${n}`, img: "moeda_1", trocas: ["moeda_2", "moeda_3", "moeda_4"], cor: SOME }] })),
  { osso: "cenoura", pai: "heroi", x: ENTRA, y: ALTO, pecas: [{ slot: "cenoura", img: "cenoura", cor: SOME }] },
  ...ESPINHOS.map((n) => ({ osso: `espinho${n}`, pai: "heroi", x: ENTRA, y: 58, pecas: [{ slot: `espinho${n}`, img: "espinho", cor: SOME }] })),
  { osso: "botao", x: 0, y: 250, pecas: [{ slot: "botao", img: "botao", fatias: { caixa: [270, 92], m: [16, 16, 16, 22], acompanha: { slot: "jogar", respiro: [38, 12] } } }, { slot: "jogar", texto: { chave: "JOGAR", tam: 40, caixa: [600, 60], sombra: "1d7a4a" }, y: 6 }] },
  { osso: "dica", x: 0, y: 250, pecas: [{ slot: "dica", texto: { chave: "DICA", tam: 34, caixa: [600, 50], sombra: "2a6a9a" }, cor: SOME }] },
  {
    osso: "painel",
    x: dir - 150,
    y: H / 2,
    pecas: [
      { slot: "painel", img: "painel", y: -5, fatias: { caixa: [268, 340], m: [22, 22, 22, 22] } },
      { slot: "titulo", img: "titulo", y: 128, fatias: { caixa: [214, 58], m: [14, 14, 14, 20], acompanha: { slot: "missoes", respiro: [22, 8] } } },
      { slot: "missoes", texto: { chave: "MISSOES", tam: 28, caixa: [320, 50] }, y: 132 },
    ],
  },
  // cada missao e um osso (a linha pula quando ela se cumpre) com a caixa de marcar num filho
  ...[1, 2, 3].flatMap((k) => [
    // a caixa do texto vai do respiro depois da caixa de marcar (x -62) ate 30 antes da borda de fora do
    // painel (x 104): "DIE KAROTTE" encolhe antes de encostar na moldura
    { osso: `m${k}`, pai: "painel", x: 0, y: 55 - (k - 1) * 70, pecas: [{ slot: `m${k}_texto`, texto: { chave: ["MOEDAS", "PULOS", "CENOURA"][k - 1], tam: 22, caixa: [166, 34] as [number, number], cor: "4a3f78", alinhar: "left" as const }, x: -62 + 83 }] },
    { osso: `m${k}_marca`, pai: `m${k}`, x: -88, y: 0, pecas: [{ slot: `m${k}_caixa`, img: "vazio", trocas: ["marcado"] }] },
  ]),
  { osso: "topo", x: 0, y: top - 55, pecas: [{ slot: "barra", img: "barra", y: 4, cor: "3d4f8cff", fatias: { caixa: [700, 98], m: [16, 14, 16, 20] } }] },
  { osso: "placar", x: -dir + 44, y: top - 52, pecas: [{ slot: "pontos", texto: { livre: "0", tam: 40, caixa: [200, 50], alinhar: "left" }, x: 46 + 100 }] },
  { osso: "moeda", pai: "placar", x: 0, y: 0, pecas: [{ slot: "moeda", img: "moeda_1", trocas: ["moeda_2", "moeda_3", "moeda_4"] }] },
  { osso: "tempo", x: 0, y: top - 52, pecas: [{ slot: "tempo", texto: { livre: "30", tam: 44, caixa: [140, 56], sombra: "1d2a5a" } }] },
  // o aviso da missao cumprida: o texto vem do codigo (o da missao, no idioma)
  { osso: "aviso", x: 0, y: top - 175, pecas: [{ slot: "aviso_fundo", img: "titulo", cor: SOME, fatias: { caixa: [430, 70], m: [14, 14, 14, 20] } }, { slot: "aviso_marca", img: "marcado", x: -175, y: 3, cor: SOME }, { slot: "aviso_texto", texto: { livre: "", tam: 30, caixa: [320, 44] }, x: 20, y: 6, cor: SOME }] },
  // o escuro da pausa e do fim cobre tudo o que vem antes (a pausa e o resultado ficam por cima)
  { osso: "veu", x: 0, y: H / 2, pecas: [{ slot: "escuro", img: "escuro", tam: [W * 1.5, H * 1.5], cor: "ffffff00" }] },
  { osso: "pausa_titulo", x: 0, y: 760, pecas: [{ slot: "pausa_texto", texto: { chave: "PAUSA", tam: 84, caixa: [640, 110], sombra: "0b1020" }, cor: SOME }] },
  {
    osso: "fim",
    x: 0,
    y: 720,
    pecas: [
      { slot: "fim_painel", img: "painel", cor: SOME, fatias: { caixa: [470, 480], m: [22, 22, 22, 22] } },
      { slot: "fim_faixa", img: "titulo", y: 228, cor: SOME, fatias: { caixa: [300, 76], m: [14, 14, 14, 20], acompanha: { slot: "fim_titulo", respiro: [30, 12] } } },
      { slot: "fim_titulo", texto: { chave: "FIM", tam: 42, caixa: [520, 56] }, y: 233, cor: SOME },
      { slot: "fim_moeda", img: "moeda_1", x: -150, y: 105, cor: SOME },
      { slot: "fim_moedas", texto: { chave: "MOEDAS", tam: 54, caixa: [300, 70], cor: "4a3f78", alinhar: "left" }, x: 40, y: 105, cor: SOME },
      { slot: "fim_recorde", texto: { chave: "RECORDE", tam: 30, caixa: [400, 44], cor: "6a5f98" }, y: 25, cor: SOME },
    ],
  },
  { osso: "fim_novo", pai: "fim", x: 0, y: -40, pecas: [{ slot: "fim_novo", texto: { chave: "NOVO", tam: 32, caixa: [400, 46], cor: "ffb000", sombra: "7a4a00" }, cor: SOME }] },
  { osso: "denovo", pai: "fim", x: 0, y: -160, pecas: [{ slot: "denovo_fundo", img: "botao", cor: SOME, fatias: { caixa: [270, 88], m: [16, 16, 16, 22], acompanha: { slot: "denovo_texto", respiro: [38, 12] } } }, { slot: "denovo_texto", texto: { chave: "DENOVO", tam: 38, caixa: [400, 56], sombra: "1d7a4a" }, y: 6, cor: SOME }] },
  // o botao da pausa por cima do escuro: e por ele que se volta
  { osso: "pausa", x: dir - 58, y: top - 54, pecas: [{ slot: "redondo", img: "redondo" }, { slot: "pausa", img: "pausa", trocas: ["tocar"], y: 3 }] },
];
const grupo = (osso: string) => grupos.find((g) => g.osso === osso)!;
// os slots de um osso e dos que pendem dele (para esconder e mostrar um grupo inteiro)
const slotsDe = (osso: string): string[] => [...grupo(osso).pecas.map((p) => p.slot), ...grupos.filter((g) => g.pai === osso).flatMap((g) => slotsDe(g.osso))];
const parte = (p: Peca, img: string) => {
  const [w, h] = p.tam ?? tam(img);
  return { ...(p.x ? { x: p.x } : {}), ...(p.pe ? { y: h / 2 } : p.y ? { y: p.y } : {}), width: w, height: h };
};
const json: any = {
  skeleton: { spine: "4.3.23", x: -W / 2, y: 0, width: W, height: H },
  bones: [{ name: "root" }, ...grupos.map((g) => ({ name: g.osso, parent: g.pai ?? "root", x: g.x, y: g.y }))],
  slots: grupos.flatMap((g) => g.pecas.map((p) => ({ name: p.slot, bone: g.osso, ...(p.img ? { attachment: p.img } : {}), ...(p.cor ? { color: p.cor } : {}) }))),
  skins: [
    {
      name: "default",
      attachments: Object.fromEntries(grupos.flatMap((g) => g.pecas.filter((p) => p.img).map((p) => [p.slot, Object.fromEntries([p.img!, ...(p.trocas ?? [])].map((im) => [im, parte(p, im)]))]))),
    },
  ],
  // os eventos das animacoes: os ganchos do som (e de quem mais quiser saber)
  events: { pulo: {}, pousa: {}, moeda: {}, cenoura: {}, ai: {}, missao: {}, fim: {} },
  animations: {},
};
// o atlas texto do editor (o .boneco leva as imagens dentro; aqui so para o Document)
const atlas = `${NOME}.png\nsize:${LARG},${py + alt}\nfilter:Linear,Linear\n` + imagens.map((im) => `${im.nome}\nbounds:${im.ret.join(",")}\n`).join("");
const doc = Document.fromText(JSON.stringify(json), { text: atlas, pages: {} });
const run = async (cmd: string, args: any) => {
  // as fontes (query.texts mede por elas) relativas a esta pasta
  const r = await executeAsync(doc, { cmd, args }, "gerar", undefined, {}, { image: async () => null, region: () => null, bytes: async (f: string) => new Uint8Array(readFileSync(join(AQUI, f))) });
  return r[0];
};

// ---- a tela: a arte base e as ancoras, pelos mesmos comandos do editor e do MCP
await run("screen.set", { size: [W, H], fit: "contain" });
for (const [bone, anchor, stretch] of [
  ["fundo", "center", "xy"],
  ["veu", "center", "xy"],
  ["chao", "bottom", "x"],
  ["topo", "top", "x"],
  ["placar", "top-left"],
  ["tempo", "top"],
  ["aviso", "top"],
  ["pausa", "top-right"],
  ["nuvens", "top"],
  ["heroi", "center"],
  ["botao", "bottom"],
  ["dica", "bottom"],
  ["painel", "right"],
  ["pausa_titulo", "center"],
  ["fim", "center"],
])
  await run("anchor.set", { bone, anchor, ...(stretch ? { stretch } : {}) });

// ---- os textos: as fontes, a tabela de idiomas do CSV e uma parte de texto por slot, pelos comandos
await run("font.add", { name: "kenney", file: "kenney/kenney-future.ttf" });
await run("font.add", { name: "arabe", file: "fontes/NotoSansArabic-Bold.ttf" });
await run("font.add", { name: "devanagari", file: "fontes/NotoSansDevanagari-Bold.ttf" });
await run("i18n.import", { csv: readFileSync(join(AQUI, "translations.csv"), "utf8") });
for (const g of grupos)
  for (const p of g.pecas) {
    const t = p.texto;
    if (!t) continue;
    await run("text.set", {
      slot: p.slot,
      ...(t.chave ? { key: t.chave } : { text: t.livre }),
      font: "kenney",
      size: t.tam,
      minSize: Math.round(t.tam * 0.6),
      width: t.caixa[0],
      height: t.caixa[1],
      ...(p.x ? { x: p.x } : {}),
      ...(p.y ? { y: p.y } : {}),
      color: t.cor ?? "ffffff",
      align: t.alinhar ?? "center",
      ...(t.sombra ? { shadow: { color: t.sombra, y: 3 } } : {}),
    });
  }
// as nove-fatias, pelo mesmo comando do editor e do MCP (depois dos textos que elas acompanham)
for (const g of grupos)
  for (const p of g.pecas) {
    const f = p.fatias;
    if (!f) continue;
    await run("slice.set", { slot: p.slot, size: f.caixa, left: f.m[0], top: f.m[1], right: f.m[2], bottom: f.m[3], ...(f.acompanha ? { fitText: { slot: f.acompanha.slot, padding: f.acompanha.respiro } } : {}) });
  }
// os papeis, pelo mesmo comando do editor e do MCP. Os botoes: o JOGAR e o "de novo" com os estados
// animados abaixo (a area so a nove-fatias: a caixa do texto e a largura maxima, nao o botao), a pausa
// com as poses curtas padrao. O toque "pular" e a tela inteira (uma caixa no osso do ceu, que estica
// com a janela; os botoes ficam por cima dele). E os textos que o codigo troca
await run("role.set", { name: "jogar", type: "button", bone: "botao", area: { slot: "botao" }, defaultStates: true, mix: 0.12 });
await run("role.set", { name: "pausa", type: "button", bone: "pausa", defaultStates: true });
await run("role.set", { name: "denovo", type: "button", bone: "denovo", area: { slot: "denovo_fundo" }, defaultStates: true, mix: 0.12 });
await run("role.set", { name: "pular", type: "touch", bone: "fundo", area: { box: [0, 0, W, H] } });
for (const [name, slot] of [
  ["placar", "pontos"],
  ["tempo", "tempo"],
  ["aviso", "aviso_texto"],
  ["resultado", "fim_moedas"],
  ["recorde", "fim_recorde"],
])
  await run("role.set", { name, type: "text", slot });
const avisos = (await run("query.texts", {})).overflowing;
if (avisos.length) console.log(`estouram (medida aproximada): ${avisos.join(", ")}`);

// ---- as chaves. k(tempo, valores, curva da chave ate a proxima); as curvas pelo nome, na forma de
// Bezier do Spine ([cx1, cy1, cx2, cy2] por canal, normalizada no trecho)
type Curva = "lin" | "sai" | "entra" | "suave" | "degrau";
const FORMA: Record<Exclude<Curva, "degrau">, number[]> = { lin: [1 / 3, 1 / 3, 2 / 3, 2 / 3], sai: [0.15, 0.55, 0.45, 1], entra: [0.55, 0, 0.85, 0.45], suave: [0.4, 0, 0.6, 1] };
type Ponto = [number, number | number[], Curva?];
// uma timeline de 1 ou 2 canais (girar: value; mover e escala: x, y) a partir dos pontos
function linha(campos: string[], pontos: Ponto[]) {
  return pontos.map(([t, v], i) => {
    const vals = Array.isArray(v) ? v : [v];
    const chave: any = { ...(t ? { time: +t.toFixed(4) } : {}) };
    campos.forEach((c, j) => (chave[c] = vals[j]));
    const prox = pontos[i + 1];
    const curva = pontos[i][2] ?? "lin";
    if (prox && curva === "degrau") chave.curve = "stepped";
    else if (prox && curva !== "lin") {
      const [t1, v1] = prox;
      const vs1 = Array.isArray(v1) ? v1 : [v1];
      const [a, b, c, d] = FORMA[curva];
      chave.curve = vals.flatMap((v0, j) => [t + a * (t1 - t), v0 + b * (vs1[j] - v0), t + c * (t1 - t), v0 + d * (vs1[j] - v0)]);
    }
    return chave;
  });
}
const mover = (p: Ponto[]) => linha(["x", "y"], p);
const escala = (p: Ponto[]) => linha(["x", "y"], p);
const girar = (p: Ponto[]) => linha(["value"], p);
const cor = (p: [number, string][]) => p.map(([t, c]) => ({ ...(t ? { time: t } : {}), color: c }));
const quadros = (p: [number, string][]) => p.map(([t, n]) => ({ ...(t ? { time: t } : {}), name: n }));
const eventos = (p: [number, string][]) => p.map(([t, n]) => ({ time: t, name: n }));
// o alfa de varios slots juntos
const alfa = (slots: string[], p: [number, number][]) => Object.fromEntries(slots.map((s) => [s, { rgba: cor(p.map(([t, a]) => [t, "ffffff" + Math.round(a * 255).toString(16).padStart(2, "0")])) }]));

const anims: Record<string, any> = {};

// o laco da tela (trilha 0): as nuvens andam e a moeda do placar gira pelos quadros
anims.parado = {
  bones: { nuvens: { translate: mover([[0, [0, 0], "suave"], [1, [16, 0], "suave"], [2, [0, 0]]]) } },
  slots: { moeda: { attachment: quadros([[0, "moeda_1"], [0.3, "moeda_2"], [0.4, "moeda_3"], [0.5, "moeda_4"], [0.6, "moeda_3"], [0.7, "moeda_2"], [0.8, "moeda_1"]]) } },
};

// ---- o coelho (trilha 2). Respira em laco; o pulo tem antecipacao (agacha no "ready"), o impulso
// esticado, o topo segurando um pouco (a hora de pegar o que esta no alto), a queda acelerando, o
// pouso amassado e o assentamento (passa do ponto e volta)
anims["coelho/respira"] = {
  bones: { coelho: { scale: escala([[0, [1, 1], "suave"], [1, [0.97, 1.04], "suave"], [2, [1, 1]]]), translate: mover([[0, [0, 0]]]) } },
  slots: { coelho: { attachment: quadros([[0, "coelho_stand"]]), rgba: cor([[0, "ffffffff"]]) } },
};
const PULO = 250;
anims["coelho/pula"] = {
  bones: {
    coelho: {
      translate: mover([[0, [0, 0]], [0.08, [0, -4], "sai"], [0.36, [0, PULO], "suave"], [0.44, [0, PULO - 6], "entra"], [0.64, [0, 0]], [0.7, [0, -6], "suave"], [0.82, [0, 0]]]),
      scale: escala([[0, [1, 1], "sai"], [0.08, [1.16, 0.8], "sai"], [0.16, [0.84, 1.2], "suave"], [0.36, [0.97, 1.03], "suave"], [0.56, [0.92, 1.1], "entra"], [0.64, [1.22, 0.76], "sai"], [0.72, [0.94, 1.07], "suave"], [0.82, [1, 1]]]),
    },
  },
  slots: { coelho: { attachment: quadros([[0, "coelho_ready"], [0.08, "coelho_jump"], [0.64, "coelho_ready"], [0.74, "coelho_stand"]]), rgba: cor([[0, "ffffffff"]]) } },
  events: eventos([[0.08, "pulo"], [0.64, "pousa"]]),
};
// ferido: o quadro "hurt", um tranco para tras, piscando em vermelho
anims["coelho/ai"] = {
  bones: {
    coelho: {
      translate: mover([[0, [0, 0], "sai"], [0.06, [-22, 18], "entra"], [0.16, [-10, 0], "sai"], [0.24, [6, 0], "suave"], [0.34, [0, 0]]]),
      scale: escala([[0, [1.15, 0.85], "sai"], [0.12, [0.95, 1.05], "suave"], [0.3, [1, 1]]]),
    },
  },
  slots: {
    coelho: {
      attachment: quadros([[0, "coelho_hurt"], [0.62, "coelho_stand"]]),
      rgba: cor([[0, "ff7070ff"], [0.1, "ffffffff"], [0.18, "ff7070ff"], [0.28, "ffffffff"], [0.36, "ff9090ff"], [0.46, "ffffffff"]]),
    },
  },
  events: eventos([[0, "ai"]]),
};
// a festa do fim: pulinhos em laco
anims["coelho/festa"] = {
  bones: {
    coelho: {
      translate: mover([[0, [0, 0], "sai"], [0.22, [0, 70], "entra"], [0.42, [0, 0]], [0.5, [0, 0]]]),
      scale: escala([[0, [1.12, 0.86], "sai"], [0.08, [0.9, 1.12], "suave"], [0.22, [1, 1], "suave"], [0.4, [0.94, 1.06], "sai"], [0.44, [1.12, 0.86], "suave"], [0.5, [1.12, 0.86]]]),
    },
  },
  slots: { coelho: { attachment: quadros([[0, "coelho_jump"], [0.42, "coelho_ready"]]), rgba: cor([[0, "ffffffff"]]) } },
};

// ---- o brilho de pegar (trilha 3): seis estrelas saindo do corpo, girando e sumindo
const BRILHO = 0.45;
anims["brilho/pega"] = { bones: {}, slots: {} };
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.3;
  const r = i % 2 ? 95 : 70;
  anims["brilho/pega"].bones[`brilho_${i + 1}`] = {
    translate: mover([[0, [0, 0], "sai"], [BRILHO, [Math.cos(a) * r, Math.sin(a) * r]]]),
    scale: escala([[0, [0.3, 0.3], "sai"], [0.12, [1.3, 1.3], "entra"], [BRILHO, [0.2, 0.2]]]),
    rotate: girar([[0, 0], [BRILHO, i % 2 ? 140 : -140]]),
  };
  anims["brilho/pega"].slots[`brilho_${i + 1}`] = { rgba: cor([[0, "ffffffff"], [0.25, "ffffffff"], [BRILHO, "ffffff00"]]) };
}

// ---- o placar (trilha 4): pula quando soma, treme e avermelha quando perde
anims["placar/soma"] = { bones: { placar: { scale: escala([[0, [1, 1], "sai"], [0.08, [1.3, 1.3], "suave"], [0.3, [1, 1]]]) } } };
anims["placar/perde"] = {
  bones: { placar: { translate: mover([[0, [0, 0]], [0.05, [-8, 0]], [0.1, [8, 0]], [0.15, [-6, 0]], [0.2, [4, 0]], [0.25, [0, 0]]]) } },
  slots: { pontos: { rgba: cor([[0, "ff5050ff"], [0.35, "ffffffff"]]) } },
};
// os ultimos segundos (trilha 5, em laco): o tempo pulsa vermelho
anims["tempo/urgente"] = {
  bones: { tempo: { scale: escala([[0, [1.25, 1.25], "sai"], [0.25, [1, 1]], [0.5, [1, 1]]]) } },
  slots: { tempo: { rgba: cor([[0, "ff4040ff"], [0.3, "ffffffff"], [0.5, "ffffffff"]]) } },
};

// ---- os itens (trilhas 20 a 28): entram flutuando pela direita (crescem com um passo do ponto),
// atravessam balancando e somem pela esquerda; pegos, sao puxados para o coelho e estouram
const PASSA = { moeda: 3.6, cenoura: 4.0, espinho: 3.2 }; // devagar o bastante para mirar o pulo (10/11)
function passa(osso: string, dur: number, extra: any = {}) {
  const bal = osso.startsWith("cenoura") ? 22 : 12;
  const pts: Ponto[] = [];
  for (let i = 0; i <= 4; i++) pts.push([(dur * i) / 4, [(-2 * ENTRA * i) / 4, i % 2 ? bal : i === 0 || i === 4 ? 0 : -bal], "lin"]);
  // o x anda linear e o y balanca suave: cada trecho com a curva por canal
  const translate = pts.map(([t, v], i) => {
    const c: any = { ...(t ? { time: +t.toFixed(4) } : {}), x: (v as number[])[0], y: (v as number[])[1] };
    const p = pts[i + 1];
    if (p) {
      const [t1, v1] = p as [number, number[]];
      const d = t1 - t;
      c.curve = [t + d / 3, c.x + (v1[0] - c.x) / 3, t1 - d / 3, v1[0] - (v1[0] - c.x) / 3, t + d * 0.4, c.y, t1 - d * 0.4, v1[1]];
    }
    return c;
  });
  return {
    bones: { [osso]: { translate, scale: escala([[0, [0.3, 0.3], "sai"], [0.18, [1.15, 1.15], "suave"], [0.3, [1, 1]]]), ...(extra.bone ?? {}) } },
    slots: { [osso]: { rgba: cor([[0, "ffffff00"], [0.15, "ffffffff"], [dur - 0.25, "ffffffff"], [dur, "ffffff00"]]), ...(extra.slot ?? {}) } },
  };
}
// a moeda gira pelos quadros da Kenney (de frente, de lado e de volta), uma volta a cada 0,54 s
const giro = (dur: number) => {
  const seq = ["moeda_1", "moeda_2", "moeda_3", "moeda_4", "moeda_3", "moeda_2"];
  const q: [number, string][] = [];
  for (let t = 0, i = 0; t < dur; t += 0.09, i++) q.push([+t.toFixed(2), seq[i % seq.length]]);
  return quadros(q);
};
// pego: do ponto em que estava (o mix da passagem) ate o meio do coelho, crescendo e sumindo
const pega = (osso: string, y: number, ev: string, slotExtra: any = {}) => ({
  bones: { [osso]: { translate: mover([[0, [-ENTRA, y], "sai"], [0.3, [-ENTRA, y + 50]]]), scale: escala([[0, [1, 1], "sai"], [0.1, [1.6, 1.6], "entra"], [0.3, [0.4, 0.4]]]) } },
  slots: { [osso]: { rgba: cor([[0, "ffffffff"], [0.12, "ffffffff"], [0.3, "ffffff00"]]), ...slotExtra } },
  events: eventos([[0, ev]]),
});
for (const n of MOEDAS) {
  const o = `moeda${n}`;
  anims[`${o}/passa`] = passa(o, PASSA.moeda, { slot: { attachment: giro(PASSA.moeda) } });
  // a altura do corpo menos a da moeda: ela chega ao meio do coelho (no alto, ao coelho no topo do pulo)
  anims[`${o}/pega`] = pega(o, n % 2 ? 0 : -20, "moeda", { attachment: quadros([[0, "moeda_1"]]) });
}
anims["cenoura/passa"] = passa("cenoura", PASSA.cenoura, { bone: { rotate: girar([[0, -12, "suave"], [0.75, 12, "suave"], [1.5, -12, "suave"], [2.25, 12, "suave"], [3, -12]]) } });
anims["cenoura/pega"] = pega("cenoura", -20, "cenoura");
for (const n of ESPINHOS) {
  const o = `espinho${n}`;
  anims[`${o}/passa`] = passa(o, PASSA.espinho, { bone: { rotate: girar([[0, 0], [PASSA.espinho, 540]]) } });
  // bateu no coelho: quica para cima e para tras, girando, e some
  anims[`${o}/bate`] = {
    bones: { [o]: { translate: mover([[0, [-ENTRA + 40, 0], "sai"], [0.5, [-ENTRA + 300, 220]]]), rotate: girar([[0, 0], [0.5, -400]]), scale: escala([[0, [1.2, 0.8], "sai"], [0.1, [1, 1]]]) } },
    slots: { [o]: { rgba: cor([[0, "ffffffff"], [0.3, "ffffffff"], [0.5, "ffffff00"]]) } },
  };
}

// ---- a interface
// o JOGAR (estados na trilha 10, os do role.set trocados): o normal pulsa, o em cima sobe e cresce, o
// apertado afunda e escurece, o desligado fica escuro e o texto apagado
anims["jogar/normal"] = {
  bones: { botao: { scale: escala([[0, [1, 1], "suave"], [1, [1.06, 1.06], "suave"], [2, [1, 1]]]) } },
  slots: { botao: { rgba: cor([[0, "ffffffff"]]) }, jogar: { rgba: cor([[0, "ffffffff"]]) } },
};
anims["jogar/em_cima"] = { bones: { botao: { scale: escala([[0, [1.1, 1.1]]]), translate: mover([[0, [0, 6]]]) } }, slots: { botao: { rgba: cor([[0, "ffffffff"]]) }, jogar: { rgba: cor([[0, "ffffffff"]]) } } };
anims["jogar/apertado"] = { bones: { botao: { scale: escala([[0, [0.93, 0.9]]]), translate: mover([[0, [0, -4]]]) } }, slots: { botao: { rgba: cor([[0, "c8d8c8ff"]]) }, jogar: { rgba: cor([[0, "e8f0e8ff"]]) } } };
anims["jogar/desligado"] = { bones: { botao: { scale: escala([[0, [1, 1]]]) } }, slots: { botao: { rgba: cor([[0, "8c8c8cff"]]) }, jogar: { rgba: cor([[0, "ffffff8c"]]) } } };
// o JOGAR sai quando a rodada comeca (trilha 30, por cima dos estados dele): cresce e cai
anims["jogar/sai"] = {
  bones: { botao: { scale: escala([[0, [1, 1], "sai"], [0.1, [1.15, 1.15], "entra"], [0.35, [0.6, 0.6]]]), translate: mover([[0, [0, 0], "sai"], [0.1, [0, 14], "entra"], [0.35, [0, -260]]]) } },
  slots: alfa(["botao", "jogar"], [[0, 1], [0.2, 1], [0.35, 0]]),
};
// o "de novo" (trilha 12): so escala, sem cor (a cor e do fim, que o mostra e o esconde)
anims["denovo/normal"] = { bones: { denovo: { scale: escala([[0, [1, 1], "suave"], [0.8, [1.06, 1.06], "suave"], [1.6, [1, 1]]]) } } };
anims["denovo/em_cima"] = { bones: { denovo: { scale: escala([[0, [1.1, 1.1]]]), translate: mover([[0, [0, 6]]]) } } };
anims["denovo/apertado"] = { bones: { denovo: { scale: escala([[0, [0.93, 0.9]]]), translate: mover([[0, [0, -4]]]) } } };
anims["denovo/desligado"] = { bones: { denovo: { scale: escala([[0, [1, 1]]]) } } };
// "toque para pular" no comeco da rodada (trilha 7)
anims["dica/mostra"] = {
  bones: { dica: { scale: escala([[0, [0.8, 0.8], "sai"], [0.25, [1.05, 1.05], "suave"], [0.4, [1, 1], "suave"], [1.2, [1.06, 1.06], "suave"], [2, [1, 1]]]) } },
  slots: alfa(["dica"], [[0, 0], [0.2, 1], [2.1, 1], [2.6, 0]]),
};

// o painel das missoes (trilha 1): entra pela direita. "desktop" no meio da altura (a janela deitada,
// a rodada toda); "retrato" mais alto e menor, so no menu (no celular em pe ele sai na rodada e no fim)
const pecasPainel = slotsDe("painel");
anims.desktop = {
  bones: { painel: { translate: mover([[0, [340, 0], "suave"], [0.6, [-12, 0], "suave"], [0.8, [0, 0]]]) } },
  slots: alfa(pecasPainel, [[0, 0], [0.3, 1]]),
};
anims.retrato = {
  bones: { painel: { translate: mover([[0, [340, 300], "suave"], [0.6, [-12, 300], "suave"], [0.8, [0, 300]]]), scale: escala([[0, [0.82, 0.82]]]) } },
  slots: alfa(pecasPainel, [[0, 0], [0.3, 1]]),
};
// a missao cumprida (trilhas 31 a 33): a caixa encolhe, troca para marcada e salta; a linha pula
for (const k of [1, 2, 3])
  anims[`missao${k}/feita`] = {
    bones: {
      [`m${k}_marca`]: { scale: escala([[0, [1, 1], "entra"], [0.08, [0.6, 0.6], "sai"], [0.22, [1.45, 1.45], "suave"], [0.45, [1, 1]]]), rotate: girar([[0, 0], [0.08, -15, "sai"], [0.3, 6, "suave"], [0.45, 0]]) },
      [`m${k}`]: { translate: mover([[0, [0, 0]], [0.1, [0, 0], "sai"], [0.2, [0, 8], "entra"], [0.32, [0, 0]]]) },
    },
    slots: { [`m${k}_caixa`]: { attachment: quadros([[0, "vazio"], [0.08, "marcado"]]) } },
    events: eventos([[0.08, "missao"]]),
  };
// o aviso da missao (trilha 6): desce de cima, segura e sobe sumindo
anims["aviso/mostra"] = {
  bones: { aviso: { translate: mover([[0, [0, 70], "sai"], [0.25, [0, -8], "suave"], [0.4, [0, 0]], [1.7, [0, 0], "entra"], [2.1, [0, 50]]]), scale: escala([[0, [0.8, 0.8], "sai"], [0.25, [1.05, 1.05], "suave"], [0.4, [1, 1]]]) } },
  slots: alfa(slotsDe("aviso"), [[0, 0], [0.15, 1], [1.8, 1], [2.1, 0]]),
};
// a pausa (trilha 34): o escuro, PAUSA caindo com passo do ponto e o icone vira "tocar" (o reverso volta)
anims["pausa/entra"] = {
  bones: { pausa_titulo: { scale: escala([[0, [0.6, 0.6], "sai"], [0.2, [1.1, 1.1], "suave"], [0.32, [1, 1]]]), translate: mover([[0, [0, 60], "sai"], [0.2, [0, -6], "suave"], [0.32, [0, 0]]]) } },
  slots: { ...alfa(["escuro"], [[0, 0], [0.25, 0.55]]), ...alfa(["pausa_texto"], [[0, 0], [0.15, 1]]), pausa: { attachment: quadros([[0, "pausa"], [0.02, "tocar"]]) } },
};
// o fim (trilha 35): o escuro, o painel crescendo com passo do ponto, o resultado; o recorde novo
// pisca em laco (trilha 36)
anims["fim/entra"] = {
  bones: { fim: { scale: escala([[0, [0.3, 0.3], "sai"], [0.35, [1.08, 1.08], "suave"], [0.5, [1, 1]]]), translate: mover([[0, [0, -120], "sai"], [0.35, [0, 10], "suave"], [0.5, [0, 0]]]) } },
  slots: { ...alfa(["escuro"], [[0, 0], [0.3, 0.5]]), ...alfa(slotsDe("fim").filter((s) => s !== "fim_novo"), [[0, 0], [0.2, 1]]) },
  events: eventos([[0, "fim"]]),
};
anims["fim/recorde"] = {
  bones: { fim_novo: { scale: escala([[0, [1, 1], "suave"], [0.3, [1.15, 1.15], "suave"], [0.6, [1, 1]]]), rotate: girar([[0, -3, "suave"], [0.3, 3, "suave"], [0.6, -3]]) } },
  slots: alfa(["fim_novo"], [[0, 1]]),
};
json.animations = anims;

// os campos que o editor escreve vem do documento (screen, textos, fatias, papeis e o setup mudado
// pelos comandos); as animacoes e as cores do setup, daqui
const final = { ...doc.json, events: json.events, animations: { ...doc.json.animations, ...json.animations }, slots: doc.json.slots.map((s: any) => ({ ...s, ...(json.slots.find((x: any) => x.name === s.name)?.color ? { color: json.slots.find((x: any) => x.name === s.name).color } : {}) })) };

const boneco = importarSpine(final, atlas, NOME);
// ida e volta: o editor le o que escrevemos
const volta = exportarSpine(boneco as any).json;
if (JSON.stringify(volta.screen) !== JSON.stringify(final.screen)) throw new Error("a tela nao voltou igual");
writeFileSync(join(AQUI, `${NOME}.boneco`), JSON.stringify(boneco, null, 1) + "\n");
// o manifesto (query.roles): o contrato entre quem monta a tela e quem escreve a logica
const docFinal = Document.fromText(JSON.stringify(volta), { text: atlas, pages: {} });
const man = (await executeAsync(docFinal, { cmd: "query.roles", args: { name: NOME } }, "gerar"))[0].manifest;
writeFileSync(join(AQUI, `${NOME}.manifesto.json`), JSON.stringify(man, null, 1) + "\n");
console.log(`${NOME}.boneco: ${json.bones.length} ossos, ${json.slots.length} slots, ${final.screen.anchors.length} ancoras, ${Object.keys(final.animations).length} animacoes; ${NOME}.png ${LARG}x${py + alt}`);
if (man.avisos?.length) console.log("avisos do manifesto:", man.avisos);
