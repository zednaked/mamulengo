// N-028: cortar o pedaco do laco em peca nova (osso, parte e desenho) e girar sem abrir fresta.
// Precisa de um vite proprio com uma copia de exemplos/pixel (nao use o servidor de trabalho):
//   cp -r exemplos/pixel /tmp/x/pixel
//   MAMULENGO_PORT=5398 MAMULENGO_ESTAVEL=1 MAMULENGO_ROOTS=/tmp/x/pixel npx vite --port 5398 --strictPort
//   npx tsx tools/dev/cortar-em-peca.mts [porta]
// Abre o aventureiro, cria na frente de tudo uma folha de 100x40 com uma faixa vermelha (0..95 x
// 10..30), faz o laco de x = 60 ate a borda, roda o cortarEmPeca (o botao "✂ peca") e gira o osso
// novo 15 graus. Depois renderiza o mundo em volta do pivo (renderRect) e le o disco de raio 7 px da
// imagem em volta dele, sobre fundo verde: todo pixel tem que ser tinta (vermelho, sem verde nem azul),
// sem o fundo nem o boneco aparecendo pela junta. Faz o mesmo com sobra 0 como controle: ali a fresta tem que aparecer.
import { Aba } from "../navegador.ts";

const porta = process.argv[2] ?? "5398";
let falhou = false;
const aba = await Aba.abrir(1200, 800);
try {
  await aba.ir(`http://localhost:${porta}/`);
  await aba.ate("window.mamulengo && window.mamulengo.assets?.length");
  const r = await aba.cmd("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async()=>{
  const a=window.mamulengo, sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const ret=await import("/src/app/retoque.ts"), pose=await import("/src/core/pose.ts");
  await a.open(a.assets.find(x=>x.name==="aventureiro"));
  while(!a.viewer?.pose) await sleep(50);
  const v=a.viewer;
  await sleep(300);
  const osso=a.doc.json.bones[1].name;
  if(!a.run({cmd:"draw.create",args:{image:"corteT",width:100,height:40,hd:1,slot:"corteS",bone:osso}},"cria")) return {erro:"draw.create falhou"};
  await sleep(800);
  const dd=()=>a.doc.json.drawings.corteT;
  const t=a.pinturas.de("corteT",dd()); const antes=t.g.getImageData(0,0,t.w,t.h);
  t.g.fillStyle="#ff0000"; t.g.fillRect(0,10,95,20);
  a.run({cmd:"paint.set",args:{image:"corteT",rev:a.pinturas.registrar("corteT",dd(),antes,[0,0,100,40])}},"pinta");
  await sleep(800);
  const medir=async(sobra)=>{
    const h0=a.doc.history().length;
    ret.lacoDown("corteT",60,0,1); for(const p of [[100,0],[100,40],[60,40]]) ret.lacoMove(p[0],p[1],1,false); ret.lacoUp("corteT");
    const nome=ret.cortarEmPeca("corteS",undefined,sobra);
    if(!nome) return {erro:"cortarEmPeca nao cortou (sobra "+sobra+")"};
    await sleep(800);
    const b=a.doc.json.bones.find(x=>x.name===nome);
    a.run({cmd:"bone.set",args:{bone:nome,rotation:(b.rotation??0)+15}},"gira");
    await sleep(800);
    const W=pose.boneWorld(pose.skeletonAt(a.doc.json,null,0),nome);
    const esc=Math.sqrt(Math.abs(W.a*W.d-W.b*W.c));
    const y=v.flip?-W.y:W.y, lado=24*esc, N=240;
    const c=v.renderRect([W.x-lado/2,y-lado/2,lado,lado],[N,N],[0,1,0]);
    const px=c.getContext("2d").getImageData(0,0,N,N).data;
    // o disco de raio 7 px da imagem em volta do pivo (o centro da tela)
    const R=7/24*N; let n=0, pior=255, buraco=0, escuro=0;
    for(let j=0;j<N;j++) for(let i=0;i<N;i++){
      if(Math.hypot(i+0.5-N/2,j+0.5-N/2)>R) continue;
      const o=(j*N+i)*4; n++;
      // fresta: o que aparece nao e a tinta (o fundo verde ou o boneco por tras). A tinta e vermelho puro;
      // na borda da peca girada o filtro do jogo mistura o texel com o vizinho transparente e o vermelho
      // escurece (sem verde nem azul): isso conta a parte, como escurecida, nao como fresta
      const tinta=px[o+1]<40&&px[o+2]<40&&px[o]>=100;
      if(!tinta) buraco++; else if(px[o]<0.9*255) escuro++;
      pior=Math.min(pior,tinta?px[o]:0);
    }
    const passo={png:c.toDataURL("image/png"), nome, pai:b.parent, slots:a.doc.json.slots.map(s=>s.name).slice(-2), n, pior:Math.round(pior), buraco, escuro};
    while(a.doc.history().length>h0) a.doc.undo();
    await sleep(500);
    passo.desfez=!a.doc.json.bones.some(x=>x.name===nome) && !a.doc.json.drawings[nome];
    return passo;
  };
  const com=await medir(4);
  const sem=await medir(0);
  return {com, sem};
})()`,
  });
  const x = r.exceptionDetails ? { erro: JSON.stringify(r.exceptionDetails).slice(0, 600) } : r.result?.value;
  if (process.env.CORTE_PNG && x.com?.png) for (const k of ["com", "sem"]) (await import("node:fs")).writeFileSync(`${process.env.CORTE_PNG}-${k}.png`, Buffer.from(x[k].png.split(",")[1], "base64"));
  if (x.erro || x.com?.erro || x.sem?.erro) {
    falhou = true;
    console.log(`FALHA: ${x.erro ?? x.com?.erro ?? x.sem?.erro}`);
  } else {
    const ok = x.com.buraco === 0 && x.sem.buraco > 0 && x.com.desfez && x.sem.desfez && x.com.slots.join() === `corteS,${x.com.nome}`;
    if (!ok) falhou = true;
    console.log(
      `${ok ? "ok   " : "FALHA"} corte em ${x.com.nome} (osso filho de ${x.com.pai}, partes ${x.com.slots.join(" < ")}), girado 15 graus: com sobra 4, ${x.com.buraco} de ${x.com.n} pixels do disco da junta com fresta (fundo ou boneco aparecendo), ${x.com.escuro} so escurecidos pelo filtro na borda (vermelho minimo ${x.com.pior}); controle sem sobra: ${x.sem.buraco} pixels de fresta; desfazer tira a peca: ${x.com.desfez && x.sem.desfez}`,
    );
  }
} finally {
  await aba.fechar();
}
process.exit(falhou ? 1 : 0);
