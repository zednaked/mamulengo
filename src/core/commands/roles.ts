// Papeis dos elementos (so do Mamulengo; docs/NUCLEO.md "Papeis"): o que cada osso (ou slot de
// texto) e para o codigo do jogo. O modelo e o manifesto em src/core/papeis.ts; o teste de toque e
// os estados pelo ponteiro sao do nucleo. Aqui so o documento.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { animations, bones, requireBone, requireSlot, slots } from "../model.ts";
import { round } from "./timeline.ts";
import { NOME_ESTADO, ROLE_TYPES, STATES, groupSlots, manifesto, proposeRoles, rolesOf, type Role, type StateName } from "../papeis.ts";
import type { Editor } from "../document.ts";

function setRoles(e: Editor, list: Role[]) {
  e.set(["roles"], list.length ? list : undefined);
}

const hex = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v * 255)))
    .toString(16)
    .padStart(2, "0");
const cor = (c: string | undefined, k: number[]) => {
  const s = (c ?? "ffffffff").padEnd(8, "f");
  return [0, 1, 2, 3].map((i) => hex((parseInt(s.slice(i * 2, i * 2 + 2), 16) / 255) * k[i])).join("");
};

// as animacoes curtas padrao de cada estado (poses: uma chave em 0): a escala do osso e a cor dos
// slots do grupo, a partir do setup. normal: o setup; em cima: 6% maior; apertado: 6% menor e mais
// escuro; desligado: escuro e meio transparente
const PADRAO: Record<StateName, { escala: number; cor: number[] }> = {
  normal: { escala: 1, cor: [1, 1, 1, 1] },
  hover: { escala: 1.06, cor: [1, 1, 1, 1] },
  pressed: { escala: 0.94, cor: [0.82, 0.82, 0.82, 1] },
  disabled: { escala: 1, cor: [0.55, 0.55, 0.55, 0.6] },
};
export function defaultStateAnim(json: any, bone: string, st: StateName): any {
  const p = PADRAO[st];
  // a escala da animacao multiplica a do setup
  const anim: any = { bones: { [bone]: { scale: [{ x: round(p.escala), y: round(p.escala) }] } }, slots: {} };
  for (const s of groupSlots(json, bone)) {
    const sl = slots(json).find((x) => x.name === s)!;
    anim.slots[s] = { rgba: [{ color: cor(sl.color, p.cor) }] };
  }
  return anim;
}

defineCommand({
  name: "role.set",
  group: "bone",
  summary:
    "O papel de um elemento para o codigo do jogo (so do Mamulengo; o Spine nao tem): o codigo acha pelo nome (tela.botao(\"jogar\").aoTocar(...), tela.texto(\"placar\", ...)). type button: area de toque com estados (normal, hover = em cima, pressed = apertado, disabled = desligado), cada um uma animacao (states {normal: \"anim\", ...}; null tira); defaultStates:true cria as que faltam como poses curtas <nome>/<estado> (escala e cor do grupo). touch: so a area. text: a parte de texto que o jogo troca (slot). A area do botao e do toque: as partes do osso (bone) e dos filhos (as de texto so contam se o grupo nao tem outra; a nove-fatias que cresce com o texto entra no tamanho mostrado), ou area {slot} (so a parte desse slot), ou area {box: [x, y, largura, altura]} (um retangulo no osso, o meio em x, y). mix: segundos de emenda entre os estados (0.1); track: a trilha dos estados (padrao 10 + a ordem entre os botoes); disabled: comeca desligado. to: renomeia o papel; off:true tira. Ver tudo: query.roles (o manifesto).",
  params: z.object({
    name: z.string().min(1),
    type: z.enum(ROLE_TYPES).optional(),
    bone: z.string().optional(),
    slot: z.string().optional(),
    area: z.object({ slot: z.string().optional(), box: z.array(z.number()).length(4).optional() }).nullable().optional(),
    states: z.object(Object.fromEntries(STATES.map((s) => [s, z.string().nullable().optional()])) as Record<StateName, z.ZodOptional<z.ZodNullable<z.ZodString>>>).optional(),
    defaultStates: z.boolean().optional(),
    mix: z.number().min(0).optional(),
    track: z.number().int().min(0).nullable().optional(),
    disabled: z.boolean().optional(),
    to: z.string().min(1).optional(),
    off: z.boolean().optional(),
  }),
  label: (p) => `papel ${p.name}`,
  run({ e }, p) {
    const lista = [...rolesOf(e.json)];
    const k = lista.findIndex((r) => r.name === p.name);
    if (p.off) {
      if (k >= 0) lista.splice(k, 1), setRoles(e, lista);
      return { name: p.name, role: null };
    }
    const antes: Role | undefined = k >= 0 ? lista[k] : undefined;
    const type = p.type ?? antes?.type;
    if (!type) throw new Error(`o papel ${p.name} e novo: diga o type (button, touch ou text)`);
    const r: Role = { name: p.to ?? p.name, type };
    if (p.to && p.to !== p.name && lista.some((x) => x.name === p.to)) throw new Error(`papel ja existe: ${p.to}`);
    if (type === "text") {
      const slot = p.slot ?? antes?.slot ?? (slots(e.json).some((s) => s.name === p.name) ? p.name : undefined);
      if (!slot) throw new Error("o papel de texto precisa do slot da parte de texto");
      requireSlot(e.json, slot);
      const temTexto = Object.values<any>(Object.fromEntries((e.json.skins ?? []).flatMap((sk: any) => Object.entries<any>(sk.attachments?.[slot] ?? {})))).some((a: any) => a?.type === "text");
      if (!temTexto) throw new Error(`o slot ${slot} nao tem parte de texto (text.set antes)`);
      r.slot = slot;
    } else {
      const bone = p.bone ?? antes?.bone ?? (p.slot ? slots(e.json).find((s) => s.name === p.slot)?.bone : undefined) ?? (bones(e.json).some((b) => b.name === p.name) ? p.name : undefined);
      if (!bone) throw new Error("o botao e o toque precisam do osso (bone)");
      requireBone(e.json, bone);
      r.bone = bone;
      const area = p.area === null ? undefined : (p.area ?? antes?.area ?? (p.slot ? { slot: p.slot } : undefined));
      if (area?.slot) {
        requireSlot(e.json, area.slot);
        if (!groupSlots(e.json, bone).includes(area.slot)) throw new Error(`o slot ${area.slot} nao e do osso ${bone} nem dos filhos`);
      }
      if (area?.box && !(area.box[2] > 0 && area.box[3] > 0)) throw new Error("a caixa da area precisa de largura e altura positivas");
      if (area?.slot || area?.box) r.area = { ...(area.slot ? { slot: area.slot } : {}), ...(area.box ? { box: area.box.map(round) } : {}) };
      if (type === "button") {
        const st: Partial<Record<StateName, string>> = { ...(antes?.states ?? {}) };
        for (const s of STATES) {
          const v = p.states?.[s];
          if (v === null) delete st[s];
          else if (v !== undefined) {
            if (!animations(e.json)[v]) throw new Error(`animacao desconhecida: ${v} (estado ${s})`);
            st[s] = v;
          }
        }
        if (p.defaultStates)
          for (const s of STATES) {
            if (st[s]) continue;
            const nome = `${r.name}/${NOME_ESTADO[s]}`;
            if (!animations(e.json)[nome]) e.set(["animations", nome], defaultStateAnim(e.json, bone, s));
            st[s] = nome;
          }
        if (Object.keys(st).length) r.states = Object.fromEntries(STATES.filter((s) => st[s]).map((s) => [s, st[s]!]));
        const mix = p.mix ?? antes?.mix;
        if (mix !== undefined && mix !== 0.1) r.mix = round(mix);
        const track = p.track === null ? undefined : (p.track ?? antes?.track);
        if (track !== undefined) r.track = track;
      }
    }
    const dis = p.disabled ?? antes?.disabled;
    if (dis) r.disabled = true;
    if (k >= 0) lista[k] = r;
    else lista.push(r);
    if (JSON.stringify(lista) !== JSON.stringify(rolesOf(e.json))) setRoles(e, lista);
    return { role: r };
  },
});

defineCommand({
  name: "role.auto",
  group: "bone",
  summary:
    "Propoe os papeis pelos nomes (o import de PSD: as camadas viram ossos e slots com o nome delas): btn_jogar, botao_jogar ou button_jogar e um botao \"jogar\" (o osso, ou o slot como area); toque_x, area_x ou hit_x uma area de toque; txt_saldo ou texto_saldo o texto do codigo \"saldo\" (o slot com parte de texto, ou o primeiro do osso). Os que ja tem papel ficam. Sem apply mostra a proposta; apply:true grava (botoes com os estados padrao, como role.set defaultStates).",
  params: z.object({ apply: z.boolean().optional() }),
  label: () => "papeis pelos nomes",
  run(ctx, p) {
    const prop = proposeRoles(ctx.e.json);
    if (p.apply) for (const r of prop) ctx.run("role.set", { ...r, ...(r.type === "button" ? { defaultStates: true } : {}) });
    return { proposed: prop, applied: !!p.apply };
  },
});

defineCommand({
  name: "query.roles",
  group: "query",
  readonly: true,
  summary:
    "O manifesto da tela: o contrato entre quem monta a tela e quem escreve a logica, para escrever o codigo do jogo sem abrir o editor. botoes (nome, osso, area, estados e as animacoes, desligado, trilha, a chamada), toques, textos (todos, pelo nome: os do codigo marcados, a chave ou o texto livre, os {parametros} e um exemplo), estados da tela (as animacoes que nao sao estado de botao, com duracao e eventos), eventos, idiomas e avisos. A API: src/tela/tela-boneco.ts (docs/BACKEND.md \"Papeis\").",
  params: z.object({ name: z.string().optional().describe("o nome da tela no manifesto (padrao: tela)") }),
  run({ doc }, p) {
    return { roles: rolesOf(doc.json), manifest: manifesto(doc.json, p.name ?? "tela") };
  },
});
