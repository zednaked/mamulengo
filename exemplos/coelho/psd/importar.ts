// A tela de exemplos/coelho (o menu) refeita pelo PSD (docs/LAYOUT-PSD.md, "A prova"): importa
// tests/assets/psd/tela.psd como tela, sem mapa, so pela convencao de nomes, com a fonte da Kenney.
// Escreve exemplos/coelho/psd/tela.boneco, a pagina, as fontes e tela.manifesto.json (as imagens-fonte
// em images/ ficam fora do git).
//
//   npx tsx exemplos/coelho/psd/importar.ts
//   npm run dev  e abra /exemplos/coelho/ver/   (a tela importada; ?boneco=../coelho-jogo.boneco e a do gerador)
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScreenFromPsd } from "../../../server/psd.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
for (const f of ["tela.boneco", "tela.webp", "tela.manifesto.json", "fontes", "images"]) rmSync(join(AQUI, f), { recursive: true, force: true });
const r = await createScreenFromPsd({ psd: join(AQUI, "../../../tests/assets/psd/tela.psd"), dir: AQUI, name: "tela", fontes: [join(AQUI, "../kenney")] });
rmSync(join(AQUI, "images"), { recursive: true, force: true });
console.log(r.summary.join("\n"));
