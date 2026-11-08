// query.estilo: mede uma animacao com a regua do estilo da casa (src/core/estilo.ts) e
// compara com a faixa das animacoes prontas do mesmo tipo e papel (estilo-casa.json,
// gerado por tools/estilo.ts). Diz onde ficou timida ou exagerada antes de mostrar.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireAnimation } from "../model.ts";
import { compararEstilo, medir, papeisDaCasa, papel as papelDe, tipo as tipoDe } from "../estilo.ts";
import { shapeBounds } from "../desenho.ts";

defineCommand({
  name: "query.estilo",
  group: "query",
  readonly: true,
  summary:
    "Mede a animacao com a regua do estilo da casa (docs/ESTILO.md) e compara com a faixa das animacoes prontas do mesmo tipo e papel: duracao, quanto o corpo anda e gira, amassa, deform de malha, batidas, pausas, trocas. papel/tipo inferidos do nome se omitidos (papeis: idle, quebra de idle, ganho/acao, acao longa, perda, queda, entrada, saida, botao; tipos: personagem, simbolo, popup/placa, efeito, interface/mecanico, vegetacao, cenario).",
  params: z.object({ anim: z.string(), papel: z.string().optional(), tipo: z.string().optional() }),
  run({ doc }, p) {
    requireAnimation(doc.json, p.anim);
    const tipo = p.tipo ?? tipoDe(doc.file?.skeleton?.split("/").pop() ?? "", doc.json);
    const m: any = medir("", doc.json, p.anim);
    const papel = p.papel ?? papelDe(p.anim, m.dur);
    // sem bounds no cabecalho a altura vira 500 e as medidas em % da altura saem erradas
    const semBounds = !(doc.json.skeleton?.height > 0);
    const c = compararEstilo(m, tipo, papel);
    if (!c) return { tipo, papel, aviso: `sem referencia da casa para ${tipo} / ${papel}. ${papeisDaCasa().length ? `Existem: ${papeisDaCasa().join(", ")}` : "A casa esta vazia: gere com npx tsx tools/estilo.ts <seus jogos> --resumo src/core/estilo-casa.json"}` };
    const { linhas, fora, ref } = c;
    return {
      tipo,
      papel,
      referencia: `${ref.assets} assets da casa`,
      fora_da_faixa: fora,
      medidas: linhas,
      nota: fora ? "fora da faixa sem motivo e defeito: abaixo costuma ser animacao timida (pouca amplitude, pouco ritmo, pose parada)" : "dentro do estilo da casa",
      ...(semBounds ? { aviso: "o cabecalho nao tem bounds (skeleton.height): as medidas em % da altura usam 500 e podem estar infladas ou murchas. Rode skeleton.bounds antes de medir." } : {}),
      como_medimos: "corpo: centro de massa dos ossos; batidas: picos de movimento (30 fps) acima de 35% do maior pico; pausa: maior trecho com movimento abaixo de 8% do maior pico (ossos; deform e transparencia nao contam); deform: maior deslocamento de vertice nas chaves. Vegetacao e tecido se movem por deform: o corpo quase parado e normal ali.",
    };
  },
});

// query.desenho: a conferencia que da para medir num desenho (docs/DESENHAR.md, secao 4) sem
// olhar: forma ou traco cortado pela borda da imagem, nitidez no tamanho da tela, traco fora do
// padrao das outras pecas, paleta grande e pouco contraste de valor. O resto (silhueta, cinza,
// no lugar) e com os olhos: tools/quadro.ts --modo silhueta | cinza.
defineCommand({
  name: "query.desenho",
  group: "query",
  readonly: true,
  summary:
    "Confere os desenhos (ou um, image) pelo que da para medir: forma ou traco cortado pela borda da imagem, nitidez (pixels de textura por pixel de tela, com screen = pixels de tela por unidade do mundo e scale = a maior escala em que a peca aparece), traco muito mais grosso ou fino que o das outras pecas, paleta (cores de preenchimento distintas) e contraste de valor (luminancia) dentro de cada desenho. Devolve as medidas e os avisos.",
  params: z.object({ image: z.string().optional(), screen: z.number().positive().optional(), scale: z.number().positive().optional() }),
  run({ doc }, p) {
    const desenhos: Record<string, any> = doc.json.drawings ?? {};
    const nomes = p.image ? [p.image] : Object.keys(desenhos);
    if (p.image && !desenhos[p.image]) throw new Error(`nao ha desenho "${p.image}"`);
    // o tamanho da parte no mundo: a regiao que usa a imagem (largura dela sobre a do desenho)
    const escalaParte = (img: string, w: number) => {
      let e = 0;
      for (const sk of doc.json.skins ?? [])
        for (const sl of Object.values<any>(sk.attachments ?? {}))
          for (const [nome, a] of Object.entries<any>(sl))
            if ((a.path ?? nome) === img && a.width) e = Math.max(e, (a.width / w) * Math.abs(a.scaleX ?? 1));
      return e || 1;
    };
    const lum = (c: string) => {
      const v = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const avisos: string[] = [];
    const cores = new Set<string>();
    const tracos: { img: string; forma: string; mundo: number }[] = [];
    const out = nomes.map((img) => {
      const d = desenhos[img];
      const ep = escalaParte(img, d.width);
      const nitidez = (d.hd ?? 2) / (ep * (p.scale ?? 1) * (p.screen ?? 1));
      if (nitidez < 0.95) avisos.push(`${img}: borrada no maior tamanho (${nitidez.toFixed(2)} pixel de textura por pixel de tela; suba o hd para ${Math.ceil((d.hd ?? 2) / nitidez)})`);
      const cortadas: string[] = [];
      const lums: number[] = [];
      for (const s of d.shapes ?? []) {
        if (s.hidden || !s.points?.length) continue;
        const b = shapeBounds(s);
        if (!b) continue;
        const st = s.stroke?.width ? (s.closed ? (s.stroke.align === "inside" ? 0 : s.stroke.align === "outside" ? s.stroke.width : s.stroke.width / 2) : s.stroke.width / 2) : 0;
        if (b[0] - st < -0.5 || b[1] - st < -0.5 || b[2] + st > d.width + 0.5 || b[3] + st > d.height + 0.5) cortadas.push(s.name);
        if (s.fill) {
          cores.add(s.fill.slice(0, 6));
          lums.push(lum(s.fill));
        }
        if (s.stroke?.width) tracos.push({ img, forma: s.name, mundo: s.stroke.width * ep });
      }
      if (cortadas.length) avisos.push(`${img}: cortada pela borda da imagem (${cortadas.join(", ")}): draw.fit ou draw.resize com folga`);
      const contraste = lums.length > 1 ? Math.max(...lums) - Math.min(...lums) : null;
      if (contraste !== null && contraste < 0.08 && (d.shapes ?? []).length > 2) avisos.push(`${img}: pouco contraste de valor dentro do desenho (${contraste.toFixed(2)}): em cinza vira uma mancha so`);
      return { image: img, nitidez: Math.round(nitidez * 100) / 100, cortadas, contraste: contraste === null ? null : Math.round(contraste * 100) / 100, formas: (d.shapes ?? []).length };
    });
    // traco: comparado com a mediana das outras pecas (no tamanho do mundo)
    if (tracos.length >= 3) {
      const ord = tracos.map((t) => t.mundo).sort((a, b) => a - b);
      const med = ord[Math.floor(ord.length / 2)];
      for (const t of tracos) if (t.mundo > med * 2.5 || t.mundo < med * 0.4) avisos.push(`${t.img}/${t.forma}: traco de ${t.mundo.toFixed(1)} px no mundo, a mediana das pecas e ${med.toFixed(1)}`);
    }
    if (cores.size > 14) avisos.push(`paleta grande: ${cores.size} cores de preenchimento (3 a 5 principais e um acento leem melhor)`);
    return { desenhos: out, cores: cores.size, avisos };
  },
});
