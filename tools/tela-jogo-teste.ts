// O joguinho do coelho (exemplos/coelho/jogo) de ponta a ponta, num Chromium sem tela (docs/BACKEND.md
// "Papeis"): sobe o Vite numa porta propria e joga uma rodada inteira com semente fixa e o relogio na
// mao (?manual: o teste anda o jogo a 60 quadros por segundo), em portugues e em arabe, num celular em
// pe. O mouse e de verdade (Input.dispatchMouseEvent) e acha cada botao pela area do papel
// (tela.areaDe): os estados do JOGAR, comecar, pular (o toque "pular" no apertar), pegar moeda
// (o placar), a missao marcada (e o aviso com o texto dela), a pausa (o jogo congela, PAUSA traduzido,
// o JOGAR desligado), o fim (o resultado, o recorde no navegador) e "de novo". Um robo decide os pulos
// pelo que a tela mostra (tela.posicao dos itens). Depois, a mesma rodada num desktop 16:9 (o painel
// ao lado). Grava as capturas (o menu, o jogo rolando, a pausa e o fim; os estados do JOGAR) e, com
// --video, uma rodada inteira em WebM e um GIF curto.
//
//   npx tsx tools/tela-jogo-teste.ts [--porta 5288] [--saida exemplos/coelho/capturas/jogo] [--video]
//   (sem --saida, as capturas vao para uma pasta temporaria)
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import WebSocket from "ws";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const PORTA = Number(opt("porta", "5288"));
// sem --saida as capturas vao para uma pasta temporaria: o teste nao regrava as capturas do repo a
// cada rodada (para atualizar as do exemplo: --saida exemplos/coelho/capturas/jogo)
const SAIDA = resolve(opt("saida", "") || mkdtempSync(join(tmpdir(), "tela-jogo-")));
// a pasta temporaria some no fim (o /tmp tem cota)
if (!opt("saida", "")) process.on("exit", () => rmSync(SAIDA, { recursive: true, force: true }));
const VIDEO = args.includes("--video");
mkdirSync(SAIDA, { recursive: true });

let falhas = 0,
  casos = 0;
const conferir = (ok: boolean, msg: string) => {
  casos++;
  console.log(`${ok ? "ok  " : "FALHA"} ${msg}`);
  if (!ok) falhas++;
};
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// o Vite e o Chromium morrem junto com este processo (setpriv --pdeathsig); o perfil fica no worktree
// (o /tmp tem cota)
const vite = spawn("setpriv", ["--pdeathsig", "KILL", "node", "node_modules/vite/bin/vite.js", "--port", String(PORTA), "--strictPort"], { env: { ...process.env, MAMULENGO_PORT: String(PORTA), NO_COLOR: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise<void>((ok, falha) => {
  let b = "";
  const ver = (d: any) => {
    b += d;
    // no CI o Vite escreve a porta em negrito (codigos de cor no meio do endereco): sem eles
    if (b.replace(/\x1b\[[0-9;]*m/g, "").includes(`:${PORTA}`)) ok();
  };
  vite.stdout!.on("data", ver);
  vite.stderr!.on("data", ver);
  vite.once("exit", () => falha(new Error("o vite nao subiu\n" + b)));
  setTimeout(() => falha(new Error("o vite nao disse a porta em 60 s\n" + b)), 60000).unref();
});
mkdirSync(resolve(".tmp"), { recursive: true });
const prof = mkdtempSync(join(resolve(".tmp"), "tela-jogo-"));
const chrome = spawn("setpriv", ["--pdeathsig", "KILL", process.env.CHROMIUM ?? "chromium", `--user-data-dir=${prof}`, "--remote-debugging-port=0", "--no-first-run", "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise<string>((ok, falha) => {
  let b = "";
  chrome.stderr!.on("data", (d) => {
    b += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(b);
    if (m) ok(m[1]);
  });
  chrome.once("exit", () => falha(new Error("o Chromium nao abriu\n" + b)));
  setTimeout(() => falha(new Error("o Chromium nao abriu em 60 s\n" + b)), 60000).unref();
});
const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.once("open", ok));
let seq = 0;
const pend = new Map<number, (x: any) => void>();
const logs: string[] = [];
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pend.has(m.id)) pend.get(m.id)!(m.error ? { erro: m.error } : m.result);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("ERRO: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const cmd = (method: string, params: any = {}, sessionId?: string): Promise<any> =>
  new Promise((ok) => {
    const id = ++seq;
    pend.set(id, ok);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

// os textos esperados (da tabela do exemplo)
const ESPERA: Record<string, { pausa: string; moedas: (n: string) => string; zero: string }> = {
  pt: { pausa: "PAUSA", moedas: (n) => `${n} moedas`, zero: "0" },
  ar: { pausa: "إيقاف مؤقت", moedas: (n) => `${n} عملات`, zero: "٠" },
  hi: { pausa: "विराम", moedas: (n) => `${n} सिक्के`, zero: "0" },
};

// uma rodada inteira numa janela; devolve o resumo
async function rodada(idioma: string, W: number, H: number, nome: string, o: { estadosJogar?: boolean; video?: string } = {}) {
  const { targetId } = await cmd("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  const js = async (e: string) => (await cmd("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, s))?.result?.value;
  await cmd("Runtime.enable", {}, s);
  await cmd("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false }, s);
  await cmd("Page.navigate", { url: `http://localhost:${PORTA}/exemplos/coelho/jogo/?idioma=${idioma}&semente=7&manual&mudo` }, s);
  const t0 = Date.now();
  while (!(await js("!!window.tela && !!window.jogo"))) {
    if (Date.now() - t0 > 60000 || logs.some((l) => l.startsWith("ERRO"))) throw new Error("a pagina nao abriu\n" + logs.join("\n"));
    await espera(150);
  }
  // o recorde de outra rodada (a mesma origem) sai, e a pagina abre de novo
  if (await js(`localStorage.getItem("coelho.recorde")`)) {
    await js(`localStorage.removeItem("coelho.recorde"); location.reload()`);
    await espera(500);
    while (!(await js("!!window.tela && !!window.jogo"))) await espera(150);
  }
  const quadro = () => js("new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))");
  const passo = async (seg: number) => {
    await js(`window.passo(${seg})`);
  };
  const mouse = (type: string, x: number, y: number) => cmd("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, s);
  const area = async (n: string) => JSON.parse((await js(`JSON.stringify(window.tela.areaDe(${JSON.stringify(n)}))`)) ?? "null");
  const meio = (a: any) => [a.x + a.largura / 2, a.y + a.altura / 2] as [number, number];
  const clicar = async (n: string, passar = 0.15) => {
    const a = await area(n);
    if (!a) return false;
    const [x, y] = meio(a);
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
    await passo(passar);
    return true;
  };
  const estadoBotao = (n: string) => js(`window.tela.botao(${JSON.stringify(n)}).estado`);
  const texto = (n: string) => js(`window.tela.textoMostrado(${JSON.stringify(n)})`);
  const jogo = async () => JSON.parse(await js("JSON.stringify(window.jogo)"));
  const shot = async (arq?: string) => {
    await quadro();
    const r = await cmd("Page.captureScreenshot", { format: "png" }, s);
    const buf = Buffer.from(r.data, "base64");
    if (arq) writeFileSync(join(SAIDA, `${arq}.png`), buf);
    return buf;
  };
  const E = { ...ESPERA[idioma], zero: await js(`(0).toLocaleString(${JSON.stringify(idioma)})`) };
  const rotulo = `[${nome}]`;

  // ---- o menu
  await passo(1);
  const aj = await area("jogar");
  conferir(!!aj && aj.largura > 150 && (await js("window.jogo.fase")) === "menu" && (await texto("placar")) === E.zero, `${rotulo} o menu: o JOGAR pela area do papel (${aj && Math.round(aj.largura)} x ${aj && Math.round(aj.altura)} px), o placar ${await texto("placar")}`);
  conferir((await texto("m1_texto")) === E.moedas(await js(`(3).toLocaleString(${JSON.stringify(idioma)})`)), `${rotulo} a missao com o parametro: ${await texto("m1_texto")}`);
  await shot(`${nome}-menu`);

  // os estados do JOGAR pelo mouse (recortes ampliados, so na primeira rodada)
  if (o.estadosJogar) {
    const caixa = { left: Math.max(0, Math.round(aj.x - 80)), top: Math.max(0, Math.round(aj.y - 70)), width: Math.round(aj.largura + 160), height: Math.round(aj.altura + 140) };
    const recortes: Buffer[] = [];
    const recorte = async (buf: Buffer) => recortes.push(await sharp(buf).extract(caixa).resize(caixa.width * 2, caixa.height * 2, { kernel: "lanczos3" }).png().toBuffer());
    const [mx, my] = meio(aj);
    await recorte(await shot());
    await mouse("mouseMoved", mx, my);
    await passo(0.3);
    conferir((await estadoBotao("jogar")) === "em_cima", `${rotulo} o mouse em cima do JOGAR: em_cima`);
    await recorte(await shot());
    await mouse("mousePressed", mx, my);
    await passo(0.3);
    conferir((await estadoBotao("jogar")) === "apertado" && (await js("window.jogo.fase")) === "menu", `${rotulo} apertado (ainda sem comecar)`);
    await recorte(await shot());
    await mouse("mouseMoved", 20, my);
    await mouse("mouseReleased", 20, my);
    await passo(0.3);
    conferir((await js("window.jogo.fase")) === "menu", `${rotulo} soltar fora do JOGAR nao comeca`);
    // a pausa no menu desliga o JOGAR
    await clicar("pausa", 0.4);
    conferir((await js("window.jogo.pausado")) === true && (await estadoBotao("jogar")) === "desligado" && (await texto("pausa_texto")) === E.pausa, `${rotulo} a pausa no menu desliga o JOGAR e mostra ${await texto("pausa_texto")}`);
    await recorte(await shot());
    await clicar("jogar", 0.2);
    conferir((await js("window.jogo.fase")) === "menu", `${rotulo} desligado, o JOGAR nao comeca`);
    await clicar("pausa", 0.4);
    conferir((await js("window.jogo.pausado")) === false && (await estadoBotao("jogar")) === "normal", `${rotulo} a pausa de novo religa o JOGAR`);
    const rotulos = ["normal", "em cima", "apertado", "desligado"];
    const [cw, ch] = [caixa.width * 2, caixa.height * 2];
    await sharp({ create: { width: cw * 4 + 30, height: ch + 56, channels: 4, background: "#10131c" } })
      .composite([
        ...recortes.map((r, i) => ({ input: r, left: i * (cw + 10), top: 56 })),
        { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw * 4 + 30}" height="56">${rotulos.map((t, i) => `<text x="${i * (cw + 10) + cw / 2}" y="40" font-family="sans-serif" font-size="30" fill="#e8eaf2" text-anchor="middle">${t}</text>`).join("")}</svg>`), left: 0, top: 0 },
      ])
      .png()
      .toFile(join(SAIDA, "estados-jogar.png"));
  }

  // ---- comecar
  await clicar("jogar", 0.1);
  let j = await jogo();
  conferir(j.fase === "jogando" && j.moedas === 0, `${rotulo} JOGAR comeca a rodada`);
  await passo(0.4);
  conferir((await area("jogar")) === null, `${rotulo} o JOGAR saiu da tela (sem area)`);

  // ---- a rodada, com o robo: pula quando um item do alto (ou um espinho) chega perto do coelho.
  // O primeiro pulo e o mouse de verdade no meio da tela (o toque "pular"); os outros tambem
  const robo = `(() => {
    const t = window.tela, c = t.posicao("corpo")[0];
    for (const it of window.itens) {
      if (it.fase !== "passando") continue;
      const dx = t.posicao(it.nome)[0] - c;
      if (it.alto && dx > 70 && dx < 120) return true;
      if (it.tipo === "espinho" && dx > 85 && dx < 125) return true;
    }
    return false;
  })()`;
  const [cx, cy] = [W / 2, H * 0.62];
  let pulouVisto = false,
    pegouVisto = false,
    missaoVista = false,
    pausaVista = false,
    quadros = 0,
    vidN = 0;
  const marcas = { pausa: 0, fim: 0 }; // onde a pausa e o fim comecam no video (o GIF corta por elas)
  const vid = o.video ? join(SAIDA, `.video-${nome}`) : "";
  if (vid) mkdirSync(vid, { recursive: true });
  const grava = async () => {
    if (!vid) return;
    const r = await cmd("Page.captureScreenshot", { format: "jpeg", quality: 85 }, s);
    writeFileSync(join(vid, `${String(vidN++).padStart(5, "0")}.jpg`), Buffer.from(r.data, "base64"));
  };
  while ((await js("window.jogo.fase")) === "jogando") {
    if ((await js(robo)) && !(await js("window.jogo.noAr"))) {
      const antes = (await jogo()).pulos;
      await mouse("mousePressed", cx, cy);
      await mouse("mouseReleased", cx, cy);
      if (!pulouVisto) {
        const y0 = (await js(`window.tela.posicao("corpo")[1]`)) as number;
        await passo(0.3);
        const y1 = (await js(`window.tela.posicao("corpo")[1]`)) as number;
        conferir((await jogo()).pulos === antes + 1 && y1 - y0 > 150, `${rotulo} tocar a tela pula (o toque no apertar): o corpo sobe ${Math.round(y1 - y0)}`);
        await shot(`${nome}-pulando`);
        pulouVisto = true;
      }
    }
    await passo(1 / 30);
    quadros++;
    await grava();
    j = await jogo();
    if (!pegouVisto && j.pegas > 0) {
      pegouVisto = true;
      conferir((await texto("placar")) === (await js(`(${j.moedas}).toLocaleString(${JSON.stringify(idioma)})`)), `${rotulo} pegou a primeira moeda em ${j.tempo.toFixed(2)} s: o placar ${await texto("placar")}`);
    }
    if (!missaoVista && j.missoes[0]) {
      missaoVista = true;
      await passo(0.35);
      const aviso = await texto("aviso");
      conferir(aviso === (await texto("m1_texto")) && j.pegas >= 3, `${rotulo} a missao das 3 moedas marcou sozinha e o aviso mostra "${aviso}"`);
      await shot(`${nome}-missao`);
    }
    // a pausa no meio da rodada: o jogo congela (o relogio e os itens), PAUSA aparece, e volta
    if (!pausaVista && j.tempo > 12 && (await js(`window.itens.some((i) => i.fase === "passando")`))) {
      pausaVista = true;
      await clicar("pausa", 0.05);
      const congelado = JSON.parse(await js(`JSON.stringify([window.jogo.tempo, window.itens.filter(i => i.fase === "passando").map(i => window.tela.posicao(i.nome)[0])])`));
      await passo(1.5);
      const depois = JSON.parse(await js(`JSON.stringify([window.jogo.tempo, window.itens.filter(i => i.fase === "passando").map(i => window.tela.posicao(i.nome)[0])])`));
      conferir((await js("window.jogo.pausado")) === true && congelado[0] === depois[0] && JSON.stringify(congelado[1]) === JSON.stringify(depois[1]) && congelado[1].length > 0, `${rotulo} a pausa congela o relogio (${congelado[0].toFixed(2)} s) e ${congelado[1].length} itens no lugar`);
      conferir((await texto("pausa_texto")) === E.pausa && (await js("window.jogo.pulos")) === j.pulos, `${rotulo} PAUSA na tela (${await texto("pausa_texto")}); tocar a tela nao pula`);
      await mouse("mousePressed", cx, cy);
      await mouse("mouseReleased", cx, cy);
      await shot(`${nome}-pausa`);
      marcas.pausa = vidN;
      for (let i = 0; i < 15; i++) await grava();
      await clicar("pausa", 0.4);
      const solto = JSON.parse(await js(`JSON.stringify(window.jogo)`));
      conferir(!solto.pausado && solto.pulos === j.pulos && solto.tempo > depois[0], `${rotulo} a pausa de novo solta o jogo (o toque durante a pausa nao pulou)`);
    }
    if (quadros === 240) await shot(`${nome}-jogando`);
  }

  // ---- o fim
  j = await jogo();
  marcas.fim = vidN;
  conferir(j.fase === "fim" && j.tempo >= 30, `${rotulo} a rodada acaba em 30 s: ${j.moedas} moedas, ${j.pegas} pegas, ${j.pulos} pulos, cenoura ${j.cenoura}, missoes ${JSON.stringify(j.missoes)}`);
  for (let i = 0; i < 60; i++) {
    await passo(1 / 30);
    await grava();
  }
  const n = await js(`(${j.moedas}).toLocaleString(${JSON.stringify(idioma)})`);
  conferir((await texto("resultado")) === E.moedas(n), `${rotulo} o resultado conta ate "${await texto("resultado")}"`);
  conferir((await js(`localStorage.getItem("coelho.recorde")`)) === String(j.moedas) && j.novoRecorde && (await texto("recorde")).includes(n), `${rotulo} o recorde guardado no navegador: ${await texto("recorde")}`);
  conferir((await estadoBotao("pausa")) === "desligado" && !!(await area("denovo")), `${rotulo} no fim a pausa desliga e o "de novo" aparece`);
  await shot(`${nome}-fim`);
  for (let i = 0; i < 30; i++) {
    await passo(1 / 30);
    await grava();
  }

  // ---- de novo
  await clicar("denovo", 0.6);
  const k = await jogo();
  conferir(k.fase === "jogando" && k.moedas === 0 && k.missoes.every((m: boolean) => !m) && (await texto("placar")) === E.zero && (await estadoBotao("pausa")) === "normal", `${rotulo} "de novo" recomeca: placar ${await texto("placar")}, missoes desmarcadas, a pausa religada`);
  await passo(0.3);
  conferir((await area("denovo")) === null, `${rotulo} o resultado saiu (o "de novo" sem area)`);
  await cmd("Target.closeTarget", { targetId });
  return { vid, vidN, marcas };
}

let video: { vid: string; vidN: number; marcas: { pausa: number; fim: number } } | null = null;
try {
  const r = await rodada("pt", 1080, 1920, "celular-pt", { estadosJogar: true, video: VIDEO ? "sim" : undefined });
  if (VIDEO) video = r;
  await rodada("ar", 1080, 1920, "celular-ar");
  await rodada("pt", 1920, 1080, "desktop-pt");
  await rodada("hi", 1920, 1080, "desktop-hi");
} finally {
  ws.close();
  chrome.kill("SIGKILL");
  vite.kill("SIGKILL");
  await espera(300);
  rmSync(prof, { recursive: true, force: true, maxRetries: 5 });
}
// o video: a rodada inteira (30 quadros por segundo de jogo) em WebM, e um GIF curto com o comeco
// (9 s), a pausa e o fim
if (video) {
  const destino = resolve("exemplos/coelho");
  const ff = (a: string[]) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: "inherit" });
  ff(["-framerate", "30", "-i", join(video.vid, "%05d.jpg"), "-vf", "scale=540:-2", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1", join(destino, "coelho.webm")]);
  ff(["-framerate", "30", "-i", join(video.vid, "%05d.jpg"), "-vf", `select='between(n\\,0\\,269)+between(n\\,${video.marcas.pausa - 20}\\,${video.marcas.pausa + 39})+between(n\\,${video.marcas.fim - 8}\\,${video.vidN - 1})',setpts=N/30/TB,fps=15,` + "scale=300:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", join(destino, "coelho.gif")]);
  rmSync(video.vid, { recursive: true, force: true });
  console.log(`video: ${video.vidN} quadros -> exemplos/coelho/coelho.webm e coelho.gif`);
}
const erros = logs.filter((l) => l.startsWith("ERRO"));
if (erros.length) console.log(erros.join("\n"));
console.log(`${casos - falhas} de ${casos} ok`);
if (falhas || erros.length) process.exit(1);
