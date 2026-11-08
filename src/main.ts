import { mount } from "svelte";
import "./app.css";
import "./core/commands/index.ts";
import App from "./App.svelte";
import { NAVEGADOR, iniciar } from "./navegador/pagina.ts";

// no editor pelo navegador (build do vite.navegador.config.ts), o service worker que atende o
// /api tem de estar no controle antes do editor pedir qualquer coisa
async function comecar() {
  const alvo = document.getElementById("app")!;
  if (NAVEGADOR) {
    alvo.textContent = "Abrindo o Mamulengo…";
    try {
      await iniciar();
    } catch (e: any) {
      alvo.textContent = String(e?.message ?? e);
      throw e;
    }
    alvo.textContent = "";
  }
  return mount(App, { target: alvo });
}

export default comecar();

// depuracao: estado do app acessivel no console (so em dev)
if (import.meta.env.DEV) import("./app/state.svelte.ts").then((m) => ((window as any).mamulengo = m.app));
