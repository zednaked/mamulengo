// Conexao fixa de um agente com o editor aberto (a mesma ponte do MCP), para trabalhar na
// janela da pessoa e ela ver cada passo. Tres modos:
//
//   npx tsx tools/ponte.ts servir [porta do editor = 5199] [porta local = 5241]
//       fica ligado na ponte como agente e repassa POST {method, params} feitos em
//       http://127.0.0.1:<porta local> (responde {ok, result} ou {ok: false, error})
//   npx tsx tools/ponte.ts chamar <metodo> ['{"params": ...}'] [--porta 5241]
//       uma chamada pelo servir (state, open, view, exec, look, discard, save, ...)
//   npx tsx tools/ponte.ts olhar <saida.png> ['{"times": [0.5]}'] [--porta 5241]
//       o look do editor (folha de contato da animacao) gravado como PNG
//
// O editor precisa estar aberto como editor (nao como espectador: a aba que so acompanha nao
// recebe chamadas). Com o servir no ar, `chamar state` mostra o personagem aberto.
import http from "node:http";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const [modo, ...resto] = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = resto.indexOf(`--${n}`);
  return i >= 0 ? resto.splice(i, 2)[1] : d;
};

async function chamar(porta: number, method: string, params: any = {}) {
  const r = await fetch(`http://127.0.0.1:${porta}`, { method: "POST", body: JSON.stringify({ method, params }) });
  return (await r.json()) as { ok: boolean; result?: any; error?: string };
}

if (modo === "servir") {
  const portaEditor = Number(resto[0] ?? 5199),
    portaLocal = Number(resto[1] ?? 5241);
  let ws: WebSocket;
  let seq = 0;
  let editores = 0;
  const pendentes = new Map<string, (r: any) => void>();
  const liga = () => {
    ws = new WebSocket(`ws://localhost:${portaEditor}/__mamulengo`);
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "hello", role: "agent", name: "claude" }));
      console.log(`ligado ao editor da porta ${portaEditor}`);
    });
    ws.on("message", (raw: any) => {
      const m = JSON.parse(String(raw));
      if (m.t === "status" && m.editors !== editores) console.log(`editores: ${(editores = m.editors)}`);
      if (m.t === "reply") pendentes.get(m.id)?.(m);
    });
    // o servidor do editor reiniciou ou caiu: tenta de novo
    ws.on("close", () => setTimeout(liga, 1000));
    ws.on("error", () => {});
  };
  liga();
  http
    .createServer((req, res) => {
      let corpo = "";
      req.on("data", (c) => (corpo += c));
      req.on("end", () => {
        const { method, params } = JSON.parse(corpo || "{}");
        if (ws.readyState !== WebSocket.OPEN) return res.end(JSON.stringify({ ok: false, error: `sem conexao com o editor na porta ${portaEditor}` }));
        const id = String(++seq);
        const tempo = setTimeout(() => {
          pendentes.delete(id);
          res.end(JSON.stringify({ ok: false, error: "sem resposta do editor em 60 s" }));
        }, 60_000);
        pendentes.set(id, (r) => {
          clearTimeout(tempo);
          pendentes.delete(id);
          res.end(JSON.stringify(r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error }));
        });
        ws.send(JSON.stringify({ t: "call", id, method, params: params ?? {} }));
      });
    })
    .listen(portaLocal, "127.0.0.1", () => console.log(`chamadas em http://127.0.0.1:${portaLocal}`));
} else if (modo === "chamar" && resto[0]) {
  const porta = Number(opt("porta", "5241"));
  const r = await chamar(porta, resto[0], resto[1] ? JSON.parse(resto[1]) : {});
  console.log(JSON.stringify(r.ok ? r.result : { erro: r.error }, null, 1));
  process.exit(r.ok ? 0 : 1);
} else if (modo === "olhar" && resto[0]) {
  const porta = Number(opt("porta", "5241"));
  const r = await chamar(porta, "look", resto[1] ? JSON.parse(resto[1]) : {});
  if (!r.ok) {
    console.error(r.error);
    process.exit(1);
  }
  writeFileSync(resto[0], Buffer.from(r.result.image.split(",")[1], "base64"));
  console.log(`${resto[0]}: ${r.result.size.join(" x ")}, instantes ${r.result.times.join(", ")}`);
} else {
  console.error("uso: tools/ponte.ts servir [porta do editor] [porta local] | chamar <metodo> [json] | olhar <saida.png> [json]");
  process.exit(2);
}
