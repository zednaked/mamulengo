// As medidas de uma fonte TrueType/OpenType (glifos em TTF ou CFF; sem WOFF): unidades por em,
// subida e descida (hhea) e o avanco de cada caractere (cmap 4/12 + hmtx). E o que o Godot usa para o
// tamanho minimo de um Label: altura = ceil(subida) + ceil(descida); largura = soma dos avancos,
// cada um arredondado (sem posicao subpixel nos corpos grandes).
// as medidas de uma fonte numa tabela (o que a pagina recebe, sem o arquivo): so os caracteres usados
export type TabelaFonte = { unidades: number; subida: number; descida: number; avancos: Record<string, number> };

export class Fonte {
  readonly unidades: number;
  readonly subida: number;
  readonly descida: number;
  private avancos: Uint16Array;
  private mapa = new Map<number, number>();
  // a fonte a partir da tabela (na pagina)
  static deTabela(t: TabelaFonte): Fonte {
    const f = Object.create(Fonte.prototype) as Fonte;
    const chars = Object.keys(t.avancos).map(Number);
    const av = new Uint16Array(chars.length + 1);
    const mapa = new Map<number, number>();
    chars.forEach((c, i) => (mapa.set(c, i + 1), (av[i + 1] = t.avancos[c])));
    Object.assign(f, { unidades: t.unidades, subida: t.subida, descida: t.descida, avancos: av, mapa });
    return f;
  }
  // a tabela das medidas para os caracteres dados (no build)
  tabela(caracteres: Iterable<string>): TabelaFonte {
    const avancos: Record<string, number> = {};
    for (const ch of caracteres) {
      const c = ch.codePointAt(0)!;
      const g = this.mapa.get(c);
      if (g) avancos[c] = this.avancos[g];
    }
    return { unidades: this.unidades, subida: this.subida, descida: this.descida, avancos };
  }
  constructor(buf: ArrayBuffer | Uint8Array) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tabelas = new Map<string, number>();
    const n = v.getUint16(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      tabelas.set(String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]), v.getUint32(o + 8));
    }
    const t = (nome: string) => {
      const o = tabelas.get(nome);
      if (o === undefined) throw new Error(`fonte sem a tabela ${nome}`);
      return o;
    };
    this.unidades = v.getUint16(t("head") + 18);
    const hhea = t("hhea");
    this.subida = v.getInt16(hhea + 4);
    this.descida = -v.getInt16(hhea + 6);
    const nMetricas = v.getUint16(hhea + 34);
    const nGlifos = v.getUint16(t("maxp") + 4);
    const hmtx = t("hmtx");
    this.avancos = new Uint16Array(nGlifos);
    for (let g = 0; g < nGlifos; g++) this.avancos[g] = v.getUint16(hmtx + Math.min(g, nMetricas - 1) * 4);
    // cmap: a subtabela Unicode (formato 12 se houver, senao 4)
    const cmap = t("cmap");
    const nSub = v.getUint16(cmap + 2);
    let f4 = -1, f12 = -1;
    for (let i = 0; i < nSub; i++) {
      const plat = v.getUint16(cmap + 4 + i * 8), enc = v.getUint16(cmap + 6 + i * 8);
      const off = cmap + v.getUint32(cmap + 8 + i * 8);
      const fmt = v.getUint16(off);
      if (fmt === 12 && (plat === 0 || (plat === 3 && enc === 10))) f12 = off;
      if (fmt === 4 && (plat === 0 || (plat === 3 && enc === 1))) f4 = off;
    }
    if (f12 >= 0) {
      const ng = v.getUint32(f12 + 12);
      for (let i = 0; i < ng; i++) {
        const o = f12 + 16 + i * 12;
        const ini = v.getUint32(o), fim = v.getUint32(o + 4), g0 = v.getUint32(o + 8);
        for (let c = ini; c <= fim && c - ini < 0x10000; c++) this.mapa.set(c, g0 + c - ini);
      }
    } else if (f4 >= 0) {
      const seg = v.getUint16(f4 + 6) / 2;
      const fins = f4 + 14, inis = fins + seg * 2 + 2, deltas = inis + seg * 2, offs = deltas + seg * 2;
      for (let s = 0; s < seg; s++) {
        const fim = v.getUint16(fins + s * 2), ini = v.getUint16(inis + s * 2), delta = v.getInt16(deltas + s * 2), ro = v.getUint16(offs + s * 2);
        for (let c = ini; c <= fim && c !== 0xffff; c++) {
          let g: number;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            g = v.getUint16(offs + s * 2 + ro + (c - ini) * 2);
            if (g) g = (g + delta) & 0xffff;
          }
          this.mapa.set(c, g);
        }
      }
    }
  }
  tem(c: number) {
    return (this.mapa.get(c) ?? 0) > 0;
  }
  // altura de uma linha no corpo dado (subida e descida arredondadas para cima)
  altura(corpo: number) {
    return Math.ceil((this.subida * corpo) / this.unidades) + Math.ceil((this.descida * corpo) / this.unidades);
  }
  // avanco de um caractere no corpo dado, arredondado
  avanco(c: number, corpo: number) {
    const g = this.mapa.get(c) ?? 0;
    return Math.round((this.avancos[g] * corpo) / this.unidades);
  }
}

// uma fonte com reservas (a FontVariation do Godot: base e fallbacks): a primeira que tem o caractere
export class Fontes {
  constructor(readonly lista: Fonte[]) {}
  altura(corpo: number) {
    return this.lista[0].altura(corpo);
  }
  largura(texto: string, corpo: number) {
    let w = 0;
    for (const ch of texto) {
      const c = ch.codePointAt(0)!;
      const f = this.lista.find((x) => x.tem(c)) ?? this.lista[0];
      w += f.avanco(c, corpo);
    }
    return w;
  }
}
