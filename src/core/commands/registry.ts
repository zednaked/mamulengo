// Registro de comandos. Todo botao da UI e toda chamada do Claude passam por aqui:
// mesmo nome, mesmos parametros (schema zod, que tambem vira a documentacao do MCP).
import { z } from "zod";
import type { Document, Editor } from "../document.ts";

// Acesso a imagens para comandos que precisam de pixels (malha automatica pelo alpha).
// No editor vem do atlas carregado; em Node, dos arquivos.
export interface AssetProvider {
  // imagem original (sem recorte) de uma regiao do atlas, RGBA nao premultiplicado
  image(region: string): Promise<{ width: number; height: number; data: Uint8Array | Uint8ClampedArray } | null>;
  // tamanho original de uma regiao
  region(name: string): { width: number; height: number } | null;
}

export interface CommandCtx {
  doc: Document;
  assets?: AssetProvider;
  // resultado do prepare do comando (dados assincronos lidos antes da transacao)
  prepared?: any;
  // null em comandos de leitura
  e: Editor;
  source: string;
  // chama outro comando dentro da mesma transacao
  run(name: string, args: unknown): any;
}

export interface CommandDef<S extends z.ZodType = z.ZodType> {
  name: string;
  group: "skeleton" | "bone" | "slot" | "attachment" | "skin" | "constraint" | "animation" | "key" | "query" | "view" | "file" | "recipe";
  summary: string;
  params: S;
  readonly?: boolean;
  // rotulo curto para o historico/undo ("bone.set head")
  label?: (p: z.infer<S>) => string;
  // etapa assincrona antes da transacao (ex: ler pixels); o resultado chega em ctx.prepared
  prepare?: (ctx: { doc: Document; assets?: AssetProvider }, p: z.infer<S>) => Promise<any>;
  run(ctx: CommandCtx, p: z.infer<S>): any;
}

const registry = new Map<string, CommandDef<any>>();

export function defineCommand<S extends z.ZodType>(def: CommandDef<S>): CommandDef<S> {
  if (registry.has(def.name)) throw new Error(`comando duplicado: ${def.name}`);
  registry.set(def.name, def);
  return def;
}

export function getCommand(name: string): CommandDef {
  const c = registry.get(name);
  if (!c) {
    const near = [...registry.keys()].filter((k) => k.split(".")[0] === name.split(".")[0] || k.includes(name.split(".").pop()!));
    throw new Error(`comando desconhecido: "${name}".${near.length ? " Parecidos: " + near.join(", ") : ""} Use "help" para a lista.`);
  }
  return c;
}

export function listCommands(): CommandDef[] {
  return [...registry.values()];
}

export class CommandError extends Error {}

function parse(def: CommandDef, args: unknown) {
  const r = def.params.safeParse(args ?? {});
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    throw new CommandError(`${def.name}: parametros invalidos - ${issues}`);
  }
  return r.data;
}

export interface Call {
  cmd: string;
  args?: unknown;
}

// Executa um comando (ou um lote) como uma unica transacao de undo.
export function execute(doc: Document, calls: Call | Call[], source = "ui", label?: string, opts: { merge?: string } = {}, assets?: AssetProvider, prepared?: any[]): any[] {
  const list = Array.isArray(calls) ? calls : [calls];
  const defs = list.map((c) => getCommand(c.cmd));
  const parsed = list.map((c, i) => parse(defs[i], c.args));
  const needs = defs.findIndex((d, i) => d.prepare && prepared?.[i] === undefined);
  if (needs >= 0) throw new CommandError(`${defs[needs].name} precisa de dados assincronos: use executeAsync`);
  if (defs.every((d) => d.readonly)) return defs.map((d, i) => d.run({ doc, e: null as any, source, assets, prepared: prepared?.[i], run: () => { throw new CommandError("comando de leitura nao pode editar"); } }, parsed[i]));
  const txLabel = label ?? defs.map((d, i) => (d.label ? d.label(parsed[i]) : d.name)).join(" + ");
  return doc.edit(txLabel, source, (e) => {
    const ctx: CommandCtx = {
      doc,
      e,
      source,
      assets,
      run: (name, args) => {
        const d = getCommand(name);
        if (d.prepare) throw new CommandError(`${name} nao pode ser chamado de dentro de outro comando`);
        return d.run({ ...ctx, prepared: undefined }, parse(d, args));
      },
    };
    return defs.map((d, i) => {
      try {
        return d.run({ ...ctx, prepared: prepared?.[i] }, parsed[i]);
      } catch (err: any) {
        // diz qual chamada do lote falhou; o lote inteiro e desfeito
        const where = list.length > 1 ? ` (chamada ${i + 1} de ${list.length})` : "";
        throw new CommandError(`${d.name}${where}: ${err?.message ?? err}`);
      }
    });
  }, opts);
}

// Como execute, mas roda antes os prepare assincronos (fora da transacao).
export async function executeAsync(doc: Document, calls: Call | Call[], source = "ui", label?: string, opts: { merge?: string } = {}, assets?: AssetProvider): Promise<any[]> {
  const list = Array.isArray(calls) ? calls : [calls];
  const prepared: any[] = [];
  for (let i = 0; i < list.length; i++) {
    const d = getCommand(list[i].cmd);
    if (!d.prepare) continue;
    try {
      prepared[i] = await d.prepare({ doc, assets }, parse(d, list[i].args));
    } catch (err: any) {
      throw new CommandError(`${d.name}: ${err?.message ?? err}`);
    }
  }
  return execute(doc, list, source, label, opts, assets, prepared);
}

export function describeCommands(group?: string) {
  return listCommands()
    .filter((c) => !group || c.group === group)
    .map((c) => ({ name: c.name, group: c.group, summary: c.summary, readonly: !!c.readonly, params: z.toJSONSchema(c.params, { io: "input", unrepresentable: "any" }) }));
}
