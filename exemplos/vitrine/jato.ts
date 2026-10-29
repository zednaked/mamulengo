// As chaves do jato em camadas do robo (o rig fica no vitrine.boneco: ossos jato_e/d, halo,
// linguas, nucleo, mascara, clarao, luz no chao, fumaca e fogo), para uma lista de janelas
// [comeco, fim] em segundos. A vitrine e o jogo usam; `P` prefixa os nomes (o jogo poe o robo
// dentro da cena como "robo.").
export const NL = 6; // quadros das linguas de fogo
export const QUADRO = 1 / 30;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
// tremor repetivel: um numero de 0 a 1 por quadro e canal
export const tremor = (k: number, canal: number) => {
  const v = Math.sin(k * 12.9898 + canal * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
// envelope do jato: 0 antes, ignicao exagerada (1,35 em 0,12 s), 1 ate perto do fim, 0 no fim
export const envelope = (t: number, [a, z]: [number, number]) => {
  if (t <= a || t >= z) return 0;
  if (t < a + 0.12) return (1.35 * (t - a)) / 0.12;
  if (t < a + 0.3) return 1.35 - (0.35 * (t - a - 0.12)) / 0.18;
  if (t > z - 0.15) return (z - t) / 0.15;
  return 1;
};
const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");

export function chavesJato(janelas: [number, number][], P: (n: string) => string = (n) => n, picosFogo: number[] = []) {
  const tremido = (fn: (t: number, k: number, env: number) => any) => {
    const ks: any[] = [{ tempo: 0, ...fn(0, 0, 0) }];
    for (const jan of janelas) {
      ks.push({ tempo: r3(jan[0]), ...fn(jan[0], 0, 0) });
      for (let k = 1, t = jan[0] + QUADRO; t < jan[1]; k++, t += QUADRO) ks.push({ tempo: r3(t), ...fn(t, k, envelope(t, jan)) });
      ks.push({ tempo: r3(jan[1]), ...fn(jan[1], 0, 0) });
    }
    return ks;
  };
  const ossos: any = {},
    slots: any = {},
    efeitos: any = {},
    particulas: any = {};
  for (const lado of ["e", "d"]) {
    // o osso do jato: escala pelo envelope e um tremor de 12% a cada quadro
    ossos[P(`jato_${lado}`)] = { escalar: tremido((_t, k, env) => ({ x: r3(env * (0.9 + 0.24 * tremor(k + (lado === "d" ? 50 : 0), 1))), y: r3(env * (0.9 + 0.2 * tremor(k + (lado === "d" ? 50 : 0), 2))) })) };
    slots[P(`jato_halo_${lado}`)] = { rgba: tremido((_t, k, env) => ({ cor: "ffffff" + hex(Math.min(1, env) * (0.7 + 0.3 * tremor(k + 7, 3))) })) };
    slots[P(`jato_nucleo_${lado}`)] = { rgba: tremido((_t, k, env) => ({ cor: "ffffff" + hex(Math.min(1, env) * (0.8 + 0.2 * tremor(k + 11, 4))) })) };
    // as pernas esquentam com a luz do jato
    efeitos[P(`perna_${lado}`)] = { tingir: tremido((_t, k, env) => ({ cor: "ff9a48ff", forca: r3(Math.min(1, env) * (0.28 + 0.12 * tremor(k + 3, 5))) })) };
  }
  for (const [li, lado] of ["e", "d"].entries()) {
    // as linguas: um quadro a cada 1/30 s dentro das janelas, cada pe comecando num quadro
    const ks: any[] = [{ tempo: 0, nome: null }];
    for (const jan of janelas) {
      for (let k = 0, t = jan[0]; t < jan[1]; k++, t += QUADRO) ks.push({ tempo: r3(t), nome: `lingua_${(k + li * 3) % NL}` });
      ks.push({ tempo: r3(jan[1]), nome: null });
    }
    slots[P(`jato_lingua_${lado}`)] = { parte: ks };
  }
  // o clarao: acende na ignicao e some em 0,25 s, crescendo
  slots[P("clarao")] = { rgba: [{ tempo: 0, cor: "ffd9a000" }, ...janelas.flatMap(([a]) => [{ tempo: a, cor: "ffd9a000", curva: "degrau" }, { tempo: r3(a + 0.02), cor: "ffd9a0ff" }, { tempo: r3(a + 0.28), cor: "ffd9a000" }])] };
  ossos[P("clarao")] = { escalar: [{ tempo: 0, x: 0.4, y: 0.4 }, ...janelas.flatMap(([a]) => [{ tempo: a, x: 0.4, y: 0.4, curva: "degrau" }, { tempo: r3(a + 0.02), x: 0.7, y: 0.7 }, { tempo: r3(a + 0.28), x: 1.9, y: 1.4 }])] };
  slots[P("luz_chao")] = { rgba: tremido((_t, k, env) => ({ cor: "ff9a40" + hex(Math.min(1, env) * (0.45 + 0.2 * tremor(k + 5, 6))) })) };
  // fogo (linguas e brasas): sobe em 0,15 s ate o pico e cai ate o fim da janela; fumaca na ignicao
  const rampa = janelas.flatMap(([a, z], i) => [
    { tempo: a, valor: 0 },
    { tempo: r3(a + 0.15), valor: picosFogo[i] ?? 60 },
    { tempo: r3(z - 0.0), valor: 0 },
  ]);
  particulas[P("fogo_e")] = { taxa: rampa };
  particulas[P("fogo_d")] = { taxa: rampa };
  particulas[P("fumaca")] = { rajada: janelas.map(([a]) => ({ tempo: r3(a + 0.01), quantidade: 16 })) };
  return { ossos, slots, efeitos, particulas };
}
