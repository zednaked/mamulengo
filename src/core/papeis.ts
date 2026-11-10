// Papeis dos elementos (so do Mamulengo; docs/NUCLEO.md "Papeis"): o que cada osso (ou slot de
// texto) e para o codigo do jogo. `roles` no topo do JSON do editor (`papeis` no .boneco):
//
//   { name: "jogar", type: "button", bone: "botao", area: { slot: "botao" },
//     states: { normal: "jogar/normal", hover: "jogar/em_cima", pressed: "jogar/apertado", disabled: "jogar/desligado" },
//     mix: 0.1, track: 10, disabled: false }
//   { name: "fundo", type: "touch", bone: "fundo", area: { box: [0, 0, 700, 1370] } }
//   { name: "placar", type: "text", slot: "pontos" }
//
// Aqui: o modelo no documento, o manifesto (o contrato legivel entre quem monta a tela e quem
// escreve a logica; docs/BACKEND.md "Papeis") e os papeis propostos pelos nomes (o import de PSD:
// `btn_jogar` e um botao, `txt_saldo` um texto do codigo). O teste de toque e os estados pelo
// ponteiro sao do nucleo (nucleo/src/papeis.cpp).
import { animations, bones, descendants, skins, slots } from "./model.ts";

export const ROLE_TYPES = ["button", "touch", "text"] as const;
export type RoleType = (typeof ROLE_TYPES)[number];
export const STATES = ["normal", "hover", "pressed", "disabled"] as const;
export type StateName = (typeof STATES)[number];
// os nomes dos estados no .boneco e na API do jogo
export const NOME_ESTADO: Record<StateName, string> = { normal: "normal", hover: "em_cima", pressed: "apertado", disabled: "desligado" };
export const NOME_TIPO: Record<RoleType, string> = { button: "botao", touch: "toque", text: "texto" };

export type Role = {
  name: string;
  type: RoleType;
  bone?: string;
  slot?: string;
  area?: { slot?: string; box?: number[] };
  states?: Partial<Record<StateName, string>>;
  mix?: number;
  track?: number;
  disabled?: boolean;
};

export const rolesOf = (json: any): Role[] => json.roles ?? [];

// os slots do osso e dos filhos dele (o grupo)
export function groupSlots(json: any, bone: string): string[] {
  const ds = new Set([bone, ...descendants(json, bone)]);
  return slots(json)
    .filter((s) => ds.has(s.bone))
    .map((s) => s.name);
}

// as partes de texto de um slot (nome -> parte)
function textsOf(json: any, slot: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const sk of skins(json)) for (const [n, a] of Object.entries<any>(sk.attachments?.[slot] ?? {})) if (a?.type === "text") out[n] = a;
  return out;
}
const textOf = (json: any, slot: string) => {
  const ts = textsOf(json, slot);
  const setup = slots(json).find((s) => s.name === slot)?.attachment;
  return ts[setup] ?? Object.values(ts)[0] ?? null;
};

// os {nome} de um texto
const params = (s: string) => [...s.matchAll(/\{([A-Za-z_][\w]*)\}/g)].map((m) => m[1]);

// ---- o manifesto: o que o codigo do jogo pode chamar pelo nome, sem abrir o editor

export type Manifesto = {
  boneco: string;
  api: string;
  botoes: { nome: string; osso: string; area: string; estados: Record<string, string | null>; desligado: boolean; trilha: number; codigo: string }[];
  toques: { nome: string; osso: string; area: string; codigo: string }[];
  textos: { nome: string; slot: string; doCodigo: boolean; texto?: string; chave?: string; parametros: string[]; exemplo?: string; codigo: string }[];
  estados: { nome: string; duracao: number; eventos: string[]; codigo: string }[];
  eventos: string[];
  idiomas: string[];
  avisos: string[];
};

const duracao = (a: any): number => {
  let d = 0;
  const visita = (o: any) => {
    if (Array.isArray(o)) {
      for (const k of o) if (k && typeof k === "object" && typeof k.time === "number") d = Math.max(d, k.time);
      for (const k of o) if (k && typeof k === "object") visita(k);
    } else if (o && typeof o === "object") for (const v of Object.values(o)) visita(v);
  };
  visita(a);
  return Math.round(d * 1000) / 1000;
};

export function manifesto(json: any, nome = "tela"): Manifesto {
  const roles = rolesOf(json);
  const tr = json.translations;
  const avisos: string[] = [];
  const area = (r: Role) => (r.area?.box ? `caixa [${r.area.box.join(", ")}] no osso` : r.area?.slot ? `a parte do slot ${r.area.slot}` : `as partes do osso ${r.bone} e dos filhos`);
  let trilha = 10;
  const botoes: Manifesto["botoes"] = [];
  for (const r of roles.filter((r) => r.type === "button")) {
    const t = r.track ?? trilha;
    trilha++;
    const estados = Object.fromEntries(STATES.map((s) => [NOME_ESTADO[s], r.states?.[s] ?? null]));
    if (!r.states?.normal) avisos.push(`o botao ${r.name} nao tem animacao no estado normal`);
    botoes.push({ nome: r.name, osso: r.bone!, area: area(r), estados, desligado: !!r.disabled, trilha: t, codigo: `tela.botao(${JSON.stringify(r.name)}).aoTocar(() => { ... })` });
  }
  const toques = roles.filter((r) => r.type === "touch").map((r) => ({ nome: r.name, osso: r.bone!, area: area(r), codigo: `tela.toque(${JSON.stringify(r.name)}, () => { ... })` }));
  // os textos: todas as partes de texto (pelo slot); as com papel sao as que o jogo troca
  const textos: Manifesto["textos"] = [];
  const doCodigo = new Map(roles.filter((r) => r.type === "text").map((r) => [r.slot!, r.name]));
  for (const s of slots(json)) {
    const a = textOf(json, s.name);
    if (!a) continue;
    const nomeR = doCodigo.get(s.name);
    const ps = new Set<string>(params(a.string ?? ""));
    let exemplo: string | undefined;
    if (a.key && tr?.strings?.[a.key]) {
      for (const v of tr.strings[a.key]) for (const p of params(v ?? "")) ps.add(p);
      exemplo = tr.strings[a.key][0] || undefined;
    }
    const n = nomeR ?? s.name;
    const ex = ps.size ? `{ ${[...ps].map((p) => `${p}: 3`).join(", ")} }` : a.key ? null : `"..."`;
    textos.push({
      nome: n,
      slot: s.name,
      doCodigo: !!nomeR,
      ...(a.key ? { chave: a.key } : { texto: a.string ?? "" }),
      parametros: [...ps],
      ...(exemplo ? { exemplo } : {}),
      codigo: ex ? `tela.texto(${JSON.stringify(n)}, ${ex})` : `tela.texto(${JSON.stringify(n)}, "...")  // troca a chave por texto livre`,
    });
  }
  // os estados da tela: as animacoes que nao sao estado de botao
  const deBotao = new Set(roles.flatMap((r) => Object.values(r.states ?? {})));
  const estados = Object.entries<any>(animations(json))
    .filter(([n]) => !deBotao.has(n))
    .map(([n, a]) => ({
      nome: n,
      duracao: duracao(a),
      eventos: [...new Set<string>((a.events ?? []).map((e: any) => e.name))],
      codigo: `tela.estado(${JSON.stringify(n)})`,
    }));
  for (const r of roles) if (r.type !== "text" && !bones(json).some((b) => b.name === r.bone)) avisos.push(`o papel ${r.name} aponta para o osso ${r.bone}, que nao existe`);
  return {
    boneco: nome,
    api: "src/tela/tela-boneco.ts (docs/BACKEND.md, \"Papeis\"): const tela = await TelaBoneco.abrir(gl, N, desenhista, url); tela.ligarPonteiro(canvas)",
    botoes,
    toques,
    textos,
    estados,
    eventos: Object.keys(json.events ?? {}),
    idiomas: tr?.languages ?? [],
    avisos,
  };
}

// ---- papeis pelos nomes (o import de PSD; docs/NUCLEO.md "Papeis", "Pelo nome")

const PREFIXOS: [RegExp, RoleType][] = [
  [/^(btn|bt|botao|button)[_\-. ](.+)$/i, "button"],
  [/^(toque|area|hit|touch)[_\-. ](.+)$/i, "touch"],
  [/^(txt|texto|text)[_\-. ](.+)$/i, "text"],
];
export function roleFromName(n: string): { type: RoleType; name: string } | null {
  for (const [re, type] of PREFIXOS) {
    const m = n.match(re);
    if (m) return { type, name: m[2] };
  }
  return null;
}

// os papeis que os nomes propoem: ossos btn_/toque_ (botao, area) e slots txt_ com parte de texto
// (ou ossos txt_ com um slot de texto); os que ja tem papel ficam de fora
export function proposeRoles(json: any): Role[] {
  const out: Role[] = [];
  const tem = new Set(rolesOf(json).flatMap((r) => [r.name, r.bone, r.slot].filter(Boolean) as string[]));
  for (const b of bones(json)) {
    const r = roleFromName(b.name);
    if (!r || tem.has(b.name) || tem.has(r.name)) continue;
    if (r.type === "text") {
      const s = groupSlots(json, b.name).find((s) => textOf(json, s));
      if (s && !tem.has(s)) out.push({ name: r.name, type: "text", slot: s });
    } else out.push({ name: r.name, type: r.type, bone: b.name });
  }
  for (const s of slots(json)) {
    const r = roleFromName(s.name);
    if (!r || tem.has(s.name) || tem.has(r.name) || out.some((o) => o.name === r.name)) continue;
    if (r.type === "text" && textOf(json, s.name)) out.push({ name: r.name, type: "text", slot: s.name });
    else if (r.type !== "text") out.push({ name: r.name, type: r.type, bone: s.bone, area: { slot: s.name } });
  }
  return out;
}
