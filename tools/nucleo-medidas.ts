// Conferencia das medidas no modo "nucleo" (etapa C: o editor sem o spine-core) contra o modo
// "spine", nos personagens CC0 de tests/assets: as mesmas medidas e os mesmos comandos rodam
// pela camada de src/core/instantes.ts nos dois modos e os resultados sao comparados.
//
// - A pose em instantes: o mundo e a pose local de cada osso, a parte, a cor e os vertices de
//   cada slot e a ordem de desenho, a 30 quadros por segundo em cada animacao, nas emendas (fila
//   e corte, mix 0,2 s) e os eventos (eventos sinteticos acrescentados as animacoes).
// - Cada query.* (rig, motion, relation, estilo, malha, recorte, transition com fila, corte e
//   cortes, mesh) e ficha.check (a ficha do personagem mais regras de todos os tipos) e
//   ficha.draft: o texto tem de ser igual e os numeros iguais a uma unidade da ultima casa
//   impressa (o arredondamento de um valor que difere em 1e-6 pode virar a casa).
// - Comandos que calculam a Pose base (bone.add e bone.set pelo mundo, attachment.region pelo
//   mundo, constraint.ik sem bendPositive, key.set no espaco do mundo, mesh.weights, mesh.vertices,
//   skeleton.bounds, pose.follow, anim.match): o documento depois deles, numero a numero.
// - O custo de cada medida nos dois modos (ms).
//
// Em Node (o mesmo nucleo em wasm do editor). A conferencia na pagina (nenhum spine-core no modo
// nucleo, contado no navegador) esta em --pagina.
//
//   npx tsx tools/nucleo-medidas.ts [pastas] [--detalhe] [--pagina [--port 5209]]
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";
import { carregarNucleo } from "../src/render/desenhista.ts";
import { abrirMedidor, estatisticas, usarMedidas, type ModoMedidas, type Quadro } from "../src/core/instantes.ts";
import { parseAtlas } from "../src/core/atlas-text.ts";
import { Document } from "../src/core/document.ts";
import { executeAsync, type AssetProvider } from "../src/core/commands/index.ts";
import { animDuration } from "../src/core/ficha.ts";

const argv = process.argv.slice(2);
const detalhe = argv.includes("--detalhe");
const pagina = argv.includes("--pagina");
const pastas = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--port");
const raizes = pastas.length ? pastas : ["tests/assets"];

const N = await carregarNucleo();
usarMedidas("spine", N);

// ---- os personagens: x.spine-json com o atlas e as imagens ao lado
type Asset = { nome: string; skel: string; atlas: string; ficha: string | null; imagens: string };
const assets: Asset[] = [];
for (const r of raizes)
  for (const f of statSync(r).isDirectory() ? readdirSync(r, { recursive: true }).map(String) : [r]) {
    const p = statSync(r).isDirectory() ? join(r, f) : f;
    if (!p.endsWith(".spine-json")) continue;
    const atlas = p.replace(/\.spine-json$/, ".atlas");
    if (!existsSync(atlas)) continue;
    const ficha = p.replace(/\.spine-json$/, ".ficha.md");
    assets.push({ nome: basename(p, ".spine-json"), skel: p, atlas, ficha: existsSync(ficha) ? ficha : null, imagens: join(dirname(p), "images") });
  }

// ---- comparacoes

const TOL = { pos: 0.01, mat: 1e-4, cor: 1 / 255, local: 1e-3 };

type Pior = { d: number; onde: string };
const pior = (): Pior => ({ d: 0, onde: "" });
const marca = (p: Pior, d: number, onde: string) => {
  if (d > p.d) Object.assign(p, { d, onde });
};

// pose em instantes: devolve o pior de cada grandeza e as diferencas que nao sao numero
function comparaQuadros(A: Quadro[], B: Quadro[], onde: string, r: Record<string, Pior>, falhas: string[]) {
  if (A.length !== B.length) falhas.push(`${onde}: ${A.length} contra ${B.length} quadros`);
  for (let k = 0; k < Math.min(A.length, B.length); k++) {
    const a = A[k],
      b = B[k];
    const w = `${onde} t=${a.t.toFixed(4)}`;
    a.bones.forEach((x, i) => {
      const y = b.bones[i];
      if (x.name !== y.name) falhas.push(`${w}: osso ${x.name} contra ${y.name}`);
      marca(r.pos, Math.max(Math.abs(x.worldX - y.worldX), Math.abs(x.worldY - y.worldY)), `${w} ${x.name}`);
      marca(r.mat, Math.max(Math.abs(x.a - y.a), Math.abs(x.b - y.b), Math.abs(x.c - y.c), Math.abs(x.d - y.d)), `${w} ${x.name}`);
      const lx = x.local,
        ly = y.local;
      marca(r.local, Math.max(...(["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY"] as const).map((c) => Math.abs(lx[c] - ly[c]))), `${w} ${x.name}`);
    });
    a.slots.forEach((x, i) => {
      const y = b.slots[i];
      if (x.attachment !== y.attachment) falhas.push(`${w}: slot ${x.name} mostra ${x.attachment} contra ${y.attachment}`);
      marca(r.cor, Math.max(Math.abs(x.color.r - y.color.r), Math.abs(x.color.g - y.color.g), Math.abs(x.color.b - y.color.b), Math.abs(x.color.a - y.color.a)), `${w} ${x.name}`);
      if (x.vertices && y.vertices) {
        if (x.vertices.length !== y.vertices.length) falhas.push(`${w}: slot ${x.name} com ${x.vertices.length} contra ${y.vertices.length} numeros de vertice`);
        else for (let j = 0; j < x.vertices.length; j++) marca(r.vert, Math.abs(x.vertices[j] - y.vertices[j]), `${w} ${x.name}`);
      }
    });
    const oa = a.drawOrder.map((s) => s.name).join(","),
      ob = b.drawOrder.map((s) => s.name).join(",");
    if (oa !== ob) falhas.push(`${w}: ordem de desenho diferente`);
  }
}

// numeros de um texto e o texto sem eles; a unidade da ultima casa de cada numero impresso
const NUM = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g;
const unidade = (s: string) => (/e/.test(s) ? Math.abs(+s) * 1e-3 : s.includes(".") ? 10 ** -(s.split(".")[1].length) : 1);

// diferenca entre dois resultados de comando: o texto igual e cada numero dentro de uma unidade
// da ultima casa impressa (o pior, em unidades dessa casa)
function comparaSaida(a: any, b: any, onde: string, p: Pior, falhas: string[]) {
  // numero cru: como se impresso (os resultados ja vem arredondados a 0,1, 0,01 ou 0,001)
  if (typeof a === "number" && typeof b === "number") return comparaSaida(String(a), String(b), onde, p, falhas);
  if (typeof a === "string" && typeof b === "string") {
    if (a === b) return;
    const ta = a.replace(NUM, "#"),
      tb = b.replace(NUM, "#");
    if (ta !== tb) {
      falhas.push(`${onde}: texto diferente: ${a.slice(0, 160)} | ${b.slice(0, 160)}`);
      return;
    }
    const na = a.match(NUM) ?? [],
      nb = b.match(NUM) ?? [];
    na.forEach((x, i) => {
      const u = Math.max(unidade(x), unidade(nb[i]));
      const d = Math.abs(+x - +nb[i]) / u;
      marca(p, d, `${onde} (${x} contra ${nb[i]})`);
      if (d > 1 + 1e-9) falhas.push(`${onde}: ${x} contra ${nb[i]}`);
    });
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of ks) {
      if (!(k in a) || !(k in b)) falhas.push(`${onde}.${k}: so num dos modos`);
      else comparaSaida(a[k], b[k], `${onde}.${k}`, p, falhas);
    }
    return;
  }
  if (a !== b) falhas.push(`${onde}: ${JSON.stringify(a)} contra ${JSON.stringify(b)}`);
}

// documentos depois das edicoes: o maior desvio de numero (estrutura diferente: falha)
function comparaDoc(a: any, b: any, onde: string, p: Pior, falhas: string[]) {
  if (typeof a === "number" && typeof b === "number") return marca(p, Math.abs(a - b), onde);
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of ks) {
      if (!(k in a) || !(k in b)) {
        const x = a[k] ?? 0,
          y = b[k] ?? 0;
        if (typeof x === "number" && typeof y === "number") marca(p, Math.abs(x - y), `${onde}.${k}`);
        else falhas.push(`${onde}.${k}: so num dos modos`);
      } else comparaDoc(a[k], b[k], `${onde}.${k}`, p, falhas);
    }
    return;
  }
  if (a !== b) falhas.push(`${onde}: ${JSON.stringify(a)} contra ${JSON.stringify(b)}`);
}

// ---- roteiro por personagem

// eventos sinteticos (os CC0 nao tem): no 0, no meio (dois no mesmo tempo) e no fim de cada animacao
function comEventos(json: any) {
  const j = structuredClone(json);
  j.events = { ...(j.events ?? {}), passo: {}, pulo: { int: 2 } };
  for (const a of Object.values<any>(j.animations ?? {})) {
    const d = animDuration(a);
    if (!(d > 0)) continue;
    a.events = [
      { name: "passo" },
      { time: +(d / 2).toFixed(4), name: "pulo" },
      { time: +(d / 2).toFixed(4), name: "passo" },
      { time: +d.toFixed(4), name: "pulo" },
    ];
  }
  return j;
}

const tempos = (d: number, fps = 30) => {
  const n = Math.max(1, Math.round(d * fps));
  return Array.from({ length: n + 1 }, (_, i) => (i / n) * d);
};

// os casos de cada personagem: cada query.* nas animacoes e ficha.check com a ficha dele mais
// regras de todos os tipos (o resultado pode falhar: tem de ser igual nos dois modos)
type Caso = { nome: string; cmd: string; args: any };
function casosDe(json: any, ficha: string | null, nome: string): Caso[] {
  const anims = Object.keys(json.animations ?? {});
  const bones: string[] = json.bones.map((b: any) => b.name);
  const pares = paresDe(json);
  const malhas = malhasDe(json);
  let regras = ficha ?? "# Ficha\n";
  // mais regras de todos os tipos (a ficha CC0 nao tem todas): o resultado pode falhar, tem de ser igual
  const fisicas = (json.constraints ?? []).filter((c: any) => c.type === "physics").map((c: any) => c.bone);
  regras += "\n## Rig\n\n```regras\n" + [...pares.map(([b, p]) => `preso ${b} ${p} 3`), ...pares.map(([b]) => `limite ${b} rotate -10..10`), ...pares.map(([b]) => `limite ${b} x -2..2`), ...fisicas.map((b: string) => `fisica ${b} 10`)].join("\n") + "\n```\n";
  for (const a of anims) {
    const outra = anims.find((b) => b !== a) ?? a;
    regras += `\n## Animacao: ${a}\n\n\`\`\`regras\nloop 1\ntermina_como ${outra} 5\ncomeca_como ${outra} 5\ntransicao ${outra} 0.2\ntransicao ${outra} 0.05 1.2\ncorte ${outra} 0.1\nestilo ganho/acao\nestilo idle\n\`\`\`\n`;
  }
  const casos: Caso[] = [{ nome: "query.rig", cmd: "query.rig", args: {} }];
  for (const a of anims) {
    const outra = anims.find((b) => b !== a) ?? a;
    const d = animDuration(json.animations[a]);
    casos.push({ nome: `query.motion ${a}`, cmd: "query.motion", args: { anim: a, bones } });
    for (const [b, p] of pares) casos.push({ nome: `query.relation ${a} ${b}/${p}`, cmd: "query.relation", args: { anim: a, bone: b, relativeTo: p } });
    casos.push({ nome: `query.estilo ${a}`, cmd: "query.estilo", args: { anim: a } });
    casos.push({ nome: `query.malha ${a}`, cmd: "query.malha", args: { anim: a } });
    casos.push({ nome: `query.recorte ${a}`, cmd: "query.recorte", args: { anim: a } });
    casos.push({ nome: `query.transition ${a} -> ${outra} fila`, cmd: "query.transition", args: { anim: a, next: outra, mix: 0.2 } });
    casos.push({ nome: `query.transition ${a} -> ${outra} corte`, cmd: "query.transition", args: { anim: a, next: outra, mix: 0.15, at: +(d * 0.4).toFixed(3) } });
    casos.push({ nome: `query.transition ${a} -> ${outra} 6 cortes`, cmd: "query.transition", args: { anim: a, next: outra, mix: 0.1, cuts: 6 } });
    for (const [slot, att] of malhas.slice(0, 2)) casos.push({ nome: `query.mesh ${slot} ${a}`, cmd: "query.mesh", args: { slot, attachment: att, anim: a, time: +(d / 2).toFixed(3) } });
  }
  casos.push({ nome: "ficha.check (a ficha e regras de todos os tipos)", cmd: "ficha.check", args: { text: regras } });
  casos.push({ nome: "ficha.draft", cmd: "ficha.draft", args: { name: nome } });
  return casos;
}

// ossos de referencia: quatro ossos espalhados com o pai (para query.relation e as regras)
function paresDe(json: any): [string, string][] {
  const bones: string[] = json.bones.map((b: any) => b.name);
  const pais = json.bones.filter((b: any) => b.parent && b.parent !== bones[0]);
  return [0, Math.floor(pais.length / 3), Math.floor((2 * pais.length) / 3), pais.length - 1].map((k) => pais[k]).filter(Boolean).map((b: any) => [b.name, b.parent]);
}

function malhasDe(json: any): [string, string][] {
  const malhas: [string, string][] = [];
  for (const sk of json.skins ?? []) for (const [slot, m] of Object.entries<any>(sk.attachments ?? {})) for (const [n, a] of Object.entries<any>(m)) if (a.type === "mesh" && !malhas.some(([s]) => s === slot)) malhas.push([slot, n]);
  return malhas;
}

// edicoes que calculam a Pose base (ou uma pose animada) pelo mundo
function edicoesDe(json: any, regiao: string): { cmd: string; args: any }[] {
  const anims = Object.keys(json.animations ?? {});
  const bones: string[] = json.bones.map((b: any) => b.name);
  const pares = paresDe(json);
  const malhas = malhasDe(json);
  const outra = anims[1] ?? anims[0];
  const meio = (a: string) => +(animDuration(json.animations[a]) / 2).toFixed(3);
  const b0 = pares[0]?.[0] ?? bones[1],
    b1 = pares[1]?.[0] ?? bones[2];
  const comPai = json.bones.find((b: any) => b.name === b1)?.parent ?? bones[0];
  const cadeia = json.bones.filter((b: any) => b.parent && b.parent !== bones[0]).slice(0, 2).map((b: any) => b.name);
  const slot0 = json.slots.find((s: any) => s.attachment)?.name;
  return [
    { cmd: "bone.add", args: { name: "conf_novo", parent: b0, at: [12, 140], toward: [60, 210] } },
    { cmd: "bone.add", args: { name: "conf_alvo", parent: bones[0], at: [90, 120] } },
    { cmd: "bone.set", args: { bone: b1, at: [20, 150] } },
    { cmd: "slot.add", args: { name: "conf_slot", bone: "conf_novo" } },
    { cmd: "attachment.region", args: { slot: "conf_slot", name: regiao, world: { center: [30, 160], rotation: 20, scale: [1, 1] } } },
    { cmd: "ik.create", args: { name: "conf_ik", bones: [comPai, b1].filter((x, i, l) => l.indexOf(x) === i).slice(0, 2), target: "conf_alvo", index: 0 } },
    { cmd: "key.set", args: { anim: anims[0], target: { bone: b0 }, timeline: "translate", time: meio(anims[0]), x: 7, y: -4, space: "world" } },
    { cmd: "skeleton.bounds", args: { animations: true } },
    ...(cadeia.length ? [{ cmd: "pose.follow", args: { anim: anims[0], bone: cadeia[cadeia.length - 1], relativeTo: bones[0], chain: cadeia, fps: 4 } }] : []),
    { cmd: "anim.match", args: { anim: anims[0], like: outra, at: "fim" } },
    ...(slot0 ? [{ cmd: "slot.set", args: { slot: slot0, bone: b1 } }] : []),
    ...malhas.slice(0, 1).flatMap(([slot, att]) => [
      { cmd: "mesh.vertices", args: { slot, attachment: att, moves: [{ i: 0, dx: 3, dy: -2 }] } },
      { cmd: "mesh.weights", args: { slot, attachment: att, bones: [json.slots.find((s: any) => s.name === slot).bone, b0].filter((x, i, l) => l.indexOf(x) === i) } },
      { cmd: "deform.set", args: { anim: anims[0], slot, attachment: att, time: meio(anims[0]), moves: [{ i: 1, dx: 4, dy: 1 }] } },
      { cmd: "mesh.unbind", args: { slot, attachment: att } },
    ]),
  ];
}

type Linha = Record<string, string | number>;
const docsNode = new Map<string, any>();
const tabela: Linha[] = [];
const custos: Linha[] = [];
let totalFalhas = 0;

for (const as of assets) {
  const json = JSON.parse(readFileSync(as.skel, "utf8"));
  const atlasText = readFileSync(as.atlas, "utf8");
  const atlas = parseAtlas(atlasText);
  const provider: AssetProvider = {
    async image(name) {
      const f = join(as.imagens, name + ".png");
      if (!existsSync(f)) return null;
      const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data };
    },
    region(name) {
      const r = atlas.regions.find((x) => x.name === name);
      return r ? { width: r.originalWidth, height: r.originalHeight } : null;
    },
  };
  const anims = Object.keys(json.animations ?? {});
  const linha = (caso: string, r: Record<string, Pior> | Pior, falhas: string[], extra: Linha = {}) => {
    totalFalhas += falhas.length ? 1 : 0;
    const p = (x: Pior | undefined, f = (d: number) => d.toExponential(1)) => (x ? f(x.d) : "");
    const l: Linha = { personagem: as.nome, caso };
    if ("d" in r) l["pior"] = (r as Pior).d.toFixed(3);
    else for (const [k, v] of Object.entries(r)) l[k] = p(v);
    Object.assign(l, extra);
    l.ok = falhas.length ? `FALHA (${falhas.length})` : "ok";
    tabela.push(l);
    if (falhas.length && detalhe) console.log(`${as.nome} ${caso}:\n  ${falhas.slice(0, 12).join("\n  ")}`);
    else if (falhas.length) console.log(`${as.nome} ${caso}: ${falhas[0]}${falhas.length > 1 ? ` (+${falhas.length - 1})` : ""}`);
  };

  // 1. a pose em instantes
  {
    const j = comEventos(json);
    const med = (modo: ModoMedidas) => abrirMedidor(j, atlasText, modo);
    const S = med("spine"),
      M = med("nucleo");
    if (M.modo !== "nucleo") throw new Error(`${as.nome}: o nucleo recusou o documento: ${estatisticas.ultimaRecusa}`);
    const r = { pos: pior(), mat: pior(), local: pior(), cor: pior(), vert: pior() };
    const falhas: string[] = [];
    let quadros = 0;
    const o = { slots: true, vertices: true };
    for (const a of [null, ...anims]) {
      const ts = a ? tempos(S.duracao(a)) : [0];
      // fora da ordem tambem (o medidor refaz desde 0 quando o tempo volta)
      const ts2 = a ? [...ts, ts[Math.floor(ts.length / 3)], 0.01] : ts;
      comparaQuadros(S.poses(a, ts2, o), M.poses(a, ts2, o), a ?? "setup", r, falhas);
      quadros += ts2.length;
      if (a) comparaQuadros(S.poses(a, [S.duracao(a)], { ...o, loop: false }), M.poses(a, [S.duracao(a)], { ...o, loop: false }), `${a} sem loop`, r, falhas);
    }
    linha(`pose em ${quadros} instantes (setup e ${anims.length} animacoes, 30 qps)`, r, falhas);
    const re = { pos: pior(), mat: pior(), local: pior(), cor: pior(), vert: pior() };
    const fe: string[] = [];
    let qe = 0;
    for (const a of anims)
      for (const b of anims) {
        if (a === b && anims.length > 1) continue;
        for (const seq of [{ next: b, mix: 0.2 }, { next: b, mix: 0.2, at: +(S.duracao(a) * 0.37).toFixed(4) }, { next: b, mix: 0.3, at: 0 }, { next: b, mix: 0 }]) {
          const total = (seq.at ?? Math.max(S.duracao(a) - seq.mix, 0)) + Math.max(S.duracao(b), seq.mix);
          const ts = tempos(total);
          comparaQuadros(S.sequencia(a, seq, ts, o), M.sequencia(a, seq, ts, o), `${a} -> ${b} ${JSON.stringify(seq)}`, re, fe);
          qe += ts.length;
        }
      }
    linha(`emendas (fila, corte, corte em 0, mix 0) em ${qe} instantes`, re, fe);
    // eventos: da animacao em loop por 2,5 voltas e das emendas
    const fv: string[] = [];
    let ne = 0;
    const pe = pior();
    for (const a of anims) {
      const casos: [string, any][] = [[`${a} loop`, { loop: true }], [`${a} uma vez`, { loop: false }], ...anims.filter((b) => b !== a).map((b) => [`${a} -> ${b}`, { seq: { next: b, mix: 0.2 } }] as [string, any]), ...anims.filter((b) => b !== a).map((b) => [`${a} corta em ${b}`, { seq: { next: b, mix: 0.2, at: S.duracao(a) / 2 } }] as [string, any])];
      for (const [nome, op] of casos) {
        const ate = S.duracao(a) * 2.5;
        const ea = S.eventos(a, ate, op),
          eb = M.eventos(a, ate, op);
        ne += ea.length;
        if (ea.length !== eb.length) fv.push(`${nome}: ${ea.length} contra ${eb.length} eventos`);
        ea.forEach((x, i) => {
          const y = eb[i];
          if (!y || x.name !== y.name || x.anim !== y.anim) fv.push(`${nome}: evento ${i} ${x.name}/${x.anim} contra ${y?.name}/${y?.anim}`);
          else marca(pe, Math.max(Math.abs(x.time - y.time), Math.abs(x.keyTime - y.keyTime)), `${nome} ${i}`);
        });
      }
    }
    linha(`eventos (${ne}, nome, animacao, instante e tempo da chave)`, { tempo: pe }, fv);
    // caixa da pose direta (skeleton.bounds)
    const pc = pior();
    const fc: string[] = [];
    for (const a of [null, ...anims])
      for (const t of a ? tempos(S.duracao(a), 8) : [0]) {
        const x = S.caixa(a, t),
          y = M.caixa(a, t);
        if (!x || !y) {
          if (!!x !== !!y) fc.push(`${a} ${t}: caixa so num dos modos`);
          continue;
        }
        marca(pc, Math.max(...x.map((v, i) => Math.abs(v - y[i]))), `${a ?? "setup"} t=${t.toFixed(3)}`);
      }
    linha("caixa da pose direta (skeleton.bounds)", { pos: pc }, fc);
    S.liberar();
    M.liberar();
  }

  // 2. as query.* e a ficha, pelos comandos (o que o Claude e o editor recebem)
  const casos = casosDe(json, as.ficha ? readFileSync(as.ficha, "utf8") : null, as.nome);
  const custo: Record<string, Record<ModoMedidas, number>> = {};
  const resultados: Record<ModoMedidas, any[]> = { spine: [], nucleo: [], godot: [] };
  for (const modo of ["spine", "nucleo"] as const) {
    usarMedidas(modo);
    const doc = Document.fromText(readFileSync(as.skel, "utf8"), { text: atlasText, pages: {} });
    for (const c of casos) {
      // o melhor de 3 (o primeiro aquece o JIT)
      let r: any,
        ms = Infinity;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        try {
          r = (await executeAsync(doc, { cmd: c.cmd, args: c.args }, "conferencia", undefined, {}, provider))[0];
        } catch (e: any) {
          r = { erro: String(e?.message ?? e) };
        }
        ms = Math.min(ms, performance.now() - t0);
      }
      resultados[modo].push(r);
      const g = c.cmd === "query.relation" ? "query.relation" : c.cmd === "query.mesh" ? "query.mesh" : c.nome.replace(/ .*$/, "") + (c.cmd === "query.transition" ? ` (${c.nome.split(" ").slice(-1)[0]})` : "");
      ((custo[g] ??= { spine: 0, nucleo: 0, godot: 0 })[modo] as number) += ms;
    }
  }
  const porGrupo = new Map<string, { p: Pior; falhas: string[]; n: number }>();
  casos.forEach((c, i) => {
    const g = c.cmd === "query.transition" ? `query.transition (${c.nome.split(" ").slice(-1)[0]})` : c.cmd;
    const e = porGrupo.get(g) ?? { p: pior(), falhas: [], n: 0 };
    e.n++;
    comparaSaida(resultados.spine[i], resultados.nucleo[i], c.nome, e.p, e.falhas);
    if (resultados.nucleo[i]?.erro) e.falhas.push(`${c.nome}: ${resultados.nucleo[i].erro}`);
    porGrupo.set(g, e);
  });
  for (const [g, e] of porGrupo) linha(`${g} (${e.n})`, e.p, e.falhas, { unidade: "casas" });
  for (const [g, c] of Object.entries(custo)) custos.push({ personagem: as.nome, medida: g, "spine (ms)": +c.spine.toFixed(2), "nucleo (ms)": +c.nucleo.toFixed(2), razao: +(c.nucleo / Math.max(c.spine, 1e-6)).toFixed(2) });

  // 3. comandos que calculam a Pose base: o documento depois deles
  {
    const edits = edicoesDe(json, atlas.regions[0].name);
    const docs: Record<string, any> = {};
    const fe: string[] = [];
    for (const modo of ["spine", "nucleo"] as const) {
      usarMedidas(modo);
      const doc = Document.fromText(readFileSync(as.skel, "utf8"), { text: atlasText, pages: {} });
      for (const e of edits)
        try {
          await executeAsync(doc, e, "conferencia", undefined, {}, provider);
        } catch (err: any) {
          fe.push(`${modo} ${e.cmd}: ${err?.message ?? err}`);
        }
      docs[modo] = JSON.parse(doc.serialize());
    }
    const pd = pior();
    docsNode.set(as.nome, docs);
    comparaDoc(docs.spine, docs.nucleo, "", pd, fe);
    if (pd.d > 0.01) fe.push(`documento: ${pd.onde} difere ${pd.d}`);
    linha(`documento depois de ${edits.length} edicoes (${[...new Set(edits.map((e) => e.cmd))].join(", ")})`, { doc: pd }, fe);
  }
}

// ---- casos pequenos: restricoes que mexem na pose local (IK, transformacao com alvo local),
// sem chave no osso, tocando pelo Estado (o editor e as medidas). Antes da etapa C o nucleo
// guardava o que a restricao fez para o quadro seguinte e somava (IK com mix 0,5 chegava ao alvo)
{
  const osso = (name: string, parent: string | null, o: any = {}) => ({ name, ...(parent ? { parent } : {}), ...o });
  const pequenos: [string, any, string | null][] = [
    ["IK de 2 ossos, mix 0,5", { constraints: [{ type: "ik", name: "ik", bones: ["a", "b"], target: "t", mix: 0.5 }] }, null],
    ["IK de 1 osso, mix 0,3", { constraints: [{ type: "ik", name: "ik", bones: ["a"], target: "t", mix: 0.3 }] }, null],
    ["transformacao local somando, mix 0,5", { constraints: [{ type: "transform", name: "tr", source: "t", bones: ["b"], localSource: true, localTarget: true, additive: true, mixRotate: 0.5, mixX: 0.5, mixY: 0.5, properties: { rotate: { to: { rotate: {} } }, x: { to: { x: {} } } } }] }, null],
  ];
  // anotado: uma restricao num osso que vem antes, na lista, de uma restricao num ancestral dele
  // (a fisica de um personagem CC0 e, depois dela, um IK com mix 0 no avo do osso da fisica). O
  // oraculo mostra a fisica; o nucleo recalcula o descendente depois do IK e a perde
  const comFisica = assets.map((as) => JSON.parse(readFileSync(as.skel, "utf8"))).find((j) => (j.constraints ?? []).some((c: any) => c.type === "physics"));
  if (comFisica) {
    const f = comFisica.constraints.find((c: any) => c.type === "physics");
    const pai = comFisica.bones.find((b: any) => b.name === f.bone)?.parent;
    const avo = comFisica.bones.find((b: any) => b.name === pai)?.parent;
    if (pai && avo) {
      const j = structuredClone(comFisica);
      j.bones.push({ name: "conf_alvo", parent: j.bones[0].name, x: 90, y: 120 });
      j.constraints.push({ type: "ik", name: "conf_ik", bones: [avo, pai], target: "conf_alvo", mix: 0 });
      pequenos.push([`anotado: fisica em ${f.bone} antes de um IK (mix 0) em ${avo}, ${pai}`, j, "anotado"]);
    }
  }
  for (const [nome, extra, anotado] of pequenos) {
    const j = anotado
      ? extra
      : {
          skeleton: {},
          bones: [osso("root", null), osso("a", "root", { length: 50, rotation: 90 }), osso("b", "a", { x: 50, length: 40, rotation: 20 }), osso("t", "root", { x: 60, y: 40 })],
          slots: [],
          ...extra,
          animations: { x: { bones: { t: { translate: [{ x: 0, y: 0 }, { time: 1, x: -40, y: 30 }] } }, root: { rotate: [{ value: 0 }, { time: 0.5, value: 15 }, { time: 1, value: 0 }] } } },
        };
    const anim = anotado ? Object.keys(j.animations)[0] : "x";
    const ts = tempos(1, 60);
    const r = { pos: pior(), mat: pior(), local: pior(), cor: pior(), vert: pior() };
    const f: string[] = [];
    const S = abrirMedidor(j as any, null, "spine"),
      M = abrirMedidor(j as any, null, "nucleo");
    comparaQuadros(S.poses(anim, ts), M.poses(anim, ts), nome, r, f);
    if (r.pos.d > TOL.pos || r.mat.d > TOL.mat) f.push(`${r.pos.onde}: ${r.pos.d.toExponential(2)} px`);
    S.liberar();
    M.liberar();
    if (anotado) {
      tabela.push({ personagem: "(pequeno)", caso: nome, pos: r.pos.d.toExponential(1), mat: r.mat.d.toExponential(1), ok: f.length ? "difere (anotado)" : "ok" });
      continue;
    }
    totalFalhas += f.length ? 1 : 0;
    tabela.push({ personagem: "(pequeno)", caso: nome, pos: r.pos.d.toExponential(1), mat: r.mat.d.toExponential(1), local: r.local.d.toExponential(1), ok: f.length ? `FALHA (${f.length})` : "ok" });
    if (f.length) console.log(`${nome}: ${f[0]}`);
  }
}

usarMedidas("godot");
console.table(tabela);
console.log("custo (ms, o melhor de 3, somado por medida):");
console.table(custos);
console.log(`medidores: ${estatisticas.spine} no spine-core, ${estatisticas.nucleo} no nucleo, ${estatisticas.recusas} recusas`);
console.log(totalFalhas ? `${totalFalhas} caso(s) com diferenca (--detalhe para ver)` : "medidas iguais nos modos spine e nucleo");
if (pagina) totalFalhas += await conferePagina();
process.exit(totalFalhas ? 1 : 0);

// ---- na pagina: o editor de verdade (editor proprio com tests/assets e um Chromium headless),
// as mesmas medidas e edicoes pela ponte nos modos spine e nucleo. Conta, na pagina, cada
// SkeletonJson.readSkeletonData e Skeleton.updateWorldTransform do spine-core (de qualquer
// quem: viewer, comandos, ficha, o painel da ficha): no modo nucleo tem de ser 0
async function conferePagina(): Promise<number> {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const i = argv.indexOf("--port");
  const port = i >= 0 ? Number(argv[i + 1]) : 5209;
  const out = join(tmpdir(), "mamulengo-nucleo-medidas");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const kids: ChildProcess[] = [];
  const stop = () => {
    for (const k of kids)
      try {
        if (k.pid) process.kill(-k.pid, "SIGTERM");
      } catch {}
  };
  process.on("exit", stop);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitHttp = async (url: string, ms: number) => {
    for (let t = 0; t < ms; t += 500) {
      try {
        if ((await fetch(url)).ok) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`nao respondeu: ${url}`);
  };
  const env = { ...process.env, MAMULENGO_ROOTS: join(REPO, "tests/assets"), MAMULENGO_PORT: String(port), MAMULENGO_ESTAVEL: "1" };
  kids.push(spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: REPO, env, detached: true, stdio: ["ignore", openSync(join(out, "vite.log"), "w"), openSync(join(out, "vite.log"), "a")] }));
  await waitHttp(`http://localhost:${port}/`, 60_000);
  const portaCdp = port + 1000;
  const profile = mkdtempSync(join(tmpdir(), "nucleo-medidas-chromium-"));
  kids.push(
    spawn("chromium", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1400,900", `--user-data-dir=${profile}`, "--no-first-run", `--remote-debugging-port=${portaCdp}`, `http://localhost:${port}/?acompanhar=0&runtime=spine`], {
      detached: true,
      stdio: ["ignore", openSync(join(out, "chromium.log"), "w"), openSync(join(out, "chromium.log"), "a")],
    }),
  );
  const ws = new WebSocket(`ws://localhost:${port}/__mamulengo`);
  await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
  let editors = 0;
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === "status") editors = m.editors;
  });
  ws.send(JSON.stringify({ t: "hello", role: "agent", name: "nucleo-medidas" }));
  for (let t = 0; !editors; t += 250) {
    if (t > 60_000) throw new Error("o editor nao conectou na ponte");
    await sleep(250);
  }
  let seq = 0;
  const call = (method: string, params: any = {}) =>
    new Promise<any>((ok, fail) => {
      const id = String(++seq);
      const h = (raw: any) => {
        const r = JSON.parse(String(raw));
        if (r.t !== "reply" || r.id !== id) return;
        ws.off("message", h);
        r.ok ? ok(r.result) : fail(new Error(`${method}: ${r.error}`));
      };
      ws.on("message", h);
      ws.send(JSON.stringify({ t: "call", id, method, params }));
    });
  await waitHttp(`http://localhost:${portaCdp}/json`, 30_000);
  const tabs = await (await fetch(`http://localhost:${portaCdp}/json`)).json();
  const cdp = new WebSocket(tabs.find((t: any) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, fail) => (cdp.once("open", ok), cdp.once("error", fail)));
  let cid = 0;
  const send = (method: string, params: any = {}) =>
    new Promise<any>((ok, fail) => {
      const my = ++cid;
      const h = (raw: any) => {
        const m = JSON.parse(String(raw));
        if (m.id !== my) return;
        cdp.off("message", h);
        m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result);
      };
      cdp.on("message", h);
      cdp.send(JSON.stringify({ id: my, method, params }));
    });
  const ev = async <T = any>(js: string): Promise<T> => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { const app = window.mamulengo, v = app.viewer; return JSON.stringify(await (async () => { ${js} })() ?? null); })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`na pagina: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return JSON.parse(r.result.value) as T;
  };
  await ev(`localStorage.setItem("mamulengo.onboarded", "1"); document.querySelector(".back")?.click();`);
  // contadores do spine-core na pagina (o mesmo modulo que o editor usa, a URL do vite), com a pilha
  await ev(`
    if (window.__spine) return;
    const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\.vite\\/deps\\/@esotericsoftware_spine-(webgl|core)\\.js/.test(n));
    if (!urls.length) throw new Error("modulo do spine-core nao achado");
    const c = (window.__spine = { lidos: 0, posados: 0, pilhas: {} });
    const pilha = () => {
      const k = new Error().stack.split("\\n").slice(2, 6).map((l) => l.trim().replace(/https?:[^)]*\\/src\\//, "").replace(/\\?[^:]*/, "")).join(" < ");
      c.pilhas[k] = (c.pilhas[k] ?? 0) + 1;
    };
    for (const u of urls) {
      const m = await import(u);
      const P = m.Skeleton.prototype, J = m.SkeletonJson.prototype;
      if (!P.__contado) {
        const f = P.updateWorldTransform;
        P.updateWorldTransform = function (...a) { c.posados++; pilha(); return f.apply(this, a); };
        P.__contado = true;
      }
      if (!J.__contado) {
        const g = J.readSkeletonData;
        J.readSkeletonData = function (...a) { c.lidos++; pilha(); return g.apply(this, a); };
        J.__contado = true;
      }
    }
  `);
  const lista = (await call("assets")).filter((a: any) => a.id.startsWith(join(REPO, "tests/assets")));
  let falhas = 0;
  const linhasP: Linha[] = [];
  for (const as of lista) {
    const skel = assets.find((x) => x.nome === as.name);
    if (!skel) continue;
    const json = JSON.parse(readFileSync(skel.skel, "utf8"));
    const casos = casosDe(json, skel.ficha ? readFileSync(skel.ficha, "utf8") : null, skel.nome);
    const edits = edicoesDe(json, parseAtlas(readFileSync(skel.atlas, "utf8")).regions[0].name);
    const R: Record<string, { res: any[]; doc: any; lidos: number; posados: number; pilhas: any; medidas: any; ms: number }> = {};
    for (const runtime of ["spine", "nucleo"] as const) {
      await call("discard");
      await call("open", { id: as.id });
      // uma animacao aberta: o painel da ficha confere as regras dela a cada edicao
      await call("view", { runtime, playing: false, animation: Object.keys(json.animations)[0] });
      const st = await call("state");
      if (runtime === "nucleo" && !st.view.nucleo?.drawing) throw new Error(`${as.name}: o nucleo nao esta desenhando: ${st.view.nucleoError}`);
      await sleep(900);
      await ev("window.__spine.lidos = 0; window.__spine.posados = 0; window.__spine.pilhas = {};");
      const t0 = performance.now();
      const res: any[] = [];
      for (const c of casos)
        try {
          res.push((await call("exec", { calls: { cmd: c.cmd, args: c.args } })).results[0]);
        } catch (e: any) {
          res.push({ erro: String(e?.message ?? e) });
        }
      const ms = performance.now() - t0;
      for (const e of edits)
        try {
          await call("exec", { calls: e });
        } catch (err: any) {
          res.push({ erro: `${e.cmd}: ${err?.message ?? err}` });
        }
      // o painel da ficha confere as regras 450 ms depois da ultima edicao
      await sleep(900);
      const doc = await ev("return JSON.parse(app.doc.serialize());");
      const c = await ev<any>("return window.__spine;");
      R[runtime] = { res, doc, lidos: c.lidos, posados: c.posados, pilhas: c.pilhas, medidas: (await call("state")).view.medidas, ms };
      await call("discard");
    }
    const S = R.spine,
      M = R.nucleo;
    const p = pior(),
      f: string[] = [];
    casos.forEach((c, k) => comparaSaida(S.res[k], M.res[k], c.nome, p, f));
    for (const r of [...S.res.slice(casos.length), ...M.res.slice(casos.length)]) f.push(String(r.erro));
    const pd = pior();
    comparaDoc(S.doc, M.doc, "", pd, f);
    if (pd.d > 0.01) f.push(`documento: ${pd.onde} difere ${pd.d}`);
    if (pd.d > 0.01 && detalhe) {
      const k = pd.onde.split(".").slice(1, -2);
      const at = (o: any) => k.reduce((x, y) => x?.[y], o);
      console.log("spine", JSON.stringify(at(S.doc)), "\nnucleo", JSON.stringify(at(M.doc)), "\nnode spine", JSON.stringify(at(docsNode.get(skel.nome)?.spine)), "\nnode nucleo", JSON.stringify(at(docsNode.get(skel.nome)?.nucleo)));
    }
    const okS = M.lidos === 0 && M.posados === 0 && S.posados > 0 && M.medidas?.modo === "nucleo" && M.medidas?.recusas === 0;
    if (f.length || !okS) falhas++;
    if (!okS) console.log(`${as.name}: spine-core no modo nucleo, de onde:`, JSON.stringify(M.pilhas, null, 1), M.medidas);
    if (f.length) console.log(`${as.name} na pagina: ${f.slice(0, detalhe ? 12 : 1).join("\n  ")}`);
    linhasP.push({
      personagem: as.name,
      "medidas e edicoes": `${casos.length} medidas, ${edits.length} edicoes`,
      "resultados (pior, casas)": +p.d.toFixed(3),
      "documento (pior)": +pd.d.toExponential(1),
      "spine-core no modo nucleo": `${M.lidos} leituras, ${M.posados} poses`,
      "no modo spine": `${S.lidos} leituras, ${S.posados} poses`,
      "medidas pela ponte (ms) spine / nucleo": `${S.ms.toFixed(0)} / ${M.ms.toFixed(0)}`,
      ok: f.length || !okS ? "FALHA" : "ok",
    });
  }
  await call("view", { runtime: "spine" }).catch(() => {});
  ws.close();
  cdp.close();
  console.log("na pagina (o editor pela ponte):");
  console.table(linhasP);
  stop();
  return falhas;
}
