// O elenco da demo: os seis personagens CC0 de tests/boneco (arte de Kenney), na ordem do
// palco. A lista e estatica (a pagina nao tem servidor). `rotulos`: o nome das animacoes na
// interface; `laco`: as que tocam em loop (as outras tocam uma vez e voltam ao idle).
export type Personagem = {
  pasta: string;
  nome: { en: string; pt: string };
  laco: string[];
  // de onde vem a arte (pacote do Kenney)
  arte: string;
};

export const ELENCO: Personagem[] = [
  { pasta: "robo", nome: { en: "Robot", pt: "Robô" }, laco: ["idle"], arte: "Toon Characters" },
  { pasta: "zumbi", nome: { en: "Zombie", pt: "Zumbi" }, laco: ["idle", "anda"], arte: "Toon Characters" },
  { pasta: "monstro2", nome: { en: "Cyclops", pt: "Ciclope" }, laco: ["idle"], arte: "Monster Builder" },
  { pasta: "aventureiro", nome: { en: "Adventurer", pt: "Aventureiro" }, laco: ["idle"], arte: "Toon Characters" },
  { pasta: "monstro", nome: { en: "Monster", pt: "Monstro" }, laco: ["idle"], arte: "Monster Builder" },
  { pasta: "pessoa", nome: { en: "Person", pt: "Pessoa" }, laco: ["idle"], arte: "Modular Characters" },
];

export const ROTULOS: Record<string, { en: string; pt: string }> = {
  idle: { en: "idle", pt: "parado" },
  ganhou: { en: "win", pt: "ganhou" },
  anda: { en: "walk", pt: "anda" },
  susto: { en: "scare", pt: "susto" },
  acenar: { en: "wave", pt: "acenar" },
};
