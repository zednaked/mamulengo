import { mount } from "svelte";
import "./app.css";
import "./core/commands/index.ts";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app")! });

// depuracao: estado do app acessivel no console (so em dev)
if (import.meta.env.DEV) import("./app/state.svelte.ts").then((m) => ((window as any).mamulengo = m.app));
