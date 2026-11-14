// Os pixels das pinturas (raster) do Atelie. Ficam fora do documento: aqui na memoria (um canvas por
// imagem) e, ao salvar, num PNG na pasta <personagem>-pinturas. O documento so guarda o nome do
// estado (`drawings.<imagem>.raster.rev`): cada pincelada troca o rev pelo comando paint.set e
// guarda aqui o retangulo de antes e de depois, entao desfazer e refazer do documento levam os
// pixels junto. Quem pinta e src/app/pintura.ts.
import { drawingsOf, pinturaArquivo, pinturasPasta, type Drawing } from "../core/desenho.ts";
import type { Document } from "../core/document.ts";

interface No {
  pai: string | null;
  // o retangulo que a pincelada mudou, como era e como ficou (null: estado lido do disco)
  ret: [number, number, number, number] | null;
  antes: ImageData | null;
  depois: ImageData | null;
  // a folha mudou de tamanho: antes e depois sao as imagens inteiras (de tamanhos diferentes)
  tam?: boolean;
}
interface Tela {
  w: number;
  h: number;
  canvas: OffscreenCanvas;
  g: OffscreenCanvasRenderingContext2D;
  rev: string | null;
  // o rev que esta no disco (null: nada gravado)
  gravado: string | null;
}

const novoRev = () => Math.random().toString(36).slice(2, 10);

function tela(w: number, h: number): Tela {
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  return { w: canvas.width, h: canvas.height, canvas, g: canvas.getContext("2d", { willReadFrequently: true })!, rev: null, gravado: null };
}

// a tela passa a ser outra (outro tamanho), no mesmo objeto (quem guarda a Tela continua valendo)
function trocar(t: Tela, nova: Tela) {
  t.canvas = nova.canvas;
  t.g = nova.g;
  t.w = nova.w;
  t.h = nova.h;
}
// os pixels de um passo: um retangulo, ou a imagem inteira de um tamanho novo
function poe(t: Tela, k: No, img: ImageData) {
  if (k.tam) {
    if (img.width !== t.w || img.height !== t.h) trocar(t, tela(img.width, img.height));
    t.g.putImageData(img, 0, 0);
  } else t.g.putImageData(img, k.ret![0], k.ret![1]);
}

export class Pinturas {
  private telas = new Map<string, Tela>();
  private nos = new Map<string, No>();
  // de qual imagem e cada estado (para copiar um quadro pintado)
  private dono = new Map<string, string>();
  private avisou = false;
  // recados para quem usa o editor (o estado liga ao toast)
  avisar: (texto: string) => void = () => {};

  limpar() {
    this.telas.clear();
    this.nos.clear();
    this.dono.clear();
    this.avisou = false;
  }

  // a imagem da pintura, para desenhar por baixo das formas (src/app/desenho.ts)
  base = (image: string, d: Drawing): CanvasImageSource | null => {
    // (tambem durante a primeira pincelada, antes de o documento ganhar o rev)
    void d;
    return this.telas.get(image)?.canvas ?? null;
  };

  tem(image: string) {
    return this.telas.has(image);
  }

  // a tela de uma imagem, do tamanho do desenho (criada vazia se nao havia)
  de(image: string, d: Drawing): Tela {
    let t = this.telas.get(image);
    if (!t || t.w !== Math.ceil(d.width) || t.h !== Math.ceil(d.height)) {
      const nova = tela(d.width, d.height);
      if (t) (nova.g.drawImage(t.canvas, 0, 0), (nova.rev = t.rev));
      t = nova;
      this.telas.set(image, t);
    }
    return t;
  }

  pixels(image: string, d: Drawing): Uint8ClampedArray {
    const t = this.de(image, d);
    return t.g.getImageData(0, 0, t.w, t.h).data;
  }

  // um retangulo vindo do pintor (RGBA reto)
  remendo(image: string, d: Drawing, ret: [number, number, number, number], rgba: Uint8Array) {
    const t = this.de(image, d);
    const [x, y, w, h] = ret;
    if (w <= 0 || h <= 0 || rgba.length !== w * h * 4) return;
    t.g.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), x, y);
  }

  copia(image: string, d: Drawing): ImageData {
    const t = this.de(image, d);
    return t.g.getImageData(0, 0, t.w, t.h);
  }

  // a pincelada acabou: guarda o retangulo de antes e de depois e devolve o rev novo
  registrar(image: string, d: Drawing, antes: ImageData, ret: [number, number, number, number]): string {
    const t = this.de(image, d);
    const [x, y, w, h] = ret;
    const corte = new OffscreenCanvas(antes.width, antes.height).getContext("2d")!;
    corte.putImageData(antes, 0, 0);
    const rev = novoRev();
    this.nos.set(rev, { pai: t.rev, ret, antes: corte.getImageData(x, y, w, h), depois: t.g.getImageData(x, y, w, h) });
    this.dono.set(rev, image);
    t.rev = rev;
    return rev;
  }

  // a folha cresce l, t, r, b pixels para cada lado (os pixels andam junto); devolve o rev novo. Quem
  // chama roda paint.grow com ele
  crescer(image: string, d: Drawing, l: number, tp: number, r: number, b: number): string {
    const t = this.de(image, d);
    const antes = t.g.getImageData(0, 0, t.w, t.h);
    const nova = tela(t.w + l + r, t.h + tp + b);
    nova.g.drawImage(t.canvas, l, tp);
    trocar(t, nova);
    const rev = novoRev();
    this.nos.set(rev, { pai: t.rev, ret: [0, 0, t.w, t.h], antes, depois: t.g.getImageData(0, 0, t.w, t.h), tam: true });
    this.dono.set(rev, image);
    t.rev = rev;
    return rev;
  }

  // a imagem inteira de um quadro novo, de qualquer tamanho (os intermediarios); devolve o rev
  definir(image: string, rgba: Uint8ClampedArray, w: number, h: number): string {
    const t = tela(w, h);
    t.g.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    const rev = novoRev();
    this.nos.set(rev, { pai: null, ret: null, antes: null, depois: null });
    this.dono.set(rev, image);
    t.rev = rev;
    this.telas.set(image, t);
    return rev;
  }

  // leva a tela ao estado `alvo` andando pelas pinceladas guardadas; false se nao ha caminho
  private andar(t: Tela, alvo: string | null): boolean {
    if (t.rev === alvo) return true;
    // desfazer: sobe de t.rev ate alvo
    const sobe: No[] = [];
    for (let r = t.rev; r !== null; ) {
      const n = this.nos.get(r);
      if (!n) break;
      sobe.push(n);
      r = n.pai;
      if (r === alvo) {
        for (const k of sobe) if (k.ret && k.antes) poe(t, k, k.antes);
        t.rev = alvo;
        return true;
      }
      if (!n.ret) break;
    }
    // refazer: sobe de alvo ate t.rev e aplica de volta
    const desce: No[] = [];
    for (let r = alvo; r !== null; ) {
      const n = this.nos.get(r);
      if (!n) break;
      desce.push(n);
      r = n.pai;
      if (r === t.rev) {
        for (const k of desce.reverse()) if (k.ret && k.depois) poe(t, k, k.depois);
        t.rev = alvo;
        return true;
      }
      if (!n.ret) break;
    }
    return false;
  }

  // o documento mudou (pincelada, desfazer, refazer, quadro copiado): os pixels acompanham o rev de
  // cada desenho. Devolve as imagens cujos pixels mudaram
  sincronizar(doc: Document): string[] {
    const mudou: string[] = [];
    const ds = drawingsOf(doc.json);
    for (const [image, d] of Object.entries(ds)) {
      const alvo = d.raster?.rev ?? null;
      let t = this.telas.get(image);
      if (!t && alvo === null) continue;
      if (!t) {
        // imagem nova com um estado conhecido: o quadro copiado de outro
        const de = this.dono.get(alvo!);
        const origem = de ? this.telas.get(de) : undefined;
        t = this.de(image, d);
        if (origem) {
          t.g.drawImage(origem.canvas, 0, 0);
          t.rev = origem.rev;
          this.andar(t, alvo);
        }
        t.rev = alvo;
        mudou.push(image);
        continue;
      }
      if (t.rev === alvo) continue;
      if (!this.andar(t, alvo)) {
        // estado que esta sessao nao conhece (um rascunho recuperado): fica com os pixels que tem
        if (!this.avisou && alvo !== null) this.avisar("A pintura deste quadro veio de outra sessão: os pixels são os do último salvamento.");
        this.avisou = true;
        if (alvo === null) t.g.clearRect(0, 0, t.w, t.h);
        t.rev = alvo;
      }
      mudou.push(image);
    }
    return mudou;
  }

  // ao abrir: os PNGs da pasta das pinturas
  async carregar(doc: Document, url: (arquivo: string) => string) {
    this.limpar();
    const ds = drawingsOf(doc.json);
    const faltam: string[] = [];
    await Promise.all(
      Object.entries(ds).map(async ([image, d]) => {
        if (!d.raster) return;
        const t = this.de(image, d);
        t.rev = t.gravado = d.raster.rev;
        this.nos.set(d.raster.rev, { pai: null, ret: null, antes: null, depois: null });
        this.dono.set(d.raster.rev, image);
        try {
          const r = await fetch(url(pinturaArquivo(image)));
          if (!r.ok) throw new Error(String(r.status));
          const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
          t.g.drawImage(bmp, 0, 0);
          bmp.close();
        } catch {
          faltam.push(image);
        }
      }),
    );
    if (faltam.length) this.avisar(`Não achei a pintura de ${faltam.join(", ")} na pasta ${doc.file.atlas ? pinturasPasta(doc.file.atlas) : "das pinturas"}: ${faltam.length === 1 ? "o quadro abre" : "os quadros abrem"} sem ela.`);
  }

  // ao salvar: os PNGs que mudaram; devolve quantos gravou
  async gravar(doc: Document, grava: (arquivo: string, png: Blob) => Promise<void>): Promise<number> {
    let n = 0;
    for (const [image, d] of Object.entries(drawingsOf(doc.json))) {
      if (!d.raster) continue;
      const t = this.telas.get(image);
      if (!t || t.rev !== d.raster.rev || t.gravado === t.rev) continue;
      await grava(pinturaArquivo(image), await t.canvas.convertToBlob({ type: "image/png" }));
      t.gravado = t.rev;
      n++;
    }
    return n;
  }
}

