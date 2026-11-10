// Confere as nove-fatias do nucleo (docs/NUCLEO.md "Nove-fatias"), que o oraculo nao tem: o boneco
// de tests/nucleo/fatias (um painel ancorado esticando em x e em y, com a imagem no dobro do tamanho;
// ladrilhos num filho dele, repetindo em x e repetindo para caber em y; uma barra esticando so em x
// com a imagem cortada e girada no atlas; uma regiao girada 90 graus na barra; o fundo de um botao que
// acompanha a medida do texto, num osso girado com uma animacao de escala) em varias janelas. Para
// cada caso (o botao com a caixa maior que a imagem), refaz a conta pela especificacao (o esticar da janela, o tamanho, os pedacos de cada
// eixo, a grade, os uvs e os triangulos) e compara com o nucleo nativo (nucleo-pose --fatias), com o
// binario (a mesma saida, byte a byte) e com o wasm (o desenho: posicoes e uvs; o clique: os 4
// cantos de fora). Confere tambem que os cantos tem tamanho constante, que no tamanho base os
// cantos de fora sao os da regiao sem fatias, e os erros de leitura.
//
//   npx tsx tools/nucleo-fatias.ts [--nucleo nucleo/build-web/nucleo.mjs] [--pose nucleo/build/nucleo-pose]
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
const ARQ = resolve("tests/nucleo/fatias/fatias.boneco");
const TEXTO = readFileSync(ARQ, "utf8");
const base = JSON.parse(TEXTO);
const tmp = mkdtempSync(join(tmpdir(), "nucleo-fatias-"));

let falhas = 0,
  casos = 0;
const conferir = (ok: boolean, msg: string) => {
  casos++;
  if (!ok) falhas++, console.log("FALHA " + msg);
};
const perto = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// o binario pela ferramenta do nucleo (a mesma arvore)
const ARQ_BIN = join(tmp, "fatias.bin.boneco");
{
  const r = spawnSync(BIN, [ARQ, ARQ_BIN], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`nucleo-binario: ${r.stderr}`);
}

// ---- a conta pela especificacao

type Eixo = { d: number[]; s: number[]; pedacos: number[] };
const MODO = { esticar: 0, repetir: 1, repetir_caber: 2 } as const;
function eixo(tam: number, mE: number, mD: number, L: number, e: number, modo: number, p0: number, p1: number): Eixo {
  const out: Eixo = { d: [], s: [], pedacos: [] };
  let cE = mE / e,
    cD = mD / e;
  if (cE + cD > L) {
    const k = L / (cE + cD);
    cE *= k;
    cD *= k;
  }
  const dl = -L / 2,
    dr = L / 2;
  const pc: [number, number, number, number][] = [];
  if (mE > 0 && cE > 0) pc.push([dl, dl + cE, 0, Math.min(mE, tam)]);
  const a = dl + cE,
    b = dr - cD,
    vao = b - a;
  const s0 = Math.min(mE, tam),
    s1 = Math.max(s0, tam - mD),
    mo = s1 - s0;
  if (vao > 0) {
    if (!(mo > 0) || modo === 0) pc.push([a, b, s0, s1]);
    else {
      const peca = mo / e;
      let caber = modo === 2;
      let n = caber ? Math.max(1, Math.round(vao / peca)) : Math.ceil(vao / peca - 1e-9);
      if (n > 64) (n = 64), (caber = true);
      for (let k = 0; k < n; k++) {
        if (caber) pc.push([a + (vao * k) / n, k + 1 === n ? b : a + (vao * (k + 1)) / n, s0, s1]);
        else {
          const d0 = a + k * peca,
            d1 = k + 1 === n ? b : d0 + peca;
          pc.push([d0, d1, s0, k + 1 === n ? s0 + ((d1 - d0) / peca) * mo : s1]);
        }
      }
    }
  }
  if (mD > 0 && cD > 0) pc.push([b, dr, Math.max(0, tam - mD), tam]);
  for (let [d0, d1, q0, q1] of pc) {
    const c0 = Math.max(q0, p0),
      c1 = Math.min(q1, p1);
    if (!(c1 > c0)) continue;
    const f = (d1 - d0) / (q1 - q0);
    [d0, d1] = [d0 + (c0 - q0) * f, d0 + (c1 - q0) * f];
    const n = out.d.length;
    let i0 = n - 1;
    if (!(n && Math.abs(out.d[n - 1] - d0) < 1e-9 && Math.abs(out.s[n - 1] - c0) < 1e-9)) {
      i0 = n;
      out.d.push(d0), out.s.push(c0);
    }
    out.d.push(d1), out.s.push(c1);
    out.pedacos.push(i0, out.d.length - 1);
  }
  return out;
}

// a regiao: o retangulo com pixels e os uvs dos cantos (baixo-esquerda, cima-esquerda, cima-direita,
// baixo-direita), como o leitor do nucleo os faz para a regiao (docs/NUCLEO.md "Desenho")
function regiao(nomeImagem: string, largura: number, altura: number) {
  const g = base.imagens.find((i: any) => i.nome === nomeImagem);
  const [x, y, rw, rh] = g.ret;
  const [pw, ph] = base.paginas[g.pagina].tamanho;
  const [ox, oy, ow, oh] = g.corte ?? [0, 0, rw, rh];
  const fx = largura / ow,
    fy = altura / oh;
  const uv = (px: number, py: number) => {
    let u: number, v: number;
    if (g.girada === 90) (u = x + py), (v = y + rw - px);
    else if (g.girada === 180) (u = x + rw - px), (v = y + rh - py);
    else if (g.girada === 270) (u = x + rh - py), (v = y + px);
    else (u = x + px), (v = y + py);
    return [u / pw, v / ph];
  };
  return { p0x: ox * fx, p0y: oy * fy, p1x: (ox + rw) * fx, p1y: (oy + rh) * fy, uvs: [...uv(0, rh), ...uv(0, 0), ...uv(rw, 0), ...uv(rw, rh)] };
}

type Parte = any;
function partePorSlot(slot: string): Parte {
  const s = base.slots.find((x: any) => x.nome === slot);
  return base.skins[0].partes[slot][s.parte];
}

// a grade de uma regiao fatiada no tamanho L x A com o esticar (ex, ey): vertices no osso, uvs, triangulos
function grade(p: Parte, nomeImagem: string, L: number, A: number, ex: number, ey: number) {
  const f = p.fatias;
  const r = regiao(nomeImagem, p.largura, p.altura);
  const X = eixo(p.largura, f.esquerda ?? 0, f.direita ?? 0, L, ex, MODO[(f.eixo_x ?? "esticar") as keyof typeof MODO], r.p0x, r.p1x);
  const Y = eixo(p.altura, f.baixo ?? 0, f.cima ?? 0, A, ey, MODO[(f.eixo_y ?? "esticar") as keyof typeof MODO], r.p0y, r.p1y);
  const th = ((p.rotacao ?? 0) * 3.1415927) / 180,
    cs = Math.cos(th),
    sn = Math.sin(th);
  const sx = p.escala_x ?? 1,
    sy = p.escala_y ?? 1;
  const v: number[] = [],
    uv: number[] = [],
    tri: number[] = [];
  const u = r.uvs;
  for (let iy = 0; iy < Y.d.length; iy++)
    for (let ix = 0; ix < X.d.length; ix++) {
      const lx = X.d[ix] * sx,
        ly = Y.d[iy] * sy;
      v.push((p.x ?? 0) + lx * cs - ly * sn, (p.y ?? 0) + lx * sn + ly * cs);
      const fu = (X.s[ix] - r.p0x) / (r.p1x - r.p0x),
        fv = (Y.s[iy] - r.p0y) / (r.p1y - r.p0y);
      uv.push(u[0] + fu * (u[6] - u[0]) + fv * (u[2] - u[0]), u[1] + fu * (u[7] - u[1]) + fv * (u[3] - u[1]));
    }
  const nx = X.d.length;
  for (let j = 0; j < Y.pedacos.length; j += 2)
    for (let k = 0; k < X.pedacos.length; k += 2) {
      const [ya, yb, xa, xb] = [Y.pedacos[j], Y.pedacos[j + 1], X.pedacos[k], X.pedacos[k + 1]];
      const be = ya * nx + xa,
        ce = yb * nx + xa,
        cd = yb * nx + xb,
        bd = ya * nx + xb;
      tri.push(be, ce, cd, cd, bd, be);
    }
  return { nx, ny: Y.d.length, v, uv, tri, X, Y };
}

// ---- os casos

const [BW, BH] = [base.tela.arte[2], base.tela.arte[3]];
// a imagem de cada slot fatiado e o esticar que a especificacao da (kx, ky: a vista sobre a arte)
const SLOTS: Record<string, { imagem: string; esticar: (kx: number, ky: number) => [number, number] }> = {
  painel: { imagem: "painel", esticar: (kx, ky) => [kx, ky] },
  ladrilhos: { imagem: "ladrilho", esticar: (kx, ky) => [kx, ky] }, // filho sem ancora: estica com o pai
  barra: { imagem: "barra", esticar: (kx) => [kx, 1] },
  lateral: { imagem: "painel", esticar: (kx) => [1, kx] }, // girada 90 na barra: o x dela e o y do osso
  fundo_botao: { imagem: "botao", esticar: () => [1, 1] }, // ancorado sem esticar
};

type Saida = { ossos: Record<string, number[]>; vertices: Record<string, number[]>; fatias: Record<string, any>; texto: string };
function nativo(arq: string, extra: string[], anim = "-", t = 0): Saida {
  const r = spawnSync(POSE, [arq, anim, String(t), "--fatias", ...extra], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`nucleo-pose: ${r.stderr}`);
  const q = JSON.parse(r.stdout).quadros[0];
  const fat = /^fatias (.*)$/m.exec(r.stderr)![1];
  return { ossos: q.ossos, vertices: q.vertices, fatias: JSON.parse(fat), texto: r.stdout + fat };
}

// o wasm: o desenho (posicoes e uvs de cada slot, na ordem de desenho) e os cantos do clique
function wasm(janela: [number, number] | null, medida: [number, number] | null, anim = -1, t = 0) {
  const p = N.stringToNewUTF8(TEXTO);
  const m = N._mm_carregar(p);
  N._free(p);
  if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
  const info = JSON.parse(N.UTF8ToString(N._mm_info(m)));
  const i = N._mm_instancia(m);
  if (janela) N._mm_janela(i, ...janela);
  if (medida) N._mm_texto_medida(i, 0, ...medida);
  N._mm_tocar(i, anim, 1);
  if (t > 0) N._mm_avancar(i, t);
  N._mm_limpar_desenho();
  N._mm_desenhar(i);
  const nv = N._mm_num_vertices();
  const buf = Array.from(N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + nv * 8)) as number[];
  const cantos: Record<string, number[]> = {};
  info.slots.forEach((s: { nome: string }, k: number) => {
    const n = N._mm_vertices_slot(i, k);
    cantos[s.nome] = Array.from(N.HEAPF64.subarray(N._mm_saida() / 8, N._mm_saida() / 8 + n));
  });
  const nf = N._mm_fatias(i);
  const fat = Array.from(N.HEAPF64.subarray(N._mm_saida() / 8, N._mm_saida() / 8 + nf)) as number[];
  N._mm_liberar_instancia(i);
  N._mm_liberar_modelo(m);
  return { buf, cantos, fat };
}

const mundo = (o: number[], x: number, y: number) => [o[0] * x + o[1] * y + o[4], o[2] * x + o[3] * y + o[5]];

const JANELAS: [string, number, number][] = [
  ["sem janela", 0, 0],
  ["a propria arte", 600, 1000],
  ["celular 9:16", 1080, 1920],
  ["celular 9:20", 1080, 2400],
  ["tablet 3:4", 1536, 2048],
  ["desktop 16:9", 1920, 1080],
  ["desktop 21:9", 2560, 1080],
];
// a medida do texto (largura e altura usadas, nas unidades da caixa): nenhuma, menor que a caixa do
// botao, e maior (o "JOGAR" em alemao)
const MEDIDAS: ([number, number] | null)[] = [null, [50, 30], [200, 44]];

for (const [nomeJ, W, H] of JANELAS)
  for (const md of MEDIDAS) {
    const extra = [...(W ? ["--janela", `${W}x${H}`] : []), ...(md ? ["--texto", `0:${md[0]}x${md[1]}`] : [])];
    const caso = `${nomeJ}${md ? `, texto ${md[0]}x${md[1]}` : ""}`;
    const nat = nativo(ARQ, extra);
    const bin = nativo(ARQ_BIN, extra);
    conferir(bin.texto === nat.texto, `${caso}: o binario difere do texto`);
    // a vista (docs/NUCLEO.md "Tela", caber)
    const s = W ? Math.min(W / BW, H / BH) : 1;
    const kx = W ? W / s / BW : 1,
      ky = W ? H / s / BH : 1;
    const web = wasm(W ? [W, H] : null, md);
    let off = 0; // no desenho do wasm: os slots em ordem, cada um com a grade dele
    for (const [slot, d] of Object.entries(SLOTS)) {
      const p = partePorSlot(slot);
      const [ex, ey] = d.esticar(kx, ky);
      let L = p.fatias.largura ?? p.largura,
        A = p.fatias.altura ?? p.altura;
      if (p.fatias.acompanha && md) {
        const t = partePorSlot(p.fatias.acompanha.slot);
        const [rx, ry] = p.fatias.acompanha.respiro;
        L = Math.max(L, (md[0] * (t.escala_x ?? 1)) / (p.escala_x ?? 1) + 2 * rx);
        A = Math.max(A, (md[1] * (t.escala_y ?? 1)) / (p.escala_y ?? 1) + 2 * ry);
      }
      const g = grade(p, d.imagem, L, A, ex, ey);
      const f = nat.fatias[slot];
      const o = nat.ossos[base.slots.find((x: any) => x.nome === slot).osso];
      const esp = [];
      for (let k = 0; k < g.v.length; k += 2) esp.push(...mundo(o, g.v[k], g.v[k + 1]));
      const v = nat.vertices[slot];
      conferir(perto(f.ex, ex, 1e-9) && perto(f.ey, ey, 1e-9) && perto(f.largura, L, 1e-12) && perto(f.altura, A, 1e-12), `${caso}: ${slot} esticar ${f.ex}, ${f.ey} tamanho ${f.largura} x ${f.altura}; esperado ${ex}, ${ey}, ${L} x ${A}`);
      conferir(f.nx === g.nx && f.ny === g.ny && v.length === esp.length && v.every((x, k) => Math.abs(x - esp[k]) < 1e-6), `${caso}: ${slot} grade ${f.nx}x${f.ny} posicoes ${JSON.stringify(v.slice(0, 8))} esperadas ${g.nx}x${g.ny} ${JSON.stringify(esp.slice(0, 8))}`);
      conferir(f.uvs.length === g.uv.length && f.uvs.every((x: number, k: number) => Math.abs(x - g.uv[k]) < 1e-6), `${caso}: ${slot} uvs ${JSON.stringify(f.uvs.slice(0, 8))} esperados ${JSON.stringify(g.uv.slice(0, 8))}`);
      conferir(JSON.stringify(f.triangulos) === JSON.stringify(g.tri), `${caso}: ${slot} triangulos`);
      // o wasm desenha a mesma grade (posicao em float e uv) e o clique sao os 4 cantos de fora
      const nv = g.nx * g.ny;
      const q = web.buf.slice(off * 8, (off + nv) * 8);
      off += nv;
      conferir(q.length === nv * 8 && [...Array(nv).keys()].every((k) => perto(q[k * 8], v[k * 2], 1e-5) && perto(q[k * 8 + 1], v[k * 2 + 1], 1e-5) && Math.abs(q[k * 8 + 2] - f.uvs[k * 2]) < 1e-7 && Math.abs(q[k * 8 + 3] - f.uvs[k * 2 + 1]) < 1e-7), `${caso}: ${slot} no desenho do wasm`);
      const idx = [0, (g.ny - 1) * g.nx, g.ny * g.nx - 1, g.nx - 1];
      const c = web.cantos[slot];
      conferir(c.length === 8 && idx.every((k, j) => perto(c[j * 2], v[k * 2], 1e-9) && perto(c[j * 2 + 1], v[k * 2 + 1], 1e-9)), `${caso}: ${slot} cantos do clique no wasm ${JSON.stringify(c)}`);
      const fw = web.fat.slice(Object.keys(SLOTS).indexOf(slot) * 7, Object.keys(SLOTS).indexOf(slot) * 7 + 7);
      conferir(fw[1] === g.nx && fw[2] === g.ny && perto(fw[3], L, 1e-12) && perto(fw[5], ex, 1e-12) && perto(fw[6], ey, 1e-12), `${caso}: ${slot} mm_fatias ${JSON.stringify(fw)}`);
    }
    // os cantos tem tamanho constante no mundo, qualquer que seja a janela: o painel (40 e 50 na
    // largura, 20 e 30 na altura; a imagem no dobro, as margens nas unidades da parte)
    {
      const v = nat.vertices.painel;
      const nx = nat.fatias.painel.nx;
      const dx = (a: number, b: number) => Math.hypot(v[b * 2] - v[a * 2], v[b * 2 + 1] - v[a * 2 + 1]);
      const ny = nat.fatias.painel.ny;
      conferir(perto(dx(0, 1), 40, 1e-6) && perto(dx(nx - 2, nx - 1), 50, 1e-6) && perto(dx(0, nx), 20, 1e-6) && perto(dx((ny - 2) * nx, (ny - 1) * nx), 30, 1e-6), `${caso}: os cantos do painel ${dx(0, 1)}, ${dx(nx - 2, nx - 1)}, ${dx(0, nx)}, ${dx((ny - 2) * nx, (ny - 1) * nx)}`);
    }
  }

// no tamanho base (sem janela, sem texto maior), os cantos de fora sao os da regiao sem fatias com a
// largura e a altura da caixa (a exportacao para o Spine: a regiao esticada para a caixa)
{
  const sem = structuredClone(base);
  for (const ps of Object.values<any>(sem.skins[0].partes))
    for (const p of Object.values<any>(ps)) {
      if (p.fatias?.largura) (p.largura = p.fatias.largura), (p.altura = p.fatias.altura);
      delete p.fatias;
    }
  const arq = join(tmp, "sem-fatias.boneco");
  writeFileSync(arq, JSON.stringify(sem));
  const r = spawnSync(POSE, [arq, "-", "0"], { encoding: "utf8" });
  const plano = JSON.parse(r.stdout).quadros[0].vertices;
  const nat = nativo(ARQ, []);
  for (const slot of Object.keys(SLOTS)) {
    const { nx, ny } = nat.fatias[slot];
    const v = nat.vertices[slot];
    const fora = [0, (ny - 1) * nx, ny * nx - 1, nx - 1].flatMap((k) => [v[k * 2], v[k * 2 + 1]]);
    conferir(fora.every((x, k) => Math.abs(x - plano[slot][k]) < 1e-9), `tamanho base: ${slot} cantos de fora ${JSON.stringify(fora)} e a regiao ${JSON.stringify(plano[slot])}`);
  }
}

// a escala da animacao nao e esticar: o botao que pulsa cresce inteiro, cantos inclusive
{
  const nat = nativo(ARQ, ["--janela", "1080x2400"], "pulsa", 0.5);
  const v = nat.vertices.fundo_botao;
  const largura = Math.hypot(v[2] - v[0], v[3] - v[1]);
  conferir(perto(largura, 30 * 1.2, 1e-6) && nat.fatias.fundo_botao.ex === 1, `animacao de escala: o canto do botao com ${largura} (esperado ${30 * 1.2})`);
  const web = wasm([1080, 2400], null, 0, 0.5);
  conferir(perto(web.cantos.fundo_botao[0], v[0], 1e-9), `animacao de escala no wasm`);
}

// erros de leitura
for (const [msg, troca] of [
  ["margem negativa", (b: any) => (b.skins[0].partes.painel.painel.fatias.esquerda = -1)],
  ["caixa precisa", (b: any) => (b.skins[0].partes.painel.painel.fatias.largura = 0)],
  ["eixo desconhecido", (b: any) => (b.skins[0].partes.painel.painel.fatias.eixo_x = "espelhar")],
  ["slot desconhecido", (b: any) => (b.skins[0].partes.fundo_botao.botao.fatias.acompanha.slot = "nada")],
  ["nao tem parte de texto", (b: any) => (b.skins[0].partes.fundo_botao.botao.fatias.acompanha.slot = "painel")],
] as [string, (b: any) => void][]) {
  const b = structuredClone(base);
  troca(b);
  const p = N.stringToNewUTF8(JSON.stringify(b));
  const m = N._mm_carregar(p);
  N._free(p);
  conferir(m < 0 && N.UTF8ToString(N._mm_erro()).includes(msg), `erro de leitura "${msg}": ${m < 0 ? N.UTF8ToString(N._mm_erro()) : "leu"}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`${casos - falhas} de ${casos} conferencias ok (${JANELAS.length} janelas x ${MEDIDAS.length} medidas do texto x ${Object.keys(SLOTS).length} regioes fatiadas; nativo, binario e wasm)`);
process.exit(falhas ? 1 : 0);
