// O relevo (docs/NUCLEO.md "Luzes") no editor pelo navegador: a mesma conta da ferramenta
// (src/core/relevo.ts) com o arquivo e a imagem do navegador. A pagina e lida sem perda (PNG pelo
// png.ts; WebP e JPEG pelo canvas), o relevo e gravado em PNG RGB sem perda e a pose de montagem
// vem do nucleo em wasm (a mesma conta do nucleo-pose do servidor).
//
// POST /api/relevo {boneco, borda?, profundidade?, detalhe?, camadas?} -> {ok, saida}, como o
// servidor (server/plugin.ts): copia de seguranca, relevo em todas as paginas e o .boneco
// regravado com "relevo" nelas (no formato em que estava, texto ou binario).
import { calcularRelevo, type RelevoOpcoes } from "../core/relevo.ts";
import { copia, erro, gravarBoneco, json, lerBoneco, nucleoWasm } from "./api.ts";
import * as fs from "./fs.ts";
import { lerImagem } from "./imagens.ts";
import { codificarPng } from "./png.ts";

// as matrizes de mundo dos ossos na pose de montagem (como o nucleo-pose <x.boneco> - 0): o
// .boneco carregado sem as instancias (os filhos nao mexem nos ossos do pai)
async function poseDeMontagem(b: any): Promise<Record<string, number[]>> {
  const N = await nucleoWasm();
  const t = N.stringToNewUTF8(JSON.stringify(b));
  const m = N._mm_carregar(t);
  N._free(t);
  if (m < 0) throw new Error(`nucleo: ${N.UTF8ToString(N._mm_erro())}`);
  const inst = N._mm_instancia(m);
  try {
    N._mm_tocar(inst, -1, 0);
    const p = N._mm_pose_ossos(inst) / 8;
    const out: Record<string, number[]> = {};
    for (const o of b.ossos ?? []) {
      const nome = N.stringToNewUTF8(o.nome);
      const i = N._mm_osso(m, nome);
      N._free(nome);
      if (i >= 0) out[o.nome] = Array.from(N.HEAPF64.subarray(p + i * 14, p + i * 14 + 6));
    }
    return out;
  } finally {
    N._mm_liberar_instancia(inst);
    N._mm_liberar_modelo(m);
  }
}

export async function rotaRelevo(rota: string, req: Request): Promise<Response | null> {
  if (rota !== "/api/relevo" || req.method !== "POST") return null;
  const corpo = await req.json();
  const p = fs.normalizar(corpo.boneco ?? "");
  if (!p.endsWith(".boneco")) return erro(403, `so .boneco dentro das raizes: ${p}`);
  const lido = await lerBoneco(p);
  if (!lido) return erro(404, `nao existe: ${p}`);
  await copia(p);
  const pasta = fs.pastaDe(p);
  const o: Partial<RelevoOpcoes> = {};
  for (const k of ["borda", "profundidade", "detalhe", "camadas"] as const) if (typeof corpo[k] === "number") o[k] = corpo[k];
  const b = lido.b as any;
  const { linhas, paginas } = await calcularRelevo(
    b,
    {
      async pixels(arquivo) {
        const im = await lerImagem(fs.normalizar(`${pasta}/${arquivo}`));
        if (!im) throw new Error(`pagina nao existe: ${arquivo}`);
        return { data: im.data, W: im.width, H: im.height };
      },
      async gravarPng(nome, rgb, w, h) {
        const onde = fs.normalizar(`${pasta}/${nome}`);
        await fs.gravarArquivo(onde, (await codificarPng(rgb, w, h, 3)) as BufferSource);
        return onde;
      },
      pose: () => poseDeMontagem(b),
    },
    o,
  );
  await gravarBoneco(p, b, lido.binario);
  return json({ ok: true, saida: [...linhas, `${fs.nomeDe(p)}: relevo em ${paginas.length} paginas`].slice(-6) });
}
