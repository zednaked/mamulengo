// Um desenho (src/core/desenho.ts) em SVG, com o mesmo resultado do canvas do editor
// (src/app/desenho.ts): preenchimento par-impar, traco no centro, por dentro (recortado pela
// forma, com o dobro da largura) e por fora (o dobro da largura, com o miolo apagado). Serve para
// rasterizar a pagina dos desenhos fora do navegador (server/desenhos.ts, com o sharp).
import { svgPath, type Drawing } from "./desenho.ts";
import { segsDoTraco, tracoVariavel } from "./lapis.ts";

const cor = (c: string) => ({ hex: "#" + c.slice(0, 6), a: c.length >= 8 ? parseInt(c.slice(6, 8), 16) / 255 : 1 });

export function desenhoEmSvg(d: Drawing, escala = 1): string {
  const W = Math.max(1, Math.ceil(d.width * escala)),
    H = Math.max(1, Math.ceil(d.height * escala));
  const defs: string[] = [];
  const corpo: string[] = [];
  d.shapes.forEach((s, i) => {
    if (s.hidden || !s.points.length) return;
    const p = svgPath(s);
    if (s.fill) {
      const f = cor(s.fill);
      corpo.push(`<path d="${p}" fill="${f.hex}" fill-opacity="${f.a}" fill-rule="${s.rule ?? "evenodd"}"/>`);
    }
    const st = s.stroke;
    if (!st || st.width <= 0) return;
    const k = cor(st.color);
    if (tracoVariavel(s)) {
      const d = segsDoTraco(s, Math.max(0.25, 1 / escala)).map((g) => g[0] + g.slice(1).join(" ")).join(" ");
      if (d) corpo.push(`<path d="${d}" fill="${k.hex}" fill-opacity="${k.a}" fill-rule="nonzero"/>`);
      return;
    }
    const align = s.closed ? (st.align ?? "center") : "center";
    const estilo = (w: number) => `fill="none" stroke="${k.hex}" stroke-opacity="${k.a}" stroke-width="${w}" stroke-linejoin="${st.join ?? "miter"}" stroke-linecap="${st.cap ?? "butt"}" stroke-miterlimit="4"`;
    if (align === "center") corpo.push(`<path d="${p}" ${estilo(st.width)}/>`);
    else if (align === "inside") {
      defs.push(`<clipPath id="r${i}"><path d="${p}" clip-rule="${s.rule ?? "evenodd"}"/></clipPath>`);
      corpo.push(`<path d="${p}" ${estilo(st.width * 2)} clip-path="url(#r${i})"/>`);
    } else {
      defs.push(`<mask id="m${i}" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000"><rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff"/><path d="${p}" fill="#000" fill-rule="${s.rule ?? "evenodd"}"/></mask>`);
      corpo.push(`<path d="${p}" ${estilo(st.width * 2)} mask="url(#m${i})"/>`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join("")}</defs><g transform="scale(${escala})">${corpo.join("")}</g></svg>`;
}
