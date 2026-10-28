// Diario de processo: anota etapas, notas, medidas e comandos de um trabalho longo (integrar
// um personagem num jogo, uma rodada de bancada) e monta um DIARIO.md com a linha do tempo,
// a duracao de cada etapa, as medidas e as notas por tipo. Cada evento vai como uma linha
// em <pasta>/diario.jsonl (so acrescenta, nunca reescreve); o .md e gerado a partir dele.
//
//   npx tsx tools/diario.ts abrir "<titulo>"            cria a pasta (DIARIO=<pasta> ou --dir)
//   npx tsx tools/diario.ts etapa "<nome>"              comeca uma etapa (fecha a anterior)
//   npx tsx tools/diario.ts nota "<texto>" [--tipo T]   T: nota, licao, limite, problema,
//                                                       decisao, tecnica, melhoria
//   npx tsx tools/diario.ts medida <nome> <valor> [unidade] [--obs "..."]
//   npx tsx tools/diario.ts cmd -- <comando...>         roda, mede o tempo, guarda a saida
//   npx tsx tools/diario.ts fechar                      fecha a etapa aberta
//   npx tsx tools/diario.ts md                          (re)gera o DIARIO.md
//
// Trilhas: quem trabalha em paralelo no mesmo diario (duas pessoas, dois agentes) usa
// --trilha <nome> ou DIARIO_TRILHA; cada trilha tem a sua etapa aberta.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const TIPOS = ["nota", "licao", "limite", "problema", "decisao", "tecnica", "melhoria"] as const;
const TITULO_TIPO: Record<string, string> = {
  licao: "Lições",
  limite: "Limitações encontradas",
  problema: "Problemas",
  decisao: "Decisões",
  tecnica: "Técnicas de animação",
  melhoria: "Melhorias para a ferramenta e o fluxo",
  nota: "Notas",
};

interface Evento {
  t: string; // ISO
  ev: "abrir" | "etapa" | "fechar" | "nota" | "medida" | "cmd";
  [k: string]: any;
}

const args = process.argv.slice(2);
// opcoes so antes do "--" (o que vem depois e o comando de cmd)
const flag = (n: string) => {
  const fim = args.indexOf("--");
  const i = args.indexOf(`--${n}`);
  if (i < 0 || (fim >= 0 && i > fim)) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const pasta = flag("dir") ?? process.env.DIARIO;
if (!pasta) throw new Error("diga a pasta: DIARIO=<pasta> ou --dir <pasta>");
const dir = resolve(pasta);
const arq = join(dir, "diario.jsonl");
const ler = (): Evento[] => (existsSync(arq) ? readFileSync(arq, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const gravar = (e: Omit<Evento, "t">) => {
  const ev = { t: new Date().toISOString(), ...e, ...(trilha ? { trilha } : {}) } as Evento;
  appendFileSync(arq, JSON.stringify(ev) + "\n");
  return ev;
};
// etapa aberta da trilha: a ultima "etapa" sem "fechar" depois
const aberta = (todos: Evento[]) => {
  const evs = todos.filter((e) => (e.trilha ?? undefined) === trilha);
  for (let i = evs.length - 1; i >= 0; i--) {
    if (evs[i].ev === "fechar") return null;
    if (evs[i].ev === "etapa") return evs[i].nome as string;
  }
  return null;
};
const dur = (ms: number) => (ms < 60e3 ? `${(ms / 1e3).toFixed(1)} s` : ms < 3600e3 ? `${(ms / 60e3).toFixed(1)} min` : `${(ms / 3600e3).toFixed(2)} h`);
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { hour12: false });

function md() {
  const evs = ler();
  const titulo = evs.find((e) => e.ev === "abrir")?.titulo ?? "Diário";
  const out: string[] = [`# ${titulo}`, ""];
  if (!evs.length) return writeFileSync(join(dir, "DIARIO.md"), out.join("\n"));
  out.push(`Começo: ${hora(evs[0].t)}. Último registro: ${hora(evs[evs.length - 1].t)}. Gerado de \`diario.jsonl\` por \`tools/diario.ts\`.`, "");
  // etapas com duracao (da abertura ate o fechar ou a proxima etapa)
  const etapas: { nome: string; trilha?: string; ini: string; fim: string | null }[] = [];
  for (const e of evs) {
    if (e.ev === "etapa" || e.ev === "fechar") {
      const ult = etapas.filter((s) => s.trilha === e.trilha).pop();
      if (ult && !ult.fim) ult.fim = e.t;
    }
    if (e.ev === "etapa") etapas.push({ nome: e.nome, trilha: e.trilha, ini: e.t, fim: null });
  }
  const temTrilha = evs.some((e) => e.trilha);
  if (etapas.length) {
    out.push("## Etapas", "", `| etapa |${temTrilha ? " trilha |" : ""} início | duração |`, `|---|${temTrilha ? "---|" : ""}---|---|`);
    for (const s of etapas) out.push(`| ${s.nome} |${temTrilha ? ` ${s.trilha ?? ""} |` : ""} ${hora(s.ini)} | ${s.fim ? dur(+new Date(s.fim) - +new Date(s.ini)) : "em andamento"} |`);
    out.push("");
  }
  const med = evs.filter((e) => e.ev === "medida");
  if (med.length) {
    out.push("## Medidas", "", "| etapa | medida | valor | obs |", "|---|---|---|---|");
    for (const m of med) out.push(`| ${m.etapa ?? ""} | ${m.nome} | ${m.valor}${m.unidade ? " " + m.unidade : ""} | ${m.obs ?? ""} |`);
    out.push("");
  }
  for (const tp of TIPOS.filter((x) => x !== "nota").concat("nota")) {
    const ns = evs.filter((e) => e.ev === "nota" && e.tipo === tp);
    if (!ns.length) continue;
    out.push(`## ${TITULO_TIPO[tp]}`, "");
    for (const n of ns) out.push(`- ${n.texto}${n.etapa ? ` _(${n.etapa})_` : ""}`);
    out.push("");
  }
  const cmds = evs.filter((e) => e.ev === "cmd");
  if (cmds.length) {
    out.push("## Comandos", "", "| etapa | comando | duração | saída |", "|---|---|---|---|");
    for (const c of cmds) out.push(`| ${c.etapa ?? ""} | \`${String(c.cmd).replace(/\|/g, "\\|").slice(0, 120)}\` | ${dur(c.ms)} | ${c.code === 0 ? "ok" : `código ${c.code}`} ([${c.saida}](${c.saida})) |`);
    out.push("");
  }
  out.push("## Linha do tempo", "");
  for (const e of evs) {
    const o = e.ev === "etapa" ? `**etapa:** ${e.nome}` : e.ev === "fechar" ? "fim da etapa" : e.ev === "nota" ? `${e.tipo}: ${e.texto}` : e.ev === "medida" ? `medida ${e.nome} = ${e.valor}${e.unidade ? " " + e.unidade : ""}` : e.ev === "cmd" ? `comando (${dur(e.ms)}, código ${e.code}): \`${String(e.cmd).slice(0, 100)}\`` : `aberto: ${e.titulo}`;
    out.push(`- ${hora(e.t)}${e.trilha ? ` [${e.trilha}]` : ""} ${o}`);
  }
  writeFileSync(join(dir, "DIARIO.md"), out.join("\n") + "\n");
}

const trilha = flag("trilha") ?? process.env.DIARIO_TRILHA ?? undefined;
const tipoFlag = flag("tipo");
const obsFlag = flag("obs");
const [acao, ...resto] = args;
mkdirSync(dir, { recursive: true });
const etapa = aberta(ler()) ?? undefined;
switch (acao) {
  case "abrir":
    if (ler().some((e) => e.ev === "abrir")) throw new Error(`ja existe um diario em ${dir}`);
    gravar({ ev: "abrir", titulo: resto.join(" ") || "Diário" });
    break;
  case "etapa":
    if (!resto.length) throw new Error("etapa <nome>");
    if (etapa) gravar({ ev: "fechar", etapa });
    gravar({ ev: "etapa", nome: resto.join(" ") });
    break;
  case "fechar":
    if (etapa) gravar({ ev: "fechar", etapa });
    break;
  case "nota": {
    const tipo = tipoFlag ?? "nota";
    if (!TIPOS.includes(tipo as any)) throw new Error(`tipo invalido: ${tipo} (${TIPOS.join(", ")})`);
    gravar({ ev: "nota", tipo, texto: resto.join(" "), etapa });
    break;
  }
  case "medida": {
    const obs = obsFlag;
    const [nome, valor, unidade] = resto;
    if (!nome || valor === undefined) throw new Error("medida <nome> <valor> [unidade]");
    const n = Number(valor.replace(",", "."));
    gravar({ ev: "medida", nome, valor: Number.isFinite(n) ? n : valor, unidade, obs, etapa });
    break;
  }
  case "cmd": {
    const i = resto.indexOf("--");
    const cmd = (i >= 0 ? resto.slice(i + 1) : resto).join(" ");
    if (!cmd) throw new Error("cmd -- <comando>");
    mkdirSync(join(dir, "saidas"), { recursive: true });
    const n = ler().filter((e) => e.ev === "cmd").length + 1;
    const saida = `saidas/${String(n).padStart(3, "0")}.txt`;
    const t0 = Date.now();
    const r = spawnSync("bash", ["-lc", cmd], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const ms = Date.now() - t0;
    writeFileSync(join(dir, saida), `$ ${cmd}\n\n${r.stdout ?? ""}${r.stderr ? `\n--- stderr\n${r.stderr}` : ""}`);
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    gravar({ ev: "cmd", cmd, ms, code: r.status ?? -1, saida, etapa });
    md();
    process.exit(r.status ?? 1);
  }
  case "md":
    break;
  default:
    throw new Error("uso: abrir | etapa | nota | medida | cmd | fechar | md (veja o cabecalho)");
}
md();
