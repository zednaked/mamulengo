// Renomear e apagar mantendo todas as referencias do formato coerentes.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { CONSTRAINT_TYPES, boneIndex, bones, constraints, descendants, requireBone, requireSkin, requireSlot, skins, slots } from "../model.ts";
import { decodeDrawOrder, encodeDrawOrder } from "./organize.ts";
import type { Editor } from "../document.ts";

const anims = (e: Editor) => Object.entries<any>(e.json.animations ?? {});

// renomeia uma chave de objeto se existir
function renameKey(e: Editor, path: (string | number)[], from: string, to: string) {
  let o: any = e.json;
  for (const k of path) o = o?.[k];
  if (o && typeof o === "object" && from in o) e.apply({ op: "rename", path, from, to });
}

// todas as constraints (formato 4.3 e antigo) com caminho
const allC = (e: Editor) => constraints(e.json);

defineCommand({
  name: "bone.rename",
  group: "bone",
  summary: "Renomeia um osso e atualiza tudo que aponta para ele (filhos, slots, constraints, skins, animacoes).",
  params: z.object({ bone: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia osso ${p.bone} -> ${p.to}`,
  run({ e }, p) {
    const i = requireBone(e.json, p.bone);
    if (boneIndex(e.json, p.to) >= 0) throw new Error(`osso ja existe: ${p.to}`);
    e.set(["bones", i, "name"], p.to);
    bones(e.json).forEach((b, k) => b.parent === p.bone && e.set(["bones", k, "parent"], p.to));
    slots(e.json).forEach((s, k) => s.bone === p.bone && e.set(["slots", k, "bone"], p.to));
    for (const { c, path } of allC(e)) {
      for (const f of ["target", "source", "bone"]) if (c[f] === p.bone) e.set([...path, f], p.to);
      if (Array.isArray(c.bones) && c.bones.includes(p.bone))
        e.set(
          [...path, "bones"],
          c.bones.map((b: string) => (b === p.bone ? p.to : b)),
        );
    }
    skins(e.json).forEach((s, k) => {
      if (Array.isArray(s.bones) && s.bones.includes(p.bone))
        e.set(
          ["skins", k, "bones"],
          s.bones.map((b: string) => (b === p.bone ? p.to : b)),
        );
    });
    for (const [an] of anims(e)) renameKey(e, ["animations", an, "bones"], p.bone, p.to);
    ((e.json as any).particles ?? []).forEach((em: any, k: number) => em.bone === p.bone && e.set(["particles", k, "bone"], p.to));
    ((e.json as any).lights ?? []).forEach((l: any, k: number) => l.bone === p.bone && e.set(["lights", k, "bone"], p.to));
    return { renamed: p.to };
  },
});

// remapeia indices de osso nos vertices com pesos depois de remover ossos
function remapWeights(e: Editor, removed: Set<number>, force: boolean) {
  const oldCount = bones(e.json).length + removed.size;
  const map: number[] = [];
  let n = 0;
  for (let i = 0; i < oldCount; i++) map.push(removed.has(i) ? -1 : n++);
  skins(e.json).forEach((s, si) => {
    for (const [slot, atts] of Object.entries<any>(s.attachments ?? {}))
      for (const [name, a] of Object.entries<any>(atts)) {
        if (!a.vertices || !a.uvs || a.vertices.length <= a.uvs.length) continue;
        const v = a.vertices;
        const out: number[] = [];
        let touched = false;
        for (let i = 0; i < v.length; ) {
          const cnt = v[i++];
          const list: number[][] = [];
          for (let k = 0; k < cnt; k++, i += 4) list.push([v[i], v[i + 1], v[i + 2], v[i + 3]]);
          const kept = list.filter((x) => map[x[0]] >= 0);
          if (kept.length !== list.length) {
            if (!force) throw new Error(`a malha ${slot}/${name} tem pesos em osso removido; use force=true para redistribuir`);
            if (!kept.length) throw new Error(`um vertice de ${slot}/${name} depende so de ossos removidos`);
            const s = kept.reduce((t, x) => t + x[3], 0);
            kept.forEach((x) => (x[3] = x[3] / s));
          }
          out.push(kept.length);
          for (const x of kept) {
            if (map[x[0]] !== x[0]) touched = true;
            out.push(map[x[0]], x[1], x[2], x[3]);
          }
          if (kept.length !== list.length) touched = true;
        }
        if (touched) e.set(["skins", si, "attachments", slot, name, "vertices"], out);
      }
  });
}

defineCommand({
  name: "bone.delete",
  group: "bone",
  summary:
    "Apaga um osso e seus descendentes, junto com slots presos neles, constraints que os usam e as timelines. Malhas com pesos nesses ossos exigem force=true (os pesos sao redistribuidos).",
  params: z.object({ bone: z.string(), force: z.boolean().default(false) }),
  label: (p) => `apaga osso ${p.bone}`,
  run(ctx, p) {
    const { e } = ctx;
    requireBone(e.json, p.bone);
    if (!bones(e.json)[0] || bones(e.json)[0].name === p.bone) throw new Error("o osso raiz nao pode ser apagado");
    const dead = new Set([p.bone, ...descendants(e.json, p.bone)]);
    // slots presos nos ossos que somem
    for (const s of slots(e.json).filter((x) => dead.has(x.bone))) ctx.run("slot.delete", { slot: s.name });
    // emissores de particulas que nascem deles
    for (const em of ((e.json as any).particles ?? []).filter((x: any) => dead.has(x.bone))) ctx.run("particles.delete", { name: em.name });
    // luzes presas neles
    for (const l of ((e.json as any).lights ?? []).filter((x: any) => dead.has(x.bone))) ctx.run("light.delete", { name: l.name });
    // constraints que dependem deles
    for (const { c } of allC(e).filter(({ c }) => dead.has(c.target) || dead.has(c.source) || dead.has(c.bone) || c.bones?.some((b: string) => dead.has(b))))
      ctx.run("constraint.delete", { name: c.name });
    const removed = new Set<number>();
    for (let i = bones(e.json).length - 1; i >= 0; i--)
      if (dead.has(bones(e.json)[i].name)) {
        removed.add(i);
        e.remove(["bones"], i);
      }
    remapWeights(e, removed, p.force);
    skins(e.json).forEach((s, k) => {
      if (Array.isArray(s.bones) && s.bones.some((b: string) => dead.has(b)))
        e.set(
          ["skins", k, "bones"],
          s.bones.filter((b: string) => !dead.has(b)),
        );
    });
    for (const [an, a] of anims(e)) for (const b of dead) if (a.bones?.[b]) e.set(["animations", an, "bones", b], undefined);
    return { deleted: [...dead] };
  },
});

defineCommand({
  name: "slot.rename",
  group: "slot",
  summary: "Renomeia um slot e atualiza skins, animacoes, ordem de desenho, mascaras e constraints.",
  params: z.object({ slot: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia slot ${p.slot} -> ${p.to}`,
  run({ e }, p) {
    const i = requireSlot(e.json, p.slot);
    if (slots(e.json).some((s) => s.name === p.to)) throw new Error(`slot ja existe: ${p.to}`);
    e.set(["slots", i, "name"], p.to);
    skins(e.json).forEach((s, si) => {
      renameKey(e, ["skins", si, "attachments"], p.slot, p.to);
      for (const [slot, atts] of Object.entries<any>(s.attachments ?? {}))
        for (const [name, a] of Object.entries<any>(atts)) {
          if (a.type === "clipping" && a.end === p.slot) e.set(["skins", si, "attachments", slot, name, "end"], p.to);
          if (a.type === "linkedmesh" && a.slot === p.slot) e.set(["skins", si, "attachments", slot, name, "slot"], p.to);
        }
    });
    for (const { c, path, type } of allC(e)) if (type === "path") for (const f of ["slot", "target"]) if (c[f] === p.slot) e.set([...path, f], p.to);
    for (const [an] of anims(e)) {
      renameKey(e, ["animations", an, "slots"], p.slot, p.to);
      renameKey(e, ["animations", an, "effects"], p.slot, p.to);
    }
    ((e.json as any).particles ?? []).forEach((em: any, k: number) => em.slot === p.slot && e.set(["particles", k, "slot"], p.to));
    for (const [an, a] of anims(e)) {
      for (const skin of Object.keys(a.attachments ?? {})) renameKey(e, ["animations", an, "attachments", skin], p.slot, p.to);
      (a.drawOrder ?? []).forEach((k: any, ki: number) =>
        (k.offsets ?? []).forEach((o: any, oi: number) => o.slot === p.slot && e.set(["animations", an, "drawOrder", ki, "offsets", oi, "slot"], p.to)),
      );
    }
    return { renamed: p.to };
  },
});

defineCommand({
  name: "slot.delete",
  group: "slot",
  summary: "Apaga um slot com seus attachments e timelines; as chaves de ordem de desenho sao recalculadas.",
  params: z.object({ slot: z.string() }),
  label: (p) => `apaga slot ${p.slot}`,
  run(ctx, p) {
    const { e } = ctx;
    const i = requireSlot(e.json, p.slot);
    const before = slots(e.json).map((s) => s.name);
    for (const s of skins(e.json))
      for (const [slot, atts] of Object.entries<any>(s.attachments ?? {}))
        for (const [name, a] of Object.entries<any>(atts))
          if (a.type === "clipping" && a.end === p.slot && slot !== p.slot) throw new Error(`a mascara ${slot}/${name} termina neste slot; mude o end antes`);
    for (const { c, type } of allC(e)) if (type === "path" && (c.slot ?? c.target) === p.slot) ctx.run("constraint.delete", { name: c.name });
    for (const em of ((e.json as any).particles ?? []).filter((x: any) => x.slot === p.slot)) ctx.run("particles.delete", { name: em.name });
    // ordem de desenho: decodifica com a ordem antiga, tira o slot, recodifica
    const after = before.filter((n) => n !== p.slot);
    for (const [an, a] of anims(e))
      (a.drawOrder ?? []).forEach((k: any, ki: number) => {
        if (!k.offsets) return;
        const order = decodeDrawOrder(before, k.offsets).filter((n) => n !== p.slot);
        const enc = encodeDrawOrder(after, order);
        e.set(["animations", an, "drawOrder", ki, "offsets"], enc.length ? enc : undefined);
      });
    e.remove(["slots"], i);
    skins(e.json).forEach((s, si) => s.attachments?.[p.slot] && e.set(["skins", si, "attachments", p.slot], undefined));
    for (const [an, a] of anims(e)) {
      if (a.slots?.[p.slot]) e.set(["animations", an, "slots", p.slot], undefined);
      if (a.effects?.[p.slot]) e.set(["animations", an, "effects", p.slot], undefined);
      for (const skin of Object.keys(a.attachments ?? {})) if (a.attachments[skin][p.slot]) e.set(["animations", an, "attachments", skin, p.slot], undefined);
    }
    return { deleted: p.slot };
  },
});

defineCommand({
  name: "attachment.rename",
  group: "attachment",
  summary: "Renomeia um attachment (em todas as skins) e atualiza setup, chaves de troca de imagem, deforms e linked meshes.",
  params: z.object({ slot: z.string(), from: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia ${p.slot}/${p.from} -> ${p.to}`,
  run({ e }, p) {
    const i = requireSlot(e.json, p.slot);
    let found = false;
    skins(e.json).forEach((s, si) => {
      const atts = s.attachments?.[p.slot];
      if (atts?.[p.from]) {
        if (atts[p.to]) throw new Error(`ja existe ${p.slot}/${p.to} na skin ${s.name}`);
        found = true;
        // sem "path", a imagem vinha do nome antigo: fixa o path para continuar a mesma
        if (!atts[p.from].path && (atts[p.from].type ?? "region") !== "clipping") e.set(["skins", si, "attachments", p.slot, p.from, "path"], p.from);
        renameKey(e, ["skins", si, "attachments", p.slot], p.from, p.to);
      }
      for (const [slot, list] of Object.entries<any>(s.attachments ?? {}))
        for (const [name, a] of Object.entries<any>(list))
          if (a.type === "linkedmesh" && a.source === p.from && (a.slot ?? slot) === p.slot) e.set(["skins", si, "attachments", slot, name, "source"], p.to);
    });
    if (!found) throw new Error(`attachment nao existe: ${p.slot}/${p.from}`);
    if (slots(e.json)[i].attachment === p.from) e.set(["slots", i, "attachment"], p.to);
    for (const [an, a] of anims(e)) {
      (a.slots?.[p.slot]?.attachment ?? []).forEach((k: any, ki: number) => k.name === p.from && e.set(["animations", an, "slots", p.slot, "attachment", ki, "name"], p.to));
      for (const skin of Object.keys(a.attachments ?? {})) renameKey(e, ["animations", an, "attachments", skin, p.slot], p.from, p.to);
    }
    return { renamed: p.to };
  },
});

defineCommand({
  name: "constraint.rename",
  group: "constraint",
  summary: "Renomeia uma constraint (timelines e listas de skin acompanham).",
  params: z.object({ name: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia constraint ${p.name} -> ${p.to}`,
  run({ e }, p) {
    const c = allC(e).find((x) => x.c.name === p.name);
    if (!c) throw new Error(`constraint nao existe: ${p.name}`);
    if (allC(e).some((x) => x.c.name === p.to)) throw new Error(`ja existe: ${p.to}`);
    e.set([...c.path, "name"], p.to);
    for (const [an] of anims(e)) renameKey(e, ["animations", an, c.type], p.name, p.to);
    skins(e.json).forEach((s, si) => {
      if (Array.isArray(s[c.type]) && s[c.type].includes(p.name))
        e.set(
          ["skins", si, c.type],
          s[c.type].map((n: string) => (n === p.name ? p.to : n)),
        );
    });
    void CONSTRAINT_TYPES;
    return { renamed: p.to };
  },
});

defineCommand({
  name: "event.rename",
  group: "animation",
  summary: "Renomeia um evento e todos os disparos dele.",
  params: z.object({ name: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia evento ${p.name} -> ${p.to}`,
  run({ e }, p) {
    if (!e.json.events?.[p.name]) throw new Error(`evento nao existe: ${p.name}`);
    if (e.json.events[p.to]) throw new Error(`ja existe: ${p.to}`);
    e.apply({ op: "rename", path: ["events"], from: p.name, to: p.to });
    for (const [an, a] of anims(e)) (a.events ?? []).forEach((k: any, ki: number) => k.name === p.name && e.set(["animations", an, "events", ki, "name"], p.to));
    return { renamed: p.to };
  },
});

defineCommand({
  name: "skin.rename",
  group: "skin",
  summary: "Renomeia uma skin (deforms e linked meshes acompanham).",
  params: z.object({ name: z.string(), to: z.string().min(1) }),
  label: (p) => `renomeia skin ${p.name} -> ${p.to}`,
  run({ e }, p) {
    const i = requireSkin(e.json, p.name);
    if (skins(e.json).some((s) => s.name === p.to)) throw new Error(`skin ja existe: ${p.to}`);
    e.set(["skins", i, "name"], p.to);
    for (const [an] of anims(e)) renameKey(e, ["animations", an, "attachments"], p.name, p.to);
    skins(e.json).forEach((s, si) => {
      for (const [slot, atts] of Object.entries<any>(s.attachments ?? {}))
        for (const [name, a] of Object.entries<any>(atts)) if (a.type === "linkedmesh" && a.skin === p.name) e.set(["skins", si, "attachments", slot, name, "skin"], p.to);
    });
    return { renamed: p.to };
  },
});
