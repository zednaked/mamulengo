// Olho maluco (googly eye): o branco, a pupila solta e o brilho, colados numa camada. A pupila fica
// na ponta de um osso preso ao centro do olho, com fisica de giro so com gravidade (quase sem
// mola): pende para baixo, rola pela borda quando o corpo mexe e assenta. Num ponto dado ou em
// lugares aleatorios dentro da parte opaca da imagem da camada. As imagens vem da biblioteca de
// efeitos (biblioteca/efeitos, "olho_maluco"): o editor as poe no atlas antes.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireSlot, skins, slots } from "../model.ts";
import { apply, boneWorld, skeletonAt } from "../pose.ts";
import { round } from "./timeline.ts";

// proporcoes do olho da Kenney (Googly Eyes): pupila e brilho em fracao do diametro do branco;
// curso: quanto o centro da pupila sai do centro do olho
const PUPILA = 0.588,
  CURSO = 0.19,
  BRILHO = { x: 0.194, y: 0.168, d: 0.364 };
const IMAGENS = { branco: "efeito_googly_branco", pupila: "efeito_googly_pupila", brilho: "efeito_googly_brilho" };

// sorteio com semente (o mesmo resultado a cada vez)
function sorteador(semente: number) {
  let s = semente >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// pixel da imagem (u, v; y para baixo) -> espaco do osso da camada, numa regiao ou numa malha sem
// pesos; null fora da malha
function pixelParaOsso(a: any, w: number, h: number): (u: number, v: number) => [number, number] | null {
  if (!a.type || a.type === "region") {
    const rot = ((a.rotation ?? 0) * Math.PI) / 180,
      c = Math.cos(rot),
      s = Math.sin(rot);
    const lw = (a.width ?? w) * (a.scaleX ?? 1),
      lh = (a.height ?? h) * (a.scaleY ?? 1);
    return (u, v) => {
      const x = (u / w - 0.5) * lw,
        y = (0.5 - v / h) * lh;
      return [(a.x ?? 0) + x * c - y * s, (a.y ?? 0) + x * s + y * c];
    };
  }
  if (a.type === "mesh") {
    if (a.vertices.length !== a.uvs.length) throw new Error("olho maluco: a malha tem pesos; ponha numa camada de imagem ou malha sem pesos");
    const uv = a.uvs,
      vs = a.vertices,
      tr = a.triangles;
    return (u, v) => {
      const pu = u / w,
        pv = v / h;
      for (let t = 0; t < tr.length; t += 3) {
        const [i, j, k] = [tr[t], tr[t + 1], tr[t + 2]];
        const x1 = uv[i * 2], y1 = uv[i * 2 + 1], x2 = uv[j * 2], y2 = uv[j * 2 + 1], x3 = uv[k * 2], y3 = uv[k * 2 + 1];
        const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        if (Math.abs(det) < 1e-12) continue;
        const l1 = ((y2 - y3) * (pu - x3) + (x3 - x2) * (pv - y3)) / det,
          l2 = ((y3 - y1) * (pu - x3) + (x1 - x3) * (pv - y3)) / det,
          l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        return [l1 * vs[i * 2] + l2 * vs[j * 2] + l3 * vs[k * 2], l1 * vs[i * 2 + 1] + l2 * vs[j * 2 + 1] + l3 * vs[k * 2 + 1]];
      }
      return null;
    };
  }
  throw new Error(`olho maluco: a camada mostra ${a.type}; ponha numa imagem ou malha`);
}

defineCommand({
  name: "eye.googly",
  group: "slot",
  summary:
    "Olho maluco: cola olhos de boneco (branco, pupila solta e brilho) numa camada. A pupila pende para baixo e rola quando a peca mexe (fisica de giro com gravidade). at: pontos em pixels da imagem da camada (y para baixo); sem at, count olhos em lugares aleatorios dentro da parte opaca (seed muda o sorteio). size: diametro em px (padrao: pelo tamanho da peca). Se a peca tem geleia, os olhos seguem a geleia. As imagens (efeito_googly_*) precisam estar no atlas: no editor, o menu da camada as traz da biblioteca.",
  params: z.object({
    slot: z.string(),
    attachment: z.string().optional().describe("padrao: a imagem visivel da camada"),
    skin: z.string().default("default"),
    at: z.array(z.tuple([z.number(), z.number()])).optional(),
    count: z.number().int().min(1).max(40).default(1),
    area: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional().describe("sorteio so dentro deste retangulo da imagem, em fracao: [x0, y0, x1, y1] (0 a 1, y para baixo); para nao cair em cima do rosto"),
    size: z.number().positive().optional(),
    seed: z.number().int().min(0).default(1),
    name: z.string().optional().describe("prefixo dos nomes (padrao <slot>_olho)"),
    gravity: z.number().default(900).describe("puxa a pupila para baixo (px/s2)"),
  }),
  label: (p) => `olho maluco em ${p.slot}`,
  async prepare(ctx, p) {
    const sl = slots(ctx.doc.json).find((s) => s.name === p.slot);
    const att = p.attachment ?? sl?.attachment;
    const a = att ? skins(ctx.doc.json).find((s) => s.name === p.skin)?.attachments?.[p.slot]?.[att] : null;
    const img = a ? await ctx.assets?.image(a.path ?? att!) : null;
    if (!img) throw new Error(`olho maluco: a imagem de ${p.slot} nao esta disponivel`);
    return { img, att };
  },
  run({ e, run, assets, prepared }, p) {
    const { img, att } = prepared as { img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }; att: string };
    requireSlot(e.json, p.slot);
    for (const n of Object.values(IMAGENS)) if (!assets?.region(n)) throw new Error(`olho maluco: falta a imagem ${n} no atlas (traga o olho maluco da biblioteca)`);
    const sl = slots(e.json).find((s) => s.name === p.slot)!;
    const a = skins(e.json).find((s) => s.name === p.skin)!.attachments[p.slot][att];
    const W = img.width,
      H = img.height;
    const paraOsso = pixelParaOsso(a, W, H);
    // tamanho: diametro em px do mundo; px da imagem por px do osso, pela largura
    const largura = !a.type || a.type === "region" ? (a.width ?? W) * Math.abs(a.scaleX ?? 1) : (() => {
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < a.vertices.length; i += 2) (x0 = Math.min(x0, a.vertices[i])), (x1 = Math.max(x1, a.vertices[i]));
      return x1 - x0;
    })();
    const pxImg = W / Math.max(largura, 1e-6);
    const altura = largura * (H / W);
    const size = p.size ?? Math.max(12, Math.min(70, Math.min(largura, altura) * 0.22));
    const r = size / 2;
    // os pontos (pixels da imagem): dados, ou sorteados dentro da parte opaca, longe da borda e
    // uns dos outros
    const opaco = (u: number, v: number) => {
      const x = Math.round(u),
        y = Math.round(v);
      return x >= 0 && y >= 0 && x < W && y < H && img.data[(y * W + x) * 4 + 3] > 200;
    };
    let pontos: [number, number][] = p.at ?? [];
    if (!p.at) {
      const rnd = sorteador(p.seed);
      const ri = r * pxImg * 1.05;
      for (let tent = 0; tent < 4000 && pontos.length < p.count; tent++) {
        const [a0, b0, a1, b1] = p.area ?? [0, 0, 1, 1];
        const u = (a0 + rnd() * (a1 - a0)) * W,
          v = (b0 + rnd() * (b1 - b0)) * H;
        let dentro = opaco(u, v);
        for (let k = 0; k < 12 && dentro; k++) dentro = opaco(u + Math.cos((k * Math.PI) / 6) * ri, v + Math.sin((k * Math.PI) / 6) * ri);
        if (!dentro || pontos.some(([x, y]) => Math.hypot(x - u, y - v) < ri * 2.2)) continue;
        if (!paraOsso(u, v)) continue;
        pontos.push([u, v]);
      }
      if (!pontos.length) throw new Error(`olho maluco: nao coube nenhum olho de ${round(size)} px dentro de ${p.slot}; diga size menor ou at`);
    }
    // o mundo no setup, para os ossos novos (pelo mundo: at e toward)
    const mundo = boneWorld(skeletonAt(e.json, null, 0), sl.bone);
    const base = p.name ?? `${p.slot}_olho`;
    const livre = (n: string) => {
      let nome = n;
      for (let k = 2; slots(e.json).some((s) => s.name === nome) || (e.json.bones ?? []).some((b: any) => b.name === nome); k++) nome = `${n}_${k}`;
      return nome;
    };
    // os olhos ficam na frente da camada, na ordem em que foram postos
    let acima = p.slot;
    const criados: string[] = [];
    const novosSlots: string[] = [];
    for (const [u, v] of pontos) {
      const loc = paraOsso(u, v);
      if (!loc) throw new Error(`olho maluco: o ponto [${u}, ${v}] cai fora da imagem de ${p.slot}`);
      const [wx, wy] = apply(mundo, loc[0], loc[1]);
      const olho = livre(base);
      const piv = `${olho}_pupila`;
      run("bone.add", { name: olho, parent: sl.bone, at: [round(wx), round(wy)] });
      // a pupila na ponta de um osso que aponta para baixo no mundo (onde a gravidade a deixa)
      run("bone.add", { name: piv, parent: olho, at: [round(wx), round(wy)], toward: [round(wx), round(wy - CURSO * size)] });
      const sBranco = `${olho}_branco`,
        sPupila = `${olho}_pupila`,
        sBrilho = `${olho}_brilho`;
      run("slot.add", { name: sBranco, bone: olho, above: acima });
      run("attachment.region", { slot: sBranco, name: IMAGENS.branco, width: round(size), height: round(size) });
      run("slot.set", { slot: sBranco, attachment: IMAGENS.branco });
      run("slot.add", { name: sPupila, bone: piv, above: sBranco });
      run("attachment.region", { slot: sPupila, name: IMAGENS.pupila, x: round(CURSO * size), width: round(PUPILA * size), height: round(PUPILA * size) });
      run("slot.set", { slot: sPupila, attachment: IMAGENS.pupila });
      run("slot.add", { name: sBrilho, bone: olho, above: sPupila });
      run("attachment.region", { slot: sBrilho, name: IMAGENS.brilho, world: { center: [round(wx + BRILHO.x * size), round(wy + BRILHO.y * size)] }, width: round(BRILHO.d * size), height: round(BRILHO.d * size) });
      run("slot.set", { slot: sBrilho, attachment: IMAGENS.brilho });
      // so gravidade (mola quase nula): pende, rola e assenta; o limite segura arrancos grandes. O
      // .boneco guarda a gravidade no sentido do jogo (o do nucleo), o contrario do formato do
      // editor: aqui vai trocada para puxar para baixo no nucleo (medido)
      run("physics.create", { name: `${olho}_fisica`, bone: piv, rotate: 1, inertia: 1, strength: 4, damping: 0.88, gravity: -p.gravity, mass: 1, limit: 1500, length: round(CURSO * size) });
      acima = sBrilho;
      criados.push(olho);
      novosSlots.push(sBranco, sPupila, sBrilho);
    }
    // na geleia: os olhos andam com ela
    if (a.jelly) {
      const si = skins(e.json).findIndex((s) => s.name === p.skin);
      e.set(["skins", si, "attachments", p.slot, att, "jelly", "followers"], [...(a.jelly.followers ?? []), ...novosSlots]);
    }
    return { eyes: criados, size: round(size), points: pontos.map(([x, y]) => [round(x), round(y)]) };
  },
});
