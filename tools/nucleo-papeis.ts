// Confere os papeis do nucleo (docs/NUCLEO.md "Papeis"), que o oraculo nao tem: o boneco de
// tests/nucleo/papeis (um botao com nove-fatias que cresce com o texto, num osso girado e ancorado;
// um toque desenhado por cima dele; um botao girado com um filho e uma area so do filho; uma area
// em caixa num osso girado; um botao invisivel; uma malha; um texto do codigo) em varias janelas e
// medidas do texto. Refaz a area de cada papel pela especificacao (o mundo dos ossos e o tamanho da
// grade vem do nucleo-pose) e o papel em cada ponto de uma grade (o de cima na ordem de desenho),
// e compara com o nucleo nativo (nucleo-pose --papeis --toque), com o binario (a mesma saida) e com
// o wasm (mm_papel_area, mm_papel_no_ponto). Depois os estados dos botoes pelo ponteiro no wasm
// (em cima, apertado, sair apertado, soltar, dedo, desligado, a animacao de cada estado na trilha
// com o mix) e os erros de leitura.
//
//   npx tsx tools/nucleo-papeis.ts [--nucleo nucleo/build-web/nucleo.mjs] [--pose nucleo/build/nucleo-pose]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const POSE = resolve(opt("pose", "nucleo/build/nucleo-pose"));
const BIN = resolve(join(POSE, "..", "nucleo-binario"));
const N = await (await import(pathToFileURL(resolve(opt("nucleo", "nucleo/build-web/nucleo.mjs"))).href)).default();
const ARQ = resolve("tests/nucleo/papeis/papeis.boneco");
const TEXTO = readFileSync(ARQ, "utf8");
const base = JSON.parse(TEXTO);
const tmp = mkdtempSync(join(tmpdir(), "nucleo-papeis-"));

let falhas = 0,
  casos = 0;
const conferir = (ok: boolean, msg: string) => {
  casos++;
  if (!ok) falhas++, console.log("FALHA " + msg);
};
const perto = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const iguais = (a: number[], b: number[], tol = 1e-6) => a.length === b.length && a.every((x, i) => perto(x, b[i], tol));

const ARQ_BIN = join(tmp, "papeis.bin.boneco");
{
  const r = spawnSync(BIN, [ARQ, ARQ_BIN], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`nucleo-binario: ${r.stderr}`);
}

// ---- a conta pela especificacao

type Caso = { janela: [number, number] | null; medida: [number, number] | null };
type Mundo = Record<string, number[]>; // osso -> [a, b, c, d, x, y]
const PAPEIS: any[] = base.papeis;
const slots: any[] = base.slots;
const partes = (s: any) => base.skins[0].partes[s.nome][s.parte];
const desce = (osso: string, raiz: string): boolean => {
  for (let o: string | undefined = osso; o; o = base.ossos.find((b: any) => b.nome === o).pai) if (o === raiz) return true;
  return false;
};
const leva = (w: number[], x: number, y: number) => [w[0] * x + w[1] * y + w[4], w[2] * x + w[3] * y + w[5]];
const quad = (c: number[]) => [c[0], c[1], c[2], c[3], c[4], c[5], c[4], c[5], c[6], c[7], c[0], c[1]];
function cantosRegiao(p: any, l = p.largura, a = p.altura) {
  const r = ((p.rotacao ?? 0) * Math.PI) / 180,
    sx = p.escala_x ?? 1,
    sy = p.escala_y ?? 1;
  const out: number[] = [];
  for (const [u, v] of [
    [-l / 2, -a / 2],
    [-l / 2, a / 2],
    [l / 2, a / 2],
    [l / 2, -a / 2],
  ]) {
    const x = u * sx,
      y = v * sy;
    out.push((p.x ?? 0) + Math.cos(r) * x - Math.sin(r) * y, (p.y ?? 0) + Math.sin(r) * x + Math.cos(r) * y);
  }
  return out;
}
// a area do papel k: triangulos no mundo e a posicao mais alta na ordem de desenho
function areaSpec(k: number, mundo: Mundo, fat: Record<string, any>): { tri: number[]; pos: number } {
  const d = PAPEIS[k];
  if (d.tipo === "texto") return { tri: [], pos: -1 };
  const doSlot = d.area?.slot ? [d.area.slot] : slots.filter((s) => desce(s.osso, d.osso)).map((s) => s.nome);
  const soTexto = doSlot.every((n: string) => partes(slots.find((s) => s.nome === n)).tipo === "texto");
  let tri: number[] = [],
    pos = -1;
  for (const n of doSlot) {
    const i = slots.findIndex((s) => s.nome === n);
    const s = slots[i];
    if ((s.cor ?? "ffffffff").slice(6) === "00") continue;
    if (d.area?.caixa) {
      pos = Math.max(pos, i);
      continue;
    }
    const p = partes(s);
    if (p.tipo === "texto" && !soTexto) continue;
    const w = mundo[s.osso];
    let local: number[];
    if (p.tipo === "malha") {
      const v = p.vertices;
      for (let t = 0; t < p.triangulos.length; t++) tri.push(...leva(w, v[p.triangulos[t] * 2], v[p.triangulos[t] * 2 + 1]));
      pos = Math.max(pos, i);
      continue;
    }
    if (p.fatias) local = cantosRegiao(p, fat[n].largura, fat[n].altura);
    else local = cantosRegiao(p);
    const c: number[] = [];
    for (let j = 0; j < 8; j += 2) c.push(...leva(w, local[j], local[j + 1]));
    tri.push(...quad(c));
    pos = Math.max(pos, i);
  }
  if (d.area?.caixa) {
    const [x, y, l, a] = d.area.caixa;
    const c: number[] = [];
    for (const [u, v] of [
      [x - l / 2, y - a / 2],
      [x - l / 2, y + a / 2],
      [x + l / 2, y + a / 2],
      [x + l / 2, y - a / 2],
    ])
      c.push(...leva(mundo[d.osso], u, v));
    tri = [...tri, ...quad(c)];
  }
  return { tri, pos };
}
const dentro = (t: number[], o: number, x: number, y: number) => {
  const d1 = (x - t[o + 2]) * (t[o + 1] - t[o + 3]) - (t[o] - t[o + 2]) * (y - t[o + 3]);
  const d2 = (x - t[o + 4]) * (t[o + 3] - t[o + 5]) - (t[o + 2] - t[o + 4]) * (y - t[o + 5]);
  const d3 = (x - t[o]) * (t[o + 5] - t[o + 1]) - (t[o + 4] - t[o]) * (y - t[o + 1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
function papelSpec(areas: { tri: number[]; pos: number }[], x: number, y: number) {
  let melhor = -1,
    mp = -2;
  areas.forEach((a, k) => {
    let ok = false;
    for (let o = 0; o + 6 <= a.tri.length && !ok; o += 6) ok = dentro(a.tri, o, x, y);
    if (ok && a.pos >= mp) (melhor = k), (mp = a.pos);
  });
  return melhor;
}

// ---- o nucleo nativo

function nativo(arq: string, c: Caso, pontos: number[][]) {
  const extra = [...(c.janela ? ["--janela", c.janela.join("x")] : []), ...(c.medida ? ["--texto", `0:${c.medida.join("x")}`] : []), "--papeis", "--fatias", ...pontos.flatMap((p) => ["--toque", p.join(",")])];
  const r = spawnSync(POSE, [arq, "-", "0", ...extra], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`nucleo-pose: ${r.stderr}`);
  const pose = JSON.parse(r.stdout).quadros[0];
  const papeis = JSON.parse(/^papeis (.*)$/m.exec(r.stderr)![1]);
  const fat = JSON.parse(/^fatias (.*)$/m.exec(r.stderr)![1]);
  const vista = /^vista (.*)$/m.exec(r.stderr)?.[1].split(" ").map(Number);
  return { pose, papeis, fat, vista };
}

// ---- o wasm

function abrirWasm(c: Caso) {
  const p = N.stringToNewUTF8(TEXTO);
  const m = N._mm_carregar(p);
  N._free(p);
  if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
  const i = N._mm_instancia(m);
  N._mm_reiniciar(i);
  if (c.janela) N._mm_janela(i, ...c.janela);
  if (c.medida) N._mm_texto_medida(i, 0, ...c.medida);
  N._mm_passo(i, 0);
  return { m, i, info: JSON.parse(N.UTF8ToString(N._mm_info(m))) };
}
const saida = (n: number) => Array.from(N.HEAPF64.subarray(N._mm_saida() / 8, N._mm_saida() / 8 + n)) as number[];

// ---- as areas e os toques em cada caso

const CASOS: Caso[] = [
  { janela: null, medida: null },
  { janela: null, medida: [600, 50] },
  { janela: [1080, 1920], medida: null },
  { janela: [1920, 1080], medida: [300, 40] },
  { janela: [700, 2000], medida: [500, 60] },
];
for (const c of CASOS) {
  const nome = `${c.janela?.join("x") ?? "arte"} medida ${c.medida?.join("x") ?? "-"}`;
  // a grade de pontos na vista (ou na arte), mais os meios de cada area
  const n0 = nativo(ARQ, c, []);
  const [vx, vy, vw, vh] = n0.vista ? n0.vista.slice(1) : [-300, 0, 600, 1000];
  const mundo: Mundo = Object.fromEntries(Object.entries<number[]>(n0.pose.ossos).map(([n, m]) => [n, m]));
  const fat: Record<string, any> = n0.fat;
  const spec = PAPEIS.map((_, k) => areaSpec(k, mundo, fat));
  const pontos: number[][] = [];
  for (let gx = 0; gx <= 60; gx++) for (let gy = 0; gy <= 100; gy++) pontos.push([vx + (vw * gx) / 60, vy + (vh * gy) / 100]);
  for (const a of spec) for (let o = 0; o + 6 <= a.tri.length; o += 6) pontos.push([(a.tri[o] + a.tri[o + 2] + a.tri[o + 4]) / 3, (a.tri[o + 1] + a.tri[o + 3] + a.tri[o + 5]) / 3]);
  // o nativo em lotes (a linha de comando), o binario com os mesmos pontos
  const tn: number[] = [],
    tb: number[] = [];
  let areasN: Record<string, number[]> = {};
  for (let i = 0; i < pontos.length; i += 800) {
    const lote = pontos.slice(i, i + 800);
    const a = nativo(ARQ, c, lote),
      b = nativo(ARQ_BIN, c, lote);
    tn.push(...a.papeis.toques);
    tb.push(...b.papeis.toques);
    areasN = a.papeis.areas;
    conferir(JSON.stringify(a.papeis) === JSON.stringify(b.papeis), `${nome}: o binario da o mesmo`);
  }
  PAPEIS.forEach((d, k) => conferir(iguais(areasN[d.nome], spec[k].tri, 1e-6), `${nome}: area de ${d.nome} ${JSON.stringify(areasN[d.nome]?.slice(0, 8))} contra ${JSON.stringify(spec[k].tri.slice(0, 8))}`));
  let difs = 0;
  pontos.forEach((p, j) => {
    if (tn[j] !== papelSpec(spec, p[0], p[1])) difs++;
  });
  conferir(difs === 0, `${nome}: o papel em ${pontos.length} pontos (${difs} diferentes da conta)`);
  // o wasm igual ao nativo
  const w = abrirWasm(c);
  PAPEIS.forEach((d, k) => conferir(iguais(saida(N._mm_papel_area(w.i, k)), areasN[d.nome], 1e-9), `${nome}: wasm, area de ${d.nome}`));
  let difW = 0;
  pontos.forEach((p, j) => {
    if (N._mm_papel_no_ponto(w.i, p[0], p[1]) !== tn[j]) difW++;
  });
  conferir(difW === 0, `${nome}: wasm, o papel em ${pontos.length} pontos (${difW} diferentes)`);
  N._mm_liberar_instancia(w.i);
  N._mm_liberar_modelo(w.m);
  // o que deve valer em todo caso
  const k = (n: string) => PAPEIS.findIndex((d) => d.nome === n);
  conferir(spec[k("sumido")].tri.length === 0 && !tn.includes(k("sumido")), `${nome}: o invisivel nao tem area`);
  conferir(spec[k("pontos")].tri.length === 0, `${nome}: o texto do codigo nao e area de toque`);
  // a area do botao e a grade da nove-fatias, nao a caixa do texto (400 de largura)
  conferir(perto(fat.fundo_botao.largura, Math.max(240, (c.medida?.[0] ?? 0) + 40)), `${nome}: o botao cresce com o texto (${fat.fundo_botao.largura})`);
  conferir(perto(Math.hypot(spec[k("jogar")].tri[4] - spec[k("jogar")].tri[2], spec[k("jogar")].tri[5] - spec[k("jogar")].tri[3]), fat.fundo_botao.largura, 1e-6), `${nome}: a area do botao tem a largura da grade`);
}
// a ordem: o toque desenhado por cima ganha onde cobre o botao; a area so do filho ganha no filho
{
  const c: Caso = { janela: null, medida: null };
  const n0 = nativo(ARQ, c, [
    [110, 150],
    [-60, 150],
    [276, 930],
    [220, 900],
  ]);
  const nomes = n0.papeis.toques.map((k: number) => PAPEIS[k]?.nome ?? null);
  conferir(JSON.stringify(nomes) === JSON.stringify(["tampa", "jogar", "so_icone", "pausa"]), `a ordem de desenho decide: ${JSON.stringify(nomes)}`);
}

// ---- os estados dos botoes pelo ponteiro (wasm)
{
  const w = abrirWasm({ janela: null, medida: null });
  const kj = w.info.papeis.findIndex((p: any) => p.nome === "jogar");
  const kp = w.info.papeis.findIndex((p: any) => p.nome === "pausa");
  const anim = (n: string) => w.info.animacoes.findIndex((a: any) => a.nome === n);
  const est = (k: number) => N._mm_papel_estado(w.i, k);
  const naTrilha = (t: number) => {
    const a = N._mm_estado_atual(w.i, t);
    return a < 0 ? null : { anim: w.info.animacoes[a]?.nome, loop: saida(4)[1], mix: saida(4)[2] };
  };
  const toques = () => saida(N._mm_papeis_toques(w.i));
  conferir(est(kj) === -1, "antes de iniciar, sem estado");
  N._mm_papeis_iniciar(w.i);
  conferir(w.info.papeis[kj].trilha === 10 && w.info.papeis[kp].trilha === 3 && w.info.papeis[kp].mix === 0.25, "a trilha padrao (10 + a ordem entre os botoes) e a do arquivo");
  const t0 = naTrilha(10);
  conferir(est(kj) === 0 && t0?.anim === "jogar/normal" && t0.loop === 1 && t0.mix === 0, `iniciar: normal em laco, sem mix ${JSON.stringify(t0)}`);
  conferir(est(kp) === 3 && naTrilha(3)?.anim === "pausa/normal", "a pausa comeca desligada (sem animacao de desligado: a do normal)");
  const sobre = [-60, 150],
    fora = [-250, 950];
  const p = (tipo: number, xy: number[]) => N._mm_papeis_ponteiro(w.i, tipo, xy[0], xy[1]);
  conferir(p(0, sobre) === kj && est(kj) === 1 && naTrilha(10)?.anim === "jogar/em_cima" && naTrilha(10)?.loop === 0 && naTrilha(10)?.mix === 0.1, `em cima ${JSON.stringify(naTrilha(10))}`);
  p(1, sobre);
  conferir(est(kj) === 2 && naTrilha(10)?.anim === "jogar/apertado", "apertado");
  p(0, fora);
  conferir(est(kj) === 0 && naTrilha(10)?.anim === "jogar/normal", "apertado e saiu: normal");
  p(0, sobre);
  conferir(est(kj) === 2, "voltou apertado");
  p(2, sobre);
  conferir(JSON.stringify(toques()) === JSON.stringify([kj]) && est(kj) === 1, "soltou no botao (mouse): toque e em cima");
  conferir(toques().length === 0, "quem le esvazia");
  p(1, sobre);
  p(2, fora);
  conferir(toques().length === 0 && est(kj) === 0, "soltou fora: sem toque");
  p(1, sobre);
  p(3, sobre);
  conferir(JSON.stringify(toques()) === JSON.stringify([kj]) && est(kj) === 0, "dedo: toque e normal (sem em cima)");
  N._mm_papel_desligar(w.i, kj, 1);
  conferir(est(kj) === 3 && naTrilha(10)?.anim === "jogar/desligado" && naTrilha(10)?.loop === 1, "desligado");
  p(1, sobre);
  p(2, sobre);
  conferir(toques().length === 0 && est(kj) === 3 && N._mm_papel_desligado(w.i, kj) === 1, "desligado nao toca");
  N._mm_papel_desligar(w.i, kj, 0);
  conferir(est(kj) === 1, "religado com o ponteiro em cima: em cima");
  N._mm_papel_desligar(w.i, kp, 0);
  conferir(est(kp) === 0, "a pausa religada");
  p(1, [220, 900]);
  conferir(est(kp) === 2 && naTrilha(3)?.anim === "pausa/normal", "o estado sem animacao cai no normal");
  p(4, [0, 0]);
  conferir(est(kp) === 0 && est(kj) === 0, "saiu da janela: todos normal");
  // o toque (sem estados) tambem toca; o apertado mostrado a mao
  const kt = w.info.papeis.findIndex((x: any) => x.nome === "tampa");
  p(1, [110, 150]);
  p(3, [110, 150]);
  conferir(JSON.stringify(toques()) === JSON.stringify([kt]), "o toque toca");
  N._mm_papel_mostrar(w.i, kj, 2);
  conferir(est(kj) === 2 && naTrilha(10)?.anim === "jogar/apertado", "mostrar um estado");
  // reiniciar desliga os botoes ate iniciar de novo
  N._mm_reiniciar(w.i);
  conferir(est(kj) === -1 && N._mm_papeis_ponteiro(w.i, 0, sobre[0], sobre[1]) === -1, "reiniciar esquece os botoes");
  // o jogo pausa trilhas (mm_estado_ritmo: a pausa do jogo, com os botoes andando) e solta uma trilha
  // (mm_estado_vazio: o que ela animava volta ao de baixo); tela.ritmo e tela.soltar na web
  const relogio = (t: number) => (N._mm_estado_atual(w.i, t) < 0 ? -1 : saida(4)[3]);
  conferir(N._mm_estado_ritmo(w.i, 5, 0) === 0, "ritmo numa trilha vazia: nada");
  N._mm_estado_tocar(w.i, 5, anim("jogar/normal"), 1, 0);
  N._mm_estado_enfileirar(w.i, 5, anim("jogar/apertado"), 0, 0.5, 0);
  N._mm_estado_tocar(w.i, 6, anim("jogar/normal"), 1, 0);
  N._mm_passo(w.i, 0.3);
  conferir(N._mm_estado_ritmo(w.i, 5, 0) === 1, "ritmo 0 na trilha 5");
  N._mm_passo(w.i, 1);
  conferir(perto(relogio(5), 0.3, 1e-9) && naTrilha(5)?.anim === "jogar/normal" && perto(relogio(6), 1.3, 1e-9), `pausada: o relogio da 5 parado em ${relogio(5)} e a fila esperando; a 6 anda (${relogio(6)})`);
  N._mm_estado_ritmo(w.i, 5, 0.5);
  N._mm_passo(w.i, 0.2);
  conferir(perto(relogio(5), 0.4, 1e-9), `ritmo 0,5: anda a metade (${relogio(5)})`);
  N._mm_estado_ritmo(w.i, 5, 1);
  N._mm_passo(w.i, 0.2);
  N._mm_passo(w.i, 0);
  conferir(naTrilha(5)?.anim === "jogar/apertado", "ritmo 1: a fila volta a andar");
  N._mm_estado_vazio(w.i, 6, 0);
  N._mm_passo(w.i, 0.1);
  N._mm_passo(w.i, 0.1);
  conferir(N._mm_estado_atual(w.i, 6) === -1, "soltar: a trilha 6 fica vazia");
  N._mm_liberar_instancia(w.i);
  N._mm_liberar_modelo(w.m);
}

// ---- erros de leitura
const erros: [string, (j: any) => void][] = [
  ["nome repetido", (j) => j.papeis.push({ ...j.papeis[1] })],
  ["tipo desconhecido", (j) => (j.papeis[1].tipo = "lista")],
  ["animacao desconhecida", (j) => (j.papeis[0].estados.normal = "nao_ha")],
  ["nao tem parte de texto", (j) => (j.papeis[7].slot = "tampa")],
  ["nao e do osso", (j) => (j.papeis[6].area.slot = "tampa")],
  ["largura e altura positivas", (j) => (j.papeis[3].area.caixa = [0, 0, 0, 10])],
  ["osso desconhecido", (j) => (j.papeis[1].osso = "nao_ha")],
  ["papel sem nome", (j) => delete j.papeis[1].nome],
];
for (const [msg, muda] of erros) {
  const j = structuredClone(base);
  muda(j);
  const arq = join(tmp, "erro.boneco");
  writeFileSync(arq, JSON.stringify(j));
  const r = spawnSync(POSE, [arq, "-", "0"], { encoding: "utf8" });
  conferir(r.status !== 0 && r.stderr.includes(msg), `erro de leitura "${msg}": ${r.stderr.trim()}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`${casos - falhas} de ${casos} conferencias ok`);
if (falhas) process.exit(1);
