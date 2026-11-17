// N-032: a folha que cresce (a pincelada passou da borda) nao estica a pintura nem rele o atlas.
// Precisa de um vite proprio com uma copia de exemplos/pixel (nao use o servidor de trabalho):
//   cp -r exemplos/pixel /tmp/x/pixel
//   MAMULENGO_PORT=5398 MAMULENGO_ESTAVEL=1 MAMULENGO_ROOTS=/tmp/x/pixel npx vite --port 5398 --strictPort
//   npx tsx tools/dev/folha-cresce.mts [porta] [runtime...]
// Abre o aventureiro, cria uma folha de 100x100 numa peca, pinta metade vermelha e metade azul e faz
// o que o crescerComPincelada (src/app/pintura.ts) faz depois do pintor: pinturas.crescer, o
// paint.grow (right=100) e o atualizarJa. Amostra todo quadro por 2,5 s e exige:
//   (a) nenhum quadro com o anexo ja com 200 de largura e a regiao do VIEWER (v.atlas) ainda velha;
//   (b) nenhum intervalo entre quadros acima de 50 ms;
//   (c) nenhuma busca de /api/texture depois do grow (PerformanceObserver de resource) e nenhuma
//       recarga do atlas inteiro (app.reloadAtlas).
// Roda em cada modo de desenho pedido (padrao: nucleo, spine e godot).
import { Aba } from "../navegador.ts";

const porta = process.argv[2] ?? "5398";
const runtimes = process.argv.length > 3 ? process.argv.slice(3) : ["nucleo", "spine", "godot"];
let falhou = false;
// a folha cresceu com transparente: a peca continua na tela (nada preto nem sumido) e a tinta tambem.
// A divisa vermelho/azul anda uns 5% com o paint.grow, com ou sem esta correcao (medido no caminho
// antigo: 290116/223869 -> 304245/210641), entao a tinta so precisa continuar la
const perto = (a: number, b: number) => Math.abs(a - b) <= Math.max(20, 0.05 * Math.max(a, b));
const pareceIgual = (a: any, b: any) => a.r > 50 && a.b > 50 && b.r > a.r * 0.8 && b.b > a.b * 0.8 && perto(a.o, b.o);
for (const runtime of runtimes) {
  const aba = await Aba.abrir(1200, 800);
  try {
    await aba.ir(`http://localhost:${porta}/`);
    await aba.ate("window.mamulengo && window.mamulengo.assets?.length");
    const r = await aba.cmd("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async()=>{
    const a=window.mamulengo, sleep=ms=>new Promise(r=>setTimeout(r,ms)), raf=()=>new Promise(r=>requestAnimationFrame(r));
    await a.open(a.assets.find(x=>x.name==="aventureiro"));
    while(!a.viewer?.pose) await sleep(50);
    const v=a.viewer;
    if (v.runtime!==${JSON.stringify(runtime)}) await v.setRuntime(${JSON.stringify(runtime)});
    await sleep(300);
    const sl=a.doc.json.slots.find(s=>s.bone!==a.doc.json.bones[0].name && s.attachment);
    if(!a.run({cmd:"draw.create",args:{image:"folhaT",width:100,height:100,slot:sl.name}},"cria")) return {erro:"draw.create falhou: "+a.error};
    await sleep(1500);
    const dd=()=>a.doc.json.drawings?.folhaT;
    const t=a.pinturas.de("folhaT",dd()); const antes=t.g.getImageData(0,0,t.w,t.h);
    t.g.fillStyle="red"; t.g.fillRect(0,0,50,100); t.g.fillStyle="blue"; t.g.fillRect(50,0,50,100);
    const rev0=a.pinturas.registrar("folhaT",dd(),antes,[0,0,100,100]);
    a.run({cmd:"paint.set",args:{image:"folhaT",rev:rev0}},"pinta");
    await sleep(1500);
    const att=()=>{for(const s of a.doc.json.skins) for(const sn in s.attachments) for(const n in s.attachments[sn]){const x=s.attachments[sn][n]; if((x.path??n)==="folhaT") return x.width;} return null};
    // a regiao que o viewer usa (nao o texto do documento): largura na pagina, em pixels
    const regV=()=>{const g=v.atlas?.findRegion("folhaT"); return g? g.width : null};
    // a tela: quantos pixels vermelhos, azuis e fora do fundo (o resto da peca nao pode sumir)
    const tela=async()=>{const im=new Image(); im.src=v.snapshot(); await im.decode(); const c=new OffscreenCanvas(im.width,im.height), g=c.getContext("2d"); g.drawImage(im,0,0); const d=g.getImageData(0,0,c.width,c.height).data; const f=[d[0],d[1],d[2]]; let r=0,b=0,o=0; for(let i=0;i<d.length;i+=4){const R=d[i],G=d[i+1],B=d[i+2]; if(R>200&&G<60&&B<60) r++; else if(B>200&&R<60&&G<60) b++; if(Math.abs(R-f[0])+Math.abs(G-f[1])+Math.abs(B-f[2])>12) o++;} return {r,b,o}};
    const tela0=await tela();
    const busca=[]; const T0=performance.now();
    const po=new PerformanceObserver(l=>{for(const e of l.getEntries()) if(e.name.includes("/api/texture")) busca.push(e.name)});
    po.observe({type:"resource"});
    const quadros=[]; let on=true;
    const amostra=()=>{quadros.push({t:performance.now()-T0,attW:att(),reg:regV()}); if(on) requestAnimationFrame(amostra)};
    requestAnimationFrame(amostra); await raf();
    const reg0=regV();
    // o fim do crescerComPincelada (src/app/pintura.ts), sem o ler do pintor
    // quem trocou o atlas: a recarga inteira (reloadAtlas) ou a troca so dos desenhos
    let recargas=0, trocas=0; const rl=a.reloadAtlas.bind(a), tr=v.trocarAtlasDosDesenhos?.bind(v);
    a.reloadAtlas=(t)=>(recargas++, rl(t)); if(tr) v.trocarAtlasDosDesenhos=(...x)=>(trocas++, tr(...x));
    const t1=performance.now()-T0;
    const revC=a.pinturas.crescer("folhaT",dd(),0,0,100,0);
    a.run({cmd:"paint.grow",args:{image:"folhaT",left:0,top:0,right:100,bottom:0,rev:revC}},"cresce");
    void a.desenhos.atualizarJa(a.doc,a.viewer);
    const logo={attW:att(),reg:regV()};
    const sync=performance.now()-T0-t1;
    await sleep(2500); on=false; po.disconnect(); const tFim=performance.now()-T0;
    // copia ja: o quadro que ainda estava pedido chega durante a foto da tela e nao conta
    const qs=quadros.filter(q=>q.t<=tFim);
    const tela1=await tela();
    const esticados=qs.filter(q=>q.attW===200 && q.reg===reg0).length;
    const gaps=qs.slice(1).map((q,i)=>q.t-qs[i].t);
    return {runtime:v.runtime, reg0, logo, fim:qs.at(-1), esticados, n:qs.length, maiorGap:Math.max(...gaps), ondeGap:qs[gaps.indexOf(Math.max(...gaps))+1].t-t1, sync, buscas:busca.length, recargas, trocas, tela0, tela1};
  })()`,
    });
    const x = r.exceptionDetails ? { erro: JSON.stringify(r.exceptionDetails).slice(0, 600) } : r.result?.value;
    if (x.erro) {
      falhou = true;
      console.log(`FALHA ${runtime}: ${x.erro}`);
      continue;
    }
    const ok = x.esticados === 0 && x.maiorGap <= 50 && x.buscas === 0 && x.recargas === 0 && x.fim.reg !== x.reg0 && x.fim.attW === 200 && pareceIgual(x.tela0, x.tela1);
    if (!ok) falhou = true;
    console.log(
      `${ok ? "ok   " : "FALHA"} ${x.runtime}: regiao ${x.reg0} -> ${x.logo.reg} no mesmo tique (fim ${x.fim.reg}), ${x.esticados} quadro(s) esticado(s) de ${x.n}, maior intervalo ${x.maiorGap.toFixed(1)} ms (${x.ondeGap.toFixed(0)} ms do grow; o grow leva ${x.sync.toFixed(1)} ms), ${x.buscas} busca(s) de /api/texture, ${x.recargas} recarga(s) e ${x.trocas} troca(s) do atlas, tela vermelho/azul/peca ${x.tela0.r}/${x.tela0.b}/${x.tela0.o} -> ${x.tela1.r}/${x.tela1.b}/${x.tela1.o}`,
    );
  } finally {
    await aba.fechar();
  }
}
process.exit(falhou ? 1 : 0);
