import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { mamulengo } from "./server/plugin.ts";

// Raizes onde o editor procura projetos Godot: MAMULENGO_ROOTS (separadas por ":"),
// em .env.local (fora do git) ou no ambiente. Padrao: a pasta acima deste repo.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "MAMULENGO_"), ...process.env };
  const roots = (env.MAMULENGO_ROOTS ?? "..").split(":").filter(Boolean);
  return {
    plugins: [svelte(), mamulengo({ roots })],
    // worktrees de agentes (.claude/worktrees) ficam dentro do repo: nao vigiar,
    // senao cada edicao deles recarregaria o editor aberto. So o .claude DESTE repo:
    // o editor rodando de dentro de um worktree (que mora em .claude/) vigia o proprio codigo.
    // MAMULENGO_ESTAVEL=1 (a bancada usa): sem recarga nem reinicio quando o codigo muda,
    // para editar o Mamulengo nao derrubar uma rodada de agente em andamento
    server: {
      port: Number(env.MAMULENGO_PORT ?? 5199),
      strictPort: true,
      hmr: env.MAMULENGO_ESTAVEL ? false : undefined,
      watch: env.MAMULENGO_ESTAVEL ? { ignored: ["**/*"] } : { ignored: [`${resolve(".claude")}/**`] },
    },
  };
});
