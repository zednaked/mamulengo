// Estilo da casa medido: percorre animacoes Spine prontas (so leitura) e mede, por papel
// (idle, quebra de idle, ganho, perda, queda de simbolo, entrada/idle/saida de popup...),
// duracao, quanto o corpo anda e gira, amassa e estica, batidas, pausas, curvas e trocas.
// Os numeros viram o guia de "quanto" para quem anima do zero (docs/ESTILO.md).
//
//   npx tsx tools/estilo.ts <raiz> [<raiz> ...] [--md docs/ESTILO.md] [--json saida.json] [--resumo src/core/estilo-casa.json]
//
// Nada da arte sai daqui: so medidas relativas ao tamanho do personagem.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { scanSpineAssets } from "../server/godot.ts";
import { animDuration } from "../src/core/ficha.ts";
import { medir, type Medida } from "../src/core/estilo.ts";

const rest = process.argv.slice(2);
const opt = (k: string) => {
  const i = rest.indexOf(`--${k}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
// raizes: os argumentos antes da primeira opcao
const fim = rest.findIndex((a) => a.startsWith("--"));
const raizes = (fim < 0 ? rest : rest.slice(0, fim)).map((r) => r.replace(/\/$/, ""));
// copias de trabalho (sandbox, scratchpad, o proprio repo, copias de jogos em
// mamulengo-<algo>) so contam quando a raiz pedida e uma delas: senao um jogo copiado
// contaria duas vezes
const copia = (p: string) => /scratchpad|\/mamulengo(-[a-z]+)?\//.test(p);
if (!raizes.length) {
  console.error("uso: estilo.ts <raiz> [--md arquivo.md] [--json arquivo.json]");
  process.exit(2);
}

const out: Medida[] = [];
for (const root of raizes) for (const s of scanSpineAssets(root)) {
  if (s.tres.endsWith(".boneco") || !s.skeleton.startsWith(root + "/") || (copia(s.skeleton) && !copia(root + "/"))) continue;
  let j: any;
  try {
    j = JSON.parse(readFileSync(s.skeleton, "utf8"));
  } catch {
    continue;
  }
  const name = basename(s.skeleton).replace(/\.spine-json$|\.json$/, "");
  for (const anim of Object.keys(j.animations ?? {})) {
    if (animDuration(j.animations[anim]) <= 0) continue;
    try {
      out.push(medir(name, j, anim));
    } catch (e: any) {
      console.error(`pulei ${name}/${anim}: ${e.message}`);
    }
  }
}

const q = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? 0;
};
const faixa = (v: number[], d = 0) => (v.length ? `${q(v, 0.25).toFixed(d)} a ${q(v, 0.75).toFixed(d)} (mediana ${q(v, 0.5).toFixed(d)})` : "-");

if (opt("json")) writeFileSync(opt("json")!, JSON.stringify(out, null, 1));

// cada asset pesa 1 por papel (um asset chega a ter 76 animacoes): usa a animacao mediana dele
const porAsset = new Map<string, Medida[]>();
for (const m of out) (porAsset.get(`${m.tipo}|${m.papel}|${m.asset}`) ?? porAsset.set(`${m.tipo}|${m.papel}|${m.asset}`, []).get(`${m.tipo}|${m.papel}|${m.asset}`)!).push(m);
const grupos = new Map<string, Medida[]>();
for (const [k, ms] of porAsset) {
  const g = k.split("|").slice(0, 2).join("|");
  const med = [...ms].sort((a, b) => a.dur - b.dur)[Math.floor(ms.length / 2)];
  (grupos.get(g) ?? grupos.set(g, []).get(g)!).push(med);
}
const L: string[] = [];
L.push("# Estilo da casa (medido)", "");
L.push(
  `Medidas de ${out.length} animações prontas, agrupadas por tipo de asset e papel da animação. Use como referência de **quanto**: duração, amplitude, ritmo. Valores são o intervalo do meio (25% a 75%) e a mediana. Gerado por \`npx tsx tools/estilo.ts <raiz>\`; nenhuma arte entra aqui.`,
  "",
  "Colunas:",
  "- **duração** em segundos;",
  "- **corpo**: quanto a raiz do corpo anda, em % da altura do personagem;",
  "- **silhueta**: quanto a pose mais distante se afasta da inicial, em % da altura (deslocamento dos ossos desde o primeiro quadro, no osso do percentil 75: braços e cabeça indo longe contam, o corpo parado não). É o que separa uma pose que lê de longe de um gesto pequeno;",
  "- **giro**: o maior giro de um osso, em graus; **giro típico**: o giro mediano dos ossos animados;",
  "- **amassa**: quanto a escala sai de 1, em %;",
  "- **deforma**: o maior deslocamento de um vertice nas chaves de deform, em % da altura (vegetacao e tecido se movem assim, sem osso nenhum andar);",
  "- **batidas**: picos de movimento por segundo. Movimento = deslocamento medio dos ossos entre quadros (30 fps); pico = quadro maior que os vizinhos e acima de 35% do maior pico da animacao;",
  "- **pausa**: o maior trecho seguido com movimento abaixo de 8% do maior pico (ossos; deform e transparencia nao contam), em segundos;",
  "- **chaves/s**: chaves por segundo, todas as timelines somadas;",
  "- **curvas**: % de chaves com curva bezier;",
  "- **trocas**: imagens trocadas por animação;",
  "- **loop**: % das animações que emendam em si mesmas.",
  "",
  "## Como usar",
  "",
  "- **Antes das chaves:** ache a linha do tipo e do papel da sua animação e use a mediana como alvo.",
  "- **Depois:** meça a sua com `query.estilo {anim, papel}`, que usa a mesma régua e diz onde ficou abaixo ou acima da faixa.",
  "- **Fora da faixa sem motivo é defeito.** Abaixo dela é o erro mais comum de quem anima do zero: tudo certo e tímido.",
  "- **Exemplo:** um ganho feito do zero costuma sair abaixo da casa em tudo ao mesmo tempo: corpo andando pouco, giro pequeno, poucas batidas e uma pausa parada. Lê certo, mas parece sem vontade.",
  "- **Movimento sempre:** na casa, até pose segurada respira. Pausa medida é zero em quase tudo, porque o personagem mexe algo enquanto segura (ombro, cabeça, sobrancelha).",
  "- **Trocas de imagem:** em ganho de personagem o gesto principal costuma vir de troca de mão ou rosto, não só de girar osso.",
  "- **Escala, não pixels:** as medidas são relativas à altura do personagem (bounds do cabeçalho). Converta para o seu: 10% de 600 = 60 px.",
  "",
);
const order = ["personagem", "simbolo", "popup/placa", "efeito", "interface/mecanico", "vegetacao", "cenario"];
for (const t of order) {
  const keys = [...grupos.keys()].filter((k) => k.startsWith(t + "|")).sort();
  if (!keys.length) continue;
  L.push(`## ${t}`, "");
  L.push("| papel | assets | duração | corpo % | silhueta % | giro | giro típico | amassa % | deforma % | batidas/s | pausa | chaves/s | curvas % | trocas | loop % |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const k of keys) {
    const g = grupos.get(k)!;
    const curv = g.map((m) => (100 * m.curvas.bezier) / Math.max(1, m.curvas.bezier + m.curvas.linear + m.curvas.stepped));
    L.push(
      `| ${k.split("|")[1]} | ${g.length} | ${faixa(g.map((m) => m.dur), 2)} | ${faixa(g.map((m) => m.corpo), 1)} | ${faixa(g.map((m) => m.silhueta), 1)} | ${faixa(g.map((m) => m.giro))} | ${faixa(g.map((m) => m.giroMediano))} | ${faixa(g.map((m) => m.amassa))} | ${faixa(g.map((m) => m.deforma), 1)} | ${faixa(g.map((m) => m.batidas), 1)} | ${faixa(g.map((m) => m.pausa), 2)} | ${faixa(g.map((m) => m.chavesPorSeg))} | ${faixa(curv)} | ${faixa(g.map((m) => m.trocas))} | ${Math.round((100 * g.filter((m) => m.loop).length) / g.length)} |`,
    );
  }
  L.push("");
}
// faixas da casa por tipo e papel (so numeros), para o comando query.estilo comparar
if (opt("resumo")) {
  const metr = ["dur", "corpo", "silhueta", "giro", "giroMediano", "amassa", "deforma", "batidas", "pausa", "chavesPorSeg", "trocas"] as const;
  const res: Record<string, any> = {};
  for (const [k, g] of grupos) {
    res[k] = { assets: g.length };
    for (const m of metr) res[k][m] = [q(g.map((x) => x[m] as number), 0.25), q(g.map((x) => x[m] as number), 0.5), q(g.map((x) => x[m] as number), 0.75)].map((v) => +v.toFixed(3));
  }
  writeFileSync(opt("resumo")!, JSON.stringify(res, null, 1) + "\n");
}
const md = L.join("\n");
if (opt("md")) writeFileSync(opt("md")!, md + "\n");
console.log(md);
