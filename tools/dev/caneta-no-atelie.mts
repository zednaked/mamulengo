// N-031: no Atelie, nenhum botao da caneta chega as ferramentas de osso (girar, mover).
// Precisa de um vite proprio com uma copia de exemplos/pixel (nao use o servidor de trabalho):
//   cp -r exemplos/pixel /tmp/x/pixel
//   MAMULENGO_PORT=5397 MAMULENGO_ESTAVEL=1 MAMULENGO_ROOTS=/tmp/x/pixel npx vite --port 5397 --strictPort
//   npx tsx tools/dev/caneta-no-atelie.mts [porta]
// Abre o aventureiro, Girar escolhido, tecla 8 com so um osso escolhido (sem desenho aberto) e dispara
// downs de caneta com (button, buttons) = (5,32) ponta borracha, (2,2) botao lateral, (0,1) ponta.
// Grava a pose de todos os ossos a cada evento e a cada quadro: tem de ficar uma so, e a selecao igual.
// Depois repete com o desenho ja aberto (Atelie numa peca), caminho em que o drawDown pega tudo.
import { Aba } from "../navegador.ts";

const porta = process.argv[2] ?? "5397";
let falhou = false;
// cada caso numa aba nova: o Atelie aberto do caso anterior nao vaza para o seguinte
for (const comDesenho of [false, true]) {
  const aba = await Aba.abrir(1200, 800);
  try {
    await aba.ir(`http://localhost:${porta}/`);
    await aba.ate("window.mamulengo && window.mamulengo.assets?.length");
    const ev = async (js: string) => {
      const r = await aba.cmd("Runtime.evaluate", {
        expression: js,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
      return r.result?.value;
    };
    const caso = (comDesenho: boolean) =>
      ev(`(async()=>{
    const a=window.mamulengo, sleep=ms=>new Promise(r=>setTimeout(r,ms));
    await a.open(a.assets.find(x=>x.name==="aventureiro"));
    while(!a.viewer?.pose) await sleep(50);
    await sleep(500);
    const v=a.viewer, cv=document.querySelector("canvas");
    const sl=a.doc.json.slots.find(s=>s.bone!==a.doc.json.bones[0].name && s.attachment);
    a.select(${comDesenho} ? {bone:sl.bone, slot:sl.name} : {bone:sl.bone}); a.tool="rotate";
    window.dispatchEvent(new KeyboardEvent("keydown",{key:"8",code:"Digit8",bubbles:true}));
    await sleep(500);
    const pose=()=>v.pose.bones.map(x=>x.data?.name+":"+[x.worldX,x.worldY,x.a,x.b].map(n=>n.toFixed(2)).join(",")).join("|");
    const r=cv.getBoundingClientRect(), p={x:r.left+r.width/2, y:r.top+r.height/2};
    const out=[];
    for (const [button,buttons] of [[5,32],[2,2],[0,1]]) {
      if (!${comDesenho} && a.drawEdit) { a.select({bone:sl.bone}); }
      const de0=!!a.drawEdit, sel0=a.selection.bone, seen=new Set([pose()]); let on=true;
      const raf=()=>{seen.add(pose()); if(on) requestAnimationFrame(raf)}; requestAnimationFrame(raf);
      const mk=(t,x,y,bt,bs)=>cv.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:1,pointerType:"pen",isPrimary:true,clientX:x,clientY:y,button:bt,buttons:bs,pressure:bs?0.5:0}));
      mk("pointerover",p.x+40,p.y,-1,0); mk("pointermove",p.x+40,p.y,-1,buttons); seen.add(pose());
      mk("pointerdown",p.x+40,p.y,button,buttons); seen.add(pose());
      for(let i=1;i<=10;i++){ mk("pointermove",p.x+40-i*3,p.y+i*8,-1,buttons); seen.add(pose()); await sleep(16); }
      mk("pointerup",p.x+10,p.y+80,button,0); seen.add(pose()); await sleep(100); on=false;
      out.push({de0,button,buttons,poses:seen.size,sel0,sel:a.selection.bone,atelie:!!a.atelie,drawEdit:!!a.drawEdit});
    }
    return out;})()`);
    {
      for (const r of await caso(comDesenho)) {
        const ok = r.poses === 1 && r.sel === r.sel0 && r.atelie;
        if (!ok) falhou = true;
        console.log(
          `${ok ? "ok   " : "FALHA"} ${comDesenho ? "com desenho" : "sem desenho"} button=${r.button} buttons=${r.buttons}: ${r.poses} pose(s), selecao ${r.sel0} -> ${r.sel}, desenho aberto: ${r.de0}`,
        );
  
      }
    }
  } finally {
    await aba.fechar();
  }
}
process.exit(falhou ? 1 : 0);
