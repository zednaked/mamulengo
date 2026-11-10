// Confere os textos do nucleo (docs/NUCLEO.md "Texto"), que o oraculo nao tem: o boneco de
// tests/nucleo/texto (uma parte de texto girada e escalada num osso girado e escalado, com chave,
// fonte, contorno e sombra; outra de texto livre com quebra de linha e aspas; a troca de parte por
// animacao; um slot vazio). O nucleo guarda o texto e a caixa, nao desenha letras: confere o que
// ele le (mm_textos, no texto e no binario), a caixa sem imagem (o clique), que sem imagem nada se
// desenha, e que com a imagem entregue (mm_texto_imagem) os 4 cantos saem na conta da especificacao
// (osso x parte x retangulo), com o uv pedido, na pagina dos textos e com a cor do slot.
//
//   npx tsx tools/nucleo-texto.ts [--nucleo nucleo/build-web/nucleo.mjs] [--bin nucleo/build/nucleo-binario]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const BIN = resolve(opt("bin", "nucleo/build/nucleo-binario"));
const N = await (await import(pathToFileURL(resolve(opt("nucleo", "nucleo/build-web/nucleo.mjs"))).href)).default();
const ARQ = resolve("tests/nucleo/texto/texto.boneco");
const tmp = mkdtempSync(join(tmpdir(), "nucleo-texto-"));

let falhas = 0,
  casos = 0;
const conferir = (ok: boolean, msg: string) => {
  casos++;
  if (!ok) falhas++, console.log("FALHA " + msg);
};
const perto = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));

// o binario pela ferramenta do nucleo (a mesma arvore)
const binario = join(tmp, "texto.bin.boneco");
const r = spawnSync(BIN, [ARQ, binario], { encoding: "utf8" });
conferir(r.status === 0, `nucleo-binario: ${r.stderr}`);

function carregar(arq: string) {
  const bytes = readFileSync(arq);
  let texto: string;
  if (bytes.subarray(0, 4).toString() === "BNCB") {
    const p = N._malloc(bytes.length);
    N.HEAPU8.set(bytes, p);
    texto = N.UTF8ToString(N._mm_boneco_texto(p, bytes.length));
    N._free(p);
  } else texto = bytes.toString("utf8");
  const p = N.stringToNewUTF8(texto);
  const m = N._mm_carregar(p);
  N._free(p);
  if (m < 0) throw new Error(N.UTF8ToString(N._mm_erro()));
  return m;
}

// mundo de um osso pela especificacao (pais antes, heranca normal, sem cisalhar)
type M = [number, number, number, number, number, number];
const local = (x: number, y: number, rot: number, sx: number, sy: number): M => {
  const r = (rot * 3.1415927) / 180; // o pi do nucleo (docs/NUCLEO.md "Descobertas")
  return [Math.cos(r) * sx, -Math.sin(r) * sy, Math.sin(r) * sx, Math.cos(r) * sy, x, y];
};
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[0] * b[4] + a[1] * b[5] + a[4], a[2] * b[4] + a[3] * b[5] + a[5]];
const ap = (m: M, x: number, y: number) => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];

for (const [rotulo, arq] of [["texto", ARQ], ["binario", binario]] as const) {
  const m = carregar(arq);
  const info = JSON.parse(N.UTF8ToString(N._mm_info(m)));
  const tx = JSON.parse(N.UTF8ToString(N._mm_textos(m)));
  conferir(info.textos.length === 3 && info.textos.map((t: any) => t.nome).join() === "jogar,pontos,outro", `${rotulo}: mm_info textos ${JSON.stringify(info.textos)}`);
  const j = tx.textos[0];
  conferir(
    j.chave === "JOGAR" && j.texto === "JOGAR" && j.familia === "titulo" && j.tamanho === 40 && j.minimo === 24 && j.cor === "ffee00ff" && j.alinhar === 0 && j.alinhar_v === 2 && j.estouro === 1 && j.largura === 300 && j.altura === 60 && j.linha === 3 && j.cor_linha === "1d7a4aff" && JSON.stringify(j.sombra) === '["00000080",0,4]',
    `${rotulo}: os campos do texto ${JSON.stringify(j)}`,
  );
  conferir(tx.textos[1].texto === 'linha 1\nlinha "2"' && tx.textos[1].estouro === 0 && tx.textos[1].alinhar === 1 && tx.textos[2].estouro === 2, `${rotulo}: texto livre com quebra e aspas ${JSON.stringify(tx.textos[1])}`);
  conferir(JSON.stringify(tx.fontes) === '[{"nome":"titulo","arquivo":"fontes/titulo.ttf"},{"nome":"arabe","arquivo":"fontes/arabe.ttf"}]', `${rotulo}: fontes ${JSON.stringify(tx.fontes)}`);
  conferir(tx.idiomas.join() === "pt,en,ar" && tx.traducoes.JOGAR[2] === "العب" && JSON.stringify(tx.traducoes.SO_PT) === '["oi","",""]', `${rotulo}: traducoes ${JSON.stringify(tx.traducoes)}`);
  const parteJogar = info.partes[j.parte];
  conferir(parteJogar.tipo === 7 && parteJogar.vertices === 4, `${rotulo}: a parte de texto e do tipo 7 com 4 cantos`);

  const inst = N._mm_instancia(m);
  N._mm_reiniciar(inst);
  N._mm_passo(inst, 0);
  const osso = local(10, 100, 20, 1.5, 1);
  const parte = local(5, -4, 30, 0.5, 2);
  const W = mul(osso, parte);
  const cantos = (ret: number[]) => [[ret[0], ret[1]], [ret[0], ret[3]], [ret[2], ret[3]], [ret[2], ret[1]]].flatMap(([x, y]) => ap(W, x, y));
  const verts = (slot: number) => {
    const n = N._mm_vertices_slot(inst, slot);
    return Array.from(N.HEAPF64.subarray(N._mm_saida() / 8, N._mm_saida() / 8 + n)) as number[];
  };
  // sem imagem: os cantos sao a caixa, e nada do slot vai para o desenho
  const caixa = cantos([-150, -30, 150, 30]);
  const v0 = verts(1);
  conferir(v0.length === 8 && v0.every((v, i) => perto(v, caixa[i], 1e-5)), `${rotulo}: sem imagem, a caixa ${JSON.stringify(v0)} x ${JSON.stringify(caixa)}`);
  const desenho = () => {
    N._mm_limpar_desenho();
    N._mm_desenhar(inst);
    const nv = N._mm_num_vertices();
    const vs = Array.from(N.HEAPF32.subarray(N._mm_vertices() / 4, N._mm_vertices() / 4 + nv * 8)) as number[];
    const nl = N._mm_num_lotes();
    const lotes = [];
    const pl = N._mm_lotes() / 4;
    for (let k = 0; k < nl; k++) lotes.push(Array.from(N.HEAP32.subarray(pl + k * 7, pl + k * 7 + 7)));
    return { nv, vs, lotes };
  };
  const d0 = desenho();
  conferir(d0.nv === 4, `${rotulo}: sem imagem so o fundo desenha (${d0.nv} vertices)`);
  // a imagem entregue: o retangulo maior que a caixa (a folga do contorno) e o uv no atlas
  const ret = [-160, -40, 170, 45];
  N._mm_texto_imagem(inst, 0, ...ret, 0.25, 0.5, 0.75, 0.625);
  N._mm_pagina_textos(inst, 2048, 2048);
  N._mm_passo(inst, 0);
  const v1 = verts(1);
  const esp = cantos(ret);
  conferir(v1.every((v, i) => perto(v, esp[i], 1e-5)), `${rotulo}: com imagem, os cantos ${JSON.stringify(v1)} x ${JSON.stringify(esp)}`);
  const d1 = desenho();
  conferir(d1.nv === 8, `${rotulo}: com imagem o texto desenha (${d1.nv} vertices)`);
  const q = d1.vs.slice(32, 64);
  const uv = [0.25, 0.625, 0.25, 0.5, 0.75, 0.5, 0.75, 0.625];
  conferir([0, 1, 2, 3].every((c) => perto(q[c * 8], esp[c * 2], 1e-4) && perto(q[c * 8 + 1], esp[c * 2 + 1], 1e-4) && perto(q[c * 8 + 2], uv[c * 2]) && perto(q[c * 8 + 3], uv[c * 2 + 1]) && perto(q[c * 8 + 7], 128 / 255, 1e-3)), `${rotulo}: vertices do texto (posicao, uv, alfa do slot) ${JSON.stringify(q)}`);
  const pg = d1.lotes.map((l: number[]) => l[1]);
  conferir(pg.includes(info.paginas.length), `${rotulo}: o lote do texto na pagina dos textos (${info.paginas.length}): ${JSON.stringify(pg)}`);
  // a troca de parte pela animacao: o segundo texto aparece com a imagem dele; o osso girado leva junto
  N._mm_texto_imagem(inst, 1, -60, -20, 60, 20, 0, 0, 0.1, 0.1);
  N._mm_texto_imagem(inst, 2, -25, -10, 25, 10, 0.1, 0, 0.2, 0.1);
  N._mm_estado_tocar(inst, 0, N._mm_animacao(m, N.stringToNewUTF8("troca")), 0, 0);
  N._mm_passo(inst, 0.75);
  const v2 = verts(2);
  const pl = local(-100, 250, 67.5, 1, 1);
  const esp2 = [[-25, -10], [-25, 10], [25, 10], [25, -10]].flatMap(([x, y]) => ap(pl, x, y));
  conferir(v2.every((v, i) => perto(v, esp2[i], 1e-6)), `${rotulo}: a parte trocada pela animacao no osso girado ${JSON.stringify(v2)} x ${JSON.stringify(esp2)}`);
  // tirar a imagem: volta a caixa e para de desenhar
  N._mm_texto_imagem(inst, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  N._mm_passo(inst, 0);
  conferir(desenho().nv === 8 - 4 + 4, `${rotulo}: sem a imagem do primeiro, desenham o fundo e o segundo`);
  N._mm_liberar_instancia(inst);
  N._mm_liberar_modelo(m);
}

// erros de leitura
for (const [nome, troca] of [
  ["caixa sem altura", (b: any) => delete b.skins[0].partes.jogar.jogar.altura],
  ["estouro desconhecido", (b: any) => (b.skins[0].partes.jogar.jogar.estouro = "x")],
  ["fonte repetida", (b: any) => b.fontes.push({ nome: "titulo", arquivo: "a.ttf" })],
] as const) {
  const b = JSON.parse(readFileSync(ARQ, "utf8"));
  troca(b);
  const p = N.stringToNewUTF8(JSON.stringify(b));
  const m = N._mm_carregar(p);
  N._free(p);
  conferir(m < 0, `erro de leitura: ${nome}`);
  if (m < 0) console.log(`  ${nome}: ${N.UTF8ToString(N._mm_erro())}`);
}

console.log(`${casos} conferencias, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
