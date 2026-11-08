// Zip sem dependencias, para levar personagens para dentro e para fora do navegador (o Firefox e o
// Safari nao abrem pasta do computador). Grava com deflate pelo CompressionStream("deflate-raw")
// (guarda sem comprimir quando nao ganha nada), nomes em UTF-8 (bit 11) e CRC32; le entradas
// guardadas (0) e deflate (8) pelo diretorio central. Zip64, criptografia e outros metodos dao
// erro claro. Roda na pagina, no service worker e no Node (os testes).

export type Entrada = { nome: string; dados: Uint8Array<ArrayBuffer>; data?: Date };

// ---- CRC32 (polinomio 0xEDB88320, tabela)

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- deflate cru pelos streams do navegador

async function passar(dados: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<any> }): Promise<Uint8Array<ArrayBuffer>> {
  const escrever = (async () => {
    const w = stream.writable.getWriter();
    await w.write(dados);
    await w.close();
  })();
  const ler = new Response(stream.readable).arrayBuffer();
  const [, buf] = await Promise.all([escrever, ler]);
  return new Uint8Array(buf);
}
const comprimir = (d: Uint8Array) => passar(d, new CompressionStream("deflate-raw"));
const descomprimir = (d: Uint8Array) => passar(d, new DecompressionStream("deflate-raw"));

// ---- hora no formato do DOS (resolucao de 2 s, hora local, de 1980 em diante)

function dos(d: Date): { hora: number; dia: number } {
  const ano = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// ---- gravar

const LIMITE = 0xffffffff;
const MAX_ENTRADAS = 0xffff;

export async function zipar(entradas: Entrada[]): Promise<Blob> {
  if (entradas.length >= MAX_ENTRADAS) throw new Error(`zip com arquivos demais (${entradas.length}): o formato sem zip64 aceita ate ${MAX_ENTRADAS - 1}`);
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let pos = 0;
  for (const e of entradas) {
    const nome = enc.encode(e.nome);
    if (e.dados.length >= LIMITE) throw new Error(`${e.nome} e grande demais para zip sem zip64 (4 GB)`);
    const crc = crc32(e.dados);
    const comp = e.dados.length ? await comprimir(e.dados) : new Uint8Array(0);
    const deflate = comp.length < e.dados.length;
    const corpo = deflate ? comp : e.dados;
    const { hora, dia } = dos(e.data ?? new Date());
    const flags = 1 << 11; // nome em UTF-8
    const metodo = deflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versao para extrair (2.0: deflate e pastas)
    local.setUint16(6, flags, true);
    local.setUint16(8, metodo, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, corpo.length, true);
    local.setUint32(22, e.dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, (3 << 8) | 20, true); // feito por: unix, 2.0
    cd.setUint16(6, 20, true);
    cd.setUint16(8, flags, true);
    cd.setUint16(10, metodo, true);
    cd.setUint16(12, hora, true);
    cd.setUint16(14, dia, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, corpo.length, true);
    cd.setUint32(24, e.dados.length, true);
    cd.setUint16(28, nome.length, true);
    // extra, comentario, disco, atributos internos: zero
    cd.setUint32(38, (0o100644 << 16) >>> 0, true); // -rw-r--r-- no unix
    cd.setUint32(42, pos, true);

    partes.push(new Uint8Array(local.buffer), nome, corpo);
    central.push(new Uint8Array(cd.buffer), nome);
    pos += 30 + nome.length + corpo.length;
    if (pos >= LIMITE) throw new Error("zip grande demais sem zip64 (4 GB)");
  }
  const inicioCentral = pos;
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, entradas.length, true);
  fim.setUint16(10, entradas.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, inicioCentral, true);
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)] as BlobPart[], { type: "application/zip" });
}

// ---- ler

export async function deszipar(zip: Uint8Array): Promise<Entrada[]> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // o fim do diretorio central: do fim para o comeco (o comentario pode ter ate 64 KB)
  let fim = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      fim = i;
      break;
    }
  if (fim < 0) throw new Error("não é um arquivo .zip (sem o diretório central)");
  if (fim >= 20 && v.getUint32(fim - 20, true) === 0x07064b50) throw new Error("zip64 não é suportado: compacte em partes menores (até 4 GB e 65535 arquivos)");
  const total = v.getUint16(fim + 10, true);
  const tamCentral = v.getUint32(fim + 12, true);
  let p = v.getUint32(fim + 16, true);
  if (v.getUint16(fim + 4, true) !== 0 || v.getUint16(fim + 6, true) !== 0) throw new Error("zip em vários volumes não é suportado");
  if (total === 0xffff || tamCentral === LIMITE || p === LIMITE) throw new Error("zip64 não é suportado: compacte em partes menores (até 4 GB e 65535 arquivos)");
  if (p + tamCentral > fim) throw new Error("zip corrompido (diretório central fora do arquivo)");

  const utf8 = new TextDecoder("utf-8", { fatal: false });
  const out: Entrada[] = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > zip.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("zip corrompido (entrada do diretório central)");
    const flags = v.getUint16(p + 8, true);
    const metodo = v.getUint16(p + 10, true);
    const hora = v.getUint16(p + 12, true);
    const dia = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true);
    const tamComp = v.getUint32(p + 20, true);
    const tam = v.getUint32(p + 24, true);
    const lnome = v.getUint16(p + 28, true);
    const lextra = v.getUint16(p + 30, true);
    const lcom = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const bytesNome = zip.subarray(p + 46, p + 46 + lnome);
    // sem o bit 11 o nome e CP437; os nomes ASCII (quase todos) saem iguais, o resto vai como UTF-8
    const nome = utf8.decode(bytesNome);
    p += 46 + lnome + lextra + lcom;
    if (tamComp === LIMITE || tam === LIMITE || local === LIMITE) throw new Error(`zip64 não é suportado (${nome})`);
    if (flags & 1) throw new Error(`zip com senha não é suportado (${nome})`);
    if (nome.endsWith("/")) continue; // pasta
    if (local + 30 > zip.length || v.getUint32(local, true) !== 0x04034b50) throw new Error(`zip corrompido (${nome})`);
    const ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (ini + tamComp > zip.length) throw new Error(`zip corrompido (${nome} passa do fim)`);
    const corpo = zip.subarray(ini, ini + tamComp);
    let dados: Uint8Array<ArrayBuffer>;
    if (metodo === 0) dados = corpo.slice();
    else if (metodo === 8) dados = await descomprimir(corpo);
    else throw new Error(`${nome}: método de compressão ${metodo} não é suportado (só guardado e deflate)`);
    if (dados.length !== tam || crc32(dados) !== crc) throw new Error(`zip corrompido (${nome}: tamanho ou CRC não confere)`);
    const data = new Date(1980 + (dia >> 9), ((dia >> 5) & 15) - 1, dia & 31, hora >> 11, (hora >> 5) & 63, (hora & 31) * 2);
    out.push({ nome, dados, data });
  }
  return out;
}

// o caminho de uma entrada, limpo; null se sai da pasta (.., absoluto, letra de disco)
export function caminhoSeguro(nome: string): string | null {
  const n = nome.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return null;
  const partes = n.split("/").filter((s) => s && s !== ".");
  if (!partes.length || partes.some((s) => s === "..")) return null;
  return partes.join("/");
}
