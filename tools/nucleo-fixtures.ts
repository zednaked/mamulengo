// Fixtures geradas (nao versionadas) para conferir partes do nucleo que os assets CC0 de
// tests/boneco nao cobrem, sempre contra o oraculo (docs/NUCLEO.md):
//
//   npx tsx tools/nucleo-fixtures.ts [saida]   # padrao: <tmp>/nucleo-fixtures
//   npx tsx tools/nucleo-compara.ts <saida>/transformacao
//   npx tsx tools/nucleo-estado.ts <saida>/eventos [--mix 0.2]
//
// - transformacao/: restricao de transformacao com os deslocamentos do topo (`rotacao`, `x`,
//   `y`, `escala_x`, `escala_y`, `cisalha_y`): 144 casos dirigidos (um deslocamento por vez,
//   para cada propriedade do alvo, em mundo, fonte local, alvo local e somando) e 200
//   aleatorios (varias propriedades, escala e deslocamento por alvo, limites, mixes, fonte
//   espelhada pela animacao);
// - eventos/: o pessoa e o monstro (CC0) com eventos de usuario em toda animacao, dois no
//   mesmo tempo e um no 0, para os roteiros de tras para frente do nucleo-estado.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const saida = resolve(process.argv[2] ?? join(tmpdir(), "nucleo-fixtures"));
const PROPS = ["girar", "x", "y", "escala_x", "escala_y", "cisalha_y"] as const;

// gerador com semente (mulberry32): os mesmos casos em toda execucao
function gerador(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esqueleto(nome: string, ossos: any[], restricao: any, animacoes: any) {
  return {
    boneco: 0,
    nome,
    esqueleto: { x: 0, y: 0, largura: 10, altura: 10 },
    ossos,
    slots: [],
    skins: [{ nome: "default", partes: {} }],
    imagens: [],
    paginas: [],
    restricoes: [restricao],
    animacoes,
  };
}

function transformacao(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const desl: Record<string, number> = { rotacao: 150, x: 20, y: -15, escala_x: 0.4, escala_y: -0.3, cisalha_y: 12 };
  const fonteDe: Record<string, string> = { rotacao: "girar", x: "x", y: "y", escala_x: "escala_x", escala_y: "escala_y", cisalha_y: "cisalha_y" };
  let n = 0;
  for (const [d, v] of Object.entries(desl))
    for (const alvo of PROPS)
      for (const modo of ["mundo", "fonte_local", "alvo_local", "somar"]) {
        const r: any = { tipo: "transformacao", nome: "c", fonte: "f", ossos: ["a"], propriedades: { [fonteDe[d]]: { para: { [alvo]: { max: 100 } } } }, [d]: v };
        if (modo === "fonte_local") r.fonte_local = r.alvo_local = true;
        else if (modo !== "mundo") r[modo] = true;
        const ossos = [
          { nome: "root" },
          { nome: "f", pai: "root", x: 30, y: 20, rotacao: 40, escala_x: 1.3, escala_y: 0.8 },
          { nome: "a", pai: "root", x: -10, y: 5, rotacao: 10 },
        ];
        const anim = { anda: { ossos: { f: { girar: [{ tempo: 0, valor: 0 }, { tempo: 1, valor: 300 }] } } } };
        writeFileSync(join(dir, `${d}-para-${alvo}-${modo}.boneco`), JSON.stringify(esqueleto("d", ossos, r, anim)));
        n++;
      }
  const rnd = gerador(7);
  const u = (a: number, b: number) => +(a + (b - a) * rnd()).toFixed(3);
  const sorteia = <T>(xs: readonly T[], k: number) => [...xs].sort(() => rnd() - 0.5).slice(0, k);
  for (let i = 0; i < 200; i++) {
    const propriedades: any = {};
    for (const p of sorteia(PROPS, 1 + Math.floor(rnd() * 3))) {
      const para: any = {};
      for (const q of sorteia(PROPS, 1 + Math.floor(rnd() * 2))) {
        para[q] = { max: rnd() < 0.5 ? u(-100, 100) : 100 };
        if (rnd() < 0.3) para[q].deslocamento = u(-20, 20);
        if (rnd() < 0.3) para[q].escalar = u(-2, 2);
      }
      propriedades[p] = { para };
      if (rnd() < 0.3) propriedades[p].deslocamento = u(-10, 10);
    }
    const r: any = { tipo: "transformacao", nome: "c", fonte: "f", ossos: ["a"], propriedades };
    const faixas: Record<string, [number, number]> = { rotacao: [-180, 180], x: [-50, 50], y: [-50, 50], escala_x: [-1, 1], escala_y: [-1, 1], cisalha_y: [-30, 30] };
    for (const [k, [a, b]] of Object.entries(faixas)) if (rnd() < 0.6) r[k] = u(a, b);
    for (const k of ["fonte_local", "alvo_local", "somar", "limitar"]) if (rnd() < 0.3) r[k] = true;
    for (const k of ["mix_girar", "mix_x", "mix_y", "mix_escala_x", "mix_escala_y", "mix_cisalha_y"]) if (rnd() < 0.3) r[k] = u(0, 1);
    const ossos = [
      { nome: "root" },
      { nome: "p", pai: "root", x: u(-50, 50), y: u(-50, 50), rotacao: u(-90, 90), escala_x: u(0.5, 2) },
      { nome: "f", pai: "p", x: u(-100, 100), y: u(-100, 100), rotacao: u(-180, 180), escala_x: u(0.5, 2), escala_y: u(0.5, 2) },
      { nome: "a", pai: "root", x: u(-100, 100), y: u(-100, 100), rotacao: u(-180, 180), escala_y: u(0.5, 2) },
    ];
    // a escala y da fonte pode ir a negativa: a fonte fica espelhada no meio da animacao
    const anim = {
      anda: {
        ossos: {
          f: {
            girar: [{ tempo: 0, valor: 0 }, { tempo: 1, valor: u(-200, 200) }],
            mover: [{ tempo: 0, x: 0, y: 0 }, { tempo: 1, x: u(-50, 50), y: u(-50, 50) }],
            escalar: [{ tempo: 0, x: 1, y: 1 }, { tempo: 1, x: u(0.5, 2), y: u(-2, 2) }],
          },
          p: { girar: [{ tempo: 0, valor: 0 }, { tempo: 1, valor: u(-90, 90) }] },
        },
      },
    };
    writeFileSync(join(dir, `aleatorio-${String(i).padStart(3, "0")}.boneco`), JSON.stringify(esqueleto(`t${i}`, ossos, r, anim)));
    n++;
  }
  return n;
}

function eventos(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const nome of ["pessoa", "monstro"]) {
    const pasta = join(RAIZ, "tests", "boneco", nome);
    const b = JSON.parse(readFileSync(join(pasta, `${nome}.boneco`), "utf8"));
    b.eventos = { a: { inteiro: 3 }, b: { texto: "x" }, c: {} };
    for (const an of Object.values<any>(b.animacoes))
      an.eventos = [
        { tempo: 0, nome: "a" },
        { tempo: 0.2, nome: "b" },
        { tempo: 0.2, nome: "c" },
        { tempo: 0.45, nome: "a", inteiro: 7 },
        { tempo: 0.6, nome: "c" },
      ];
    writeFileSync(join(dir, `${nome}-eventos.boneco`), JSON.stringify(b));
    for (const p of b.paginas) copyFileSync(join(pasta, p.arquivo), join(dir, p.arquivo));
  }
}

const n = transformacao(join(saida, "transformacao"));
eventos(join(saida, "eventos"));
console.log(`${saida}: ${n} casos de transformacao, 2 bonecos com eventos`);
