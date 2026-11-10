// A cena lida (tscn.ts) com o layout calculado (layout.ts) vira a tela do Mamulengo (tela.ts): a lista
// de desenho com imagem (recorte de esticar ja resolvido), caixa, texto, boneco e toque, e a tabela dos
// nos. As regras sao as do conversor de capturas, mas sem o Godot: o tema padrao do Godot 4 entra onde
// a cena nao diz.
import { ehConstrutor, ehExt, ehSub, type NoCena, type SubRecurso, type Valor } from "./tscn.ts";
import { ehControl, estiloDeTexto, type Caixa, type Medidas } from "./layout.ts";
import type { DadosTela, ElementoTela, Estilo, No } from "../tela/tela.ts";

export type OpcoesTela = Medidas & {
  // o arquivo de um res:// na saida (relativo a tela)
  arquivo: (res: string) => string;
  // as fontes de um .tres/.ttf: os arquivos (res://) na ordem de reserva
  fontesDe: (res: string) => string[];
  // as chaves de traducao existentes (o texto do Label e a chave)
  chaves?: Set<string>;
};

const num = (v: Valor | undefined, d: number) => (typeof v === "number" ? v : d);
const cor = (v: Valor | undefined, d: number[]): number[] => (ehConstrutor(v) && v._ === "Color" ? v.args.map(Number) : d);
// Color.to_html(): rrggbbaa, cada canal arredondado
const html = (c: number[]) => c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
const vec = (v: Valor | undefined, d: [number, number]): [number, number] => (ehConstrutor(v) && v._.startsWith("Vector2") ? [Number(v.args[0]), Number(v.args[1])] : d);

// o tema padrao do Godot 4 (scene/theme/default_theme.cpp) no que estas telas usam
const PADRAO = {
  label: { cor: [1, 1, 1, 1], contorno: [0, 0, 0, 1], sombra: [0, 0, 0, 0], sombraDesloc: [1, 1], sombraContorno: 1 },
  botao: { cor: [0.875, 0.875, 0.875, 1] },
  caixa: { cor: [0.1, 0.1, 0.1, 0.6] },
};

function estilo(sb: SubRecurso | null): Estilo | null {
  if (!sb || sb.tipo === "StyleBoxEmpty") return null;
  const p = sb.props;
  if (sb.tipo !== "StyleBoxFlat") return { tipo: sb.tipo };
  const lados = (k: string, d: number) => ["left", "top", "right", "bottom"].map((l) => num(p[`${k}_${l}`], d));
  return {
    tipo: "StyleBoxFlat",
    cor: html(cor(p.bg_color, [0.6, 0.6, 0.6, 1])),
    desenhar_centro: p.draw_center !== false,
    borda: lados("border_width", 0),
    cor_borda: html(cor(p.border_color, [0.8, 0.8, 0.8, 1])),
    cantos: ["top_left", "top_right", "bottom_right", "bottom_left"].map((l) => num(p[`corner_radius_${l}`], 0)),
    expandir: lados("expand_margin", 0),
  };
}

export function telaDaCena(raiz: NoCena, caixas: Map<string, Caixa>, tamanho: [number, number], o: OpcoesTela): DadosTela {
  const fontes: Record<string, string> = {};
  const imagens: DadosTela["imagens"] = {};
  const nos: Record<string, No> = {};
  type Item = { e: ElementoTela; z: number; ordem: number };
  const itens: Item[] = [];
  let ordem = 0;
  const pais = new Map<NoCena, NoCena>();
  const acima = (n: NoCena) => {
    const out: NoCena[] = [];
    for (let p = pais.get(n); p; p = pais.get(p)) out.unshift(p);
    return out;
  };
  const nomeArq = (res: string) => res.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9]+/g, "_");
  const fonte = (res: string) =>
    o.fontesDe(res).map((f) => {
      const n = nomeArq(f);
      fontes[n] = o.arquivo(f);
      return n;
    });
  const imagem = (v: Valor | undefined): { chave: string; tam: [number, number] } | null => {
    if (ehExt(v)) {
      const k = nomeArq(v.ext.caminho);
      const tam = o.textura?.(v.ext.caminho);
      if (!tam) return null;
      // o tamanho logico vai junto: o arquivo do pacote pode ter sido reduzido
      imagens[k] = { arquivo: o.arquivo(v.ext.caminho), tam: [tam[0], tam[1]] };
      return { chave: k, tam };
    }
    // textura gerada: o gradiente, desenhado pela tela ao carregar
    if (ehSub(v) && v.sub.tipo === "GradientTexture2D") {
      const p = v.sub.props;
      const g = ehSub(p.gradient) ? p.gradient.sub.props : {};
      const arr = (x: Valor | undefined) => (ehConstrutor(x) ? x.args.map(Number) : []);
      const w = num(p.width, 64), h = num(p.height, 64);
      const k = `gradiente_${v.sub.id.replace(/[^A-Za-z0-9]+/g, "_")}`;
      imagens[k] = { arquivo: "", mip: true, gradiente: { w, h, cores: arr(g.colors), offsets: arr(g.offsets), preenchimento: num(p.fill, 0), de: vec(p.fill_from, [0, 0]), para: vec(p.fill_to, [1, 0]) } } as never;
      return { chave: k, tam: [w, h] };
    }
    return null;
  };

  // z absoluto (z_index relativo ao pai por padrao)
  const zDe = new Map<NoCena, number>();
  const andar = (no: NoCena, pai: NoCena | null) => {
    if (pai) pais.set(no, pai);
    const p = no.props;
    const zPai = pai ? (zDe.get(pai) ?? 0) : 0;
    const z = num(p.z_index, 0) + (p.z_as_relative === false ? 0 : zPai);
    zDe.set(no, z);
    const k = caixas.get(no.caminho);
    const nome = no.caminho;
    const minha = ordem++;
    if (k) {
      const n: No = { xf: k.xf, z, tam: k.tam };
      const anc = ["anchor_left", "anchor_top", "anchor_right", "anchor_bottom"].map((a) => num(p[a], 0));
      if (anc.some((v) => v)) n.anc = anc;
      if (p.visible === false) n.oculto = true;
      if (ehConstrutor(p.modulate)) n.cor = html(cor(p.modulate, [1, 1, 1, 1]));
      if (p.clip_contents === true) n.corta = true;
      nos[nome] = n;
    }
    const base = k ? { nome, xf: k.xf, z, ...(ehConstrutor(p.self_modulate) ? { cor: html(cor(p.self_modulate, [1, 1, 1, 1])) } : {}) } : null;
    const mat = ehSub(p.material) && p.material.sub.tipo === "CanvasItemMaterial" ? num(p.material.sub.props.blend_mode, 0) : 0;
    const add = (e: ElementoTela) => itens.push({ e: mat ? ({ ...e, mistura: mat } as unknown as ElementoTela) : e, z, ordem: minha });
    if (base && k) {
      const [w, h] = k.tam;
      switch (no.tipo) {
        case "TextureRect":
        case "TextureButton": {
          const botao = no.tipo === "TextureButton";
          const im = imagem(botao ? p.texture_normal : p.texture);
          if (im) add({ ...base, tipo: "imagem", img: im.chave, ...esticar(im.tam, [w, h], num(p.stretch_mode, botao ? 2 : 0), botao, [p.flip_h === true, p.flip_v === true]) } as ElementoTela);
          if (botao) add({ ...base, tipo: "toque", ret: [0, 0, w, h] });
          break;
        }
        case "Panel":
        case "PanelContainer": {
          const s = ehSub(p["theme_override_styles/panel"]) ? estilo(p["theme_override_styles/panel"].sub) : { tipo: "StyleBoxFlat", cor: html(PADRAO.caixa.cor), desenhar_centro: true, borda: [0, 0, 0, 0], cor_borda: "ccccccff", cantos: [3, 3, 3, 3], expandir: [0, 0, 0, 0] };
          if (s) add({ ...base, tipo: "caixa", ret: [0, 0, w, h], estilo: s });
          break;
        }
        case "ColorRect":
          add({ ...base, tipo: "caixa", ret: [0, 0, w, h], estilo: { tipo: "StyleBoxFlat", cor: html(cor(p.color, [1, 1, 1, 1])), borda: [0, 0, 0, 0], cantos: [0, 0, 0, 0], desenhar_centro: true } });
          break;
        case "Button": {
          const s = ehSub(p["theme_override_styles/normal"]) ? estilo(p["theme_override_styles/normal"].sub) : { tipo: "StyleBoxFlat", cor: html(PADRAO.caixa.cor), desenhar_centro: true, borda: [0, 0, 0, 0], cor_borda: "ccccccff", cantos: [3, 3, 3, 3], expandir: [0, 0, 0, 0] };
          if (s) add({ ...base, tipo: "caixa", ret: [0, 0, w, h], estilo: s });
          add({ ...base, tipo: "toque", ret: [0, 0, w, h] });
          if (typeof p.text === "string" && p.text) add(texto(no, base, [w, h], true));
          break;
        }
        case "Label":
          add(texto(no, base, [w, h], false));
          break;
      }
    }
    if (no.tipo === "BonecoSprite" && typeof p.boneco === "string") {
      const kk = caixas.get(no.caminho);
      if (kk) add({ nome, xf: kk.xf, z, tipo: "boneco", arquivo: o.arquivo(p.boneco), animacao: typeof p._animacao === "string" ? p._animacao : "", tempo: 0, loop: true } as ElementoTela);
    }
    // show_behind_parent: o filho vai logo antes do pai
    for (const f of no.filhos) andar(f, no);
  };

  const texto = (no: NoCena, base: { nome: string; xf: number[]; z: number }, tam: [number, number], botao: boolean): ElementoTela => {
    const p = no.props;
    const ls = ehSub(p.label_settings) ? p.label_settings.sub.props : null;
    const { fonte: f, corpo } = estiloDeTexto(no, acima(no), o);
    const t = typeof p.text === "string" ? p.text : "";
    const contornoTam = ls ? num(ls.outline_size, 0) : num(p["theme_override_constants/outline_size"], 0);
    const contornoCor = ls ? cor(ls.outline_color, [1, 1, 1, 1]) : cor(p["theme_override_colors/font_outline_color"], PADRAO.label.contorno);
    const sombra = botao
      ? [html(cor(p["theme_override_colors/font_shadow_color"], [0, 0, 0, 1])), 0, 0, 0]
      : ls
      ? [html(cor(ls.shadow_color, [0, 0, 0, 0])), ...vec(ls.shadow_offset, [1, 1]), num(ls.shadow_size, 1)]
      : [html(cor(p["theme_override_colors/font_shadow_color"], PADRAO.label.sombra)), num(p["theme_override_constants/shadow_offset_x"], 1), num(p["theme_override_constants/shadow_offset_y"], 1), num(p["theme_override_constants/shadow_outline_size"], 1)];
    return {
      ...base,
      tipo: "texto",
      ret: [0, 0, tam[0], tam[1]],
      chave: o.chaves?.has(t) ? t : undefined,
      texto: o.traduzir?.(t) ?? t,
      fontes: fonte(f),
      tamanho: corpo,
      cor_fonte: html(ls ? cor(ls.font_color, [1, 1, 1, 1]) : cor(p["theme_override_colors/font_color"], botao ? PADRAO.botao.cor : PADRAO.label.cor)),
      contorno: [contornoTam, html(contornoCor)],
      sombra: sombra as [string, number, number, number],
      alinhar: botao ? [num(p.alignment, 1)] : [num(p.horizontal_alignment, 0), num(p.vertical_alignment, 0)],
      quebra: num(p.autowrap_mode, 0),
    } as ElementoTela;
  };

  andar(raiz, null);
  // show_behind_parent: o filho (e o que vem dele) vai logo antes do pai na ordem
  const ordemDe = new Map<string, number>();
  itens.forEach((i) => ordemDe.set(i.e.nome, Math.min(ordemDe.get(i.e.nome) ?? Infinity, i.ordem)));
  const atras = (n: NoCena) => n.props.show_behind_parent === true;
  const percorrer = (n: NoCena) => {
    if (atras(n)) {
      const pai = pais.get(n);
      const o0 = pai ? ordemDe.get(pai.caminho) : undefined;
      if (o0 !== undefined) {
        const base = ordemDe.get(n.caminho) ?? 0;
        for (const it of itens) if (it.e.nome === n.caminho || it.e.nome.startsWith(n.caminho + "/")) it.ordem = o0 - 0.5 + (it.ordem - base) / 1e4;
      }
    }
    n.filhos.forEach(percorrer);
  };
  percorrer(raiz);
  itens.sort((a, b) => a.z - b.z || a.ordem - b.ordem);
  return { versao: 1, tamanho, fontes, imagens, nos, elementos: itens.map((i) => i.e) };
}

// o retangulo desenhado e o recorte da textura (texture_rect.cpp e texture_button.cpp)
function esticar([tw, th]: [number, number], [w, h]: [number, number], modo: number, botao: boolean, espelho: [boolean, boolean]) {
  let ofs = [0, 0], size = botao ? [tw, th] : [w, h], reg = [0, 0, tw, th], tile = false;
  switch (modo) {
    case 0:
      size = [w, h];
      break;
    case 1:
      size = [w, h];
      tile = true;
      break;
    case 2:
      size = [tw, th];
      break;
    case 3:
      ofs = [(w - tw) / 2, (h - th) / 2];
      size = [tw, th];
      break;
    case 4:
    case 5: {
      const tr = (v: number) => (botao ? v : Math.trunc(v));
      let ew = tr((tw * h) / th), eh = tr(h);
      if (ew > w) (ew = tr(w)), (eh = tr((th * ew) / tw));
      if (modo === 5) ofs = [(w - ew) / 2, (h - eh) / 2];
      size = [ew, eh];
      break;
    }
    case 6: {
      size = [w, h];
      const s = Math.max(w / tw, h / th);
      reg = [Math.abs((tw * s - w) / s) / 2, Math.abs((th * s - h) / s) / 2, w / s, h / s];
      break;
    }
  }
  return { dst: [ofs[0], ofs[1], size[0], size[1]], src: reg, repetir: tile || undefined, espelho: espelho[0] || espelho[1] ? espelho : undefined };
}

export { ehControl };
