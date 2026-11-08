// A versao leve no editor pelo navegador (/api/boneco/leve, como o servidor): a conta comum
// (src/core/boneco-leve.ts) com as pastas de fs.ts, as imagens de imagens.ts e o nucleo em wasm
// no lugar do nucleo-pose. As paginas saem em PNG sem perda (o navegador nao grava WebP sem
// perda): <x>-leve.png, e o relevo <x>-leve_relevo.png.
import { empacotarBruto } from "../core/atlas-pack.ts";
import type { Bruto } from "../core/psd-importar.ts";
import { divisor, normalizar, recortarBruto, versaoLeve, desmultiplicar, type LeveIO } from "../core/boneco-leve.ts";
import { erro, gravarBoneco, json, lerBoneco, nucleoWasm } from "./api.ts";
import * as fs from "./fs.ts";
import { gravarPng, lerImagem, redimensionar } from "./imagens.ts";
import { codificarPng } from "./png.ts";

const diretorio = (c: string) => c.slice(0, c.lastIndexOf("/") + 1);

// lotes de desenho do primeiro quadro de cada animacao, pelo nucleo em wasm: a animacao do zero
// (mm_tocar); da o mesmo numero que o nucleo-pose --quadros 1 nas 79 animacoes dos exemplos e
// testes (avancar 1/60 s antes de desenhar daria a mais, com as particulas ja soltas)
async function lotes(arq: string): Promise<number[]> {
  const lido = await lerBoneco(arq);
  if (!lido) return [];
  const anims = Object.keys(lido.b.animacoes ?? {});
  if (!anims.length) return [];
  const N = await nucleoWasm();
  const str = (s: string) => N.stringToNewUTF8(s);
  // os filhos das instancias, pelo caminho normalizado (como o leitor pede)
  N._mm_limpar_arquivos();
  const fila: string[] = (lido.b.instancias ?? []).filter((i: any) => typeof i.boneco === "string").map((i: any) => normalizar(diretorio(arq) + i.boneco));
  const vistos = new Set<string>();
  while (fila.length) {
    const c = fila.shift()!;
    if (vistos.has(c)) continue;
    vistos.add(c);
    const f = await lerBoneco(c).catch(() => null);
    if (!f) continue;
    const pc = str(c),
      pt = str(JSON.stringify(f.b));
    N._mm_arquivo(pc, pt);
    N._free(pc);
    N._free(pt);
    for (const i of f.b.instancias ?? []) if (typeof i.boneco === "string") fila.push(normalizar(diretorio(c) + i.boneco));
  }
  const p = str(JSON.stringify(lido.b)),
    pc = str(arq);
  const m = N._mm_carregar_de(p, pc);
  N._free(p);
  N._free(pc);
  N._mm_limpar_arquivos();
  // nao abriu: como o nucleo-pose que falha (sem numero)
  if (m < 0) return anims.map(() => NaN);
  try {
    return anims.map((a) => {
      const pa = str(a);
      const ai = N._mm_animacao(m, pa);
      N._free(pa);
      if (ai < 0) return NaN;
      const inst = N._mm_instancia(m);
      try {
        N._mm_tocar(inst, ai, 1);
        N._mm_limpar_desenho();
        N._mm_desenhar(inst);
        return N._mm_num_lotes() as number;
      } finally {
        N._mm_liberar_instancia(inst);
      }
    });
  } finally {
    N._mm_liberar_modelo(m);
  }
}

function io(): LeveIO<Bruto> {
  // as paginas lidas uma vez so por pedido
  const paginas = new Map<string, Promise<Bruto | null>>();
  const pagina = (p: string) => {
    if (!paginas.has(p)) paginas.set(p, lerImagem(p));
    return paginas.get(p)!;
  };
  return {
    async lerBoneco(p) {
      const lido = await lerBoneco(p);
      if (!lido) throw Object.assign(new Error(`nao existe: ${p}`), { code: 404 });
      return lido;
    },
    gravarBoneco,
    existe: fs.existe,
    async tamanho(p) {
      return (await fs.lerArquivo(p))?.size ?? 0;
    },
    async gravar(p, dados) {
      await fs.gravarArquivo(p, dados as BufferSource);
    },
    async recorte(arquivo, im, o) {
      const pg = await pagina(arquivo);
      if (!pg) throw Object.assign(new Error(`pagina nao existe: ${arquivo}`), { code: 404 });
      const r: Bruto = recortarBruto(pg, im.ret, im.girada ?? 0);
      if (o.pma) desmultiplicar(r.data);
      return o.tamanho ? redimensionar(r, o.tamanho[0], o.tamanho[1]) : r;
    },
    async empacotar(entrada, o) {
      const brutas = entrada.map((e) => ({ name: e.name, ...e.data }));
      return empacotarBruto(brutas, { ...o, format: "png" }, (rgba, w, h) => codificarPng(rgba, w, h));
    },
    async relevo(p, w, h, camadas) {
      // a normal reta no fundo e as imagens por cima (sobreposicao com a transparencia delas)
      const d = new Uint8Array(w * h * 4);
      for (let i = 0; i < d.length; i += 4) (d[i] = 128), (d[i + 1] = 128), (d[i + 2] = 255), (d[i + 3] = 255);
      for (const { imagem: im, x, y } of camadas)
        for (let iy = 0; iy < im.height; iy++)
          for (let ix = 0; ix < im.width; ix++) {
            const tx = x + ix,
              ty = y + iy;
            if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
            const s = (iy * im.width + ix) * 4,
              t = (ty * w + tx) * 4,
              a = im.data[s + 3] / 255;
            for (let c = 0; c < 3; c++) d[t + c] = Math.round(im.data[s + c] * a + d[t + c] * (1 - a));
          }
      await gravarPng(p, { width: w, height: h, data: d });
    },
    lotes,
    mostrar: (p) => p,
  };
}

// a rota (ROTAS em api.ts): pedido e resposta como os do servidor (server/plugin.ts)
export async function rotaLeve(rota: string, req: Request): Promise<Response | null> {
  if (rota !== "/api/boneco/leve" || req.method !== "POST") return null;
  const b = JSON.parse((await req.text()) || "{}");
  const p = fs.normalizar(b.boneco ?? "");
  if (!p.endsWith(".boneco")) return erro(403, `so .boneco: ${p}`);
  if (!(await fs.existe(p))) return erro(404, `nao existe: ${p}`);
  const fator = Number(b.fator) > 0 ? Number(b.fator) : 0.5;
  if (divisor(fator) == null) return erro(500, `fator invalido: ${fator} (1/n: 0.5, 0.25 ou 1)`);
  const saida = await versaoLeve(io(), p, p.replace(/\.boneco$/, "-leve.boneco"), { fator, lado: 2048 });
  return json({ ok: true, saida });
}
