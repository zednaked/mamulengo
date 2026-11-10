// Confere a tela do nucleo (docs/NUCLEO.md "Tela"), que o oraculo nao tem: o boneco de
// tests/nucleo/tela (arte base 700 x 1370, ossos presos aos cantos, ao meio das bordas e ao centro,
// esticando em x, em y e nos dois, um ancorado dentro de um que estica, um filho sem ancora e um
// osso girado com animacao) em janelas de celular, tablet e desktop, nos quatro encaixes. Para cada
// caso, compara o mundo de cada osso com a conta refeita aqui pela especificacao (a vista centrada
// na arte), no nucleo nativo (nucleo-pose --janela), no binario e no wasm.
//
//   npx tsx tools/nucleo-tela.ts [--nucleo nucleo/build-web/nucleo.mjs] [--pose nucleo/build/nucleo-pose]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const POSE = resolve(opt("pose", "nucleo/build/nucleo-pose"));
const BIN = resolve(join(POSE, "..", "nucleo-binario"));
const N = await (await import(pathToFileURL(resolve(opt("nucleo", "nucleo/build-web/nucleo.mjs"))).href)).default();
const ARQ = resolve("tests/nucleo/tela/tela.boneco");
const base = JSON.parse(readFileSync(ARQ, "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "nucleo-tela-"));

let falhas = 0,
  casos = 0;
const conferir = (ok: boolean, msg: string) => {
  casos++;
  if (!ok) falhas++, console.log("FALHA " + msg);
};

const JANELAS: [string, number, number][] = [
  ["celular 9:16", 1080, 1920],
  ["celular 9:20", 1080, 2400],
  ["tablet 3:4", 1536, 2048],
  ["desktop 16:9", 1920, 1080],
  ["desktop 21:9", 2560, 1080],
  ["a propria arte", 700, 1370],
];
const ENCAIXES = ["caber", "cobrir", "largura", "altura"] as const;

// ---- a conta pela especificacao
const [BX, BY, BW, BH] = base.tela.arte as number[];
function esperado(enc: (typeof ENCAIXES)[number], W: number, H: number) {
  const s = enc === "caber" ? Math.min(W / BW, H / BH) : enc === "cobrir" ? Math.max(W / BW, H / BH) : enc === "largura" ? W / BW : H / BH;
  const vw = W / s,
    vh = H / s;
  const dw = vw - BW,
    dh = vh - BH,
    kx = vw / BW,
    ky = vh / BH;
  const cx = BX + BW / 2,
    cy = BY + BH / 2;
  // [x, y, escala do eixo x no mundo (a), escala do eixo y (d)]
  const ancorado = (x0: number, y0: number, ax: number, ay: number, e = "") => [
    e.includes("x") ? cx + (x0 - cx) * kx : x0 + (ax - 0.5) * dw,
    e.includes("y") ? cy + (y0 - cy) * ky : y0 + (0.5 - ay) * dh,
  ];
  const placar = ancorado(0, 1300, 0.5, 0);
  const barra = ancorado(0, 1340, 0.5, 0, "x");
  return {
    vista: [s, cx - vw / 2, cy - vh / 2, vw, vh],
    ossos: {
      placar: [...placar, 1, 1],
      placar_texto: [placar[0] + 40, placar[1] - 10, 1, 1],
      barra: [...barra, kx, 1],
      fechar: [...ancorado(330, 1340, 1, 0), 1, 1],
      botao: [...ancorado(0, 80, 0.5, 1), 1, 1],
      painel: [...ancorado(300, 685, 1, 0.5), 0.5, 1],
      fundo: [...ancorado(0, 685, 0.5, 0.5, "xy"), kx, ky],
      heroi: [0, 600, 1, 1],
    } as Record<string, number[]>,
  };
}

const TOL = 1e-6;
const perto = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function nativo(arquivo: string, W: number, H: number, anim = "-", t = 0) {
  const r = spawnSync(POSE, [arquivo, anim, String(t), "--janela", `${W}x${H}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`nucleo-pose: ${r.stderr}`);
  const vista = /vista (\S+) (\S+) (\S+) (\S+) (\S+)/.exec(r.stderr)!.slice(1).map(Number);
  return { vista, ossos: JSON.parse(r.stdout).quadros[0].ossos as Record<string, number[]> };
}

function wasm(texto: string, W: number, H: number, anim = -1, t = 0) {
  const p = N.stringToNewUTF8(texto);
  const m = N._mm_carregar(p);
  N._free(p);
  if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
  const i = N._mm_instancia(m);
  N._mm_janela(i, W, H);
  const v = Array.from(N.HEAPF64.subarray(N._mm_vista(i) / 8, N._mm_vista(i) / 8 + 5)) as number[];
  N._mm_tocar(i, anim, 1);
  if (t > 0) N._mm_avancar(i, t);
  const info = JSON.parse(N.UTF8ToString(N._mm_info(m)));
  const q = N._mm_pose_ossos(i) / 8;
  const ossos: Record<string, number[]> = {};
  info.ossos.forEach((o: { nome: string }, k: number) => (ossos[o.nome] = Array.from(N.HEAPF64.subarray(q + k * 14, q + k * 14 + 6))));
  N._mm_liberar_instancia(i);
  N._mm_liberar_modelo(m);
  return { vista: v, ossos, tela: info.tela };
}

for (const enc of ENCAIXES) {
  const b = structuredClone(base);
  b.tela.encaixe = enc;
  const texto = JSON.stringify(b);
  const arq = join(tmp, `tela-${enc}.boneco`);
  writeFileSync(arq, texto);
  const arqBin = join(tmp, `tela-${enc}-bin.boneco`);
  const rb = spawnSync(BIN, [arq, arqBin], { encoding: "utf8" });
  if (rb.status !== 0) throw new Error(`nucleo-binario: ${rb.stderr}`);
  for (const [nome, W, H] of JANELAS) {
    const esp = esperado(enc, W, H);
    const nat = nativo(arq, W, H);
    const bin = nativo(arqBin, W, H);
    const web = wasm(texto, W, H);
    const caso = `${enc} ${nome} (${W}x${H})`;
    conferir(nat.vista.every((x, k) => perto(x, esp.vista[k])), `${caso}: vista ${nat.vista} esperada ${esp.vista}`);
    conferir(web.vista.every((x, k) => x === nat.vista[k]), `${caso}: vista do wasm ${web.vista} diferente da nativa`);
    for (const [osso, [x, y, a, d]] of Object.entries(esp.ossos)) {
      const o = nat.ossos[osso];
      // posicao a 0,001 px (o pi do nucleo e o do oraculo, 3.1415927: um eixo a 90 graus sai com
      // 2e-8 de sobra, alguns centesimos de milesimo nesta altura); escala a 1e-6
      conferir(Math.abs(o[4] - x) < 1e-3 && Math.abs(o[5] - y) < 1e-3 && perto(Math.hypot(o[0], o[2]), a) && perto(Math.hypot(o[1], o[3]), d), `${caso}: ${osso} em [${o[4]}, ${o[5]}] eixos ${Math.hypot(o[0], o[2])}, ${Math.hypot(o[1], o[3])}; esperado [${x}, ${y}] ${a}, ${d}`);
      conferir(JSON.stringify(bin.ossos[osso]) === JSON.stringify(o), `${caso}: ${osso} no binario difere`);
      conferir(web.ossos[osso].every((v, k) => perto(v, o[k], 1e-12)), `${caso}: ${osso} no wasm ${web.ossos[osso]} contra ${o}`);
    }
  }
}

// cobrir sem deformar (`cobre`): o cenario preso embaixo com uma caixa maior que a arte escala por
// igual em volta do proprio ponto ate cobrir a vista (nunca menos que 1); a lampada (filha sem
// ancora) vai junto; o letreiro (ancorado dentro dele) nao escala; o ceu, girado e preso em cima,
// tem o ponto fora da caixa por baixo (esse lado nao conta)
{
  const b = structuredClone(base);
  b.ossos.push(
    { nome: "cenario", pai: "root", x: 0, y: 400 },
    { nome: "lampada", pai: "cenario", x: 100, y: 300, rotacao: 20 },
    { nome: "letreiro", pai: "cenario", x: -200, y: 800 },
    { nome: "ceu", pai: "root", x: 50, y: 1200, rotacao: 30 },
  );
  b.tela.ancoras.push(
    { osso: "cenario", ancora: [0.5, 1], cobre: [-600, -200, 1200, 1800] },
    { osso: "letreiro", ancora: [0, 0] },
    { osso: "ceu", ancora: [0.5, 0], cobre: [-400, 1250, 800, 300] },
  );
  const cobre = (P: number[], x0: number, y0: number, c: number[], vx: number, vy: number, vw: number, vh: number) => {
    let k = 1;
    const [cx, cy, cw, ch] = c;
    if (x0 - cx > 0) k = Math.max(k, (P[0] - vx) / (x0 - cx));
    if (cx + cw - x0 > 0) k = Math.max(k, (vx + vw - P[0]) / (cx + cw - x0));
    if (y0 - cy > 0) k = Math.max(k, (P[1] - vy) / (y0 - cy));
    if (cy + ch - y0 > 0) k = Math.max(k, (vy + vh - P[1]) / (cy + ch - y0));
    return k;
  };
  let maior = 1;
  for (const enc of ENCAIXES) {
    b.tela.encaixe = enc;
    const texto = JSON.stringify(b);
    const arq = join(tmp, `cobre-${enc}.boneco`);
    writeFileSync(arq, texto);
    const arqBin = join(tmp, `cobre-${enc}-bin.boneco`);
    const rb = spawnSync(BIN, [arq, arqBin], { encoding: "utf8" });
    if (rb.status !== 0) throw new Error(`nucleo-binario: ${rb.stderr}`);
    for (const [nome, W, H] of JANELAS) {
      const [s, vx, vy, vw, vh] = esperado(enc, W, H).vista;
      const dw = vw - BW,
        dh = vh - BH;
      const ponto = (x0: number, y0: number, ax: number, ay: number) => [x0 + (ax - 0.5) * dw, y0 + (0.5 - ay) * dh];
      void s;
      const P = ponto(0, 400, 0.5, 1);
      const k = cobre(P, 0, 400, [-600, -200, 1200, 1800], vx, vy, vw, vh);
      maior = Math.max(maior, k);
      const Q = ponto(50, 1200, 0.5, 0);
      const kc = cobre(Q, 50, 1200, [-400, 1250, 800, 300], vx, vy, vw, vh);
      const L = ponto(-200, 1200, 0, 0);
      const esp: Record<string, number[]> = {
        cenario: [P[0], P[1], k, k],
        lampada: [P[0] + 100 * k, P[1] + 300 * k, k, k],
        letreiro: [L[0], L[1], 1, 1],
        ceu: [Q[0], Q[1], kc, kc],
      };
      const nat = nativo(arq, W, H);
      const bin = nativo(arqBin, W, H);
      const web = wasm(texto, W, H);
      const caso = `cobre ${enc} ${nome} (${W}x${H})`;
      for (const [osso, [x, y, a, d]] of Object.entries(esp)) {
        const o = nat.ossos[osso];
        conferir(Math.abs(o[4] - x) < 1e-3 && Math.abs(o[5] - y) < 1e-3 && perto(Math.hypot(o[0], o[2]), a) && perto(Math.hypot(o[1], o[3]), d), `${caso}: ${osso} em [${o[4]}, ${o[5]}] eixos ${Math.hypot(o[0], o[2])}, ${Math.hypot(o[1], o[3])}; esperado [${x}, ${y}] ${a}, ${d}`);
        conferir(JSON.stringify(bin.ossos[osso]) === JSON.stringify(o), `${caso}: ${osso} no binario difere`);
        conferir(web.ossos[osso].every((v, j) => perto(v, o[j], 1e-12)), `${caso}: ${osso} no wasm ${web.ossos[osso]} contra ${o}`);
      }
      // a caixa escalada cobre a vista (nos lados em que o ponto esta dentro dela)
      const box = [P[0] - 600 * k, P[1] - 600 * k, P[0] + 600 * k, P[1] + 1200 * k];
      conferir(box[0] <= vx + 1e-6 && box[1] <= vy + 1e-6 && box[2] >= vx + vw - 1e-6 && box[3] >= vy + vh - 1e-6, `${caso}: a caixa do cenario nao cobre a vista`);
    }
  }
  conferir(maior > 1.5, `cobre: nenhum caso escalou o cenario (${maior})`);
  const t = wasm(JSON.stringify(b), 0, 0).tela;
  conferir(JSON.stringify(t.ancoras.find((a: any) => a.cobre)?.cobre) === "[-600,-200,1200,1800]", `mm_info.tela com cobre: ${JSON.stringify(t.ancoras)}`);
}

// a animacao soma por cima da correcao: o botao sobe 50 a partir do lugar dele na janela
{
  const W = 1080,
    H = 2400;
  const esp = esperado("caber", W, H).ossos.botao;
  const nat = nativo(ARQ, W, H, "sobe", 0.5).ossos.botao;
  conferir(Math.abs(nat[4] - esp[0]) < 1e-3 && Math.abs(nat[5] - esp[1] - 25) < 1e-3, `animacao sobre a ancora: botao em ${nat[4]}, ${nat[5]}; esperado ${esp[0]}, ${esp[1] + 25}`);
  const web = wasm(readFileSync(ARQ, "utf8"), W, H, 0, 0.5).ossos.botao;
  conferir(perto(web[5], nat[5], 1e-9), `animacao sobre a ancora no wasm: ${web[5]} contra ${nat[5]}`);
}

// o codigo mexe num osso (mm_osso_local, tela.mexer): fica la com a animacao tocando (ela nao mexe
// nele), a ancora soma por cima; uma animacao que mexe no osso manda (o botao na "sobe")
{
  const W = 1080,
    H = 2400;
  const b = structuredClone(base);
  b.slots = [{ nome: "marca", osso: "placar", parte: "a" }];
  b.skins = [{ nome: "default", partes: { marca: { a: { tipo: "caixa", num_vertices: 3, vertices: [0, 0, 10, 0, 10, 10] }, b: { tipo: "caixa", num_vertices: 3, vertices: [0, 0, 5, 0, 5, 5] } } } }];
  const p = N.stringToNewUTF8(JSON.stringify(b));
  const m = N._mm_carregar(p);
  N._free(p);
  if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
  const i = N._mm_instancia(m);
  N._mm_reiniciar(i);
  N._mm_janela(i, W, H);
  const info = JSON.parse(N.UTF8ToString(N._mm_info(m)));
  const k = info.ossos.findIndex((o: any) => o.nome === "placar");
  const kb = info.ossos.findIndex((o: any) => o.nome === "botao");
  N._mm_estado_tocar(i, 0, 0, 1, 0);
  N._mm_passo(i, 0.1);
  N._mm_osso_local(i, k, 100, 1300, 0, 2, 2);
  N._mm_osso_local(i, kb, 999, 999, 10, 1, 1);
  N._mm_passo(i, 0.1);
  const q = N._mm_pose_ossos(i) / 8;
  const o = Array.from(N.HEAPF64.subarray(q + k * 14, q + k * 14 + 6)) as number[];
  const ob = Array.from(N.HEAPF64.subarray(q + kb * 14, q + kb * 14 + 6)) as number[];
  const esp = esperado("caber", W, H).ossos;
  conferir(Math.abs(o[4] - (esp.placar[0] + 100)) < 1e-3 && Math.abs(o[5] - esp.placar[1]) < 1e-3 && perto(Math.hypot(o[0], o[2]), 2), `mexer: placar em ${o}; esperado x ${esp.placar[0] + 100}, escala 2`);
  conferir(Math.abs(ob[4] - 999) > 1, `mexer: a animacao manda no botao (${ob[4]})`);
  // a parte de um slot pelo nome: tira e volta
  const sl = 0;
  const nomeParte = "b";
  if (nomeParte) {
    const vazio = N.stringToNewUTF8("");
    conferir(N._mm_slot_parte(i, sl, vazio) === 1, "mm_slot_parte tira");
    N._free(vazio);
    N._mm_passo(i, 0);
    const ps = N._mm_pose_slots(i) / 8;
    conferir(N.HEAPF64[ps + sl * 5] === -1, `mm_slot_parte: o slot ficou sem parte (${N.HEAPF64[ps + sl * 5]})`);
    const pn = N.stringToNewUTF8(nomeParte);
    conferir(N._mm_slot_parte(i, sl, pn) === 1, "mm_slot_parte troca");
    N._mm_passo(i, 0);
    const pb = info.partes.findIndex((x: any) => x.nome === "b");
    conferir(N.HEAPF64[N._mm_pose_slots(i) / 8 + sl * 5] === pb, `mm_slot_parte: a parte b (${pb}) no slot`);
    N._free(pn);
    const pz = N.stringToNewUTF8("nao_existe");
    conferir(N._mm_slot_parte(i, sl, pz) === 0, "mm_slot_parte: parte que nao existe devolve 0");
    N._free(pz);
  } else conferir(false, "o tela.boneco nao tem parte para o teste do mm_slot_parte");
  N._mm_liberar_instancia(i);
  N._mm_liberar_modelo(m);
}

// o mm_info devolve a tela (para o editor)
{
  const t = wasm(readFileSync(ARQ, "utf8"), 0, 0).tela;
  conferir(t?.encaixe === "caber" && t.ancoras.length === 6 && t.ancoras[1].estica === "x" && JSON.stringify(t.arte) === "[-350,0,700,1370]", `mm_info.tela: ${JSON.stringify(t)}`);
}

// erros de leitura
for (const [msg, tela] of [
  ["osso repetido", { arte: [0, 0, 10, 10], ancoras: [{ osso: "placar" }, { osso: "placar" }] }],
  ["osso desconhecido", { arte: [0, 0, 10, 10], ancoras: [{ osso: "nada" }] }],
  ["encaixe desconhecido", { arte: [0, 0, 10, 10], encaixe: "esticar" }],
  ["largura e altura", { arte: [0, 0, 0, 10] }],
  ["cobre e [x, y, largura, altura]", { arte: [0, 0, 10, 10], ancoras: [{ osso: "placar", cobre: [0, 0, 10] }] }],
  ["cobre sem largura", { arte: [0, 0, 10, 10], ancoras: [{ osso: "placar", cobre: [0, 0, 0, 10] }] }],
  ["cobre nao estica", { arte: [0, 0, 10, 10], ancoras: [{ osso: "placar", estica: "x", cobre: [0, 0, 10, 10] }] }],
] as [string, any][]) {
  const b = structuredClone(base);
  b.tela = tela;
  const p = N.stringToNewUTF8(JSON.stringify(b));
  const m = N._mm_carregar(p);
  N._free(p);
  conferir(m < 0 && N.UTF8ToString(N._mm_erro()).includes(msg), `erro de leitura "${msg}": ${m < 0 ? N.UTF8ToString(N._mm_erro()) : "leu"}`);
}

console.log(`${casos - falhas} de ${casos} conferencias ok (${ENCAIXES.length} encaixes x ${JANELAS.length} janelas, nativo, binario e wasm)`);
process.exit(falhas ? 1 : 0);
