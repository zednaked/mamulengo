// Versao leve de um .boneco, para aparelhos fracos (que esperam a GPU, docs/ROADMAP.md "Bake"):
// todas as imagens repacotadas no menor numero de paginas (menos trocas de textura, menos lotes)
// e gravadas numa fracao da resolucao. O .boneco leve guarda as medidas logicas: os retangulos,
// cortes, o tamanho das paginas, as particulas e as medidas de efeito ficam na escala original,
// so o arquivo da pagina e menor (os desenhistas normalizam pelo `tamanho` da pagina). O
// esqueleto, as partes e as animacoes nao mudam.
//
// A parte comum a ferramenta (tools/boneco-leve.ts, que o servidor chama: o disco, o sharp e o
// nucleo-pose) e ao editor pelo navegador (src/navegador/leve.ts: as pastas de fs.ts, o canvas,
// paginas em PNG e o nucleo em wasm). Arquivo e imagem vem de quem chama (LeveIO); `T` e a
// imagem de quem chama (um PNG no servidor, RGBA no navegador).
//
// Paginas com pma, filtro, compressao no jogo ou relevo diferentes nao se juntam. O relevo vai
// junto, na mesma arrumacao. Instancias: cada filho ganha a versao leve dele e o pai aponta para
// ela. Por personagem, uma linha com os lotes de desenho do primeiro quadro de cada animacao,
// antes e depois.
import { parseAtlas } from "./atlas-text.ts";
import type { PackOptions } from "./atlas-pack.ts";

export interface LeveIO<T> {
  lerBoneco(p: string): Promise<{ b: any; binario: boolean }>;
  gravarBoneco(p: string, b: any, binario: boolean): Promise<void>;
  existe(p: string): Promise<boolean>;
  // tamanho do arquivo em bytes
  tamanho(p: string): Promise<number>;
  gravar(p: string, dados: Uint8Array): Promise<void>;
  // a imagem `im` (ret, girada) da pagina `arquivo`, na orientacao original; desmultiplicada se
  // `pma` (desmultiplicar abaixo); no tamanho pedido (null: o dela)
  recorte(arquivo: string, im: { ret: number[]; girada?: number }, o: { pma: boolean; tamanho: [number, number] | null }): Promise<T>;
  // empacota (empacotarBruto); quem chama escolhe o formato das paginas
  empacotar(entrada: { name: string; data: T }[], o: PackOptions): Promise<{ atlas: string; pages: { name: string; data: Uint8Array }[] }>;
  // grava a pagina de relevo w x h: o fundo da normal reta (128, 128, 255) com as imagens por cima
  relevo(p: string, w: number, h: number, camadas: { imagem: T; x: number; y: number }[]): Promise<void>;
  // lotes de desenho do primeiro quadro de cada animacao ([] sem como contar)
  lotes(p: string): Promise<number[]>;
  // o caminho como aparece na linha do resultado
  mostrar(p: string): string;
}

export interface LeveOpcoes {
  fator: number; // 1/n (0.5, 0.25 ou 1: so repacota)
  lado: number; // lado maximo da pagina gravada, em pixels do arquivo
}

// 1/n inteiro? (0.5 -> 2); null se nao
export function divisor(fator: number): number | null {
  const n = Math.round(1 / fator);
  return fator > 0 && Math.abs(1 / fator - n) <= 1e-9 ? n : null;
}

export function desmultiplicar(raw: Uint8Array | Uint8ClampedArray) {
  for (let i = 0; i < raw.length; i += 4) {
    const a = raw[i + 3];
    if (a === 0) raw[i] = raw[i + 1] = raw[i + 2] = 0;
    else if (a < 255) for (let c = 0; c < 3; c++) raw[i + c] = Math.min(255, Math.round((raw[i + c] * 255) / a));
  }
}

// ---- caminhos com "/" (absolutos: o servidor no Linux e no Mac, o navegador)

export function normalizar(c: string): string {
  const out: string[] = [];
  for (const s of c.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return "/" + out.join("/");
}
const pastaDe = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
// como o path.join (as paginas) e o path.resolve (as instancias) do Node
const juntar = (a: string, b: string) => normalizar(`${a}/${b}`);
const resolver = (a: string, b: string) => normalizar(b.startsWith("/") ? b : `${a}/${b}`);
// caminho de `para` visto de `de` (como o path.relative do Node)
export function relativo(de: string, para: string): string {
  const a = normalizar(de).split("/").filter(Boolean),
    b = normalizar(para).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

// Grava a versao leve de `arquivo` em `saida` (e a dos filhos das instancias, ao lado de cada um).
// Devolve uma linha por personagem, os filhos antes do pai.
export async function versaoLeve<T>(io: LeveIO<T>, arquivo: string, saida: string, o: LeveOpcoes): Promise<string[]> {
  const n = divisor(o.fator);
  if (n == null) throw new Error(`fator invalido: ${o.fator} (1/n: 0.5, 0.25 ou 1)`);
  const { fator, lado } = o;
  const linhas: string[] = [];
  const feitos = new Map<string, string>();

  async function leve(arq: string, saida: string): Promise<string> {
    if (feitos.has(arq)) return feitos.get(arq)!;
    feitos.set(arq, saida);
    const { b, binario } = await io.lerBoneco(arq);
    const pasta = pastaDe(arq);
    const pastaSaida = pastaDe(saida);
    const base = saida.slice(saida.lastIndexOf("/") + 1).replace(/\.boneco$/, "");
    const paginas: any[] = b.paginas ?? [];
    // grupos de paginas que podem dividir a mesma textura
    const chave = (p: any) => JSON.stringify([!!p.pma, p.filtro ?? null, p.jogo ?? null, !!p.relevo]);
    const grupos = new Map<string, number[]>();
    paginas.forEach((p, i) => grupos.set(chave(p), [...(grupos.get(chave(p)) ?? []), i]));
    const novas: any[] = [];
    const imagens = b.imagens.map((im: any) => ({ ...im }));
    let gi = 0;
    for (const idx of grupos.values()) {
      const p0 = paginas[idx[0]];
      const doGrupo = imagens.map((im: any, k: number) => ({ im, k })).filter(({ im }: any) => idx.includes(im.pagina ?? 0));
      if (!doGrupo.length) continue;
      const entrada: { name: string; data: T }[] = [];
      const relevos = new Map<string, T>();
      for (const { im, k } of doGrupo) {
        const pg = paginas[im.pagina ?? 0];
        const [rw, rh] = [im.ret[2], im.ret[3]];
        const tamanho: [number, number] | null = fator === 1 ? null : [Math.max(1, Math.round(rw * fator)), Math.max(1, Math.round(rh * fator))];
        entrada.push({ name: `i${k}`, data: await io.recorte(juntar(pasta, pg.arquivo), im, { pma: !!pg.pma, tamanho }) });
        if (pg.relevo) relevos.set(`i${k}`, await io.recorte(juntar(pasta, pg.relevo), im, { pma: false, tamanho }));
      }
      const nome = `${base}${gi ? `_g${gi + 1}` : ""}`;
      const pac = await io.empacotar(entrada, { maxSize: lado, padding: 2, pma: !!p0.pma, pageName: nome });
      const at = parseAtlas(pac.atlas);
      const primeira = novas.length;
      for (const [j, pa] of at.pages.entries()) {
        await io.gravar(`${pastaSaida}/${pa.name}`, pac.pages[j].data);
        const { arquivo: _a, tamanho: _t, relevo: _r, ...props } = p0;
        const nova: any = { arquivo: pa.name, tamanho: [pa.width * n!, pa.height * n!], ...props };
        if (p0.relevo) {
          // o relevo na mesma arrumacao, sem sangria (so a cor da normal importa)
          const camadas = at.regions.filter((r) => r.page === pa.name).map((r) => ({ imagem: relevos.get(r.name)!, x: r.x, y: r.y }));
          const arqRelevo = pa.name.replace(/\.(webp|png)$/, "_relevo.$1");
          await io.relevo(`${pastaSaida}/${arqRelevo}`, pa.width, pa.height, camadas);
          nova.relevo = arqRelevo;
        }
        novas.push(nova);
      }
      for (const r of at.regions) {
        const im = imagens[Number(r.name.slice(1))];
        im.pagina = primeira + at.pages.findIndex((pa) => pa.name === r.page);
        im.ret = [r.x * n!, r.y * n!, im.ret[2], im.ret[3]];
        delete im.girada;
      }
      gi++;
    }
    const out = { ...b, paginas: novas, imagens };
    // instancias: o filho leve ao lado do filho
    for (const ins of out.instancias ?? []) {
      if (typeof ins.boneco !== "string") continue;
      const filho = resolver(pasta, ins.boneco);
      if (!(await io.existe(filho))) continue;
      const filhoLeve = await leve(filho, filho.replace(/\.boneco$/, "-leve.boneco"));
      ins.boneco = relativo(pastaSaida, filhoLeve);
    }
    await io.gravarBoneco(saida, out, binario);
    const pix = async (ps: any[], dir: string, f: number) => {
      let s = 0;
      for (const p of ps) s += ((await io.existe(juntar(dir, p.arquivo))) ? 1 : 0) * Math.round(p.tamanho[0] * f) * Math.round(p.tamanho[1] * f);
      return s;
    };
    const antes = await io.lotes(arq),
      depois = await io.lotes(saida);
    const soma = (l: number[]) => (l.length ? `${l.reduce((a, x) => a + x, 0)} lotes em ${l.length} animacoes` : "sem animacoes");
    linhas.push(
      `${io.mostrar(saida)}: ${paginas.length} -> ${novas.length} paginas, ${((await pix(paginas, pasta, 1)) / 1e6).toFixed(2)} -> ${((await pix(novas, pastaSaida, fator)) / 1e6).toFixed(2)} Mpx; ${soma(antes)} -> ${soma(depois)}; ${((await io.tamanho(arq)) / 1024).toFixed(0)} KB -> ${((await io.tamanho(saida)) / 1024).toFixed(0)} KB no .boneco`,
    );
    return saida;
  }

  await leve(normalizar(arquivo), normalizar(saida));
  return linhas;
}

// pixels da imagem na orientacao original, a partir dos da pagina (o atlas guarda girada 90, 180
// ou 270: desgirar e girar no sentido horario, como o rotate do sharp)
export function recortarBruto(pagina: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, ret: number[], girada = 0): { width: number; height: number; data: Uint8Array } {
  const [x, y, W, H] = ret;
  const deitada = girada === 90 || girada === 270;
  // a area na pagina
  const aw = deitada ? H : W,
    ah = deitada ? W : H;
  const out = new Uint8Array(W * H * 4);
  for (let oy = 0; oy < H; oy++)
    for (let ox = 0; ox < W; ox++) {
      const [ax, ay] = girada === 90 ? [oy, ah - 1 - ox] : girada === 180 ? [aw - 1 - ox, ah - 1 - oy] : girada === 270 ? [aw - 1 - oy, ox] : [ox, oy];
      const sx = x + ax,
        sy = y + ay;
      if (sx < 0 || sy < 0 || sx >= pagina.width || sy >= pagina.height) continue;
      const s = (sy * pagina.width + sx) * 4,
        d = (oy * W + ox) * 4;
      out[d] = pagina.data[s];
      out[d + 1] = pagina.data[s + 1];
      out[d + 2] = pagina.data[s + 2];
      out[d + 3] = pagina.data[s + 3];
    }
  return { width: W, height: H, data: out };
}
