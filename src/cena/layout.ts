// O layout dos Control do Godot 4, calculado aqui: ancoras e offsets, tamanho minimo com a direcao de
// crescimento, pivo/rotacao/escala, e os containers (AspectRatio, Scroll, HFlow). As contas seguem
// scene/gui/control.cpp, container.cpp, aspect_ratio_container.cpp e flow_container.cpp.
import { ehConstrutor, ehExt, ehSub, type NoCena, type Valor } from "./tscn.ts";

export type Xf = [number, number, number, number, number, number]; // X = a x + c y + e
export type Caixa = { pos: [number, number]; tam: [number, number]; xf: Xf };
export type Medidas = {
  // tamanho de uma textura (res://...)
  textura?: (caminho: string) => [number, number] | undefined;
  // largura de um texto e altura de uma linha, na fonte (res:// de .ttf ou .tres) e no corpo dados
  texto?: (fonte: string, corpo: number, texto: string) => [number, number] | undefined;
  // a fonte do projeto (gui/theme/custom_font) e o corpo padrao (16)
  fontePadrao?: string;
  corpoPadrao?: number;
  // o texto como aparece (o Label traduz a chave): devolve o proprio texto sem traducao
  traduzir?: (texto: string) => string;
};

// a fonte e o corpo de um texto, como o Godot resolve: o override do no, o LabelSettings, o tema mais
// perto subindo a arvore, o tema do projeto
export function estiloDeTexto(no: NoCena, acima: NoCena[], m: Medidas): { fonte: string; corpo: number } {
  const p = no.props;
  const ls = ehSub(p.label_settings) ? p.label_settings.sub.props : null;
  const caminho = (v: Valor | undefined) => (ehExt(v) ? v.ext.caminho : undefined);
  let fonte = caminho(p["theme_override_fonts/font"]) ?? caminho(ls?.font ?? undefined);
  let corpo = typeof p["theme_override_font_sizes/font_size"] === "number" ? p["theme_override_font_sizes/font_size"] : typeof ls?.font_size === "number" ? ls.font_size : undefined;
  for (let i = acima.length - 1; i >= 0 && (fonte === undefined || corpo === undefined); i--) {
    const t = acima[i].props.theme;
    const tp = ehSub(t) ? t.sub.props : null;
    if (!tp) continue;
    fonte ??= caminho(tp.default_font);
    if (corpo === undefined && typeof tp.default_font_size === "number") corpo = tp.default_font_size;
  }
  return { fonte: fonte ?? m.fontePadrao ?? "", corpo: corpo ?? m.corpoPadrao ?? 16 };
}

const CONTAINERS = new Set(["AspectRatioContainer", "ScrollContainer", "HFlowContainer", "VFlowContainer", "HBoxContainer", "VBoxContainer", "MarginContainer", "CenterContainer", "PanelContainer"]);
const CANVAS_CONTROL = (t: string) =>
  t === "Control" || CONTAINERS.has(t) || ["TextureRect", "Label", "Button", "TextureButton", "Panel", "ColorRect", "NinePatchRect", "RichTextLabel", "LineEdit"].includes(t);

const num = (v: Valor | undefined, d: number) => (typeof v === "number" ? v : d);
const vec = (v: Valor | undefined, d: [number, number]): [number, number] =>
  ehConstrutor(v) && (v._ === "Vector2" || v._ === "Vector2i") ? [Number(v.args[0]), Number(v.args[1])] : d;
const mult = (a: Xf, b: Xf): Xf => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

export function ehControl(no: NoCena) {
  return CANVAS_CONTROL(no.tipo);
}
const visivel = (no: NoCena) => no.props.visible !== false;

export class Layout {
  readonly caixas = new Map<string, Caixa>();
  private minimos = new Map<NoCena, [number, number]>();
  private pais = new Map<NoCena, NoCena>();
  constructor(
    private raiz: NoCena,
    private medidas: Medidas = {},
  ) {
    const ligar = (n: NoCena) => n.filhos.forEach((f) => (this.pais.set(f, n), ligar(f)));
    ligar(raiz);
  }
  private acima(no: NoCena) {
    const out: NoCena[] = [];
    for (let p = this.pais.get(no); p; p = this.pais.get(p)) out.unshift(p);
    return out;
  }
  // o tamanho de um texto no estilo do no: a linha mais larga, as linhas e o espacamento entre elas
  private medirTexto(no: NoCena, bruto: string): [number, number] | undefined {
    if (!this.medidas.texto) return undefined;
    const texto = this.medidas.traduzir?.(bruto) ?? bruto;
    const { fonte, corpo } = estiloDeTexto(no, this.acima(no), this.medidas);
    const linhas = texto.split("\n");
    let w = 0, h = 0;
    for (const l of linhas) {
      const m = this.medidas.texto(fonte, corpo, l);
      if (!m) return undefined;
      w = Math.max(w, m[0]);
      h = m[1];
    }
    const esp = typeof no.props["theme_override_constants/line_spacing"] === "number" ? no.props["theme_override_constants/line_spacing"] : 3;
    return [w, linhas.length * h + (linhas.length - 1) * esp];
  }

  // o layout inteiro para uma janela de w x h
  calcular(w: number, h: number) {
    this.caixas.clear();
    this.minimos.clear();
    this.no(this.raiz, [0, 0, w, h], [1, 0, 0, 1, 0, 0], null);
    return this.caixas;
  }

  // ---- tamanho minimo (get_combined_minimum_size)
  minimo(no: NoCena): [number, number] {
    const m0 = this.minimos.get(no);
    if (m0) return m0;
    const p = no.props;
    let m: [number, number] = [0, 0];
    const tex = (v: Valor | undefined) => (ehExt(v) ? this.medidas.textura?.(v.ext.caminho) : undefined);
    switch (no.tipo) {
      case "TextureRect":
        // expand_mode 0 (KEEP_SIZE): a textura manda; 1 (IGNORE_SIZE): nada
        if (num(p.expand_mode, 0) === 0) m = tex(p.texture) ?? [0, 0];
        break;
      case "TextureButton":
        if (p.ignore_texture_size !== true) m = tex(p.texture_normal) ?? [0, 0];
        break;
      case "Label": {
        // vazio tambem ocupa uma linha de altura
        const t = typeof p.text === "string" ? p.text : "";
        const quebra = num(p.autowrap_mode, 0) !== 0;
        const corta = p.clip_text === true || num(p.text_overrun_behavior, 0) !== 0;
        const med = this.medirTexto(no, t);
        if (med) m = [quebra || corta ? 0 : med[0], med[1]];
        break;
      }
      case "Button": {
        const t = typeof p.text === "string" ? p.text : "";
        const med = t ? this.medirTexto(no, t) : undefined;
        if (med) m = [med[0], med[1]];
        break;
      }
      case "AspectRatioContainer":
      case "CenterContainer":
      case "MarginContainer":
      case "PanelContainer":
        for (const f of no.filhos) if (ehControl(f) && visivel(f) && !f.props.top_level) {
          const fm = this.minimo(f);
          m = [Math.max(m[0], fm[0]), Math.max(m[1], fm[1])];
        }
        break;
      case "ScrollContainer": {
        // so no eixo sem rolagem o filho impoe tamanho
        const filho = no.filhos.find((f) => ehControl(f) && visivel(f));
        if (filho) {
          const fm = this.minimo(filho);
          if (num(p.horizontal_scroll_mode, 1) === 0) m[0] = fm[0];
          if (num(p.vertical_scroll_mode, 1) === 0) m[1] = fm[1];
        }
        break;
      }
      case "HFlowContainer":
        for (const f of no.filhos) if (ehControl(f) && visivel(f)) {
          const fm = this.minimo(f);
          m = [Math.max(m[0], fm[0]), Math.max(m[1], fm[1])];
        }
        break;
    }
    const cm = vec(p.custom_minimum_size, [0, 0]);
    const r: [number, number] = [Math.max(m[0], cm[0]), Math.max(m[1], cm[1])];
    this.minimos.set(no, r);
    return r;
  }

  // ---- um no: o retangulo (dado pelo container pai, ou pelas ancoras), a transformacao e os filhos
  private no(no: NoCena, rectPai: [number, number, number, number], xfPai: Xf, retDoContainer: [number, number, number, number] | null) {
    const p = no.props;
    let xf: Xf;
    if (ehControl(no)) {
      let x: number, y: number, w: number, h: number;
      if (retDoContainer) [x, y, w, h] = retDoContainer;
      else {
        const [, , pw, ph] = rectPai;
        const al = num(p.anchor_left, 0), at = num(p.anchor_top, 0), ar = num(p.anchor_right, 0), ab = num(p.anchor_bottom, 0);
        x = al * pw + num(p.offset_left, 0);
        y = at * ph + num(p.offset_top, 0);
        w = ar * pw + num(p.offset_right, 0) - x;
        h = ab * ph + num(p.offset_bottom, 0) - y;
        // fora do minimo ou do maximo (custom_maximum_size, -1 = sem): o tamanho muda para o lado da
        // direcao de crescimento
        const [mw, mh] = this.minimo(no);
        const [Mw, Mh] = vec(p.custom_maximum_size, [-1, -1]);
        const ajustar = (pos: number, tam: number, min: number, max: number, g: number): [number, number] => {
          let novo = Math.max(tam, min);
          if (max >= 0) novo = Math.min(novo, max);
          const d = novo - tam;
          return [g === 0 ? pos - d : g === 2 ? pos - d / 2 : pos, novo];
        };
        [x, w] = ajustar(x, w, mw, Mw, num(p.grow_horizontal, 1));
        [y, h] = ajustar(y, h, mh, Mh, num(p.grow_vertical, 1));
      }
      // posicao, depois pivo, rotacao e escala em volta dele
      const [px, py] = vec(p.pivot_offset, [0, 0]);
      const [sx, sy] = vec(p.scale, [1, 1]);
      const r = num(p.rotation, 0);
      const co = Math.cos(r), si = Math.sin(r);
      const a = co * sx, b = si * sx, c = -si * sy, d = co * sy;
      const local: Xf = [a, b, c, d, x + px - (a * px + c * py), y + py - (b * px + d * py)];
      xf = mult(xfPai, local);
      this.caixas.set(no.caminho, { pos: [x, y], tam: [w, h], xf });
      this.filhos(no, [x, y, w, h], xf);
    } else {
      // Node2D: posicao, rotacao e escala; Node puro passa direto
      const [x, y] = vec(p.position, [0, 0]);
      const [sx, sy] = vec(p.scale, [1, 1]);
      const r = num(p.rotation, 0);
      const co = Math.cos(r), si = Math.sin(r);
      xf = mult(xfPai, [co * sx, si * sx, -si * sy, co * sy, x, y]);
      this.caixas.set(no.caminho, { pos: [x, y], tam: [0, 0], xf });
      for (const f of no.filhos) this.no(f, rectPai, xf, null);
    }
  }

  private filhos(no: NoCena, rect: [number, number, number, number], xf: Xf) {
    const [, , w, h] = rect;
    const p = no.props;
    const controles = no.filhos.filter((f) => ehControl(f) && !f.props.top_level);
    const nosContainer = CONTAINERS.has(no.tipo);
    if (!nosContainer) {
      for (const f of no.filhos) this.no(f, rect, xf, null);
      return;
    }
    const ordenados = new Map<NoCena, [number, number, number, number]>();
    if (no.tipo === "AspectRatioContainer") {
      const ratio = num(p.ratio, 1);
      const modo = num(p.stretch_mode, 2);
      const ax = [0, 0.5, 1][num(p.alignment_horizontal, 1)], ay = [0, 0.5, 1][num(p.alignment_vertical, 1)];
      // o escondido tambem e encaixado: o rect fica pronto para quando ele aparecer
      for (const f of controles) {
        const fm = this.minimo(f);
        let cw = ratio, ch = 1;
        const k = modo === 0 ? w / cw : modo === 1 ? h / ch : modo === 2 ? Math.min(w / cw, h / ch) : Math.max(w / cw, h / ch);
        cw = Math.max(cw * k, fm[0]);
        ch = Math.max(ch * k, fm[1]);
        ordenados.set(f, this.encaixar(f, [(w - cw) * ax, (h - ch) * ay, cw, ch]));
      }
    } else if (no.tipo === "ScrollContainer") {
      for (const f of controles) {
        const fm = this.minimo(f);
        // o filho ocupa a area (ou o minimo dele, se maior), na rolagem 0
        let cw = w, ch = h;
        const sf = num(f.props.size_flags_horizontal, 1), sv = num(f.props.size_flags_vertical, 1);
        if (!(sf & 2) && !(sf & 1)) cw = fm[0];
        cw = Math.max(cw, fm[0]);
        ch = Math.max(ch, fm[1]);
        let y = 0;
        // sem rolagem vertical e maior que a area: centra (shrink center) - medido no Godot
        if (num(p.vertical_scroll_mode, 1) === 0 && sv & 4 && fm[1] > h) y = (h - fm[1]) / 2;
        else if (sv & 4 && !(sv & 1)) (ch = fm[1]), (y = 0);
        ordenados.set(f, [0, y, cw, ch]);
      }
    } else if (no.tipo === "HFlowContainer") {
      // filhos em linhas (a historia do jogo e montada por codigo; aqui so o basico)
      const hs = num(p["theme_override_constants/h_separation"], 4), vs = num(p["theme_override_constants/v_separation"], 4);
      let x = 0, y = 0, alt = 0;
      for (const f of controles) {
        if (!visivel(f)) continue;
        const [fw, fh] = this.minimo(f);
        if (x > 0 && x + fw > w) (x = 0), (y += alt + vs), (alt = 0);
        ordenados.set(f, [x, y, fw, fh]);
        x += fw + hs;
        alt = Math.max(alt, fh);
      }
    } else {
      for (const f of controles) ordenados.set(f, this.encaixar(f, [0, 0, w, h]));
    }
    for (const f of no.filhos) this.no(f, rect, xf, ordenados.get(f) ?? null);
  }

  // fit_child_in_rect: sem FILL o filho fica no minimo, alinhado pelo SHRINK
  private encaixar(f: NoCena, r: [number, number, number, number]): [number, number, number, number] {
    const [mw, mh] = this.minimo(f);
    let [x, y, w, h] = r;
    const sh = num(f.props.size_flags_horizontal, 1), sv = num(f.props.size_flags_vertical, 1);
    if (!(sh & 1)) {
      if (sh & 8) x += w - mw;
      else if (sh & 4) x += Math.floor((w - mw) / 2);
      w = mw;
    }
    if (!(sv & 1)) {
      if (sv & 8) y += h - mh;
      else if (sv & 4) y += Math.floor((h - mh) / 2);
      h = mh;
    }
    return [x, y, w, h];
  }
}
