// Comandos da importacao de PSD (o plano de montagem esta em src/core/psd.ts).
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { skins } from "../model.ts";
import { round } from "./timeline.ts";
import { usesOfImage } from "../psd.ts";

const Rect = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);

defineCommand({
  name: "attachment.refit",
  group: "attachment",
  summary:
    "A imagem de uma regiao mudou de tamanho ou de lugar na arte (PSD): from e to sao os retangulos antigo e novo [esquerda, topo, largura, altura] em pixels da arte. Ajusta todo attachment que usa a imagem. Region: tamanho e posicao seguem a arte (rotacao e escala que o rig ja tinha ficam). Malha: vertices, pesos e deforms ficam onde estao; so as UVs mudam, para cada vertice continuar no mesmo ponto do desenho.",
  params: z.object({
    image: z.string().describe("nome da regiao no atlas"),
    from: Rect,
    to: Rect,
  }),
  label: (p) => `ajusta imagem ${p.image}`,
  run({ e }, p) {
    const [fl, ft, fw, fh] = p.from;
    const [tl, tt, tw, th] = p.to;
    const uses = usesOfImage(e.json, p.image);
    if (!uses.length) throw new Error(`nenhum attachment usa a imagem ${p.image}`);
    const out: string[] = [];
    const warnings: string[] = [];
    for (const u of uses) {
      const si = skins(e.json).findIndex((s) => s.name === u.skin);
      const path = ["skins", si, "attachments", u.slot, u.name];
      const a = u.a;
      const type = a.type ?? "region";
      if (a.sequence) {
        warnings.push(`${u.slot}/${u.name} tem sequence; ajuste a mao`);
        continue;
      }
      if (type === "region") {
        // unidades do attachment por pixel da arte (o rig pode ter mudado width/height)
        const rx = (a.width ?? fw) / fw,
          ry = (a.height ?? fh) / fh;
        // deslocamento do centro, em px da arte (y para baixo) -> local do attachment
        const dx = (tl + tw / 2 - (fl + fw / 2)) * rx * (a.scaleX ?? 1);
        const dy = -(tt + th / 2 - (ft + fh / 2)) * ry * (a.scaleY ?? 1);
        const r = ((a.rotation ?? 0) * Math.PI) / 180;
        const x = (a.x ?? 0) + Math.cos(r) * dx - Math.sin(r) * dy;
        const y = (a.y ?? 0) + Math.sin(r) * dx + Math.cos(r) * dy;
        const set = (k: string, v: number, def?: number) => {
          const nv = round(v);
          if (def !== undefined && Math.abs(nv - def) < 1e-9) {
            if (a[k] !== undefined) e.set([...path, k], undefined);
          } else if (a[k] !== nv) e.set([...path, k], nv);
        };
        set("x", x, 0);
        set("y", y, 0);
        set("width", tw * rx);
        set("height", th * ry);
      } else if (type === "mesh") {
        // cada vertice continua no mesmo pixel da arte: uv antigo -> px -> uv novo
        const uvs: number[] = a.uvs.map((v: number, i: number) => round(i % 2 === 0 ? (fl + v * fw - tl) / tw : (ft + v * fh - tt) / th));
        if (uvs.some((v) => v < -1e-4 || v > 1 + 1e-4)) warnings.push(`${u.slot}/${u.name}: parte da malha caiu fora da imagem nova (a arte encolheu); revise a malha`);
        e.set([...path, "uvs"], uvs);
        if (a.width !== undefined) e.set([...path, "width"], round((tw * a.width) / fw));
        if (a.height !== undefined) e.set([...path, "height"], round((th * a.height) / fh));
      } else {
        // linked mesh usa as UVs da fonte: so da para ajustar se a fonte usa a mesma imagem
        const src = skins(e.json).find((s) => s.name === (a.skin ?? "default"))?.attachments?.[a.slot ?? u.slot]?.[a.source];
        if (!src || (src.path ?? a.source) !== p.image) warnings.push(`${u.slot}/${u.name} e linked mesh de ${a.source}, que usa outra imagem: a imagem nova pode ficar deslocada; refaca o linked mesh`);
        continue;
      }
      out.push(`${u.skin}/${u.slot}/${u.name}`);
    }
    return { refit: out, warnings };
  },
});
