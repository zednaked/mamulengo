// O PSD como tela (docs/LAYOUT-PSD.md): psd.layout propoe e aplica a arte base, as ancoras, os
// papeis, os textos e as nove-fatias a partir da estrutura do PSD (src/core/psd-tela.ts).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { animations, slots } from "../model.ts";
import { NOME_ESTADO, STATES, type StateName } from "../papeis.ts";
import type { PropostaTela } from "../psd-tela.ts";

const Escolhas = {
  off: z.array(z.string()).optional().describe("ids de itens da proposta que nao entram (ex. ancora:nuvens, fatias:barra)"),
  on: z.array(z.string()).optional().describe("ids de itens desligados na proposta que entram (as nove-fatias achadas so pela imagem)"),
  change: z.record(z.string(), z.any()).optional().describe('troca campos de um item: {"ancora:painel": {ancora: "right", esticar: "y"}, "texto:jogar": {chave: "PLAY"}, "botao:x": {nome: "y"}, "fatias:barra": {margens: [16,14,16,20]}}'),
  art: z.array(z.number()).length(4).optional().describe("a arte base [x, y, largura, altura] em px do PSD (padrao: o documento inteiro)"),
  fit: z.enum(["contain", "cover", "width", "height"]).optional(),
};

defineCommand({
  name: "psd.layout",
  group: "file",
  summary:
    "O PSD como tela de jogo (so .boneco; docs/LAYOUT-PSD.md): propoe, cada item com o porque, a arte base (o tamanho do PSD, encaixe caber), a ancora de cada grupo ou camada de cima pela posicao (perto do topo: em cima; do rodape: embaixo; nos cantos: o canto; faixa de largura total estica em x; o que cobre a arte e fundo e estica nos dois), os papeis pelos nomes (btn_, toque_, txt_) com os estados de botao pelas camadas (o grupo btn_x com normal, apertado, em_cima, desligado, ou as irmas x, x_apertado, x_off), as camadas de texto do PSD como partes de texto (texto, fonte, tamanho, cor, alinhamento; chave = o nome da camada renomeada ou o texto; fonte que falta avisa) e as nove-fatias (9_x, [9] ou [9:16,16,16,22] no nome, ou bordas iguais na imagem). psd: caminho do .psd (lido aqui); proposal: a de um dryRun anterior. dryRun:true so devolve a proposta (os itens, o mapa da importacao e as linhas) sem mudar nada. Sem dryRun aplica no documento aberto, que precisa ter sido importado com o mapa da proposta (mamulengo_psd com tela:true faz os dois). off, on e change ajustam os itens pelo id; map: o mapa externo da tela (<psd>.tela.json: arte, nomes, ancoras, fatias, textos); fonts: {fonte do PSD: arquivo relativo ao .boneco}.",
  params: z.object({
    psd: z.string().optional(),
    proposal: z.any().optional(),
    map: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
    dryRun: z.boolean().optional(),
    fonts: z.record(z.string(), z.string()).optional(),
    ...Escolhas,
  }),
  label: () => "tela pelo PSD",
  async prepare({ assets }, p) {
    const t = await import("../psd-tela.ts");
    let proposta: PropostaTela;
    if (p.proposal) proposta = p.proposal;
    else {
      if (!p.psd) throw new Error("psd: o caminho do .psd (ou proposal, a de um dryRun)");
      const buf = await assets?.bytes?.(p.psd);
      if (!buf) throw new Error(`nao consegui ler ${p.psd}`);
      let mapa: any = p.map;
      if (typeof mapa === "string") {
        const txt = await assets?.text?.(mapa);
        if (txt == null) throw new Error(`nao consegui ler o mapa ${mapa}`);
        mapa = JSON.parse(txt);
      }
      proposta = t.lerTela(buf, p.psd, { mapa });
    }
    const final = t.aplicarEscolhas(proposta, { off: p.off, on: p.on, change: p.change, art: p.art as any, fit: p.fit });
    return { proposta: final, mapa: t.mapaDaTela(final), linhas: t.resumoTela(final), calls: t.psdLayoutCalls };
  },
  run({ e, run, prepared }, p) {
    const { proposta, mapa, linhas, calls } = prepared as { proposta: PropostaTela; mapa: any; linhas: string[]; calls: typeof import("../psd-tela.ts").psdLayoutCalls };
    if (p.dryRun) return { dryRun: true, proposal: proposta, map: mapa, lines: linhas };
    const { calls: cs, avisos } = calls(e.json, proposta, { fonts: p.fonts });
    for (const c of cs) run(c.cmd, c.args);
    return { applied: cs.length, lines: linhas, warnings: [...proposta.avisos, ...avisos] };
  },
});

defineCommand({
  name: "psd.buttonStates",
  group: "bone",
  summary:
    "Um botao com os estados pelas imagens do PSD (o psd.layout usa): states {normal, hover, pressed, disabled: a parte do slot} vira uma animacao <nome>/<estado> que mostra essa parte no slot; os estados sem imagem ficam com as poses curtas padrao (role.set defaultStates) mostrando a parte normal. Sem slot, so as poses padrao.",
  params: z.object({
    name: z.string().min(1),
    bone: z.string(),
    slot: z.string().nullable().optional(),
    states: z.record(z.string(), z.string()).optional(),
  }),
  label: (p) => `botao ${p.name}`,
  run({ e, run }, p) {
    const est: Partial<Record<StateName, string>> = {};
    if (p.slot) {
      if (!slots(e.json).some((s) => s.name === p.slot)) throw new Error(`slot nao existe: ${p.slot}`);
      for (const s of STATES) {
        const parte = p.states?.[s];
        if (!parte) continue;
        const nome = `${p.name}/${NOME_ESTADO[s]}`;
        e.set(["animations", nome], { slots: { [p.slot]: { attachment: [{ name: parte }] } } });
        est[s] = nome;
      }
    }
    const r = run("role.set", { name: p.name, type: "button", bone: p.bone, states: est, defaultStates: true });
    // as poses padrao mostram a imagem normal (senao o estado anterior deixaria a dele)
    const normal = p.slot ? p.states?.normal : undefined;
    if (p.slot && normal)
      for (const s of STATES) {
        if (est[s]) continue;
        const nome = r.role.states?.[s];
        const a = nome ? animations(e.json)[nome] : null;
        if (a && !a.slots?.[p.slot]?.attachment) e.set(["animations", nome, "slots", p.slot, "attachment"], [{ name: normal }]);
      }
    return { role: r.role };
  },
});
