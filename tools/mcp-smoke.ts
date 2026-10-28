// Fumaca do servidor MCP pelo protocolo (cliente oficial do SDK, stdio).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/server.ts"] }));
const tools = await client.listTools();
console.log("ferramentas:", tools.tools.map((t) => t.name).join(", "));
const st: any = await client.callTool({ name: "mamulengo_state", arguments: {} });
console.log("state:", st.content[0].text.slice(0, 120).replace(/\n/g, " "));
const help: any = await client.callTool({ name: "mamulengo_help", arguments: {} });
console.log("help:", JSON.parse(help.content[0].text).map((c: any) => c.name).join(" "));
const look: any = await client.callTool({ name: "mamulengo_look", arguments: { time: 0.5 } });
console.log("look:", look.content.map((c: any) => c.type + (c.type === "image" ? `(${c.data.length} b64)` : `: ${c.text}`)).join(" | "));
const bad: any = await client.callTool({ name: "mamulengo_run", arguments: { calls: [{ cmd: "bone.set", args: { bone: "nao_existe", x: 1 } }] } });
console.log("erro amigavel:", bad.isError, bad.content[0].text.slice(0, 110));
await client.close();
