// O palco (docs/PALCO.md): o jogo dentro do .boneco, montado por comandos. stage.set liga o palco
// (gravidade, o mosaico solido); stage.actor faz de uma instancia um ator (e, com boneco, cria o
// osso, a camada e a instancia de uma vez: um personagem novo na cena num comando so); stage.remove
// tira um ator; stage.delete tira o palco. Jogar e medir: mamulengo_play (a ponte) e tools/palco.ts.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { boneIndex, requireBone, slots } from "../model.ts";
import { round } from "./timeline.ts";
import { mosaics } from "./mosaic.ts";

const stageOf = (json: any): any => json.stage;
const TIPOS = ["player", "patrol", "collectible", "door", "prop"] as const;

defineCommand({
  name: "stage.set",
  group: "skeleton",
  summary:
    "Liga ou muda o palco (so do Mamulengo; docs/PALCO.md): o jogo dentro do .boneco. gravity em px/s2 para baixo; solid: o mosaico cujos ladrilhos seguram (palette: so essas imagens da paleta; sem ela, todas), null tira; pixel: os atores desenham em pixel inteiro. Os atores entram com stage.actor; jogar e medir com mamulengo_play.",
  params: z.object({
    gravity: z.number().min(0).optional(),
    solid: z.object({ mosaic: z.string(), palette: z.array(z.string()).optional() }).nullable().optional(),
    pixel: z.boolean().optional(),
  }),
  label: () => "palco",
  run({ e }, p) {
    const atual = stageOf(e.json);
    const st: any = atual ? structuredClone(atual) : { gravity: 900, actors: [] };
    if (p.gravity !== undefined) st.gravity = round(p.gravity);
    if (p.solid === null) delete st.solid;
    else if (p.solid) {
      const m = mosaics(e.json).find((x) => x.name === p.solid!.mosaic);
      if (!m) throw new Error(`mosaico não existe: "${p.solid.mosaic}" (crie com mosaic.set)`);
      if (m.shape === "iso" || m.corners) throw new Error("o palco colide com mosaico de grade reta (sem iso nem perspectiva)");
      const fora = (p.solid.palette ?? []).filter((n) => !(m.palette ?? []).includes(n));
      if (fora.length) throw new Error(`imagens fora da paleta de ${m.name}: ${fora.join(", ")}`);
      st.solid = { mosaic: p.solid.mosaic, ...(p.solid.palette?.length ? { palette: p.solid.palette } : {}) };
    }
    if (p.pixel !== undefined) {
      if (p.pixel) st.pixel = true;
      else delete st.pixel;
    }
    if (JSON.stringify(st) !== JSON.stringify(atual)) e.set(["stage"], st);
    return { stage: st };
  },
});

defineCommand({
  name: "stage.actor",
  group: "skeleton",
  summary:
    "Cria ou muda um ator do palco: uma instancia que a simulacao move. type: player (anda e pula com a entrada), patrol (anda e vira na parede ou na beira), collectible (some ao toque e soma ponto), door (o toque vence), prop (enfeite). box [largura, altura] com o meio de baixo nos pes; speed px/s; jump px/s; side 1 ou -1 (para onde olha no comeco); animations {idle, walk, jump, dead}: nomes das animacoes do boneco filho por estado. Com boneco (o .boneco do personagem, relativo a este) e x, y (os pes no mundo), cria tambem o osso, a camada e a instancia com o nome do ator; sem boneco, a instancia ja tem de existir (instance: o nome dela, padrao o do ator). Liga o palco se ainda nao existe.",
  params: z.object({
    name: z.string().min(1),
    type: z.enum(TIPOS).optional(),
    instance: z.string().optional(),
    boneco: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    box: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    speed: z.number().min(0).optional(),
    jump: z.number().min(0).optional(),
    side: z.union([z.literal(1), z.literal(-1)]).optional(),
    animations: z.object({ idle: z.string().optional(), walk: z.string().optional(), jump: z.string().optional(), dead: z.string().optional() }).optional(),
  }),
  label: (p) => `ator ${p.name}`,
  run(ctx, p) {
    const { e } = ctx;
    const inst = p.instance ?? p.name;
    const instancias = (): any[] => (e.json as any).instances ?? [];
    let existe = instancias().some((x) => x.name === inst);
    if (p.boneco) {
      if (existe) throw new Error(`a instância ${inst} já existe: tire o boneco (ela é usada como está) ou use outro nome`);
      if (boneIndex(e.json, inst) >= 0 || slots(e.json).some((s: any) => s.name === inst)) throw new Error(`já existe osso ou camada ${inst}`);
      requireBone(e.json, "root");
      ctx.run("bone.add", { name: inst, parent: "root", x: round(p.x ?? 0), y: round(p.y ?? 0) });
      ctx.run("slot.add", { name: inst, bone: inst });
      const animacao = p.animations?.idle ?? (p.type === "patrol" ? p.animations?.walk : undefined);
      ctx.run("instance.set", { name: inst, slot: inst, boneco: p.boneco, ...(animacao ? { animation: animacao } : {}) });
      existe = true;
    } else if (p.x !== undefined || p.y !== undefined) {
      const ix = instancias().find((x) => x.name === inst);
      if (!ix) throw new Error(`instância não existe: "${inst}" (diga boneco para criar)`);
      const bi = boneIndex(e.json, ix.bone ?? slots(e.json).find((s: any) => s.name === ix.slot)?.bone);
      if (p.x !== undefined) e.set(["bones", bi, "x"], round(p.x));
      if (p.y !== undefined) e.set(["bones", bi, "y"], round(p.y));
    }
    if (!existe) throw new Error(`instância não existe: "${inst}" (crie com instance.set, ou diga boneco)`);
    const st: any = stageOf(e.json) ? structuredClone(stageOf(e.json)) : { gravity: 900, actors: [] };
    st.actors ??= [];
    const i = st.actors.findIndex((a: any) => a.name === p.name);
    if (i < 0 && !p.type) throw new Error("ator novo: diga type (player, patrol, collectible, door, prop)");
    const a: any = i >= 0 ? { ...st.actors[i] } : { name: p.name };
    if (inst !== p.name) a.instance = inst;
    else if (i < 0) a.instance = inst;
    if (p.type) a.type = p.type;
    if (p.box) a.box = p.box.map(round);
    if (p.speed !== undefined) a.speed = round(p.speed);
    if (p.jump !== undefined) a.jump = round(p.jump);
    if (p.side !== undefined) a.side = p.side;
    if (p.animations) a.animations = { ...(a.animations ?? {}), ...p.animations };
    if (i < 0) st.actors.push(a);
    else st.actors[i] = a;
    e.set(["stage"], st);
    return { actor: a, actors: st.actors.length };
  },
});

defineCommand({
  name: "stage.remove",
  group: "skeleton",
  summary: "Tira um ator do palco (a instancia fica na cena, parada). delete: true apaga tambem a instancia, a camada e o osso dela.",
  params: z.object({ name: z.string(), delete: z.boolean().optional() }),
  label: (p) => `tira ator ${p.name}`,
  run(ctx, p) {
    const { e } = ctx;
    const st = stageOf(e.json);
    const i = (st?.actors ?? []).findIndex((a: any) => a.name === p.name);
    if (i < 0) throw new Error(`ator não existe: "${p.name}"`);
    const inst = st.actors[i].instance ?? p.name;
    e.set(["stage", "actors"], st.actors.filter((_: any, k: number) => k !== i));
    if (p.delete) {
      const ix = ((e.json as any).instances ?? []).find((x: any) => x.name === inst);
      if (ix) {
        ctx.run("instance.delete", { name: inst });
        if (slots(e.json).some((s: any) => s.name === ix.slot)) ctx.run("slot.delete", { slot: ix.slot });
        if (boneIndex(e.json, inst) >= 0) ctx.run("bone.delete", { bone: inst });
      }
    }
    return { removed: p.name };
  },
});

defineCommand({
  name: "stage.delete",
  group: "skeleton",
  summary: "Tira o palco do .boneco (os atores voltam a ser instancias comuns).",
  params: z.object({}),
  label: () => "tira o palco",
  run({ e }) {
    if (!stageOf(e.json)) throw new Error("não há palco");
    e.set(["stage"], undefined);
    return { deleted: true };
  },
});
