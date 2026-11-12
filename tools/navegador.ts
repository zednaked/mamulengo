// Um Chromium sem tela (preso a este processo: setpriv --pdeathsig) e uma aba pelo CDP, para os testes
// e as capturas de um jogo. Nunca abre janela. O WebSocket e o do Node (22 em diante), sem dependencia.
//
//   const aba = await Aba.abrir(540, 960);          CHROMIUM=google-chrome escolhe o navegador
//   await aba.ir(url); await aba.ate("window.pronto"); await aba.toque(270, 800); await aba.foto("a.png");
//   aba.logs (o console e as excecoes da pagina); await aba.fechar();
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class Aba {
  private constructor(
    private chrome: ChildProcess,
    private ws: WebSocket,
    private sessao: string,
    private perfil: string,
    readonly logs: string[],
    private pend: Map<number, (x: any) => void>,
    private id = { n: 0 },
  ) {}
  static async abrir(w: number, h: number): Promise<Aba> {
    const perfil = mkdtempSync(join(process.env.MAMULENGO_TMP ?? tmpdir(), "mamulengo-cr-"));
    const chrome = spawn("setpriv", ["--pdeathsig", "KILL", process.env.CHROMIUM ?? "chromium", "--headless=new", `--user-data-dir=${perfil}`, "--remote-debugging-port=0", "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--window-size=${w},${h}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const url = await new Promise<string>((ok, falha) => {
      let b = "";
      chrome.stderr!.on("data", (d) => {
        b += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(b);
        if (m) ok(m[1]);
      });
      chrome.once("exit", () => falha(new Error("o Chromium nao abriu\n" + b)));
      setTimeout(() => falha(new Error("o Chromium nao abriu em 60 s\n" + b)), 60000).unref();
    });
    const ws = new WebSocket(url);
    await new Promise((ok, falha) => {
      ws.addEventListener("open", ok, { once: true });
      ws.addEventListener("error", () => falha(new Error("sem conexao com o Chromium")), { once: true });
    });
    const pend = new Map<number, (x: any) => void>();
    const logs: string[] = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && pend.has(m.id)) {
        pend.get(m.id)!(m.error ? { erro: m.error } : m.result);
        pend.delete(m.id);
      }
      if (m.method === "Runtime.consoleAPICalled") logs.push((m.params.type === "error" ? "ERRO " : "") + m.params.args.map((a: any) => a.value ?? a.description).join(" "));
      if (m.method === "Runtime.exceptionThrown") logs.push("EXCECAO " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    });
    const a = new Aba(chrome, ws, "", perfil, logs, pend);
    const { targetId } = await a.cmd("Target.createTarget", { url: "about:blank" }, false);
    const { sessionId } = await a.cmd("Target.attachToTarget", { targetId, flatten: true }, false);
    a.sessao = sessionId;
    await a.cmd("Runtime.enable");
    await a.cmd("Page.enable");
    await a.tamanho(w, h);
    return a;
  }
  // um comando do CDP na aba (comSessao = false: no navegador)
  cmd(method: string, params: any = {}, comSessao = true): Promise<any> {
    return new Promise((ok) => {
      const i = ++this.id.n;
      this.pend.set(i, ok);
      this.ws.send(JSON.stringify({ id: i, method, params, ...(comSessao && this.sessao ? { sessionId: this.sessao } : {}) }));
    });
  }
  async tamanho(w: number, h: number) {
    await this.cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  }
  // um script que roda antes de cada pagina (o que o hospedeiro deixa pronto antes do jogo abrir)
  async antes(fonte: string) {
    await this.cmd("Page.addScriptToEvaluateOnNewDocument", { source: fonte });
  }
  async ir(url: string) {
    await this.cmd("Page.navigate", { url });
  }
  async js<T = any>(expr: string): Promise<T> {
    const r = await this.cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r?.result?.value as T;
  }
  // espera a expressao valer na pagina; `tambem` e uma condicao deste lado (um servidor falso, por exemplo)
  async ate(expr: string, segundos = 60, tambem?: () => boolean) {
    const fim = Date.now() + segundos * 1000;
    while (Date.now() < fim) {
      try {
        if ((await this.js(`!!(${expr})`)) && (!tambem || tambem())) return;
      } catch {
        /* a pagina ainda carregando */
      }
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`esperei ${segundos} s por ${expr}\n${this.logs.slice(-8).join("\n")}`);
  }
  async foto(arquivo: string) {
    const r = await this.cmd("Page.captureScreenshot", { format: "png" });
    writeFileSync(arquivo, Buffer.from(r.data, "base64"));
  }
  async toque(x: number, y: number) {
    for (const type of ["mousePressed", "mouseReleased"]) await this.cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
  // apertar e soltar separados (segurar um botao)
  async aperta(x: number, y: number) {
    await this.cmd("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  }
  async solta(x: number, y: number) {
    await this.cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  async fechar() {
    this.ws.close();
    this.chrome.kill("SIGKILL");
    await new Promise((ok) => (this.chrome.exitCode !== null || this.chrome.signalCode !== null ? ok(null) : this.chrome.once("exit", ok)));
    // os processos filhos do Chrome ainda escrevem no perfil por um instante: tenta de novo e, se
    // sobrar, deixa a pasta temporaria (nao e falha do teste)
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(this.perfil, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((ok) => setTimeout(ok, 300));
      }
    }
    console.warn(`(o perfil ${this.perfil} ficou: o Chrome ainda escrevia nele)`);
  }
}
