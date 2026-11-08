// So a ponte (a mesma do servidor do editor, server/plugin.ts), para o editor pelo navegador
// (build:navegador, sem servidor): o MCP e o tools/ponte.ts ligam aqui como ligariam no npm run
// dev, e o editor liga com ?ponte=<porta> no endereco (fica lembrado; ?ponte=0 desliga).
//
//   npx tsx tools/ponte-servidor.ts [porta = 5199]
//
// So aceita conexao da propria maquina (127.0.0.1), e de pagina so as do Mamulengo (a propria
// maquina e o GitHub Pages; MAMULENGO_ORIGENS acrescenta outras, separadas por virgula): sem
// isso, qualquer site aberto no navegador poderia ligar na ponte e mexer no editor. O MCP e as
// ferramentas (node) nao mandam Origin e passam. A pagina em https pode ligar em ws://127.0.0.1
// (o Chromium trata a propria maquina como segura).
import http from "node:http";
import { bridge, BRIDGE_PATH } from "../server/plugin.ts";

const porta = Number(process.argv[2] ?? process.env.MAMULENGO_PORT ?? 5199);
const servidor = http.createServer((_, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(`ponte do Mamulengo: ws://127.0.0.1:${porta}${BRIDGE_PATH}\n`);
});
const ORIGENS = ["https://zednaked.github.io", ...(process.env.MAMULENGO_ORIGENS ?? "").split(",").filter(Boolean)];
const permitida = (o: string | undefined) => !o || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) || ORIGENS.includes(o);
// a ponte so ve os pedidos de origem permitida (o resto e recusado antes)
const filtrado = {
  on(ev: string, f: (...a: any[]) => void) {
    if (ev !== "upgrade") return servidor.on(ev, f);
    return servidor.on("upgrade", (req: http.IncomingMessage, socket: any, head: Buffer) => {
      if (permitida(req.headers.origin)) return f(req, socket, head);
      console.log(`recusei uma pagina de ${req.headers.origin}`);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
  },
};
bridge({ httpServer: filtrado });
servidor.listen(porta, "127.0.0.1", () => console.log(`ponte do Mamulengo em ws://127.0.0.1:${porta}${BRIDGE_PATH} (abra o editor com ?ponte=${porta})`));
