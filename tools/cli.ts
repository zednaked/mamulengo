// CLI da ponte: chama um metodo do editor aberto e imprime o resultado.
//   npx tsx tools/cli.ts open '{"query":"projeto/personagem"}'
//   npx tsx tools/cli.ts look '{"frames":6}' --png /tmp/sheet.png
// Mesmos metodos que o servidor MCP usa (assets, open, help, exec, look, view, state, undo, redo, save, discard).
import WebSocket from "ws";
import { writeFileSync } from "node:fs";

const [method, json, ...rest] = process.argv.slice(2);
if (!method) {
  console.error("uso: cli.ts <metodo> [json] [--png arquivo]");
  process.exit(2);
}
const png = rest[rest.indexOf("--png") + 1] && rest.includes("--png") ? rest[rest.indexOf("--png") + 1] : null;
const port = Number(process.env.MAMULENGO_PORT ?? 5199);
const ws = new WebSocket(`ws://localhost:${port}/__mamulengo`);
const timer = setTimeout(() => {
  console.error("sem resposta em 60s");
  process.exit(1);
}, 60_000);

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "hello", role: "agent", name: "cli" }));
  ws.send(JSON.stringify({ t: "call", id: "1", method, params: json ? JSON.parse(json) : {} }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t !== "reply") return;
  clearTimeout(timer);
  if (!m.ok) {
    // na saida padrao tambem: quem redireciona stderr ainda ve o erro
    console.log("ERRO:", m.error);
    console.error("ERRO:", m.error);
    process.exit(1);
  }
  const r = m.result;
  if (png && r?.image) {
    writeFileSync(png, Buffer.from(String(r.image).split(",")[1], "base64"));
    delete r.image;
    console.log(`imagem -> ${png}`);
  }
  // render devolve varias: arquivo.png -> arquivo-0.png, arquivo-1.png...
  if (png && Array.isArray(r?.images)) {
    r.images = r.images.map((img: string, i: number) => {
      const f = r.images.length === 1 ? png : png.replace(/(\.png)?$/, `-${i}.png`);
      writeFileSync(f, Buffer.from(String(img).split(",")[1], "base64"));
      return f;
    });
  }
  const out = (typeof r === "string" ? r : JSON.stringify(r, null, 1)) + "\n";
  ws.close();
  // sair so depois de escrever tudo: com a saida num pipe, process.exit cortava respostas grandes
  process.stdout.write(out, () => process.exit(0));
});
ws.on("error", (e) => {
  console.error("ponte indisponivel:", e.message);
  process.exit(1);
});
