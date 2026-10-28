// query.estilo: mede uma animacao com a regua do estilo da casa (src/core/estilo.ts) e
// compara com a faixa das animacoes prontas do mesmo tipo e papel (estilo-casa.json,
// gerado por tools/estilo.ts). Diz onde ficou timida ou exagerada antes de mostrar.
import { z } from "zod";
import { defineCommand } from "./registry.ts";
import { requireAnimation } from "../model.ts";
import { compararEstilo, medir, papeisDaCasa, papel as papelDe, tipo as tipoDe } from "../estilo.ts";

defineCommand({
  name: "query.estilo",
  group: "query",
  readonly: true,
  summary:
    "Mede a animacao com a regua do estilo da casa (docs/ESTILO.md) e compara com a faixa das animacoes prontas do mesmo tipo e papel: duracao, quanto o corpo anda e gira, amassa, deform de malha, batidas, pausas, trocas. papel/tipo inferidos do nome se omitidos (papeis: idle, quebra de idle, ganho/acao, acao longa, perda, queda, entrada, saida, botao; tipos: personagem, simbolo, popup/placa, efeito, interface/mecanico, vegetacao, cenario).",
  params: z.object({ anim: z.string(), papel: z.string().optional(), tipo: z.string().optional() }),
  run({ doc }, p) {
    requireAnimation(doc.json, p.anim);
    const tipo = p.tipo ?? tipoDe(doc.file?.skeleton?.split("/").pop() ?? "", doc.json);
    const m: any = medir("", doc.json, p.anim);
    const papel = p.papel ?? papelDe(p.anim, m.dur);
    // sem bounds no cabecalho a altura vira 500 e as medidas em % da altura saem erradas
    const semBounds = !(doc.json.skeleton?.height > 0);
    const c = compararEstilo(m, tipo, papel);
    if (!c) return { tipo, papel, aviso: `sem referencia da casa para ${tipo} / ${papel}. ${papeisDaCasa().length ? `Existem: ${papeisDaCasa().join(", ")}` : "A casa esta vazia: gere com npx tsx tools/estilo.ts <seus jogos> --resumo src/core/estilo-casa.json"}` };
    const { linhas, fora, ref } = c;
    return {
      tipo,
      papel,
      referencia: `${ref.assets} assets da casa`,
      fora_da_faixa: fora,
      medidas: linhas,
      nota: fora ? "fora da faixa sem motivo e defeito: abaixo costuma ser animacao timida (pouca amplitude, pouco ritmo, pose parada)" : "dentro do estilo da casa",
      ...(semBounds ? { aviso: "o cabecalho nao tem bounds (skeleton.height): as medidas em % da altura usam 500 e podem estar infladas ou murchas. Rode skeleton.bounds antes de medir." } : {}),
      como_medimos: "corpo: centro de massa dos ossos; batidas: picos de movimento (30 fps) acima de 35% do maior pico; pausa: maior trecho com movimento abaixo de 8% do maior pico (ossos; deform e transparencia nao contam); deform: maior deslocamento de vertice nas chaves. Vegetacao e tecido se movem por deform: o corpo quase parado e normal ali.",
    };
  },
});
