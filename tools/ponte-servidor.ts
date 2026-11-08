// So a ponte (a mesma do servidor do editor, server/plugin.ts), para o editor pelo navegador
// (build:navegador, sem servidor): o MCP e o tools/ponte.ts ligam aqui como ligariam no npm run
// dev, e o editor liga com ?ponte=<porta> no endereco (fica lembrado; ?ponte=0 desliga).
//
//   npx tsx tools/ponte-servidor.ts [porta = 5199]
//
// So aceita conexao da propria maquina (127.0.0.1). Do lado do navegador, a pagina em https
// pode ligar em ws://127.0.0.1 (o Chromium trata a propria maquina como segura).
import http from "node:http";
import { bridge, BRIDGE_PATH } from "../server/plugin.ts";

const porta = Number(process.argv[2] ?? process.env.MAMULENGO_PORT ?? 5199);
const servidor = http.createServer((_, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(`ponte do Mamulengo: ws://127.0.0.1:${porta}${BRIDGE_PATH}\n`);
});
bridge({ httpServer: servidor });
servidor.listen(porta, "127.0.0.1", () => console.log(`ponte do Mamulengo em ws://127.0.0.1:${porta}${BRIDGE_PATH} (abra o editor com ?ponte=${porta})`));
