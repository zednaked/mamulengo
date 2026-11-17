// N-030: o Desenhar mora no Atelie. Uma entrada so (teclas 7 e 8, os dois cliques, o inspetor), e o
// que abre vem do modo e da selecao. Precisa de um vite proprio com uma copia de exemplos/pixel (nao
// use o servidor de trabalho):
//   cp -r exemplos/pixel /tmp/x/pixel
//   MAMULENGO_PORT=5398 MAMULENGO_ESTAVEL=1 MAMULENGO_ROOTS=/tmp/x/pixel npx vite --port 5398 --strictPort
//   npx tsx tools/dev/desenhar-no-atelie.mts [porta]
// Casos, cada um numa aba nova:
//   a7, a8  Pose base, so um osso escolhido, tecla 7 / 8: Atelie aberto numa peca nova, ainda na Pose
//           base, sem a barra propria do Desenhar (.drawbar)
//   d       animando, com uma camada de quadros escolhida, tecla 8: Atelie no quadro, como antes
//   c+e+b   "Vetorizar e desenhar" no inspetor: draw.trace e Atelie na peca, com o furo e o painel das
//           formas na barra; ‹ Editor fecha o desenho junto; dois cliques na peca reabrem o Atelie nela
import { Aba } from "../navegador.ts";

const porta = process.argv[2] ?? "5398";
let falhou = false;
const conta = (ok: boolean, msg: string) => {
  if (!ok) falhou = true;
  console.log(`${ok ? "ok   " : "FALHA"} ${msg}`);
};

const ABRE = `
  const a=window.mamulengo, sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await a.open(a.assets.find(x=>x.name==="aventureiro"));
  while(!a.viewer?.pose) await sleep(50);
  await sleep(500);
  const j=()=>a.doc.json;
  const sl=j().slots.find(s=>s.bone!==j().bones[0].name && s.attachment);
  const tecla=async k=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:k,code:k.length===1?"Digit"+k:k,bubbles:true})); await sleep(600);};
  const estado=()=>({atelie:!!a.atelie, layer:a.atelie?.layer??null, quadro:a.drawEdit?!!a.drawEdit.quadro:null, image:a.drawEdit?.image??null, mode:a.mode, slots:j().slots.length, drawbar:document.querySelectorAll(".drawbar").length});
`;

async function caso(js: string) {
  const aba = await Aba.abrir(1200, 800);
  try {
    await aba.ir(`http://localhost:${porta}/`);
    await aba.ate("window.mamulengo && window.mamulengo.assets?.length");
    const r = await aba.cmd("Runtime.evaluate", { expression: `(async()=>{${ABRE}${js}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result?.value;
  } finally {
    await aba.fechar();
  }
}

for (const k of ["7", "8"]) {
  const r = await caso(`a.mode="setup"; a.select({bone:sl.bone}); const s0=j().slots.length; await tecla("${k}"); return {...estado(), s0};`);
  conta(r.atelie && r.quadro === false && r.slots === r.s0 + 1 && r.mode === "setup" && r.drawbar === 0, `(a) Pose base, so um osso, tecla ${k}: atelie=${r.atelie}, quadro=${r.quadro}, peca ${r.image}, partes ${r.s0} -> ${r.slots}, mode=${r.mode}, .drawbar=${r.drawbar}`);
}

{
  const r = await caso(`
    const anim=Object.keys(j().animations)[0]; a.viewer.setAnimation(anim); a.play.animation=anim; a.mode="animate";
    a.run({cmd:"frame.add",args:{layer:"quadros",anim,time:0,bone:j().bones[0].name,width:512,height:512,world:{center:[0,0]},until:1/12}},"camada");
    a.select({slot:"quadros",bone:j().bones[0].name}); a.viewer.seek(0); await sleep(200);
    const s0=j().slots.length; await tecla("8"); return {...estado(), s0};`);
  conta(r.atelie && r.layer === "quadros" && r.quadro === true && r.mode === "animate" && r.slots === r.s0, `(d) animando, camada de quadros escolhida, tecla 8: atelie=${r.atelie}, camada ${r.layer}, quadro=${r.quadro} (${r.image}), mode=${r.mode}`);
}

{
  const r = await caso(`
    a.mode="setup"; a.select({slot:sl.name,bone:sl.bone}); await sleep(300);
    const bt=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Vetorizar e desenhar"));
    if(!bt) return {erro:"sem o botao Vetorizar"};
    bt.click(); for(let i=0;i<200&&!a.atelie;i++) await sleep(50); await sleep(300);
    const c={...estado(), traco:!!j().drawings?.[a.drawEdit?.image??""], furo:!!document.querySelector(".topo button.furo"), formasBt:!!document.querySelector(".topo button.formas")};
    document.querySelector(".topo button.formas")?.click(); await sleep(200);
    c.painel=!!document.querySelector(".painel-formas .dp");
    document.querySelector(".topo button.sair").click(); await sleep(300);
    const fora={atelie:!!a.atelie, drawEdit:!!a.drawEdit};
    a.select({}); await sleep(200);
    const cv=document.querySelector("canvas"), rc=cv.getBoundingClientRect();
    let b=null;
    for(let y=rc.top+10;y<rc.bottom&&!a.atelie;y+=16) for(let x=rc.left+10;x<rc.right&&!a.atelie;x+=16){
      cv.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,clientX:x,clientY:y}));
      if(a.atelie){ await sleep(300); b={...estado()}; }
    }
    return {c, fora, b, peca:c.image};`);
  if (r.erro) conta(false, `(c) ${r.erro}`);
  else {
    const c = r.c;
    conta(c.atelie && c.quadro === false && c.traco && /_v\d*$/.test(c.image ?? "") && c.mode === "setup" && c.drawbar === 0, `(c) Vetorizar e desenhar: draw.trace -> ${c.image}, atelie=${c.atelie}, quadro=${c.quadro}, mode=${c.mode}, .drawbar=${c.drawbar}`);
    conta(c.furo && c.formasBt && c.painel, `(e) a barra do Atelie de peca tem o furo (${c.furo}) e o painel das formas (${c.formasBt}, abre: ${c.painel})`);
    conta(!r.fora.atelie && !r.fora.drawEdit, `‹ Editor fecha o Atelie e o desenho junto: atelie=${r.fora.atelie}, desenho aberto=${r.fora.drawEdit}`);
    const b = r.b;
    conta(!!b && b.atelie && b.quadro === false && b.image === r.peca, `(b) dois cliques na peca desenhada: ${b ? `atelie=${b.atelie}, desenho ${b.image}, quadro=${b.quadro}` : "nada abriu"}`);
  }
}
process.exit(falhou ? 1 : 0);
