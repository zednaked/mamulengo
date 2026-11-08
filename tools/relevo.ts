// Relevo das paginas de um .boneco (docs/NUCLEO.md "Luzes"; a conta em src/core/relevo.ts, comum ao
// editor pelo navegador): um mapa de normais por pagina,
// calculado da propria arte, para as luzes iluminarem as pecas sem o artista pintar nada. A altura
// sobe da borda num perfil de almofada (inclinada na borda, plana no miolo), mais um pouco do
// brilho da cor (detalhe); a normal sai da inclinacao.
//
// A borda e a da silhueta do personagem montado (modo silhueta, o padrao): o personagem na pose de
// montagem (os ossos pelo nucleo-pose), a uniao dos pixels opacos das pecas, e a altura de cada
// pixel de cada peca pela distancia ate a borda dessa uniao. Onde as pecas se juntam (o punho na
// mao, o pescoco no corpo) a superficie continua, sem vinco; com --camadas, cada peca mistura a borda
// da uniao dela com as da frente (pela ordem de desenho): a que esta por cima ganha contorno. As trocas de imagem de um slot (as
// caras) usam o lugar que teriam nele; imagem que nao esta em slot nenhum, e as giradas ou
// cortadas no atlas, ficam pela borda delas mesmas, como no modo peca.
//
//   npx tsx tools/relevo.ts <x.boneco> [--borda 12] [--profundidade 1] [--detalhe 0.2] [--paginas 0,2]
//                           [--modo silhueta|peca] [--nucleo nucleo/build/nucleo-pose] [--gravar]
//
//   --borda         largura da borda inclinada, em pixels da pagina (multiplique numa pagina HD)
//   --profundidade  quanto a borda sobe (1: a borda sobe a largura dela, 45 graus)
//   --detalhe       quanto o brilho da cor vira relevo (0: so a forma)
//   --camadas       0 a 1 (0,5): quanto cada peca tem a borda da uniao dela com as que estao na
//                   frente (a cabeca sobre o corpo ganha contorno; sem isso, so a silhueta de tudo e
//                   a peca da frente fica "grudada" na de tras quando elas se mexem)
//   --paginas       so estas paginas (indices; padrao: as das partes das skins, abaixo); a silhueta
//                   e so das pecas destas paginas (o cenario de outra pagina nao entra)
//   --modo peca     cada imagem pela borda dela (o relevo de antes: vinco onde as pecas encostam)
//   --gravar        poe "relevo" nas paginas do .boneco
// So as paginas das partes das skins, fora dos slots aditivo e tela (luz nao recebe luz). Cada
// relevo vai ao lado da pagina: <pagina>_relevo.png (vermelho: x para a direita; verde: y para
// cima; azul: para fora da tela).
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { calcularRelevo } from "../src/core/relevo.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const gravar = args.includes("--gravar") && (args.splice(args.indexOf("--gravar"), 1), true);
const borda = Number(opt("borda", "12"));
const profundidade = Number(opt("profundidade", "1"));
const detalhe = Number(opt("detalhe", "0.2"));
const camadas = Number(opt("camadas", "0.5"));
const soPaginas = opt("paginas", "");
const modo = opt("modo", "silhueta");
const nucleo = resolve(opt("nucleo", join(dirname(fileURLToPath(import.meta.url)), "..", "nucleo", "build", "nucleo-pose")));
const [arq] = args;
if (!arq || (modo !== "silhueta" && modo !== "peca")) {
  console.error("uso: tools/relevo.ts <x.boneco> [--borda 12] [--profundidade 1] [--detalhe 0.2] [--paginas 0,2] [--modo silhueta|peca] [--gravar]");
  process.exit(2);
}
const b = JSON.parse(readFileSync(resolve(arq), "utf8"));
const pasta = dirname(resolve(arq));

const { paginas } = await calcularRelevo(
  b,
  {
    async pixels(arquivo) {
      const { data, info } = await sharp(join(pasta, arquivo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, W: info.width, H: info.height };
    },
    async gravarPng(nome, rgb, w, h) {
      await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9 }).toFile(join(pasta, nome));
      return join(pasta, nome);
    },
    // a pose de montagem pelo nucleo-pose (o mesmo codigo do jogo)
    async pose() {
      const r = spawnSync(nucleo, [resolve(arq), "-", "0"], { encoding: "utf8", maxBuffer: 1 << 28 });
      if (r.status !== 0) throw new Error(`nucleo-pose: ${r.stderr || r.error} (compile o nucleo: cmake --build nucleo/build)`);
      return JSON.parse(r.stdout).quadros[0].ossos;
    },
    linha: (s) => console.log(s),
  },
  { borda, profundidade, detalhe, camadas, paginas: soPaginas, modo },
);
if (gravar) {
  writeFileSync(resolve(arq), JSON.stringify(b, null, 1) + "\n");
  console.log(`${basename(arq)}: relevo em ${paginas.length} paginas`);
}
