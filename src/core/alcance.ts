// IK em um clique (N-028, parte 2): o "Alcançar (IK)" do inspetor. Aqui so a conta, sem tela (o
// editor chama em src/app/Inspector.svelte e roda os comandos num passo de desfazer):
// - o alvo nasce na ponta do osso escolhido, na Pose base, filho da raiz (mover o alvo nao arrasta a
//   cadeia junto);
// - a cadeia sao os 2 ossos da ponta [pai, osso] quando o pai nao e a raiz (numa cadeia cortada em 3
//   ou mais, so os dois ultimos dobram e o comeco fica onde esta);
// - quando o pai e a raiz (a peca original presa ao root e um corte so), a IK e de 1 osso [osso]: ele
//   aponta para o alvo, em vez de recusar.
import { constraints } from "./model.ts";
import { boneWorld, skeletonAt } from "./pose.ts";

export interface PlanoDoAlcance {
  alvo: string;
  ik: string;
  ossos: string[];
  ponta: [number, number];
  comandos: { cmd: string; args: any }[];
  rotulo: string;
}

function nomeLivre(json: any, base: string): string {
  const usado = (n: string) => (json.bones ?? []).some((b: any) => b.name === n) || constraints(json).some((x) => x.c.name === n);
  for (let i = 1; ; i++) {
    const n = i === 1 ? base : `${base}${i}`;
    if (!usado(n)) return n;
  }
}

// devolve o plano, ou uma string com o motivo da recusa
export function planoDoAlcance(json: any, bone: string): PlanoDoAlcance | string {
  const bones: any[] = json.bones ?? [];
  const b = bones.find((x) => x.name === bone);
  if (!b) return `o osso ${bone} nao existe`;
  if (!b.parent) return "Alcançar precisa de um osso que não seja a raiz.";
  const pai = bones.find((x) => x.name === b.parent);
  const ossos = pai?.parent ? [pai.name, bone] : [bone];
  const W = boneWorld(skeletonAt(json, null, 0), bone);
  const len = b.length || 20;
  const ponta: [number, number] = [W.x + W.a * len, W.y + W.c * len];
  const alvo = nomeLivre(json, `${bone}_alvo`);
  const ik = nomeLivre(json, `${bone}_ik`);
  return {
    alvo,
    ik,
    ossos,
    ponta,
    comandos: [
      { cmd: "bone.add", args: { name: alvo, parent: bones[0].name, at: ponta, color: "ff3f00ff" } },
      { cmd: "ik.create", args: { name: ik, bones: ossos, target: alvo } },
    ],
    rotulo: `IK em ${ossos.join(" + ")}`,
  };
}
