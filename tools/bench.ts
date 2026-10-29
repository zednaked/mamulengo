// Desempenho do editor (medido no navegador aberto, pela ponte): reconstrucao por
// edicao, quadro tocando, passo de arrasto, poseAt no fim da animacao, salvar e fps.
//   npx tsx tools/bench.ts <-data.tres>[@animacao] ... [--n 10] [--runtime godot|spine|nucleo,...]
// --runtime mede em cada modo de desenho pedido (separados por virgula); sem ele, no modo atual.
import WebSocket from "ws";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const n = argv.includes("--n") ? Number(argv[argv.indexOf("--n") + 1]) : 10;
const runtimes = argv.includes("--runtime") ? argv[argv.indexOf("--runtime") + 1].split(",") : [undefined];
const targets = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--n" && argv[i - 1] !== "--runtime");
const ws = new WebSocket(`ws://localhost:${process.env.MAMULENGO_PORT ?? 5199}/__mamulengo`);
await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
ws.send(JSON.stringify({ t: "hello", role: "agent", name: "bench" }));
let seq = 0;
const call = (method: string, params: any) =>
  new Promise<any>((ok, fail) => {
    const id = String(++seq);
    const h = (raw: any) => {
      const r = JSON.parse(String(raw));
      if (r.t !== "reply" || r.id !== id) return;
      ws.off("message", h);
      r.ok ? ok(r.result) : fail(new Error(r.error));
    };
    ws.on("message", h);
    ws.send(JSON.stringify({ t: "call", id, method, params }));
  });

const rows: any[] = [];
for (const t of targets) {
  const [file, animation] = t.split("@");
  await call("open", { id: resolve(file) });
  for (const runtime of runtimes) {
    const r = await call("bench", { animation, n, runtime });
    rows.push({ asset: file.split("/").slice(-1)[0].replace("-data.tres", ""), ...r });
  }
}
ws.close();
console.table(rows.map(({ asset, runtime, animation, duration, slots, rebuildMs, poseAtEndMs, poseAtColdMs, frameMs, nucleoPoseMs, nucleoDrawMs, dragStepMs, setupStepMs, rebuildsInDrag, nucleoReloadsInDrag, serializeMs, fps }) => ({ asset, runtime, animation, duration: +duration.toFixed(2), slots, rebuildMs, poseAtEndMs, poseAtColdMs, frameMs, nucleoPoseMs, nucleoDrawMs, dragStepMs, setupStepMs, rebuildsInDrag, nucleoReloadsInDrag, serializeMs, fps })));
