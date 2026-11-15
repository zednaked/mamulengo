// O tutorial de rig e IK: as licoes (textos e conferencias). Cada licao tem uma cena com o Tico
// (exemplos/tutorial/gerar.ts escreve os originais), passos curtos e uma conferencia que olha o
// documento aberto e diz o que ja esta feito. O painel e src/app/Tutorial.svelte; preparar e
// recomecar as cenas, server/tutorial.ts. Conferencia sem DOM: roda no editor e no teste
// (tools/tutorial-teste.ts, que resolve cada cena pelos comandos).
import type { SpineJson } from "./format.ts";
import { bones, constraints, slots, animations } from "./model.ts";
import { comMedidor } from "./instantes.ts";

export type P = { x: number; y: number };
// pontos do Tico no mundo (y para cima, chao em 0): o gerador desenha por eles, a conferencia mede por eles
export const GEO = {
  perna: { quadril: { x: 4, y: 190 }, joelho: { x: 16, y: 106 }, tornozelo: { x: 2, y: 24 } },
  pernaTras: { quadril: { x: -12, y: 190 }, joelho: { x: -2, y: 106 }, tornozelo: { x: -14, y: 24 } },
  braco: { ombro: { x: 4, y: 304 }, cotovelo: { x: 24, y: 244 }, pulso: { x: 70, y: 226 } },
  bracoTras: { ombro: { x: -18, y: 304 }, cotovelo: { x: -34, y: 244 }, pulso: { x: -14, y: 190 } },
  // onde o tornozelo pisa na pedra (licoes 3 e 4)
  pedra: { x: 56, y: 62 },
};

export type ItemConferido = { ok: boolean; texto: string };
export interface Licao {
  id: string;
  // a trilha (TRILHAS): o boneco da cena e a ordem
  trilha: string;
  icone: string;
  titulo: string;
  // o que se aprende, em uma frase
  aprende: string;
  // o que fazer nesta cena
  tarefa: string;
  passos: string[];
  dica?: string;
  conferir(json: SpineJson): ItemConferido[];
}

// ---- medidas
const TOL_JUNTA = 14;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
type Osso = { worldX: number; worldY: number; a: number; c: number; length: number; name: string };
const origem = (o: Osso): P => ({ x: o.worldX, y: o.worldY });
const ponta = (o: Osso): P => ({ x: o.worldX + o.a * o.length, y: o.worldY + o.c * o.length });

function setup(json: SpineJson): Map<string, Osso> {
  return comMedidor(json, null, (m) => {
    const q: any = m.poses(null, [0])[0];
    const out = new Map<string, Osso>();
    for (const b of bones(json)) {
      const o = q.findBone(b.name);
      if (o) out.set(b.name, { worldX: o.worldX, worldY: o.worldY, a: o.a, c: o.c, length: o.length || 0, name: b.name });
    }
    return out;
  }, { leve: true });
}
// ossos ao longo de uma animacao (a cada 1/30 s)
function aoLongo(json: SpineJson, anim: string, nomes: string[]): Record<string, Osso[]> {
  const a = animations(json)[anim];
  return comMedidor(json, null, (m) => {
    const dur = Math.max(m.duracao(anim), 1 / 30);
    const n = Math.max(2, Math.round(dur * 30));
    const ts = Array.from({ length: n + 1 }, (_, i) => Math.min((i / n) * dur, dur - 1e-4));
    const qs: any[] = m.poses(anim, ts);
    const out: Record<string, Osso[]> = {};
    for (const nome of nomes)
      out[nome] = qs.map((q) => {
        const o = q.findBone(nome);
        return { worldX: o.worldX, worldY: o.worldY, a: o.a, c: o.c, length: o.length || 0, name: nome };
      });
    void a;
    return out;
  }, { leve: true });
}
const pai = (json: SpineJson, osso: string): string | undefined => bones(json).find((b: any) => b.name === osso)?.parent;
const existe = (json: SpineJson, osso: string) => bones(json).some((b: any) => b.name === osso);
function ancestrais(json: SpineJson, osso: string): string[] {
  const out: string[] = [];
  for (let p = pai(json, osso); p && !out.includes(p); p = pai(json, p)) out.push(p);
  return out;
}
const ossoDaCamada = (json: SpineJson, slot: string): string | undefined => slots(json).find((s: any) => s.name === slot)?.bone;
// o IK de dois ossos com exatamente esta cadeia
const ikDe = (json: SpineJson, cadeia: [string, string]) =>
  constraints(json).find(({ type, c }) => type === "ik" && c.bones?.length === 2 && c.bones[0] === cadeia[0] && c.bones[1] === cadeia[1])?.c;
// lado da dobra: sinal de (b - a) x (c - b)
const cruz = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
const px = (n: number) => `${Math.round(n)} px`;
// o osso com origem mais perto de um ponto
function maisPerto(ossos: Map<string, Osso>, p: P, fora: string[] = []): { nome: string; d: number } | null {
  let melhor: { nome: string; d: number } | null = null;
  for (const [nome, o] of ossos) {
    if (fora.includes(nome)) continue;
    const d = dist(origem(o), p);
    if (!melhor || d < melhor.d) melhor = { nome, d };
  }
  return melhor;
}

// ---- as licoes
const TICO: Omit<Licao, "trilha">[] = [
  {
    id: "prender",
    icone: "📎",
    titulo: "Prender as peças nos ossos",
    aprende: "Quem move uma imagem é o osso em que ela está presa: peça presa no osso errado fica para trás.",
    tarefa: "Os ossos do braço da frente já existem, mas a manga, o antebraço e a mão estão presos na raiz. Prenda cada um no seu osso.",
    passos: [
      "Embaixo, escolha a animação “acenar” e aperte Espaço: os ossos acenam, mas as imagens do braço ficam paradas. Volte para a Pose base.",
      "Clique na manga vermelha do braço da frente. No painel da direita, em “preso no osso”, escolha braco.",
      "Faça o mesmo com o antebraço (osso antebraco) e com a mão (osso mao). A imagem fica no mesmo lugar da tela: só muda quem a carrega.",
      "Toque “acenar” de novo: agora o braço inteiro acena.",
    ],
    dica: "No Esqueleto, à esquerda, os ossos aparecem em árvore: braco é filho do tronco, antebraco do braco, mao do antebraco. Girar um pai leva os filhos.",
    conferir(json) {
      return (
        [
          ["braco", "braco", "a manga presa"],
          ["antebraco", "antebraco", "o antebraço preso"],
          ["mao", "mao", "a mão presa"],
        ] as const
      ).map(([slot, osso, nome]) => {
        const atual = ossoDaCamada(json, slot);
        return { ok: atual === osso, texto: `${nome} no osso ${osso}${atual && atual !== osso ? ` (está em ${atual})` : ""}` };
      });
    },
  },
  {
    id: "ossos",
    icone: "🦴",
    titulo: "Criar os ossos da perna",
    aprende: "Um osso começa na junta (onde a peça gira) e aponta para a próxima junta; cada osso novo nasce filho do osso escolhido.",
    tarefa: "A perna da frente não tem ossos: coxa, canela e pé estão presos no quadril. Crie a cadeia quadril → coxa → canela → pé, começando cada osso no anel rosa da junta, e prenda cada peça no seu osso.",
    passos: [
      "Fique na Pose base. No Esqueleto, à esquerda, clique em quadril: ele será o pai da coxa.",
      "Pegue a ferramenta Osso (tecla 5) e arraste do anel rosa de cima (o quadril da perna) até o anel do meio (o joelho). Nasce o osso da coxa, filho do quadril. Dois cliques no nome renomeiam (coxa).",
      "Com o osso novo escolhido, arraste do anel do joelho até o anel de baixo (o tornozelo): é a canela, filha da coxa.",
      "Com a canela escolhida, arraste do tornozelo até a ponta do pé: é o pé.",
      "Agora prenda as peças: clique na coxa (calça azul de cima) e, em “preso no osso”, escolha o osso da coxa. Depois a canela e o pé.",
      "Teste com Girar (2): girar a coxa leva a canela e o pé juntos. Ctrl+Z volta o giro.",
    ],
    dica: "Errou o começo de um osso? Ctrl+Z e arraste de novo. A conferência aceita até 14 px de distância do anel.",
    conferir(json) {
      const ossos = setup(json);
      const juntas: [keyof typeof GEO.perna, string, string][] = [
        ["quadril", "coxa", "a coxa presa"],
        ["joelho", "canela", "a canela presa"],
        ["tornozelo", "pe", "o pé preso"],
      ];
      const itens: ItemConferido[] = [];
      let paiEsperado = "quadril";
      for (const [junta, slot, nome] of juntas) {
        const p = GEO.perna[junta];
        // o osso desta junta: o que a peca usa, se comecar na junta; senao, o mais perto do anel
        const daPeca = ossoDaCamada(json, slot);
        const o = daPeca && daPeca !== "quadril" && ossos.has(daPeca) && dist(origem(ossos.get(daPeca)!), p) <= TOL_JUNTA ? { nome: daPeca, d: dist(origem(ossos.get(daPeca)!), p) } : maisPerto(ossos, p, ["root", "quadril", "tronco", "coxa_e", "canela_e", "pe_e"]);
        const achou = !!o && o.d <= TOL_JUNTA;
        const filho = achou && pai(json, o!.nome) === paiEsperado;
        itens.push({
          ok: achou && filho,
          texto: achou
            ? filho
              ? `osso no ${junta} (${o!.nome}), filho de ${paiEsperado}`
              : `o osso ${o!.nome} está no ${junta}, mas é filho de ${pai(json, o!.nome)}; precisa ser filho de ${paiEsperado}`
            : `um osso começando no anel do ${junta}${o ? ` (o mais perto está a ${px(o.d)})` : ""}`,
        });
        const presa = achou && ossoDaCamada(json, slot) === o!.nome;
        itens.push({ ok: presa, texto: `${nome} no osso do ${junta}${!presa && daPeca ? ` (está em ${daPeca})` : ""}` });
        if (achou) paiEsperado = o!.nome;
        else break;
      }
      return itens;
    },
  },
  {
    id: "alcancar",
    icone: "🎯",
    titulo: "Alcançar com IK",
    aprende: "Com IK, você move só a ponta (o alvo) e a coxa e a canela giram sozinhas para chegar lá.",
    tarefa: "Faça a perna da frente alcançar um alvo e ponha o tornozelo no anel amarelo, em cima da pedra.",
    passos: [
      "Na Pose base, clique no osso canela (no desenho ou no Esqueleto).",
      "No painel da direita, aperte 🎯 Alcançar (IK). Aparece um osso vermelho na ponta da canela: canela_alvo.",
      "Com Mover (1), arraste o alvo vermelho até o anel amarelo na pedra. A coxa e a canela dobram sozinhas; o pé vai junto.",
      "Tente levar o alvo para longe demais: a perna estica até onde dá e para. É o limite do IK.",
    ],
    dica: "Sem IK, pôr o pé na pedra pede girar a coxa e depois a canela, várias vezes até acertar. Com IK é um arraste.",
    conferir(json) {
      const ik = ikDe(json, ["coxa", "canela"]);
      const itens: ItemConferido[] = [{ ok: !!ik, texto: ik ? `IK ${ik.name}: coxa e canela alcançam ${ik.target}` : "um IK na coxa e na canela (🎯 Alcançar na canela)" }];
      const o = setup(json).get("canela");
      const d = o ? dist(ponta(o), GEO.pedra) : Infinity;
      itens.push({ ok: d <= 12, texto: `tornozelo no anel amarelo${d <= 12 ? "" : o ? ` (falta ${px(d)})` : ""}` });
      return itens;
    },
  },
  {
    id: "dobra",
    icone: "🦵",
    titulo: "Joelho para o lado certo",
    aprende: "Para chegar ao mesmo alvo, a perna pode dobrar para dois lados; o IK guarda qual é o certo.",
    tarefa: "O pé do Tico está na pedra, mas o joelho dobrou para trás. Troque a dobra do IK da perna da frente.",
    passos: [
      "Clique no osso canela ou coxa. No painel da direita, em Restrições, aparece canela_ik.",
      "Aperte ⇄ dobra: o joelho passa para o outro lado e o pé continua na pedra.",
      "Mova o alvo (canela_alvo) com Mover (1) para ver o joelho dobrando sempre para a frente.",
    ],
    dica: "O 🎯 Alcançar já escolhe o lado pela pose em que a perna está desenhada. A dobra trocada aparece em rig montado à mão ou copiado de outro personagem.",
    conferir(json) {
      const ik = ikDe(json, ["coxa", "canela"]);
      if (!ik) return [{ ok: false, texto: "o IK canela_ik na coxa e na canela (sumiu? recomece a cena)" }];
      const os = setup(json);
      const [co, ca] = [os.get("coxa"), os.get("canela")];
      if (!co || !ca) return [{ ok: false, texto: "os ossos coxa e canela" }];
      const certo = Math.sign(cruz(GEO.perna.quadril, GEO.perna.joelho, GEO.perna.tornozelo));
      const agora = Math.sign(cruz(origem(co), origem(ca), ponta(ca)));
      const d = dist(ponta(ca), GEO.pedra);
      return [
        { ok: agora === certo, texto: "joelho dobrando para a frente" },
        { ok: d <= 12, texto: `tornozelo no anel da pedra${d <= 12 ? "" : ` (falta ${px(d)})`}` },
      ];
    },
  },
  {
    id: "chao",
    icone: "🦶",
    titulo: "Pé plantado no chão",
    aprende: "O alvo do IK leva o pé com ele: preso no quadril, o pé desce junto com o corpo; preso na raiz, fica no chão.",
    tarefa: "Na animação “agachar”, os pés afundam no chão. Passe os dois alvos (canela_alvo e canela_e_alvo) para a raiz.",
    passos: [
      "Escolha “agachar” embaixo e aperte Espaço: o Tico desce e os pés entram no chão. Volte para a Pose base.",
      "No Esqueleto, à esquerda, os alvos estão dentro de quadril. Arraste canela_alvo para cima de root: ele vira filho da raiz e fica no mesmo lugar.",
      "Faça o mesmo com canela_e_alvo.",
      "Toque “agachar” de novo: o quadril desce, os joelhos dobram e os pés ficam no chão.",
    ],
    dica: "Trocar o pai de um osso só funciona na Pose base. A regra serve para mão que segura algo parado (corrimão, parede): o alvo fica fora do corpo.",
    conferir(json) {
      const itens: ItemConferido[] = [];
      for (const [cadeia, nome] of [
        [["coxa", "canela"], "da frente"],
        [["coxa_e", "canela_e"], "de trás"],
      ] as const) {
        const ik = ikDe(json, cadeia as [string, string]);
        const solto = !!ik && !ancestrais(json, ik.target).includes("quadril") && ik.target !== "quadril";
        itens.push({ ok: solto, texto: ik ? `alvo do pé ${nome} (${ik.target}) fora do quadril${solto ? "" : `: hoje é filho de ${pai(json, ik.target)}`}` : `o IK da perna ${nome}` });
      }
      if (!animations(json).agachar || !existe(json, "quadril")) return [...itens, { ok: false, texto: "a animação agachar (sumiu? recomece a cena)" }];
      const s = aoLongo(json, "agachar", ["quadril", "canela", "canela_e"]);
      const desce = s.quadril[0].worldY - Math.min(...s.quadril.map((o) => o.worldY));
      const anda = (os: Osso[]) => Math.max(...os.map((o) => dist(ponta(o), ponta(os[0]))));
      const pes = Math.max(anda(s.canela), anda(s.canela_e));
      itens.push({ ok: desce >= 30 && pes <= 3, texto: `pés parados no agachar${pes > 3 ? ` (andam ${px(pes)})` : ""}` });
      return itens;
    },
  },
  {
    id: "agachar",
    icone: "🎬",
    titulo: "Animar com IK",
    aprende: "Com os pés presos por IK, animar é mexer só o corpo: as pernas se ajeitam sozinhas em cada quadro.",
    tarefa: "Crie a animação “agachar”: o quadril desce pelo menos 30 px e volta, e os pés não saem do lugar.",
    passos: [
      "Embaixo, ＋ nova animação, com o nome agachar.",
      "No instante 0, clique no quadril (o osso amarelo na cintura) e, com Mover (1), arraste um pouquinho e devolva: fica uma chave da pose de pé.",
      "Ande a régua até 0,4 s e arraste o quadril para baixo uns 50 px. Os joelhos dobram e os pés ficam onde estão.",
      "Em 0,8 s, ponha o quadril de volta no lugar (ou copie a chave do 0 com Ctrl+C e cole com Ctrl+V).",
      "Espaço toca. Experimente também inclinar o tronco com Girar (2) no fundo do agachamento.",
    ],
    dica: "Se o quadril descer demais, a perna não alcança mais o alvo e o pé descola do chão. É o limite do comprimento da perna.",
    conferir(json) {
      const a = animations(json).agachar;
      if (!a) return [{ ok: false, texto: "uma animação chamada agachar" }];
      const s = aoLongo(json, "agachar", ["quadril", "canela", "canela_e"]);
      const y0 = s.quadril[0].worldY;
      const desce = y0 - Math.min(...s.quadril.map((o) => o.worldY));
      const fim = Math.abs(s.quadril[s.quadril.length - 1].worldY - y0);
      const anda = (os: Osso[]) => Math.max(...os.map((o) => dist(ponta(o), ponta(os[0]))));
      const pes = Math.max(anda(s.canela), anda(s.canela_e));
      return [
        { ok: true, texto: "uma animação chamada agachar" },
        { ok: desce >= 30, texto: `o quadril desce pelo menos 30 px${desce >= 30 ? ` (desce ${px(desce)})` : desce > 0.5 ? ` (só ${px(desce)})` : ""}` },
        { ok: desce >= 30 && fim <= 4, texto: `o quadril volta ao lugar no fim${fim > 4 ? ` (fica a ${px(fim)})` : ""}` },
        { ok: pes <= 3, texto: `os pés não saem do lugar${pes > 3 ? ` (andam ${px(pes)})` : ""}` },
      ];
    },
  },
  {
    id: "bola",
    icone: "⚽",
    titulo: "A mão segue a bola",
    aprende: "O alvo de um IK pode ser qualquer osso: trocando o alvo, a mão passa a seguir outra coisa sem nenhuma chave nova.",
    tarefa: "O braço da frente já tem IK, com um alvo próprio. Faça a mão seguir a bola em “bola_passa”.",
    passos: [
      "Escolha “bola_passa” e toque: a bola passeia e a mão fica parada. Volte para a Pose base.",
      "Clique no antebraço. Em Restrições, no antebraco_ik, troque o “alvo” de antebraco_alvo para bola.",
      "Toque “bola_passa”: o braço inteiro acompanha a bola, quadro a quadro.",
    ],
    dica: "Para a mão pegar e soltar, o jogo costuma ter dois alvos e trocar o mix do IK por animação. O alvo antigo continua no Esqueleto; pode apagar se não for usar.",
    conferir(json) {
      const ik = ikDe(json, ["braco", "antebraco"]);
      const naBola = !!ik && (ik.target === "bola" || ancestrais(json, ik.target).includes("bola"));
      const itens: ItemConferido[] = [{ ok: naBola, texto: ik ? `o IK do braço alcança a bola${naBola ? "" : ` (hoje: ${ik.target})`}` : "o IK do braço (antebraco_ik)" }];
      if (!animations(json).bola_passa || !existe(json, "bola")) return [...itens, { ok: false, texto: "a animação bola_passa (sumiu? recomece a cena)" }];
      const s = aoLongo(json, "bola_passa", ["antebraco", "bola"]);
      const longe = Math.max(...s.antebraco.map((o, i) => dist(ponta(o), origem(s.bola[i]))));
      itens.push({ ok: longe <= 8, texto: `a mão acompanha a bola a animação toda${longe > 8 ? ` (chega a ${px(longe)} dela)` : ""}` });
      return itens;
    },
  },
];

// ---- a trilha do monstro: o Clique (azul) da Kenney (exemplos/monstros), de frente, com pernas de
// uma peca so (a perna dobra pela malha), olhos, boca e nariz soltos
export const GEO_MONSTRO = {
  // na imagem da perna (55 x 149 no mundo): a bola do quadril, o meio da canela fina e o tornozelo
  pernaD: { quadril: { x: 40, y: 135 }, joelho: { x: 51, y: 81 }, tornozelo: { x: 41, y: 39 } },
  pernaE: { quadril: { x: -40, y: 135 }, joelho: { x: -51, y: 81 }, tornozelo: { x: -41, y: 39 } },
};
const ROSTO: [string, string][] = [
  ["olho_e", "o olho da esquerda"],
  ["olho_d", "o olho da direita"],
  ["nariz", "o nariz"],
  ["boca", "a boca"],
];
// a parte (attachment) a mostra numa camada e os ossos que pesam nela (malha com pesos)
function parteDe(json: SpineJson, slot: string): any {
  const att = slots(json).find((s: any) => s.name === slot)?.attachment;
  for (const sk of (json as any).skins ?? []) {
    const a = sk.attachments?.[slot]?.[att];
    if (a) return a;
  }
  return null;
}
function ossosDaMalha(json: SpineJson, a: any): string[] {
  if (a?.type !== "mesh") return [];
  const nv = (a.uvs?.length ?? 0) / 2;
  if (!a.vertices || a.vertices.length === nv * 2) return [];
  const nomes = bones(json).map((b: any) => b.name);
  const usados = new Set<string>();
  for (let i = 0, v = 0; v < nv && i < a.vertices.length; v++) {
    const n = a.vertices[i++];
    for (let k = 0; k < n; k++, i += 4) if (a.vertices[i + 3] > 0.05) usados.add(nomes[a.vertices[i]]);
  }
  return [...usados];
}
const pesDoMonstro = (json: SpineJson, anim: string) => {
  const s = aoLongo(json, anim, ["quadril", "canela_d", "canela_e"]);
  const anda = (os: Osso[]) => Math.max(...os.map((o) => dist(ponta(o), ponta(os[0]))));
  return { s, pes: Math.max(anda(s.canela_d), anda(s.canela_e)) };
};

const MONSTRO: Omit<Licao, "trilha">[] = [
  {
    id: "m-montar",
    icone: "👀",
    titulo: "Montar o rosto",
    aprende: "Tudo o que deve ir junto com o corpo fica preso no osso do corpo (ou num filho dele).",
    tarefa: "No “pular”, o corpo sobe e o rosto fica no ar. Prenda os dois olhos, o nariz e a boca no osso corpo.",
    passos: [
      "Escolha “pular” embaixo e aperte Espaço: o corpo pula e o rosto fica para trás. Volte para a Pose base.",
      "Clique num olho. No painel da direita, em “preso no osso”, escolha corpo.",
      "Faça o mesmo com o outro olho, o nariz e a boca.",
      "Toque “pular” de novo: o monstro inteiro pula. Os braços e as orelhas já estavam no corpo.",
    ],
    dica: "O Clique é visto de frente: a ordem das camadas (aba Ordem, à esquerda) põe os braços e as orelhas atrás do corpo e o rosto na frente.",
    conferir(json) {
      return ROSTO.map(([slot, nome]) => {
        const o = ossoDaCamada(json, slot);
        const ok = o === "corpo" || (!!o && ancestrais(json, o).includes("corpo"));
        return { ok, texto: `${nome} no corpo${ok || !o ? "" : ` (está em ${o})`}` };
      });
    },
  },
  {
    id: "m-ossos",
    icone: "🦴",
    titulo: "Ossos dentro de uma peça só",
    aprende: "A perna do monstro é uma imagem inteira, mas pode ter dois ossos dentro dela: coxa e canela.",
    tarefa: "A perna da direita (a sua direita) está presa no quadril, sem ossos. Crie a coxa e a canela dentro dela, pelos anéis rosa, e prenda a perna na coxa. A perna da esquerda já está pronta, de exemplo.",
    passos: [
      "Na Pose base, clique em quadril no Esqueleto e pegue a ferramenta Osso (5).",
      "Arraste do anel de cima (a bola do quadril, escondida atrás do corpo) até o anel do meio (o joelho): nasce a coxa.",
      "Com ela escolhida, arraste do joelho até o anel de baixo (o tornozelo): nasce a canela, filha da coxa.",
      "Clique na perna e, em “preso no osso”, escolha o osso da coxa.",
      "Gire a coxa com Girar (2): a perna inteira vai junto. Gire a canela: nada acontece, porque a imagem é uma peça só presa na coxa. A próxima lição resolve isso.",
    ],
    dica: "Compare com a perna da esquerda no Esqueleto: coxa_e e canela_e. Dê nomes parecidos aos seus (coxa_d, canela_d) com dois cliques.",
    conferir(json) {
      const ossos = setup(json);
      const p = GEO_MONSTRO.pernaD;
      const fora = ["root", "quadril", "corpo", "coxa_e", "canela_e"];
      const itens: ItemConferido[] = [];
      const coxa = maisPerto(ossos, p.quadril, fora);
      const coxaOk = !!coxa && coxa.d <= TOL_JUNTA && pai(json, coxa.nome) === "quadril";
      itens.push({ ok: coxaOk, texto: coxa && coxa.d <= TOL_JUNTA ? (coxaOk ? `coxa (${coxa.nome}) na bola do quadril, filha de quadril` : `${coxa.nome} está no quadril, mas é filho de ${pai(json, coxa.nome)}`) : `um osso começando na bola do quadril${coxa ? ` (o mais perto está a ${px(coxa.d)})` : ""}` });
      const canela = coxaOk ? maisPerto(ossos, p.joelho, [...fora, coxa!.nome]) : null;
      const canelaOk = !!canela && canela.d <= TOL_JUNTA && pai(json, canela.nome) === coxa!.nome;
      itens.push({ ok: canelaOk, texto: canela && canela.d <= TOL_JUNTA ? (canelaOk ? `canela (${canela.nome}) no joelho, filha da coxa` : `${canela.nome} está no joelho, mas é filho de ${pai(json, canela.nome)}`) : "um osso começando no anel do joelho, filho da coxa" });
      const ponteOk = canelaOk && dist(ponta(ossos.get(canela!.nome)!), p.tornozelo) <= TOL_JUNTA;
      itens.push({ ok: ponteOk, texto: "a canela chega até o anel do tornozelo" });
      const presa = coxaOk && ossoDaCamada(json, "perna_d") === coxa!.nome;
      itens.push({ ok: presa, texto: `a perna presa na coxa${presa ? "" : ` (está em ${ossoDaCamada(json, "perna_d")})`}` });
      return itens;
    },
  },
  {
    id: "m-malha",
    icone: "🫧",
    titulo: "A perna que dobra (malha)",
    aprende: "Uma imagem vira malha e cada ponto dela segue os ossos que estão perto: a perna curva no joelho em vez de girar inteira.",
    tarefa: "Faça a perna da direita dobrar com a coxa e a canela. Teste com o “chutar”.",
    passos: [
      "Escolha “chutar” e toque: a canela gira, mas a perna não dobra (o osso mexe e a imagem não). Volte para a Pose base.",
      "Clique na perna da direita. No painel da direita, aperte 🫧 Deixar deformável: a imagem vira uma malha de triângulos.",
      "Logo abaixo, aperte Dobrar com os ossos: os pontos de cima seguem a coxa, os de baixo a canela, e os do meio um pouco de cada.",
      "Toque “chutar” de novo: a perna curva no joelho e o pé vai junto com a canela.",
    ],
    dica: "Ver ▸ malhas mostra os triângulos. Se uma parte puxar errado, Editar malha ▸ pintar pesos deixa acertar ponto a ponto.",
    conferir(json) {
      const a = parteDe(json, "perna_d");
      const malha = a?.type === "mesh";
      const ossos = ossosDaMalha(json, a);
      const dobra = ossos.includes("coxa_d") && ossos.includes("canela_d");
      return [
        { ok: malha, texto: "a perna da direita deformável (malha)" },
        { ok: dobra, texto: `a malha dobra com coxa_d e canela_d${malha && ossos.length && !dobra ? ` (hoje: ${ossos.join(", ")})` : ""}` },
      ];
    },
  },
  {
    id: "m-pes",
    icone: "🦶",
    titulo: "Pés no chão com IK",
    aprende: "Com um alvo na raiz para cada pé, o corpo pode descer e subir e os pés ficam onde estão.",
    tarefa: "No “agachar”, os pés afundam no chão. Ponha IK nas duas pernas para os pés ficarem parados.",
    passos: [
      "Toque “agachar”: o quadril desce e as pernas inteiras descem junto. Volte para a Pose base.",
      "Clique no osso canela_d e aperte 🎯 Alcançar (IK). Nasce o alvo canela_d_alvo, na raiz, no tornozelo.",
      "Faça o mesmo na canela_e.",
      "Toque “agachar” de novo: os joelhos dobram e os pés ficam no chão. As malhas curvam junto.",
    ],
    dica: "O 🎯 Alcançar põe o alvo na raiz de propósito: preso no quadril, ele desceria com o corpo. O pé inclina junto com a canela; num rig de jogo, o pé ganha um osso próprio, preso no alvo, para ficar reto no chão.",
    conferir(json) {
      const itens: ItemConferido[] = [];
      for (const [cadeia, nome] of [
        [["coxa_d", "canela_d"], "da direita"],
        [["coxa_e", "canela_e"], "da esquerda"],
      ] as const) {
        const ik = ikDe(json, cadeia as [string, string]);
        const solto = !!ik && !ancestrais(json, ik.target).includes("quadril");
        itens.push({ ok: solto, texto: ik ? `IK na perna ${nome}${solto ? "" : `, com o alvo fora do quadril`}` : `IK na perna ${nome}` });
      }
      if (!animations(json).agachar) return [...itens, { ok: false, texto: "a animação agachar (sumiu? recomece a cena)" }];
      const { pes } = pesDoMonstro(json, "agachar");
      itens.push({ ok: pes <= 3, texto: `pés parados no agachar${pes > 3 ? ` (andam ${px(pes)})` : ""}` });
      return itens;
    },
  },
  {
    id: "m-pulo",
    icone: "🦘",
    titulo: "O pulo",
    aprende: "Com IK, os pés só saem do chão quando você move os alvos: o corpo e os pés são animados separados.",
    tarefa: "Crie a animação “pulo”: o quadril abaixa (preparação), sobe alto com os pés no ar e volta ao chão no fim.",
    passos: [
      "Embaixo, ＋ nova animação, com o nome pulo.",
      "Em 0 s, dê uma chave no quadril parado (Mover, arraste e devolva). Em 0,2 s, desça o quadril uns 10 px: os joelhos dobram, é a preparação. A perna do Clique é quase reta, então pouco já dobra bastante.",
      "Em 0,45 s, suba o quadril uns 80 px acima de onde começou. Nesse mesmo instante, suba os dois alvos dos pés (canela_d_alvo e canela_e_alvo) uns 50 px: os pés saem do chão.",
      "Em 0,7 s, ponha os alvos de volta no chão e o quadril uns 8 px abaixo (a aterrissagem amortece). Em 0,9 s, tudo no lugar do começo.",
      "Espaço toca. Exagere: no desenho animado, o corpo vai mais alto que os pés.",
    ],
    dica: "Copiar a chave do 0 (Ctrl+C) e colar no fim (Ctrl+V) é o jeito mais fácil de terminar exatamente onde começou.",
    conferir(json) {
      if (!animations(json).pulo) return [{ ok: false, texto: "uma animação chamada pulo" }];
      const { s } = pesDoMonstro(json, "pulo");
      const y0 = s.quadril[0].worldY;
      const ys = s.quadril.map((o) => o.worldY);
      const baixo = y0 - Math.min(...ys),
        alto = Math.max(...ys) - y0;
      const pe0 = ponta(s.canela_d[0]).y;
      const peAlto = Math.max(...s.canela_d.map((o, i) => Math.min(ponta(o).y, ponta(s.canela_e[i]).y))) - pe0;
      const ultimo = s.quadril.length - 1;
      const fim = Math.max(Math.abs(ys[ultimo] - y0), dist(ponta(s.canela_d[ultimo]), ponta(s.canela_d[0])), dist(ponta(s.canela_e[ultimo]), ponta(s.canela_e[0])));
      return [
        { ok: true, texto: "uma animação chamada pulo" },
        { ok: baixo >= 6, texto: `o quadril abaixa antes de pular (pelo menos 6 px)${baixo >= 6 ? "" : baixo > 0.5 ? ` (só ${px(baixo)})` : ""}` },
        { ok: alto >= 40, texto: `o quadril sobe pelo menos 40 px${alto >= 40 ? ` (sobe ${px(alto)})` : alto > 0.5 ? ` (só ${px(alto)})` : ""}` },
        { ok: peAlto >= 25, texto: `os dois pés saem do chão (pelo menos 25 px)${peAlto >= 25 ? "" : peAlto > 0.5 ? ` (só ${px(peAlto)})` : ""}` },
        { ok: alto >= 40 && fim <= 4, texto: `tudo volta ao lugar no fim${fim > 4 ? ` (falta ${px(fim)})` : ""}` },
      ];
    },
  },
];

export const TRILHAS = [
  { id: "tico", icone: "🧒", titulo: "Tico", resumo: "o básico: ossos, peças e IK num boneco de perfil, peça por peça" },
  { id: "monstro", icone: "👾", titulo: "Monstro", resumo: "um monstro de frente com pernas de uma peça só: ossos dentro da imagem, malha que dobra, IK e pulo" },
];
export const LICOES: Licao[] = [...TICO.map((l) => ({ ...l, trilha: "tico" })), ...MONSTRO.map((l) => ({ ...l, trilha: "monstro" }))];
export const licoesDa = (trilha: string) => LICOES.filter((l) => l.trilha === trilha);

export const CENAS_TUTORIAL = LICOES.map((l) => ({ id: l.id, trilha: l.trilha }));
// a pasta de cada cena (relativa a exemplos/tutorial/cenas): trilha/NN-id
export function pastaDaCena(id: string) {
  const l = LICOES.find((x) => x.id === id);
  if (!l) throw new Error(`cena desconhecida: ${id}`);
  return `${l.trilha}/${String(licoesDa(l.trilha).indexOf(l) + 1).padStart(2, "0")}-${id}`;
}
