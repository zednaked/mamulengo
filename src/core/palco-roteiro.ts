// O roteiro de entrada do palco (docs/PALCO.md): trechos "teclas quadros" separados por virgula
// (teclas: esquerda, direita, pulo, juntas com +, ou nada; 60 quadros por segundo), virando a
// entrada de cada passo (bits: 1 esquerda, 2 direita, 4 pulo). O pulo vale na borda (apertar):
// segurado num trecho conta uma vez, e cada trecho com pulo aperta de novo (depois de um trecho com
// pulo, o primeiro quadro solta). tools/palco.ts joga; tools/quadro.ts --palco filma.
export const PASSO_PALCO = 1 / 60;

export type Trecho = { teclas: number; quadros: number; texto: string };

export function lerRoteiro(r: string): Trecho[] {
  return r
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [t, q] = s.split(/\s+/);
      let teclas = 0;
      for (const k of t.split("+")) {
        if (k === "esquerda") teclas |= 1;
        else if (k === "direita") teclas |= 2;
        else if (k === "pulo") teclas |= 4;
        else if (k !== "nada") throw new Error(`tecla desconhecida: ${k} (esquerda, direita, pulo, nada)`);
      }
      const quadros = Number(q ?? 1);
      if (!(quadros > 0)) throw new Error(`trecho sem quadros: ${s}`);
      return { teclas, quadros, texto: s };
    });
}

// a entrada de cada passo, e onde cada trecho acaba (o indice do ultimo passo dele)
export function passosDoRoteiro(r: string): { bits: number[]; fins: number[]; trechos: Trecho[] } {
  const trechos = lerRoteiro(r);
  const bits: number[] = [];
  const fins: number[] = [];
  let antes = 0;
  for (const t of trechos) {
    const soltar = t.teclas & antes & 4;
    for (let k = 0; k < t.quadros; k++) bits.push(k === 0 && soltar ? t.teclas & ~4 : t.teclas);
    fins.push(bits.length - 1);
    antes = t.teclas;
  }
  return { bits, fins, trechos };
}
