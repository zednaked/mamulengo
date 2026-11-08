// Trocar e acrescentar imagens soltas num personagem, e criar um .boneco a partir de uma pasta de
// imagens: a fonte de cada imagem fica em <pasta>/images (como o Spine), e o atlas e reempacotado
// a partir delas. Arquivo e imagem vem de quem chama (PsdIO de src/core/psd-importar.ts): o editor
// pelo navegador usa as pastas dele (src/navegador/imagens-atlas.ts). O atlas pode ser o de um
// .boneco (virtual: quem chama le e regrava pelo `gravarAtlas`).
import { parseAtlas } from "./atlas-text.ts";
import { juntar, pasta, type PsdIO } from "./psd-importar.ts";
import { importarSpine } from "../boneco/spine.ts";

// o nome base das paginas: x.atlas -> x, x.boneco.atlas -> x
const baseDoAtlas = (atlas: string) =>
  atlas
    .slice(atlas.lastIndexOf("/") + 1)
    .replace(/\.atlas$/, "")
    .replace(/\.boneco$/, "");

// garante a pasta de fontes (personagem vindo do Spine nao tem: sai do atlas atual)
export async function fontesDoAtlas(io: PsdIO, atlas: string, atlasTexto: string): Promise<string> {
  const imagesDir = juntar(pasta(atlas), "images");
  if (!(await io.imagens(imagesDir)).length) await io.desempacotar(atlas, atlasTexto, imagesDir);
  return imagesDir;
}

// reempacota as fontes de images/ e regrava as paginas e o atlas
export async function reempacotar(io: PsdIO, o: { atlas: string; atlasTexto: string; gravarAtlas: (texto: string) => Promise<void> }) {
  const dir = pasta(o.atlas);
  const imagesDir = await fontesDoAtlas(io, o.atlas, o.atlasTexto);
  const antes = parseAtlas(o.atlasTexto);
  for (const pg of antes.pages) await io.copia?.(juntar(dir, pg.name));
  const packed = await io.empacotar(await io.imagens(imagesDir), { pageName: baseDoAtlas(o.atlas), pma: antes.pages[0]?.pma ?? false });
  for (const pg of packed.pages) await io.gravar(juntar(dir, pg.name), pg.data);
  await o.gravarAtlas(packed.atlas);
  return { atlas: o.atlas, atlasText: packed.atlas, regions: parseAtlas(packed.atlas).regions.length, pages: packed.pages.map((p) => p.name) };
}

// .boneco novo a partir das imagens de uma pasta: as fontes vao para <dir>/images, as paginas ao
// lado, esqueleto so com a raiz (as partes entram depois, pelos comandos)
export async function criarBonecoDeImagens(io: PsdIO, o: { dir: string; name: string; imagesFrom: string }) {
  if (!/^[\w.-]+$/.test(o.name)) throw new Error(`nome invalido "${o.name}": use letras, numeros, - e _ (sem espacos)`);
  const arquivo = juntar(o.dir, `${o.name}.boneco`);
  if (await io.existe(arquivo)) throw new Error(`ja existe: ${arquivo}`);
  const fontes = await io.imagens(o.imagesFrom);
  if (!fontes.length) throw new Error(`nenhuma imagem em ${o.imagesFrom}`);
  const imagesDir = juntar(o.dir, "images");
  for (const im of fontes) {
    const destino = juntar(imagesDir, im.name + im.file.slice(im.file.lastIndexOf(".")));
    if (destino === im.file) continue;
    const b = await io.ler(im.file);
    if (b) await io.gravar(destino, b);
  }
  const packed = await io.empacotar(await io.imagens(imagesDir), { pageName: o.name });
  for (const pg of packed.pages) await io.gravar(juntar(o.dir, pg.name), pg.data);
  const json = { skeleton: { spine: "4.3.23", images: "./images/", audio: "" }, bones: [{ name: "root" }], slots: [], skins: [{ name: "default", attachments: {} }], animations: {} };
  await io.gravarBoneco(arquivo, importarSpine(json, packed.atlas, o.name), false);
  return { tres: arquivo, skeleton: arquivo + ".spine-json", atlas: arquivo + ".atlas", regions: parseAtlas(packed.atlas).regions.length, pages: packed.pages.map((p) => p.name) };
}
