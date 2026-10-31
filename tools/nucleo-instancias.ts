// Confere as instancias do nucleo (docs/NUCLEO.md "Instancias") pela especificacao: para cada
// instante e cada instancia visivel (slot com alfa > 0), calcula por conta propria a animacao e o
// tempo do filho (a chave em vigor da timeline dela, ou inicio + velocidade x relogio; depois o
// laco ou o limite) e a mistura (no comeco dela, a pose e a da animacao anterior), a base (o osso do pai vezes a posicao da instancia) e o mundo de cada osso
// do filho (o filho sozinho no nucleo-pose, nesse tempo, vezes a base), e compara com o que o
// nucleo calculou dentro do pai. Desce nas instancias dos filhos (aninhadas) do mesmo jeito.
//
//   npx tsx tools/nucleo-instancias.ts [tests/nucleo/instancias/instancias.boneco] [--nucleo nucleo/build/nucleo-pose]
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--nucleo");
const bin = resolve(i >= 0 ? args.splice(i, 2)[1] : "nucleo/build/nucleo-pose");
const arq = resolve(args[0] ?? "tests/nucleo/instancias/instancias.boneco");

const f32 = Math.fround;
type M = number[]; // a b c d x y
const vezes = (p: M, q: M): M => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3], p[0] * q[4] + p[1] * q[5] + p[4], p[2] * q[4] + p[3] * q[5] + p[5]];
const GRAU = 3.1415927 / 180;

const json = new Map<string, any>();
const le = (c: string) => (json.has(c) ? json.get(c) : (json.set(c, JSON.parse(readFileSync(c, "utf8"))), json.get(c)));
// a duracao de uma animacao: a ultima chave de todas as timelines dela
const duracao = (a: any) => {
  let d = 0;
  const junta = (o: any): void => {
    if (Array.isArray(o)) o.forEach(junta);
    else if (o && typeof o === "object") {
      if (typeof o.tempo === "number") d = Math.max(d, f32(o.tempo));
      Object.values(o).forEach(junta);
    }
  };
  junta(a);
  return d;
};
const pose = (c: string, anim: string | null, ts: number[]) => {
  const r = spawnSync(bin, [c, anim ?? "-", ts.join(",")], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout).quadros;
};

let falhas = 0,
  conferidas = 0,
  misturas = 0,
  maior = 0;
const falha = (m: string) => (falhas++, console.log("FALHA " + m));

// o que o nucleo calculou num esqueleto (saida), com o tempo da animacao dele (tAnim, null sem
// animacao) e o arquivo
function confere(caminho: string, anim: string | null, tAnim: number | null, saida: any, onde: string) {
  const b = le(caminho);
  const insts: any[] = b.instancias ?? [];
  if (!insts.length) return;
  const a = anim ? b.animacoes?.[anim] : null;
  const dur = a ? duracao(a) : 0;
  const tA = tAnim === null ? null : dur > 0 ? tAnim % dur : tAnim;
  for (const inst of insts) {
    const nome = `${onde}/${inst.nome}`;
    const slot = saida.slots.find((s: any) => s.nome === inst.slot);
    const visivel = slot.cor[3] > 0;
    const out = saida.instancias?.[inst.nome];
    if (!visivel) {
      if (out) falha(`${nome}: slot apagado e a instancia saiu`);
      continue;
    }
    if (!out) {
      falha(`${nome}: visivel e nao saiu`);
      continue;
    }
    const filho = resolve(dirname(caminho), inst.boneco);
    const fb = le(filho);
    // o que a timeline pede (o campo que falta vem da chave anterior, ou da instancia)
    let an: string | null = inst.animacao ?? null,
      ini = inst.inicio ?? 0,
      vel = inst.velocidade ?? 1,
      laco = inst.repetir ?? true,
      t: number;
    const chaves: any[] = (a?.instancias ?? {})[inst.nome] ?? [];
    let k = -1;
    if (tA !== null) chaves.forEach((c, j) => f32(c.tempo ?? 0) <= tA && (k = j));
    // o que vale em cada chave (o campo que falta vem da anterior)
    let mix = inst.mix ?? 0;
    const porChave: { an: string | null; ini: number; vel: number; laco: boolean; mix: number }[] = [];
    for (const c of chaves) {
      if (c.animacao !== undefined) an = c.animacao;
      if (c.inicio !== undefined) ini = c.inicio;
      if (c.velocidade !== undefined) vel = c.velocidade;
      if (c.repetir !== undefined) laco = c.repetir;
      if (c.mix !== undefined) mix = c.mix;
      porChave.push({ an, ini, vel, laco, mix });
    }
    const noLaco = (an: string | null, t: number, laco: boolean) => {
      if (!an) return 0;
      const d = duracao(fb.animacoes[an]);
      return laco && d > 0 ? ((t % d) + d) % d : Math.min(Math.max(t, 0), d);
    };
    // a mistura: a chave em vigor tem mix, comecou ha menos que ele e troca a animacao
    let alfa = 1,
      de: { an: string | null; t: number } | null = null;
    if (k >= 0) {
      ({ an, ini, vel, laco } = porChave[k]);
      t = ini + vel * (tA! - f32(chaves[k].tempo ?? 0));
      const passou = tA! - f32(chaves[k].tempo ?? 0);
      if (k > 0 && porChave[k].mix > 0 && passou < porChave[k].mix && porChave[k - 1].an !== an) {
        alfa = passou / porChave[k].mix;
        const p = porChave[k - 1];
        de = { an: p.an, t: noLaco(p.an, p.ini + p.vel * (tA! - f32(chaves[k - 1].tempo ?? 0)), p.laco) };
      }
    } else {
      an = inst.animacao ?? null;
      t = (inst.inicio ?? 0) + (inst.velocidade ?? 1) * saida.relogio;
      laco = inst.repetir ?? true;
    }
    t = noLaco(an, t, laco);
    conferidas++;
    if (out.animacao !== an) falha(`${nome}: animacao ${out.animacao}, esperada ${an}`);
    if (!(Math.abs(out.tempo - t) <= 1e-9)) falha(`${nome}: tempo ${out.tempo}, esperado ${t}`);
    if (!(Math.abs((out.mistura ?? 1) - alfa) <= 1e-9)) falha(`${nome}: mistura ${out.mistura ?? 1}, esperada ${alfa}`);
    if (alfa > 0 && alfa < 1) {
      // no meio da mistura so a fracao (a pose local mistura as duas; o mundo nao sai de uma so)
      misturas++;
      continue;
    }
    // no comeco da mistura a pose e a da anterior no tempo dela
    const [anPose, tPose] = de ? [de.an, de.t] : [an, t];
    // a base e o filho sozinho naquele tempo
    const w = saida.ossos[inst.osso ?? b.slots.find((s: any) => s.nome === inst.slot).osso];
    const r = (inst.rotacao ?? 0) * GRAU,
      sx = inst.escala_x ?? 1,
      sy = inst.escala_y ?? 1;
    const base = vezes(w, [Math.cos(r) * sx, -Math.sin(r) * sy, Math.sin(r) * sx, Math.cos(r) * sy, inst.x ?? 0, inst.y ?? 0]);
    const so = pose(filho, anPose, [tPose])[0];
    for (const [osso, m] of Object.entries<M>(so.ossos)) {
      const esp = vezes(base, m);
      const dif = Math.max(...esp.map((x, c) => Math.abs(x - out.ossos[osso][c]) / Math.max(1, Math.abs(x))));
      maior = Math.max(maior, dif);
      if (!(dif <= 1e-6)) falha(`${nome} ${osso}: ${JSON.stringify(out.ossos[osso])}, esperado ${JSON.stringify(esp)}`);
    }
    confere(filho, an, an ? t : null, out, nome);
  }
}

const b = le(arq);
for (const anim of Object.keys(b.animacoes ?? { "-": {} })) {
  const dur = duracao(b.animacoes?.[anim]);
  const ts = Array.from({ length: 13 }, (_, k) => Math.round(((Math.max(dur, 1) * 1.25 * k) / 12) * 1e4) / 1e4);
  pose(arq, anim, ts).forEach((q: any, k: number) => confere(arq, anim, ts[k], q, `${anim}@${ts[k]}`));
}
console.log(falhas ? `${falhas} diferencas em ${conferidas} instancias` : `instancias iguais (${conferidas} instancias x instantes, ${misturas} no meio de uma mistura, maior diferenca ${maior.toExponential(1)})`);
process.exit(falhas ? 1 : 0);
