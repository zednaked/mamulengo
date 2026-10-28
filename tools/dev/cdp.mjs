// Mini cliente do Chrome DevTools Protocol para testar a UI com mouse/teclado de verdade
// num Chromium headless:  node tools/dev/cdp.mjs <porta-debug> <comandos.json>
// mini cliente CDP: node cdp.mjs <porta> <comandos.json>
// comandos: [{shot: arquivo}, {click: [x,y]}, {drag: [[x1,y1],[x2,y2]], steps}, {key: "4"}, {eval: "js"}, {wait: ms},
//            {move: [x,y]}, {wheel: [x,y,dy], dx}]
// teclas com nome (Delete, Escape, Enter, setas...) tambem valem em key; code opcional (ex {key: " ", code: "Space"})
// mods soma Alt=1 Ctrl=2 Meta=4 Shift=8 (click, drag, key, wheel); button: "middle" em drag
import { writeFileSync, readFileSync } from "node:fs";
const [port, file] = process.argv.slice(2);
const cmds = JSON.parse(readFileSync(file, "utf8"));
const tabs = await (await fetch(`http://localhost:${port}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const send = (method, params = {}) => new Promise((ok) => { const my = ++id; const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener("message", h); ok(m.result ?? m.error); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: my, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mods = 0, button = "left";
const mouse = (type, x, y, buttons = button === "middle" ? 4 : 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : button, buttons, clickCount: 1, modifiers: mods });
const VK = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, " ": 32 };
for (const c of cmds) {
  mods = c.mods ?? 0;
  button = c.button ?? "left";
  if (c.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(c.shot, Buffer.from(r.data, "base64")); }
  if (c.move) await mouse("mouseMoved", ...c.move, 0);
  if (c.click) { await mouse("mouseMoved", ...c.click, 0); await mouse("mousePressed", ...c.click); await mouse("mouseReleased", ...c.click); }
  if (c.drag) { const [[x1, y1], [x2, y2]] = c.drag; const n = c.steps ?? 10; await mouse("mouseMoved", x1, y1, 0); await mouse("mousePressed", x1, y1); for (let i = 1; i <= n; i++) { await mouse("mouseMoved", x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n); await sleep(16); } await mouse("mouseReleased", x2, y2); }
  if (c.key) {
    const named = c.key.length > 1;
    const vk = c.vk ?? (named || c.key === " " ? VK[c.key] ?? 0 : c.key.toUpperCase().charCodeAt(0));
    const code = c.code ?? (named ? c.key : /[a-z]/i.test(c.key) ? "Key" + c.key.toUpperCase() : /[0-9]/.test(c.key) ? "Digit" + c.key : c.key === " " ? "Space" : "");
    // com Ctrl/Alt/Meta ou tecla com nome nao ha texto (rawKeyDown), senao o Chrome so digita
    const plain = !named && !(mods & 7);
    await send("Input.dispatchKeyEvent", { type: plain ? "keyDown" : "rawKeyDown", key: c.key, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(plain ? { text: c.key } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: c.key, code, windowsVirtualKeyCode: vk, modifiers: mods });
  }
  if (c.wheel) { const [x, y, dy] = c.wheel; await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: c.dx ?? 0, deltaY: dy, modifiers: mods }); }
  if (c.eval) { const r = await send("Runtime.evaluate", { expression: c.eval, awaitPromise: true, returnByValue: true }); console.log(JSON.stringify(r.result?.value ?? r)); }
  if (c.wait) await sleep(c.wait);
}
ws.close();
