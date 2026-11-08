// A trilha de som de uma animacao (docs/NUCLEO.md "Som"): os eventos com `audio` que tocam do
// comeco ao fim, com o instante, o volume e o balanco, descendo nas instancias (o tempo do filho
// sai das chaves dela, como no nucleo) e calando o que esta escondido (o slot da instancia com
// alfa 0 nao e calculado, e uma instancia que nao toca nao faz barulho). Trabalha sobre o .boneco
// (portugues); quem le os filhos e quem chama (o disco nas ferramentas).

export interface Som {
  tempo: number; // segundos, no relogio da animacao de cima
  audio: string; // caminho do arquivo, relativo a pasta de audio do .boneco que o define
  pasta: string; // a pasta de audio desse .boneco (esqueleto.audio, relativa a ele), com o diretorio dele
  volume: number;
  balanco: number;
  evento: string;
  onde: string; // a instancia (caminho de nomes) ou "" no de cima
}

type Ler = (caminhoRelativoAoPai: string, pai: string) => { b: any; caminho: string };

const dirDe = (c: string) => (c.includes("/") ? c.slice(0, c.lastIndexOf("/") + 1) : "");

// o alfa do slot no instante t: as chaves rgba da animacao (degrau ou linear entre duas; as
// curvas bezier ficam lineares, o bastante para saber se esta visivel), ou o do setup
function alfaSlot(b: any, anim: any, slot: string, t: number): number {
  const s = (b.slots ?? []).find((x: any) => x.nome === slot);
  const setup = s?.cor ? parseInt(String(s.cor).slice(6, 8) || "ff", 16) / 255 : 1;
  const ks: any[] = anim?.slots?.[slot]?.rgba ?? [];
  if (!ks.length) return setup;
  const a = (k: any) => parseInt(String(k.cor ?? "ffffffff").slice(6, 8) || "ff", 16) / 255;
  if (t < (ks[0].tempo ?? 0)) return a(ks[0]);
  for (let i = ks.length - 1; i >= 0; i--) {
    const k = ks[i],
      t0 = k.tempo ?? 0;
    if (t < t0) continue;
    const prox = ks[i + 1];
    if (!prox || k.curva === "degrau") return a(k);
    const t1 = prox.tempo ?? 0;
    return t1 > t0 ? a(k) + ((a(prox) - a(k)) * (t - t0)) / (t1 - t0) : a(prox);
  }
  return setup;
}

const duracao = (anim: any): number => {
  let d = 0;
  const visita = (x: any) => {
    if (Array.isArray(x)) for (const k of x) typeof k?.tempo === "number" ? (d = Math.max(d, k.tempo)) : visita(k);
    else if (x && typeof x === "object") for (const v of Object.values(x)) visita(v);
  };
  visita(anim);
  return d;
};

// os sons da animacao `nome` de `b` (no arquivo `caminho`) de 0 a `dur` segundos, sem repetir
// (repetir: em laco); `ler` abre o .boneco de uma instancia pelo caminho relativo ao pai
export function trilhaDeSom(b: any, caminho: string, nome: string | null, dur: number, ler: Ler, fps = 30, repetir = false): Som[] {
  const out: Som[] = [];
  percorre(b, caminho, nome, 0, dur, (t) => t, repetir, "", ler, fps, out, 0);
  return out.sort((x, y) => x.tempo - y.tempo);
}

// t0..t1: o trecho do tempo desta animacao; cima(t): o instante no relogio de cima; repetir: o
// trecho anda em laco
function percorre(b: any, caminho: string, nome: string | null, t0: number, t1: number, cima: (t: number) => number, repetir: boolean, onde: string, ler: Ler, fps: number, out: Som[], nivel: number) {
  if (nivel > 8) return;
  const anim = nome ? b.animacoes?.[nome] : null;
  const defs = b.eventos ?? {};
  const pasta = dirDe(caminho) + (b.esqueleto?.audio ? String(b.esqueleto.audio).replace(/\/?$/, "/") : "");
  const dur = anim ? duracao(anim) : 0;
  // os eventos desta animacao no trecho (com as voltas do laco)
  if (anim?.eventos?.length && dur > 0) {
    const volta0 = repetir ? Math.floor(t0 / dur) : 0,
      volta1 = repetir ? Math.floor(t1 / dur) : 0;
    for (let v = volta0; v <= volta1; v++)
      for (const k of anim.eventos) {
        const tl = v * dur + (k.tempo ?? 0);
        if (tl < t0 - 1e-9 || tl > t1 + 1e-9) continue;
        if (!repetir && tl > dur + 1e-9) continue;
        const d = defs[k.nome] ?? {};
        const audio = k.audio ?? d.audio;
        if (!audio) continue;
        out.push({ tempo: cima(tl), audio, pasta, volume: k.volume ?? d.volume ?? 1, balanco: k.balanco ?? d.balanco ?? 0, evento: k.nome, onde });
      }
  }
  // as instancias: a cada quadro do trecho, se o slot esta visivel, o tempo do filho; os trechos
  // seguidos com a mesma animacao do filho viram uma descida so
  for (const inst of b.instancias ?? []) {
    const chaves: any[] = anim?.instancias?.[inst.nome] ?? [];
    const filho = ler(inst.boneco, caminho);
    let trecho: { an: string | null; ini: number; vel: number; laco: boolean; ta: number; tb: number; ca: number } | null = null;
    const fecha = () => {
      if (!trecho) return;
      const { an, ini, vel, laco, ta, tb, ca } = trecho;
      // o tempo do filho de ta a tb e ini + vel * (t - ca); o de cima, cima(t)
      const f0 = ini + vel * (ta - ca),
        f1 = ini + vel * (tb - ca);
      if (vel > 0 && an) percorre(filho.b, filho.caminho, an, f0, f1, (tf) => cima(ca + (tf - ini) / vel), laco, onde ? `${onde}/${inst.nome}` : inst.nome, ler, fps, out, nivel + 1);
      trecho = null;
    };
    const passo = 1 / fps;
    for (let t = t0; t <= t1 + 1e-9; t += passo) {
      const tAnim = repetir && dur > 0 ? t % dur : t;
      const visivel = alfaSlot(b, anim, inst.slot, tAnim) > 0;
      // a chave em vigor (o campo que falta vem da anterior, ou da instancia)
      let an: string | null = inst.animacao ?? null,
        ini = inst.inicio ?? 0,
        vel = inst.velocidade ?? 1,
        laco = inst.repetir ?? true,
        ca = 0;
      for (const k of chaves) {
        if ((k.tempo ?? 0) > tAnim + 1e-9) break;
        if (k.animacao !== undefined) an = k.animacao;
        if (k.inicio !== undefined) ini = k.inicio;
        if (k.velocidade !== undefined) vel = k.velocidade;
        if (k.repetir !== undefined) laco = k.repetir;
        ca = k.tempo ?? 0;
      }
      // sem chave em vigor, o tempo do filho anda com o relogio de cima desde o zero
      const caCima = t - (tAnim - ca);
      if (!visivel) {
        fecha();
        continue;
      }
      if (trecho && trecho.an === an && trecho.ini === ini && trecho.vel === vel && trecho.laco === laco && Math.abs(trecho.ca - caCima) < 1e-9) trecho.tb = t;
      else {
        fecha();
        trecho = { an, ini, vel, laco, ta: t, tb: t, ca: caCima };
      }
    }
    fecha();
  }
}

export { duracao as duracaoDaAnimacao };
