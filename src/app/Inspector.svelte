<script lang="ts">
  import Ancora from "./Ancora.svelte";
  import Texto from "./Texto.svelte";
  import NoveFatias from "./NoveFatias.svelte";
  import Papel from "./Papel.svelte";
  import { untrack } from "svelte";
  import { parseAtlas } from "../core/atlas-text.ts";
  import { app } from "./state.svelte.ts";
  import { slotWorldBox } from "./interact.ts";
  import { applyLocal } from "./interact.ts";
  import { startMeshEdit } from "./meshedit.ts";
  import MeshPanel from "./MeshPanel.svelte";
  import DrawPanel from "./DrawPanel.svelte";
  import MosaicPanel from "./MosaicPanel.svelte";
  import { startMosaicEdit } from "./mosaicedit.ts";
  import { abrirDesenhar, newDrawnPart, startDrawEdit } from "./drawedit.ts";
  import { drawingOfSlot } from "../core/commands/desenho.ts";
  import { EFFECT_NAMES, effectAt, effectFields, fieldsAt } from "../core/model.ts";

  const FIELDS = [
    { k: "x", label: "x", step: 1 },
    { k: "y", label: "y", step: 1 },
    { k: "rotation", label: "giro", step: 1 },
    { k: "scaleX", label: "escala x", step: 0.01 },
    { k: "scaleY", label: "escala y", step: 0.01 },
  ] as const;

  // valores mostrados: pose atual (com a animacao aplicada) com uma animacao aberta, setup na Pose base
  const bone = $derived.by(() => {
    app.version;
    app.play.time;
    const name = app.selection.bone;
    if (!name || !app.doc) return null;
    const setup = app.doc.json.bones.find((b: any) => b.name === name);
    const live = app.viewer?.pose?.findBone(name)?.local;
    const src: any = app.mode === "animate" && live ? live : { x: setup?.x ?? 0, y: setup?.y ?? 0, rotation: setup?.rotation ?? 0, scaleX: setup?.scaleX ?? 1, scaleY: setup?.scaleY ?? 1 };
    return { name, parent: setup?.parent, values: Object.fromEntries(FIELDS.map((f) => [f.k, +(+src[f.k]).toFixed(f.step < 1 ? 3 : 2)])) };
  });

  const slot = $derived.by(() => {
    app.version;
    const name = app.selection.slot;
    if (!name || !app.doc) return null;
    const s = app.doc.json.slots.find((x: any) => x.name === name);
    const atts: string[] = [];
    for (const sk of app.doc.json.skins ?? []) for (const n of Object.keys(sk.attachments?.[name] ?? {})) if (!atts.includes(n)) atts.push(n);
    return { ...s, atts };
  });

  // a imagem (regiao) que a peca mostra na Pose base, dentro do osso: posicao, giro e escala
  const imagemNoOsso = $derived.by(() => {
    app.version;
    if (!slot?.attachment || !app.doc) return null;
    const a = app.doc.json.skins?.find((s: any) => s.name === app.skinDe(slot.name, slot.attachment))?.attachments?.[slot.name]?.[slot.attachment];
    if (!a || (a.type ?? "region") !== "region") return null;
    return { x: a.x ?? 0, y: a.y ?? 0, rotation: a.rotation ?? 0, scaleX: a.scaleX ?? 1, scaleY: a.scaleY ?? 1 };
  });
  function setImagem(campo: string, valor: number) {
    if (!slot?.attachment || !Number.isFinite(valor)) return;
    app.run({ cmd: "attachment.region", args: { slot: slot.name, name: slot.attachment, skin: app.skinDe(slot.name, slot.attachment), [campo]: valor } }, `imagem de ${slot.name}`);
  }

  // cor atual do slot (com a animacao aplicada, com uma animacao aberta)
  const color = $derived.by(() => {
    app.version;
    app.play.time;
    const name = app.selection.slot;
    if (!name) return null;
    const live = app.mode === "animate" ? app.viewer?.pose?.findSlot(name)?.color : null;
    const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    if (live) return { rgb: "#" + hex(live.r) + hex(live.g) + hex(live.b), a: live.a };
    const c = (app.doc?.json.slots.find((x: any) => x.name === name)?.color ?? "ffffffff").padEnd(8, "f");
    return { rgb: "#" + c.slice(0, 6), a: parseInt(c.slice(6, 8), 16) / 255 };
  });

  function setColor(rgb: string, a: number) {
    if (!slot) return;
    const hex = rgb.replace("#", "") + Math.round(a * 255).toString(16).padStart(2, "0");
    // ajustes seguidos no mesmo instante viram uma acao so de desfazer
    if (app.mode === "animate" && app.play.animation) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { slot: slot.name }, timeline: "rgba", time, color: hex } }, `cor ${slot.name} @${time}`, `cor-${slot.name}-${time}`);
    } else app.run({ cmd: "slot.set", args: { slot: slot.name, color: hex } }, `cor ${slot.name}`, `cor-${slot.name}`);
  }

  // ---- efeitos (so .boneco; docs/NUCLEO.md "Efeitos"): os ligados no setup ou animados aqui
  const EFEITOS: Record<string, { nome: string; dica: string; campos: { k: string; label: string; min?: number; max: number; step: number }[] }> = {
    outline: { nome: "contorno", dica: "linha em volta da imagem", campos: [{ k: "width", label: "largura", max: 16, step: 0.5 }] },
    glow: { nome: "brilho", dica: "halo em volta da imagem", campos: [{ k: "strength", label: "força", max: 3, step: 0.05 }, { k: "radius", label: "raio", max: 40, step: 1 }] },
    dissolve: { nome: "dissolver", dica: "some em pedacos, com borda colorida", campos: [{ k: "value", label: "quanto", max: 1, step: 0.01 }, { k: "edge", label: "borda", max: 0.3, step: 0.01 }, { k: "grain", label: "pedacos", max: 64, step: 1 }] },
    tint: { nome: "tingir", dica: "pinta a imagem com uma cor", campos: [{ k: "strength", label: "força", max: 1, step: 0.01 }] },
    smear: {
      nome: "borrar",
      dica: "estica a traseira da imagem quando ela anda rápido (smear de desenho animado)",
      campos: [
        { k: "strength", label: "força (s)", max: 0.2, step: 0.005 },
        { k: "limit", label: "limite", max: 200, step: 1 },
        { k: "fade", label: "esmaecer", max: 1, step: 0.05 },
      ],
    },
    trail: {
      nome: "rastro",
      dica: "cópias dos quadros anteriores por trás da imagem, mais fracas quanto mais antigas",
      campos: [
        { k: "copies", label: "cópias", max: 16, step: 1 },
        { k: "interval", label: "intervalo (s)", max: 0.2, step: 0.005 },
        { k: "alpha", label: "alfa", max: 1, step: 0.05 },
      ],
    },
    adjust: {
      nome: "ajuste",
      dica: "camada de ajuste: muda o que já esta desenhado por baixo da imagem (sem imagem, a tela toda)",
      campos: [
        { k: "hue", label: "matiz", min: -180, max: 180, step: 1 },
        { k: "saturation", label: "saturação", max: 4, step: 0.05 },
        { k: "lightness", label: "luminosidade", min: -1, max: 1, step: 0.02 },
        { k: "contrast", label: "contraste", max: 4, step: 0.05 },
        { k: "blur", label: "desfoque", max: 40, step: 0.5 },
      ],
    },
  };
  const ehBoneco = $derived(!!app.asset?.tres?.endsWith(".boneco"));
  const efeitos = $derived.by(() => {
    app.version;
    app.play.time;
    if (!slot || !app.doc || !ehBoneco) return [];
    const anim = app.mode === "animate" ? app.play.animation : null;
    const animados = Object.keys((anim && app.doc.json.animations?.[anim]?.effects?.[slot.name]) || {});
    return EFFECT_NAMES.filter((n) => slot.effects?.[n] || animados.includes(n)).map((n) => ({ n, v: effectFields(n, effectAt(app.doc!.json, anim, slot.name, n, app.play.time)) }));
  });
  const faltam = $derived(EFFECT_NAMES.filter((n) => !efeitos.some((x) => x.n === n)));

  function setEfeito(n: string, campo: string, valor: any) {
    if (!slot) return;
    if (app.mode === "animate" && app.play.animation) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { slot: slot.name }, timeline: n, time, [campo]: valor } }, `${EFEITOS[n].nome} ${slot.name} @${time}`, `ef-${n}-${slot.name}-${time}`);
    } else app.run({ cmd: "slot.effect", args: { slot: slot.name, effect: n, [campo]: valor } }, `${EFEITOS[n].nome} ${slot.name}`, `ef-${n}-${slot.name}`);
  }
  // ligar um efeito: no setup com um valor que ja aparece (o padrao deixa desligado)
  const LIGA: Record<string, Record<string, any>> = { outline: { width: 3, color: "ffd23cff" }, glow: { strength: 1, color: "4cc9ffff" }, dissolve: {}, tint: { color: "ff3355ff" }, smear: { strength: 0.05 }, trail: { copies: 4 }, adjust: { saturation: 0 } };
  function ligar(n: string) {
    if (!slot || !n) return;
    if (app.run({ cmd: "slot.effect", args: { slot: slot.name, effect: n, ...LIGA[n] } }, `${EFEITOS[n].nome} em ${slot.name}`)) app.avisar(`${EFEITOS[n].nome} em ${slot.name}: os controles estão logo abaixo.`);
  }
  function tirar(n: string) {
    if (!slot) return;
    app.run({ cmd: "slot.effect", args: { slot: slot.name, effect: n, off: true } }, `tira ${EFEITOS[n].nome} de ${slot.name}`);
  }

  // ---- particulas (so .boneco; docs/NUCLEO.md "Particulas"): os emissores que desenham nesta camada
  const CAMPOS_P = [
    { k: "rate", label: "taxa", max: 100, step: 1, dica: "partículas por segundo" },
    { k: "speed", label: "velocidade", max: 600, step: 5, par: true, dica: "px/s (o maior do sorteio)" },
    { k: "life", label: "vida", max: 4, step: 0.05, par: true, dica: "segundos (a maior do sorteio)" },
    { k: "spread", label: "abertura", max: 360, step: 5, dica: "graus do leque" },
    { k: "angle", label: "direção", max: 360, step: 5, dica: "graus no osso (0 = ao longo do osso)" },
    { k: "gravity", label: "gravidade", max: 1000, step: 10, dica: "px/s2 para baixo" },
  ] as const;
  const PADRAO_P: Record<string, number> = { rate: 10, speed: 100, life: 1, spread: 30, angle: 90, gravity: 0, width: 6, jitter: 0.15, segments: 10, count: 12, period: 2, band: 10, tilt: 0, depth: 0.3 };
  // o raio: a taxa e a intensidade (0 a 1), e os controles sao os da linha
  const CAMPOS_RAIO = [
    { k: "rate", label: "intensidade", max: 1, step: 0.01, dica: "0 apaga, 1 cheio" },
    { k: "width", label: "largura", max: 60, step: 1, dica: "px" },
    { k: "jitter", label: "desvio", max: 0.5, step: 0.01, dica: "quanto foge para os lados (fracao do comprimento)" },
    { k: "segments", label: "segmentos", max: 30, step: 1, dica: "pedacos da linha" },
  ];
  // a orbita: particulas girando em volta do osso, atras (slot behind) e na frente (este slot)
  const CAMPOS_ORBITA = [
    { k: "rate", label: "intensidade", max: 1, step: 0.01, dica: "0 apaga, 1 cheio" },
    { k: "count", label: "quantas", max: 40, step: 1, dica: "partículas na órbita" },
    { k: "period", label: "volta", max: 8, step: 0.1, dica: "segundos por volta" },
    { k: "radiiX", label: "largura", max: 600, step: 5, dica: "raio da elipse na horizontal, px" },
    { k: "radiiY", label: "altura", max: 400, step: 5, dica: "raio da elipse na vertical, px" },
    { k: "band", label: "faixa", max: 100, step: 1, dica: "quanto fogem para cima e para baixo da elipse, px" },
    { k: "tilt", label: "inclinação", max: 90, step: 1, dica: "graus" },
    { k: "depth", label: "profundidade", max: 1, step: 0.05, dica: "quanto a da frente cresce e a de trás encolhe" },
  ];
  const camposDe = (p: any) => (p.type === "lightning" ? CAMPOS_RAIO : p.type === "orbit" ? CAMPOS_ORBITA : CAMPOS_P);
  const emissores = $derived.by(() => {
    app.version;
    app.play.time;
    if (!slot || !app.doc || !ehBoneco) return [];
    const anim = app.mode === "animate" ? app.play.animation : null;
    return ((app.doc.json as any).particles ?? [])
      .filter((p: any) => p.slot === slot.name)
      .map((p: any) => {
        const ks: any[] = (anim && app.doc!.json.animations?.[anim]?.particles?.[p.name]?.rate) || [];
        let rate = p.rate ?? PADRAO_P.rate;
        // a taxa no instante (linear entre as chaves), para o controle mostrar o que toca
        if (ks.length && app.play.time >= (ks[0].time ?? 0)) {
          let k = ks.length - 1;
          while (k > 0 && (ks[k].time ?? 0) > app.play.time) k--;
          rate = ks[k].value ?? rate;
          if (k < ks.length - 1 && ks[k].curve !== "stepped") rate += (((ks[k + 1].value ?? rate) - rate) * (app.play.time - (ks[k].time ?? 0))) / ((ks[k + 1].time ?? 0) - (ks[k].time ?? 0));
        }
        const v = (k: string) => (k === "rate" ? rate : k === "radiiX" ? (p.radii?.[0] ?? 140) : k === "radiiY" ? (p.radii?.[1] ?? 40) : Array.isArray(p[k]) ? p[k][1] : (p[k] ?? PADRAO_P[k]));
        return { p, v };
      });
  });
  const animando = $derived(app.mode === "animate" && !!app.play.animation);

  // ---- luzes (so .boneco; docs/NUCLEO.md "Luzes"): as presas a este osso e a ambiente
  const CAMPOS_LUZ = [
    { k: "strength", label: "força", min: 0, max: 4, step: 0.05, dica: "quanto a luz soma (1: a cor dela inteira)" },
    { k: "radius", label: "raio", min: 0, max: 1500, step: 10, dica: "a luz some nessa distância, em pixels do mundo" },
    { k: "height", label: "altura", min: -300, max: 500, step: 5, dica: "acima do plano; baixa ilumina rasante, negativa vira contraluz" },
  ];
  const luzesDoOsso = $derived.by(() => {
    app.version;
    app.play.time;
    if (!bone || !app.doc || !ehBoneco) return [];
    const anim = app.mode === "animate" ? app.play.animation : null;
    return ((app.doc.json as any).lights ?? []).filter((l: any) => l.bone === bone.name).map((l: any) => ({ n: l.name as string, v: effectFields("light", fieldsAt(app.doc!.json, anim, { light: l.name }, "light", app.play.time)) }));
  });
  const ambiente = $derived.by(() => {
    app.version;
    app.play.time;
    const j = app.doc?.json as any;
    if (!j || !ehBoneco || !(j.lights?.length || j.ambient)) return null;
    return effectFields("ambient", fieldsAt(j, app.mode === "animate" ? app.play.animation : null, { ambient: true }, "ambient", app.play.time));
  });
  // sem relevo nas paginas, as luzes nao tem o que iluminar
  const semRelevo = $derived(!!app.doc && !/^relevo:/m.test(app.doc.atlas.text));
  function setLuz(n: string, campo: string, valor: any) {
    if (animando) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { light: n }, timeline: "light", time, [campo]: valor } }, `luz ${n} @${time}`, `luz-${n}-${campo}-${time}`);
    } else app.run({ cmd: "light.set", args: { name: n, [campo]: valor } }, `luz ${n}`, `luz-${n}-${campo}`);
  }
  function setAmbiente(campo: string, valor: any) {
    if (animando) {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { ambient: true }, timeline: "ambient", time, [campo]: valor } }, `ambiente @${time}`, `amb-${campo}-${time}`);
    } else app.run({ cmd: "ambient.set", args: { [campo]: valor } }, "luz ambiente", `amb-${campo}`);
  }
  // uma parte de texto numa camada nova presa a este osso (docs/EDITOR.md "Texto")
  function novoTexto() {
    if (!bone) return;
    let nome = `${bone.name}_texto`;
    for (let n = 2; app.doc?.json.slots?.some((s: any) => s.name === nome); n++) nome = `${bone.name}_texto_${n}`;
    if (app.run({ cmd: "text.set", args: { slot: nome, bone: bone.name, text: "Texto", width: 240, height: 60, size: 32 } }, `texto em ${bone.name}`)) {
      app.select({ bone: bone.name, slot: nome });
      app.avisar(`${nome}: escreva o texto ou escolha uma chave da tabela de idiomas no inspetor; o idioma mostrado troca no alto do viewport.`);
    }
  }
  function novaLuz() {
    if (!bone) return;
    let nome = "luz";
    for (let n = 2; ((app.doc?.json as any).lights ?? []).some((l: any) => l.name === nome); n++) nome = `luz_${n}`;
    if (app.run({ cmd: "light.set", args: { name: nome, bone: bone.name, color: "ffeecc", strength: 1.2, radius: 400, height: 100 } }, `luz em ${bone.name}`))
      app.avisar(`${nome} presa em ${bone.name}: ela acende as partes que têm relevo.`);
  }
  function setP(nome: string, campo: string, valor: number, atual: any) {
    if (animando && campo === "rate") {
      const time = +app.play.time.toFixed(4);
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { particles: nome }, timeline: "rate", time, value: valor } }, `taxa ${nome} @${time}`, `p-rate-${nome}-${time}`);
      return;
    }
    // orbita: largura e altura sao os dois raios da elipse
    if (campo === "radiiX" || campo === "radiiY") {
      const em = ((app.doc?.json as any).particles ?? []).find((x: any) => x.name === nome);
      const r: [number, number] = [...(em?.radii ?? [120, 40])] as [number, number];
      r[campo === "radiiX" ? 0 : 1] = valor;
      app.run({ cmd: "particles.set", args: { name: nome, radii: r } }, `particulas ${nome}`, `p-${campo}-${nome}`);
      return;
    }
    // campos com [min, max]: o controle muda o maior e mantem a proporcao do menor
    const par = CAMPOS_P.find((c) => c.k === campo && "par" in c);
    const val = par ? (Array.isArray(atual) ? [+(atual[0] * (valor / (atual[1] || 1))).toFixed(3), valor] : [valor * 0.5, valor]) : valor;
    app.run({ cmd: "particles.set", args: { name: nome, [campo]: val } }, `particulas ${nome}`, `p-${campo}-${nome}`);
  }
  // a lista da biblioteca de efeitos, para o menu "+ efeito" (so .boneco)
  $effect(() => {
    if (app.asset?.tres?.endsWith(".boneco")) app.carregarEfeitos();
  });
  function novoEmissor(tipo: "particles" | "lightning" | "orbit" = "particles") {
    if (!slot) return;
    const base = tipo === "lightning" ? "raio" : tipo === "orbit" ? "orbita" : "particulas";
    let nome = `${slot.name}_${base}`;
    for (let n = 2; ((app.doc?.json as any).particles ?? []).some((p: any) => p.name === nome); n++) nome = `${slot.name}_${base}_${n}`;
    const args: any =
      tipo === "lightning"
        ? { name: nome, slot: slot.name, type: "lightning", rate: 1, length: 220, angle: 90, segments: 10, jitter: 0.15, width: 6, refresh: 0.08, branches: 1, color: ["bfe6ffff"], blend: "additive" }
        : tipo === "orbit"
          ? (() => {
              // as que passam atras desenham na camada mais de tras que nao e esta
              const atras = app.doc!.json.slots.find((x: any) => x.name !== slot.name)?.name;
              return { name: nome, slot: slot.name, type: "orbit", behind: atras, rate: 1, count: 12, period: 2, radii: [140, 40], band: 10, tilt: 0, depth: 0.3, scale: [0.4, 0.4] };
            })()
          : { name: nome, slot: slot.name, rate: 12, life: [0.6, 1.2], speed: [60, 140], spread: 50, scale: [0.4, 0.1], spin: [-120, 120], color: ["ffffffff", "ffffff00"] };
    const nomeT = tipo === "lightning" ? "Raio" : tipo === "orbit" ? "Órbita" : "Partículas";
    if (app.run({ cmd: "particles.set", args }, `${base} em ${slot.name}`)) app.avisar(`${nomeT} em ${slot.name}: aparece no desenho do núcleo; os controles estão logo abaixo.`);
  }
  // ---- mosaicos (so .boneco; docs/NUCLEO.md "Mosaico"): os que desenham no lugar desta camada
  const mosaicosDoSlot = $derived.by(() => {
    app.version;
    return slot ? ((app.doc?.json as any)?.mosaics ?? []).filter((m: any) => m.slot === slot.name) : [];
  });
  function novoMosaico() {
    if (!slot) return;
    let nome = `${slot.name}_mosaico`;
    for (let n = 2; ((app.doc?.json as any).mosaics ?? []).some((m: any) => m.name === nome); n++) nome = `${slot.name}_mosaico_${n}`;
    // a paleta comeca com a imagem da camada (se ela mostra uma)
    const att = slot.attachment ? app.doc!.json.skins?.find((s: any) => s.attachments?.[slot.name]?.[slot.attachment])?.attachments[slot.name][slot.attachment] : null;
    const img = att && (!att.type || att.type === "region" || att.type === "mesh") ? (att.path ?? slot.attachment) : null;
    const args: any = { name: nome, slot: slot.name, columns: 8, rows: 6, palette: img ? [img] : [] };
    if (app.run({ cmd: "mosaic.set", args }, `mosaico em ${slot.name}`)) {
      startMosaicEdit(nome);
      app.avisar(`Mosaico ${nome} em ${slot.name}: pinte na tela com a imagem da paleta (o + acrescenta outras do atlas). Aparece no desenho do núcleo.`);
    }
  }
  function rajada(nome: string) {
    const time = +app.play.time.toFixed(4);
    app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { particles: nome }, timeline: "burst", time, count: 12 } }, `rajada ${nome} @${time}`);
  }

  // tipo da imagem atual do slot (region vira malha; malha pode ganhar pesos)
  // ---- instancias (so .boneco; docs/NUCLEO.md "Instancias"): as que desenham no lugar desta camada
  const instancias = $derived.by(() => {
    app.version;
    if (!slot || !app.doc || !ehBoneco) return [] as any[];
    return ((app.doc.json as any).instances ?? []).filter((i: any) => i.slot === slot.name);
  });
  const pastaDoc = $derived(app.doc?.file.tres ? app.doc.file.tres.slice(0, app.doc.file.tres.lastIndexOf("/") + 1) : "");
  // o caminho do filho, relativo a este arquivo, resolvido
  const caminhoFilho = (rel: string) => {
    const partes: string[] = [];
    for (const x of (pastaDoc + rel).split("/")) {
      if (x === "..") partes.pop();
      else if (x !== ".") partes.push(x);
    }
    return partes.join("/");
  };
  // as animacoes e skins de cada filho, lidas do arquivo dele (pelo .spine-json virtual)
  let doFilho = $state<Record<string, { anims: string[]; skins: string[] }>>({});
  $effect(() => {
    for (const i of instancias) {
      const c = caminhoFilho(i.boneco);
      if (doFilho[c]) continue;
      doFilho[c] = { anims: [], skins: [] };
      fetch(`/api/file?p=${encodeURIComponent(c + ".spine-json")}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && (doFilho[c] = { anims: Object.keys(j.animations ?? {}), skins: (j.skins ?? []).map((s: any) => s.name) }))
        .catch(() => {});
    }
  });
  // os .boneco que podem virar instancia aqui (os personagens da lista, fora este), relativos a este
  const bonecosPossiveis = $derived.by(() => {
    if (!pastaDoc) return [] as { rel: string; nome: string }[];
    const meu = app.doc?.file.tres;
    const rel = (alvo: string) => {
      const a = pastaDoc.split("/").filter(Boolean),
        b = alvo.split("/").filter(Boolean);
      let k = 0;
      while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
      return [...Array(a.length - k).fill(".."), ...b.slice(k)].join("/");
    };
    return app.assets.filter((x) => x.tres.endsWith(".boneco") && x.tres !== meu).map((x) => ({ rel: rel(x.tres), nome: `${x.project} / ${x.name}` }));
  });
  function novaInstancia(rel: string) {
    if (!slot || !rel) return;
    const base = rel.split("/").pop()!.replace(/\.boneco$/, "").replace(/[^\w.-]+/g, "_");
    let nome = base;
    for (let k = 2; ((app.doc?.json as any).instances ?? []).some((i: any) => i.name === nome); k++) nome = `${base}_${k}`;
    if (app.run({ cmd: "instance.set", args: { name: nome, slot: slot.name, boneco: rel } }, `instância ${nome} em ${slot.name}`)) app.avisar(`${nome} desenha no lugar de ${slot.name}, presa ao osso dela. Escolha a animação do filho logo abaixo.`);
  }
  const animsDe = (i: any, f: { anims: string[] } | undefined): string[] => (f?.anims.length ? f.anims : i.animation ? [i.animation] : []);
  const instSet = (nome: string, campo: string, valor: any, arrasto = false) =>
    app.run({ cmd: "instance.set", args: { name: nome, [campo]: valor } }, `instância ${nome}: ${campo}`, arrasto ? `inst-${nome}-${campo}` : undefined, arrasto);
  // ---- palco (docs/PALCO.md): a instancia como ator (jogador, patrulha, coletavel, porta)
  const palco = $derived.by(() => {
    app.version;
    return (app.doc?.json as any)?.stage ?? null;
  });
  const atorDe = (inst: string) => (palco?.actors ?? []).find((a: any) => (a.instance ?? a.name) === inst) ?? null;
  const TIPOS_ATOR: [string, string][] = [
    ["player", "jogador"],
    ["patrol", "patrulha"],
    ["collectible", "coletável"],
    ["door", "porta (vence)"],
    ["prop", "enfeite"],
  ];
  const atorSet = (nome: string, args: any, arrasto = false) => app.run({ cmd: "stage.actor", args: { name: nome, ...args } }, `ator ${nome}`, arrasto ? `ator-${nome}-${Object.keys(args).join(",")}` : undefined, arrasto);
  // a caixa sugerida: o que o boneco desenha agora, 70% da largura (orelha e braco nao colidem) e a
  // altura dos pes (o osso) ao topo
  function caixaSugerida(inst: string): [number, number] | null {
    const j: any = app.doc?.json;
    const v = app.viewer;
    const idx = (j?.instances ?? []).findIndex((x: any) => x.name === inst);
    const c = idx >= 0 ? v?.nucleo?.caixaInstancia(idx) : null;
    const ix = j?.instances?.[idx];
    const osso = ix?.bone ?? j?.slots?.find((x: any) => x.name === ix?.slot)?.bone;
    const pe = osso ? v?.pose?.findBone(osso) : null;
    if (!c || !pe) return null;
    return [Math.max(4, Math.round((c[2] - c[0]) * 0.7)), Math.max(4, Math.round(c[3] - pe.worldY))];
  }
  function tornarAtor(inst: string, tipo: string) {
    if (!tipo) return;
    const box = caixaSugerida(inst);
    const r = app.run({ cmd: "stage.actor", args: { name: inst, instance: inst, type: tipo, ...(box ? { box } : {}), ...(tipo === "player" ? { speed: 300, jump: 900 } : {}) } }, `${inst} vira ator`);
    if (r) app.avisar(`${inst} agora é ${TIPOS_ATOR.find(([t]) => t === tipo)?.[1]} no palco${box ? `, com a caixa ${box[0]} × ${box[1]} pelo tamanho do boneco` : ""}. Ajuste arrastando as alças da caixa na tela e jogue com 🎮 no alto da tela.`);
  }
  let renInst = $state<string | null>(null);
  let textoInst = $state("");
  function renomearInst() {
    const de = renInst;
    renInst = null;
    const para = textoInst.trim();
    if (de && para && para !== de) app.run({ cmd: "instance.rename", args: { name: de, to: para } }, `renomeia ${de}`);
  }
  async function embutir(nome: string) {
    const r = await app.runAsync({ cmd: "instance.inline", args: { name: nome } }, `embute ${nome}`);
    if (r) app.avisar(`${nome} foi embutida: os ossos, camadas e animações do filho agora estão neste personagem. Ctrl+Z desfaz.`);
  }
  async function extrair(osso: string) {
    if (app.doc?.dirty) await app.save();
    const arq = `${osso}.boneco`;
    const r = await app.runAsync({ cmd: "instance.extract", args: { bone: osso, boneco: arq } }, `extrai ${osso} para ${arq}`);
    if (r?.[0]) {
      app.select({ slot: r[0].slot });
      await app.save();
      await app.loadAssets(true);
      app.avisar(`${osso} e o que pende dele foram para ${arq}; no lugar ficou a instância ${r[0].instance}.${r[0].avisos?.length ? " " + r[0].avisos.join(" ") : ""} Para editar o filho, use "entrar ↳".`);
    }
  }

  // osso exclusivo da skin mostrada (skin.require)
  const soNaSkin = $derived.by(() => {
    app.version;
    const sk = app.doc?.json.skins?.find((s: any) => s.name === app.skin);
    return !!bone && !!sk?.bones?.includes(bone.name);
  });
  function trocaSoNaSkin(liga: boolean) {
    const sk = app.doc?.json.skins?.find((s: any) => s.name === app.skin);
    if (!sk || !bone) return;
    const ossos: string[] = (sk.bones ?? []).filter((b: string) => b !== bone.name);
    if (liga) ossos.push(bone.name);
    if (app.run({ cmd: "skin.require", args: { skin: sk.name, bones: ossos } }, `${bone.name} ${liga ? "só" : "não só"} na skin ${sk.name}`) && liga) app.avisar(`${bone.name} só fica ativo com a skin ${sk.name} (nas outras ele e o que pende dele somem).`);
  }

  // renomear (dois cliques no nome) e apagar (🗑) osso, camada e parte. Apagar osso com malha que
  // tem pesos nele pede o segundo clique (force); tudo desfaz com Ctrl+Z
  let renomeando = $state<{ tipo: "osso" | "slot" | "parte"; de: string } | null>(null);
  let textoRen = $state("");
  const comecaRen = (tipo: "osso" | "slot" | "parte", de: string) => ((renomeando = { tipo, de }), (textoRen = de));
  function renomear() {
    const r = renomeando;
    renomeando = null;
    const para = textoRen.trim();
    if (!r || !para || para === r.de) return;
    const call =
      r.tipo === "osso"
        ? { cmd: "bone.rename", args: { bone: r.de, to: para } }
        : r.tipo === "slot"
          ? { cmd: "slot.rename", args: { slot: r.de, to: para } }
          : { cmd: "attachment.rename", args: { slot: slot!.name, from: r.de, to: para } };
    if (!app.run(call, `renomeia ${r.de} para ${para}`)) return;
    if (r.tipo === "osso") app.select({ ...app.selection, bone: para });
    if (r.tipo === "slot") app.select({ ...app.selection, slot: para });
  }
  let forcarOsso = $state<string | null>(null);
  function apagarOsso(nome: string) {
    const force = forcarOsso === nome;
    try {
      const r = app.run({ cmd: "bone.delete", args: { bone: nome, force } }, `apaga o osso ${nome}`, undefined, !force);
      if (r) {
        forcarOsso = null;
        app.select({});
        app.avisar(`${nome} apagado, com os filhos e as camadas presas neles. Ctrl+Z desfaz.`);
        return;
      }
    } catch {}
    if (force) return (forcarOsso = null);
    // a recusa (malha com pesos nele): o segundo clique apaga mesmo assim
    forcarOsso = nome;
    app.toast(`${nome} puxa malhas com pesos: apagar tira os pesos dele delas. Clique de novo em 🗑 para apagar mesmo assim.`);
    setTimeout(() => forcarOsso === nome && (forcarOsso = null), 5000);
  }
  function apagarSlot(nome: string) {
    if (app.run({ cmd: "slot.delete", args: { slot: nome } }, `apaga a camada ${nome}`)) {
      app.select({ bone: app.selection.bone });
      app.avisar(`A camada ${nome} foi apagada, com as imagens e as chaves dela. Ctrl+Z desfaz.`);
    }
  }
  function apagarParte(nome: string) {
    if (!slot) return;
    const sk = app.doc?.json.skins?.find((x: any) => x.attachments?.[slot.name]?.[nome])?.name ?? "default";
    if (app.run({ cmd: "attachment.delete", args: { slot: slot.name, name: nome, skin: sk } }, `apaga a imagem ${nome} de ${slot.name}`)) app.avisar(`A imagem ${nome} saiu de ${slot.name}. Ctrl+Z desfaz.`);
  }

  // giro em 2,5D (deform.turn): numa animacao, a malha da peca vira como um cilindro no instante
  // atual (uma chave de deform). Os controles comecam em 0 a cada peca e instante
  let giro = $state({ vira: 0, olha: 0, persp: 0.25 });
  let giroSeq = 0;
  $effect(() => {
    void slot?.name, app.play.time;
    untrack(() => (giro = { vira: 0, olha: 0, persp: giro.persp }));
  });
  function girar() {
    if (!slot?.attachment || !app.play.animation || !geleiaOuMalha) return;
    const time = +app.play.time.toFixed(4);
    const axis = Math.abs(giro.vira) >= Math.abs(giro.olha) ? "vertical" : "horizontal";
    const angle = axis === "vertical" ? giro.vira : giro.olha;
    const tilt = axis === "vertical" ? giro.olha : giro.vira;
    app.run(
      { cmd: "deform.turn", args: { anim: app.play.animation, slot: slot.name, attachment: slot.attachment, skin: geleiaOuMalha.skin, time, angle, axis, ...(tilt ? { tilt } : {}), perspective: giro.persp } },
      `gira ${slot.name} @${time}`,
      `giro-${slot.name}-${time}-${giroSeq}`,
      true,
    );
  }
  const geleiaOuMalha = $derived.by(() => {
    app.version;
    if (!slot?.attachment || !app.doc) return null;
    const sk = app.doc.json.skins?.find((x: any) => x.attachments?.[slot.name]?.[slot.attachment]);
    const a = sk?.attachments[slot.name][slot.attachment];
    return a?.type === "mesh" ? { skin: sk.name } : null;
  });

  // geleia da malha da parte (so .boneco: o desenho do nucleo)
  const geleia = $derived.by(() => {
    app.version;
    if (!slot?.attachment || !app.doc || !ehBoneco) return null;
    const sk = app.doc.json.skins?.find((x: any) => x.attachments?.[slot.name]?.[slot.attachment]);
    const a = sk?.attachments[slot.name][slot.attachment];
    if (!a || a.type !== "mesh") return null;
    return { skin: sk.name, j: a.jelly ?? null };
  });
  let seqGeleia = 0;
  function setGeleia(args: any, label: string, arrasto = false) {
    if (!slot?.attachment || !geleia) return;
    app.run({ cmd: "mesh.jelly", args: { slot: slot.name, attachment: slot.attachment, skin: geleia.skin, ...args } }, label, arrasto ? `geleia-${slot.name}-${seqGeleia}` : undefined, arrasto);
  }
  const CAMPOS_GELEIA = [
    { k: "stiffness", label: "rigidez", min: 5, max: 400, step: 1, dica: "quanto a malha volta para o rig (mais = balanço curto e rápido)" },
    { k: "coupling", label: "contágio", min: 0, max: 300, step: 1, dica: "quanto um ponto puxa o vizinho (mais = a onda corre pela peça inteira)" },
    { k: "damping", label: "amortecer", min: 0.2, max: 15, step: 0.1, dica: "quanto o balanço se perde (mais = assenta logo)" },
    { k: "gravity", label: "peso", min: -200, max: 300, step: 1, dica: "puxa para baixo (px/s²): a peça cede, como slime" },
  ] as const;

  // a imagem da parte e um desenho (vetor): abre o Desenhar
  const desenho = $derived.by(() => {
    app.version;
    return slot?.attachment && app.doc ? drawingOfSlot(app.doc.json, slot.name) : null;
  });

  const attKind = $derived.by(() => {
    app.version;
    if (!slot?.attachment || !app.doc) return null;
    const a = app.doc.json.skins?.find((s: any) => s.attachments?.[slot.name]?.[slot.attachment])?.attachments[slot.name][slot.attachment];
    if (!a) return null;
    return { type: a.type ?? "region", weighted: a.type === "mesh" && a.vertices.length > a.uvs.length };
  });

  // as imagens do atlas (para malha ligada) e a sequencia possivel desta imagem (nome_1, nome_2...)
  const imagensAtlas = $derived.by(() => {
    app.version;
    const t = app.doc?.atlas.text;
    return t ? [...new Set(parseAtlas(app.desenhos.semDesenhos(t)).regions.map((r) => r.name))] : [];
  });
  const sequencia = $derived.by(() => {
    if (!slot?.attachment || !app.doc) return null;
    const a = app.doc.json.skins?.find((x: any) => x.attachments?.[slot.name]?.[slot.attachment])?.attachments[slot.name][slot.attachment];
    if (!a || a.sequence) return null;
    const img = (a.path ?? slot.attachment) as string;
    const m = /^(.*?)([_-]?)(\d+)$/.exec(img);
    const base = m ? m[1] : img;
    for (const sep of m ? [m[2]] : ["_", "-", ""]) {
      let n = 0;
      while (imagensAtlas.includes(`${base}${sep}${n + 1}`)) n++;
      if (n >= 2) return { base, sep, n };
    }
    return null;
  });
  function virarSequencia() {
    const q = sequencia;
    if (!slot?.attachment || !q) return;
    const sk = app.skinDe(slot.name, slot.attachment);
    const calls: any[] = [];
    const a = app.doc!.json.skins.find((x: any) => x.name === sk).attachments[slot.name][slot.attachment];
    // o caminho da imagem vira o prefixo dos quadros
    if ((a.path ?? slot.attachment) !== q.base + q.sep) calls.push({ cmd: "attachment.region", args: { slot: slot.name, name: slot.attachment, skin: sk, path: q.base + q.sep } });
    calls.push({ cmd: "sequence.set", args: { slot: slot.name, attachment: slot.attachment, skin: sk, count: q.n, start: 1, digits: 0, setup: 0 } });
    if (app.run(calls, `${slot.attachment} vira sequência`)) app.avisar(`${slot.attachment} agora é uma sequência de ${q.n} quadros; numa animação, a timeline "sequência" escolhe o quadro e a velocidade.`);
  }
  function malhaLigada(img: string) {
    if (!slot?.attachment || !img) return;
    let nome = img;
    for (let k = 2; slot.atts.includes(nome); k++) nome = `${img}_${k}`;
    const sk = app.skinDe(slot.name, slot.attachment);
    if (app.run({ cmd: "linkedmesh.create", args: { slot: slot.name, name: nome, source: slot.attachment, sourceSkin: sk, skin: app.skinEdicao, path: img, timelines: true } }, `malha ligada ${nome}`))
      app.avisar(`${nome} usa a malha e os pesos de ${slot.attachment} com a imagem ${img}: escolha em "imagem" para mostrar (dobra igual, deforms inclusive).`);
  }

  async function makeMesh() {
    if (!slot?.attachment) return;
    const att = slot.attachment;
    if (await app.runAsync([{ cmd: "mesh.create", args: { slot: slot.name, name: att, detail: 1.8 } }], `deixar ${att} deformavel`))
      app.avisar(`${slot.name} agora é deformável: numa animação, o pincel (4) amassa a imagem; "Dobrar com os ossos" faz ela curvar junto com o esqueleto.`);
  }

  // pesos automaticos: osso da peca, o pai e os filhos (o que costuma dobrar junto)
  function bindToBones() {
    if (!slot?.attachment || !app.doc) return;
    const bones = app.doc.json.bones;
    const own = slot.bone;
    const parent = bones.find((b: any) => b.name === own)?.parent;
    const kids = bones.filter((b: any) => b.parent === own).map((b: any) => b.name);
    const list = [own, ...kids, ...(parent && parent !== bones[0].name ? [parent] : [])];
    if (list.length < 2) return app.toast(`${own} não tem pai nem filhos para dobrar junto. Crie um osso filho dentro da imagem (ferramenta Osso, tecla 5).`);
    if (app.run({ cmd: "mesh.weights", args: { slot: slot.name, attachment: slot.attachment, bones: list } }, `${slot.attachment} dobra com ${list.join(", ")}`))
      app.avisar(`${slot.attachment} agora dobra com ${list.join(", ")}. Gire um deles para ver.`);
  }

  // ordem de desenho (o z): a logica fica no estado (Pose base muda o setup; animando vira
  // chave). Subir e descer passam pela proxima camada que encosta nesta na tela
  function order(dir: 1 | -1 | "front" | "back") {
    if (!slot) return;
    if (dir === "front") app.moveLayer(slot.name, app.layerOrder().length - 1);
    else if (dir === "back") app.moveLayer(slot.name, 0);
    else app.stepLayer(slot.name, dir);
  }
  // camadas que encostam nesta agora: para "na frente de" e "atras de"
  const neighbors = $derived.by(() => {
    app.version;
    app.play.time;
    const sk = app.viewer?.pose;
    if (!slot || !sk) return [] as string[];
    const me = slotWorldBox(sk, slot.name);
    if (!me) return [];
    return app.layerOrder().filter((o) => {
      if (o === slot.name) return false;
      const b = slotWorldBox(sk, o);
      return !!b && me[0] < b[2] && b[0] < me[2] && me[1] < b[3] && b[1] < me[3];
    }).reverse();
  });
  let relTo = $state("");

  // IK em um clique: o osso selecionado e o pai passam a alcancar um alvo na ponta
  function quickIk() {
    if (!bone || !app.doc) return;
    const b = app.doc.json.bones.find((x: any) => x.name === bone.name);
    const parent = app.doc.json.bones.find((x: any) => x.name === b?.parent);
    if (!parent?.parent) return app.toast("Alcançar precisa de um osso com pai (por exemplo, o antebraço preso ao braço).");
    const sk = app.viewer?.pose?.findBone(bone.name);
    if (!sk) return;
    const len = b.length || 20;
    // ponta do osso no mundo (visual, y para cima)
    let tx = sk.worldX + sk.a * len,
      ty = sk.worldY + sk.c * len;
    if (app.viewer?.flip) ty = -ty;
    const target = `${bone.name}_alvo`;
    const root = app.doc.json.bones[0].name;
    const ok = app.run(
      [
        { cmd: "bone.add", args: { name: target, parent: root, at: [tx, ty], color: "ff3f00ff" } },
        { cmd: "ik.create", args: { name: `${bone.name}_ik`, bones: [parent.name, bone.name], target } },
      ],
      `IK em ${parent.name} + ${bone.name}`,
    );
    if (ok) app.avisar(`Alcançar pronto: mova o osso ${target} (vermelho, na ponta) e ${parent.name} e ${bone.name} dobram sozinhos.`);
    app.select({ bone: target });
    app.tool = "move";
  }

  // constraints que envolvem o osso selecionado
  const cons = $derived.by(() => {
    app.version;
    const b = app.selection.bone;
    if (!b || !app.doc) return [];
    return (app.doc.json.constraints ?? [])
      .filter((c: any) => c.bone === b || c.target === b || c.source === b || c.bones?.includes(b))
      .map((c: any) => ({ name: c.name, type: c.type, strength: c.strength ?? 100, mix: c.mix ?? c.mixRotate ?? 1, target: c.target as string | undefined, bones: (c.bones ?? []) as string[], raw: c, index: (app.doc!.json.constraints ?? []).indexOf(c) }));
  });
  const totalCons = $derived((app.version, app.doc?.json.constraints?.length ?? 0));

  // renomear luz e emissor de particulas (dois cliques no nome)
  let renLista = $state<string | null>(null);
  let textoLista = $state("");
  function renomearLista() {
    const r = renLista;
    renLista = null;
    const para = textoLista.trim();
    if (!r || !para) return;
    const [tipo, de] = [r.slice(0, r.indexOf(":")), r.slice(r.indexOf(":") + 1)];
    if (para !== de) app.run({ cmd: tipo === "luz" ? "light.rename" : "particles.rename", args: { name: de, to: para } }, `renomeia ${de}`);
  }

  // acompanhar (pose.follow): numa animacao, a cadeia deste osso gira para ele manter a relacao da
  // Pose base com outro osso em cada instante (a mao que segura o oculos acompanha a cabeca)
  function acompanhar(alvo: string) {
    const j = app.doc?.json;
    const anim = app.play.animation;
    if (!j || !bone || !alvo || !anim) return;
    const pai = new Map<string, string>(j.bones.filter((b: any) => b.parent).map((b: any) => [b.name, b.parent]));
    const acima = (n: string) => {
      const out: string[] = [];
      for (let p: string | undefined = n; p; p = pai.get(p)) out.push(p);
      return out;
    };
    const doAlvo = new Set(acima(alvo));
    // os ancestrais deste osso que nao movem o alvo, do mais alto para o osso (no maximo 3)
    const cadeia = acima(bone.name).filter((n) => !doAlvo.has(n) && pai.has(n)).slice(0, 3).reverse();
    if (!cadeia.length) return app.toast(`${bone.name} e ${alvo} se movem juntos: não há o que girar.`);
    const r = app.run({ cmd: "pose.follow", args: { anim, bone: bone.name, relativeTo: alvo, chain: cadeia } }, `${bone.name} acompanha ${alvo} em ${anim}`);
    if (r) app.avisar(`${bone.name} acompanha ${alvo} em ${anim}, girando ${cadeia.join(" › ")} (chaves de girar). Ctrl+Z desfaz.`);
  }

  // ---- criar e mexer nas restricoes pela tela (2b, grupo 3)
  const nomeLivre = (base: string) => {
    const usados = new Set((app.doc?.json.constraints ?? []).map((c: any) => c.name));
    let n = base;
    for (let k = 2; usados.has(n); k++) n = `${base}_${k}`;
    return n;
  };
  // os ossos fora da cadeia de um osso (nem ele nem os que pendem dele)
  function forDe(osso: string): string[] {
    const j = app.doc?.json;
    if (!j) return [];
    return alvosPossiveis([osso]);
  }
  // os slots que tem uma parte caminho (path)
  const caminhos = $derived.by(() => {
    app.version;
    const j = app.doc?.json;
    if (!j) return [] as string[];
    const out = new Set<string>();
    for (const sk of j.skins ?? []) for (const [sl, ps] of Object.entries<any>(sk.attachments ?? {})) for (const a of Object.values<any>(ps)) if (a.type === "path") out.add(sl);
    return [...out];
  });
  function novaRestricao(tipo: string) {
    if (!bone) return;
    const b = bone.name;
    const anims = Object.keys(app.doc?.json.animations ?? {});
    let call: any = null;
    if (tipo === "copia") {
      const fonte = bone.parent && forDe(b).includes(bone.parent) ? bone.parent : forDe(b).find((x) => x !== "root") ?? forDe(b)[0];
      if (!fonte) return app.toast("Não há outro osso fora deste para copiar.");
      call = { cmd: "transform.create", args: { name: nomeLivre(`${b}_copia`), source: fonte, bones: [b], copy: ["rotate"] } };
    } else if (tipo === "caminho") {
      if (!caminhos.length) return app.toast("Não há caminho (parte path) neste personagem: crie um antes, e então o osso pode segui-lo.");
      call = { cmd: "pathc.create", args: { name: nomeLivre(`${b}_caminho`), bones: [b], target: caminhos[0], position: 0 } };
    } else if (tipo === "slider") {
      if (!anims.length) return app.toast("Crie uma animação antes: o slider faz este osso dirigir uma animação inteira.");
      call = { cmd: "slider.create", args: { name: nomeLivre(`${b}_slider`), animation: anims[0], bone: b, property: "rotate", from: 0, to: 90 } };
    } else if (tipo === "balanco") {
      call = { cmd: "physics.preset", args: { bone: b, preset: "cabelo", name: nomeLivre(`${b}_fisica`) } };
    }
    if (call && app.run(call, `restrição ${tipo} em ${b}`)) app.avisar(`${call.args.name} criada em ${b}: os controles estão logo abaixo.`);
  }
  const conSet = (nome: string, props: any, label: string) => app.run({ cmd: "constraint.set", args: { name: nome, props } }, label);
  // copia: o que copiar (girar, mover, escala) vira o mapa properties do 4.3
  const COPIA: [string, string, string[]][] = [
    ["rotate", "girar", ["rotate"]],
    ["xy", "mover", ["x", "y"]],
    ["scale", "escala", ["scaleX", "scaleY"]],
  ];
  const copiaTem = (c: any, k: string) => COPIA.find((x) => x[0] === k)![2].some((p) => c.properties?.[p]);
  function copiaTroca(c: any, k: string, liga: boolean) {
    const props = { ...(c.properties ?? {}) };
    for (const p of COPIA.find((x) => x[0] === k)![2]) {
      if (liga) props[p] = { to: { [p]: {} } };
      else delete props[p];
    }
    conSet(c.name, { properties: props }, `${c.name} copia ${k}`);
  }
  function copiaMix(c: any, v: number) {
    conSet(c.name, { mixRotate: v, mixX: v, mixY: v, mixScaleX: v, mixScaleY: v, mixShearY: v }, `mix ${c.name}`);
  }
  let renCon = $state<string | null>(null);
  let textoCon = $state("");
  function renomearCon() {
    const de = renCon;
    renCon = null;
    const para = textoCon.trim();
    if (de && para && para !== de) app.run({ cmd: "constraint.rename", args: { name: de, to: para } }, `renomeia ${de}`);
  }
  function ordemCon(nome: string, i: number) {
    if (i < 0 || i >= totalCons) return;
    if (app.run({ cmd: "constraint.order", args: { name: nome, index: i } }, `ordem de ${nome}`)) app.avisar(`${nome} agora é a ${i + 1}ª a ser aplicada (a ordem importa quando uma depende da outra).`);
  }
  // ossos que podem ser alvo de um IK: nenhum da cadeia nem pendurado nela (o alvo seguiria a
  // propria cadeia que ele move)
  function alvosPossiveis(cadeia: string[]): string[] {
    const j = app.doc?.json;
    if (!j) return [];
    const fora = new Set(cadeia);
    let cresceu = true;
    while (cresceu) {
      cresceu = false;
      for (const b of j.bones) if (b.parent && fora.has(b.parent) && !fora.has(b.name)) (fora.add(b.name), (cresceu = true));
    }
    return j.bones.map((b: any) => b.name).filter((n: string) => !fora.has(n));
  }
  function trocarAlvo(ik: string, alvo: string) {
    if (app.run({ cmd: "constraint.set", args: { name: ik, props: { target: alvo } } }, `alvo de ${ik} = ${alvo}`)) app.avisar(`${ik} agora alcança ${alvo}: mover ${alvo} dobra a cadeia. Ctrl+Z desfaz.`);
  }
  const CTYPE: Record<string, string> = { physics: "balanco", ik: "IK (alcance)", transform: "copia", path: "caminho", slider: "slider" };

  let fineOpen = $state(false);
  let scrub: { k: string; x: number; v: number; step: number; merge: string } | null = null;
  let seq = 0;

  function set(k: string, v: number, merge?: string) {
    if (!bone) return;
    applyLocal(bone.name, { [k]: v }, merge);
  }

  // arrastar o rotulo muda o valor (como no Blender/Spine)
  function labelDown(e: PointerEvent, k: string, step: number) {
    if (!bone) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub = { k, x: e.clientX, v: bone.values[k], step, merge: `insp${++seq}` };
  }
  function labelMove(e: PointerEvent) {
    if (!scrub) return;
    const dx = e.clientX - scrub.x;
    set(scrub.k, scrub.v + dx * scrub.step * (e.shiftKey ? 0.1 : 1), scrub.merge);
  }

  function slotSet(args: Record<string, any>) {
    if (!slot) return;
    if (app.mode === "animate" && app.play.animation && "attachment" in args) {
      app.run({ cmd: "key.set", args: { anim: app.play.animation, target: { slot: slot.name }, timeline: "attachment", time: +app.play.time.toFixed(4), name: args.attachment } });
      return;
    }
    app.run({ cmd: "slot.set", args: { slot: slot.name, ...args } });
  }
</script>

<div class="insp">
  {#if bone}
    <div class="title">
      <span class="ico">🦴</span>
      {#if renomeando?.tipo === "osso" && renomeando.de === bone.name}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="ren" bind:value={textoRen} onkeydown={(e) => (e.key === "Enter" ? renomear() : e.key === "Escape" && (renomeando = null))} onblur={renomear} autofocus />
      {:else}
        <button class="nome-t" ondblclick={() => comecaRen("osso", bone.name)} title="dois cliques para renomear (tudo que aponta para ele acompanha)">{bone.name}</button>
      {/if}
      {#if bone.parent}<button class="lixo" class:armado={forcarOsso === bone.name} onclick={() => apagarOsso(bone.name)} title="apagar o osso, com os filhos e as camadas presas neles (Ctrl+Z desfaz)">🗑</button>{/if}
    </div>
    {#if app.skin}
      <label class="so-skin" title="Osso exclusivo da skin {app.skin}: só fica ativo (e só mostra o que pende dele) com ela">
        <input type="checkbox" checked={soNaSkin} onchange={(e) => trocaSoNaSkin((e.target as HTMLInputElement).checked)} /> só na skin {app.skin}
      </label>
    {/if}
    <div class="dim small">pai: {bone.parent ?? "(raiz)"} · {app.mode === "animate" && app.play.animation ? `chave em ${app.play.time.toFixed(2)}s` : "pose de montagem"}</div>
    {#if (app.doc?.json as any)?.screen}<Ancora osso={bone.name} />{/if}
    {#if ehBoneco || (app.doc?.json as any)?.screen || (app.doc?.json as any)?.roles}<Papel osso={bone.name} />{/if}
    <details class="fine" open={fineOpen} ontoggle={(e) => (fineOpen = (e.target as HTMLDetailsElement).open)}>
      <summary>ajuste fino</summary>
    <div class="fields">
      {#each FIELDS as f}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <label for="campo-{f.k}" title="Arraste o nome para os lados para mudar o valor" onpointerdown={(e) => labelDown(e, f.k, f.step)} onpointermove={labelMove} onpointerup={() => (scrub = null)}>{f.label}</label>
        <input id="campo-{f.k}" type="number" step={f.step} value={bone.values[f.k]} onchange={(e) => set(f.k, +(e.target as HTMLInputElement).value)} />
      {/each}
    </div>
    </details>
    <div class="quick">
      <button onclick={quickIk} title="O osso e o pai passam a alcançar um alvo: mova o alvo e o membro dobra sozinho">🎯 Alcançar (IK)</button>
      <button onclick={() => newDrawnPart(bone.name)} title="Uma peça nova presa a este osso, desenhada com a caneta (vetor, como no Figma)">✒️ Desenhar peça nova</button>
      {#if ehBoneco && bone.parent}<button onclick={() => extrair(bone.name)} title="Leva este osso e o que pende dele (camadas, partes, restrições, animações) para um .boneco novo ao lado deste, e põe no lugar uma instância dele. Salva antes">📦 Extrair para .boneco</button>{/if}
      {#if animando}
        <select value="" onchange={(e) => { acompanhar((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="Nesta animação, este osso mantém em cada instante a relação que tem com outro na Pose base (a mão que segura os óculos acompanha a cabeça): a cadeia dele gira e vira chave">
          <option value="">🤝 acompanhar…</option>
          {#each (app.doc?.json.bones ?? []).map((b: any) => b.name).filter((n: string) => n !== bone.name) as n}<option value={n}>{n}</option>{/each}
        </select>
      {/if}
      <select value="" onchange={(e) => { novaRestricao((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="uma restrição neste osso">
        <option value="">+ restrição…</option>
        <option value="copia">copiar outro osso (girar, mover, escala)</option>
        <option value="caminho">seguir um caminho</option>
        <option value="slider" title="girar (ou mover, escalar) este osso percorre uma animação inteira">dirigir uma animação (slider)</option>
        <option value="balanco">balanço (física)</option>
      </select>
      <select value="" onchange={(e) => { const t = (e.target as HTMLSelectElement).value as any; (e.target as HTMLSelectElement).value = ""; if (t) app.comecarCaptura(t, bone.name, app.selection.slot ?? null); }} title="uma parte especial numa camada nova presa a este osso: você clica os pontos na tela">
        <option value="">+ parte especial…</option>
        <option value="clipping">✂ recorte (máscara{app.selection.slot ? ` de ${app.selection.slot}` : ""})</option>
        <option value="boundingbox">▢ caixa de clique e colisão</option>
        <option value="path">〰 caminho (para um osso seguir)</option>
        <option value="point">• ponto (para prender efeitos no jogo)</option>
      </select>
    </div>
    {#if cons.length}
      <div class="cons">
        {#each cons as c (c.name)}
          <div class="con">
            <span class="ctype">{CTYPE[c.type] ?? c.type}</span>
            {#if renCon === c.name}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="ren" bind:value={textoCon} onkeydown={(e) => (e.key === "Enter" ? renomearCon() : e.key === "Escape" && (renCon = null))} onblur={renomearCon} autofocus />
            {:else}
              <button class="cname nome-t" title="{c.name} · dois cliques para renomear · {c.index + 1}ª a ser aplicada" ondblclick={() => ((renCon = c.name), (textoCon = c.name))}>{c.name}</button>
            {/if}
            <span class="ord">
              <button class="x" disabled={c.index <= 0} title="aplicar antes" onclick={() => ordemCon(c.name, c.index - 1)}>↑</button>
              <button class="x" disabled={c.index >= totalCons - 1} title="aplicar depois" onclick={() => ordemCon(c.name, c.index + 1)}>↓</button>
              <button class="x" title="remover" onclick={() => app.run({ cmd: "constraint.delete", args: { name: c.name } })}>✕</button>
            </span>
            {#if c.type === "transform"}
              <label class="alvo-ik" title="o osso de onde vem o movimento">de
                <select value={c.raw.source} onchange={(e) => conSet(c.name, { source: (e.target as HTMLSelectElement).value }, `fonte de ${c.name}`)}>
                  {#each alvosPossiveis(c.bones) as n}<option value={n}>{n}</option>{/each}
                </select>
              </label>
              <span class="copia">
                {#each COPIA as [k, rot]}
                  <label><input type="checkbox" checked={copiaTem(c.raw, k)} onchange={(e) => copiaTroca(c.raw, k, (e.target as HTMLInputElement).checked)} /> {rot}</label>
                {/each}
              </span>
              <label class="slider" title="quanto copia (0..1)">mix <input type="range" min="0" max="1" step="0.05" value={c.mix} onchange={(e) => copiaMix(c.raw, +(e.target as HTMLInputElement).value)} /></label>
            {:else if c.type === "path"}
              <label class="alvo-ik" title="a camada com o caminho (parte path) que o osso segue">caminho
                <select value={c.raw.slot ?? c.raw.target} onchange={(e) => conSet(c.name, { slot: (e.target as HTMLSelectElement).value }, `caminho de ${c.name}`)}>
                  {#each caminhos as n}<option value={n}>{n}</option>{/each}
                </select>
              </label>
              <label class="slider" title="onde o osso fica ao longo do caminho (0 no começo, 1 no fim); numa animação, vire chave pela timeline">posição <input type="range" min="0" max="1" step="0.01" value={c.raw.position ?? 0} oninput={(e) => app.run({ cmd: "constraint.set", args: { name: c.name, props: { position: +(e.target as HTMLInputElement).value } } }, `posição ${c.name}`, `pos-${c.name}`, true)} /></label>
              <label class="slider" title="quanto vale (0..1)">mix <input type="range" min="0" max="1" step="0.05" value={c.raw.mixRotate ?? 1} onchange={(e) => { const v = +(e.target as HTMLInputElement).value; conSet(c.name, { mixRotate: v, mixX: v, mixY: v }, `mix ${c.name}`); }} /></label>
            {:else if c.type === "slider"}
              <label class="alvo-ik" title="a animação que este osso dirige">anima
                <select value={c.raw.animation} onchange={(e) => conSet(c.name, { animation: (e.target as HTMLSelectElement).value }, `animação de ${c.name}`)}>
                  {#each Object.keys(app.doc?.json.animations ?? {}) as n}<option value={n}>{n}</option>{/each}
                </select>
              </label>
              <label class="alvo-ik" title="a propriedade do osso que dirige">por
                <select value={c.raw.property ?? "rotate"} onchange={(e) => conSet(c.name, { property: (e.target as HTMLSelectElement).value }, `propriedade de ${c.name}`)}>
                  {#each [["rotate", "giro"], ["x", "x"], ["y", "y"], ["scaleX", "escala x"], ["scaleY", "escala y"], ["shearY", "cisalha y"]] as [v, t]}<option value={v}>{t}</option>{/each}
                </select>
              </label>
              <span class="copia" title="de quanto a quanto a propriedade percorre a animação inteira">
                <label>de <input class="num-c" type="number" value={c.raw.from ?? 0} onchange={(e) => conSet(c.name, { from: +(e.target as HTMLInputElement).value }, `de ${c.name}`)} /></label>
                <label>até <input class="num-c" type="number" value={c.raw.to ?? 0} onchange={(e) => conSet(c.name, { to: +(e.target as HTMLInputElement).value }, `até ${c.name}`)} /></label>
              </span>
              <span class="copia">
                <label title="a propriedade do osso em relação ao pai (sem marcar: no mundo)"><input type="checkbox" checked={!!c.raw.local} onchange={(e) => conSet(c.name, { local: (e.target as HTMLInputElement).checked }, `local ${c.name}`)} /> local</label>
                <label title="soma a animação dirigida por cima do que já está (sem marcar: substitui)"><input type="checkbox" checked={!!c.raw.additive} onchange={(e) => conSet(c.name, { additive: (e.target as HTMLInputElement).checked }, `somar ${c.name}`)} /> somar</label>
                <label title="passando do fim, a animação volta ao começo (sem marcar: para no fim)"><input type="checkbox" checked={!!c.raw.loop} onchange={(e) => conSet(c.name, { loop: (e.target as HTMLInputElement).checked }, `repetir ${c.name}`)} /> repetir</label>
              </span>
              <label class="slider" title="quanto vale (0..1)">mix <input type="range" min="0" max="1" step="0.05" value={c.raw.mix ?? 1} onchange={(e) => conSet(c.name, { mix: +(e.target as HTMLInputElement).value }, `mix ${c.name}`)} /></label>
            {:else if c.type === "physics"}
              <label class="slider" title="mole ↔ duro">mole <input type="range" min="20" max="300" value={c.strength} onchange={(e) => app.run({ cmd: "constraint.set", args: { name: c.name, props: { strength: +(e.target as HTMLInputElement).value } } }, `dureza ${c.name}`)} /> duro</label>
            {:else}
              {#if c.type === "ik"}
                <label class="alvo-ik" title="O osso que a cadeia ({c.bones.join(', ')}) alcança. Pode ser um osso que já existe, como um controle da mão">alvo
                  <select value={c.target} onchange={(e) => trocarAlvo(c.name, (e.target as HTMLSelectElement).value)}>
                    {#each alvosPossiveis(c.bones) as n}<option value={n}>{n}</option>{/each}
                  </select>
                </label>
              {/if}
              <label class="slider" title="quanto vale (0..1)">mix <input type="range" min="0" max="1" step="0.05" value={c.mix} onchange={(e) => app.run({ cmd: "constraint.set", args: { name: c.name, props: { mix: +(e.target as HTMLInputElement).value } } }, `mix ${c.name}`)} /></label>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if ehBoneco}
      <div class="efeitos">
        <div class="dim small secao" title="Luzes presas a este osso: iluminam as partes que têm relevo. {animando ? 'Mexer grava chave neste instante.' : 'Na Pose base muda o valor inicial.'}">
          Luzes{#if semRelevo}&nbsp;· <span title="As imagens deste personagem ainda não têm relevo (mapa de normais), então a luz não aparece nelas. O relevo sai da própria arte (docs/NUCLEO.md, Luzes).">sem relevo ainda</span>{/if}
          <button class="relevo-b" disabled={app.relevoRodando} onclick={() => app.gerarRelevo()} title="Calcula o relevo (mapa de normais) das páginas a partir da própria arte, para as luzes iluminarem as peças. Salva o personagem antes; volta pelas Versões">{app.relevoRodando ? "calculando…" : semRelevo ? "gerar relevo" : "refazer relevo"}</button>
        </div>
        {#each luzesDoOsso as l (l.n)}
          <div class="ef">
            <div class="efnome" title="luz presa em {bone.name}">
              {#if renLista === `luz:${l.n}`}
                <!-- svelte-ignore a11y_autofocus -->
                <input class="ren" bind:value={textoLista} onkeydown={(e) => (e.key === "Enter" ? renomearLista() : e.key === "Escape" && (renLista = null))} onblur={renomearLista} autofocus />
              {:else}
                <button class="nome-t" ondblclick={() => ((renLista = `luz:${l.n}`), (textoLista = l.n))} title="dois cliques para renomear">💡 {l.n}</button>
              {/if}
              <input type="color" value={"#" + l.v.color.slice(0, 6)} title="cor" oninput={(e) => setLuz(l.n, "color", (e.target as HTMLInputElement).value.slice(1) + l.v.color.slice(6, 8))} />
              {#if !animando}<button class="tira" onclick={() => app.run({ cmd: "light.delete", args: { name: l.n } }, `apaga ${l.n}`)} title="apagar a luz">✕</button>{/if}
            </div>
            {#each CAMPOS_LUZ as c}
              <label class="efcampo" title={c.dica}>
                <span>{c.label}</span>
                <input type="range" min={c.min} max={c.max} step={c.step} value={l.v[c.k]} oninput={(e) => setLuz(l.n, c.k, +(e.target as HTMLInputElement).value)} />
                <span class="num">{(+l.v[c.k]).toFixed(c.step < 1 ? 2 : 0)}</span>
              </label>
            {/each}
          </div>
        {/each}
        {#if ambiente}
          <div class="ef">
            <div class="efnome" title="a luz que chega em tudo que tem relevo, somada as luzes">
              <span>ambiente</span>
              <input type="color" value={"#" + ambiente.color.slice(0, 6)} title="cor" oninput={(e) => setAmbiente("color", (e.target as HTMLInputElement).value.slice(1) + ambiente!.color.slice(6, 8))} />
            </div>
            <label class="efcampo" title="1: as cores como são; abaixo, o que nenhuma luz alcanca escurece">
              <span>força</span>
              <input type="range" min="0" max="2" step="0.05" value={ambiente.strength} oninput={(e) => setAmbiente("strength", +(e.target as HTMLInputElement).value)} />
              <span class="num">{(+ambiente.strength).toFixed(2)}</span>
            </label>
          </div>
        {/if}
        {#if !animando}<button onclick={novaLuz} title="uma luz presa a este osso (anda com ele)">+ luz</button>{/if}
      </div>
    {/if}
    {#if ehBoneco && !animando}
      <div class="linha-texto"><button onclick={novoTexto} title="uma parte de texto (com tradução) numa camada nova presa a este osso">+ texto</button></div>
    {/if}
    {#if ehBoneco && !(app.doc?.json as any)?.screen}
      <Ancora osso={bone.name} />
    {/if}
  {:else}
    <div class="dim">Clique numa parte do personagem para escolher.</div>
  {/if}

  {#if slot}
    <div class="title slot">
      <span class="ico">🖼</span>
      {#if renomeando?.tipo === "slot" && renomeando.de === slot.name}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="ren" bind:value={textoRen} onkeydown={(e) => (e.key === "Enter" ? renomear() : e.key === "Escape" && (renomeando = null))} onblur={renomear} autofocus />
      {:else}
        <button class="nome-t" ondblclick={() => comecaRen("slot", slot.name)} title="dois cliques para renomear a camada (animações e skins acompanham)">{slot.name}</button>
      {/if}
      <button class="lixo" onclick={() => apagarSlot(slot.name)} title="apagar a camada, com as imagens e as chaves dela (Ctrl+Z desfaz)">🗑</button>
    </div>
    <div class="dim small">
      Camada: muda qual imagem aparece, cor, transparência, ordem e malha. Quem move esta imagem e o osso
      <b>{app.selection.bone ?? slot.bone}</b>{(app.selection.bone ?? slot.bone) !== slot.bone ? ` (pelos pesos da malha; a camada fica presa em ${slot.bone})` : ""}: arrastar na tela move o osso.
    </div>
    <div class="fields">
      <label for="slot-imagem">imagem</label>
      <div class="imagem-linha">
        {#if renomeando?.tipo === "parte" && slot.attachment && renomeando.de === slot.attachment}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="ren" bind:value={textoRen} onkeydown={(e) => (e.key === "Enter" ? renomear() : e.key === "Escape" && (renomeando = null))} onblur={renomear} autofocus />
        {:else}
          <select id="slot-imagem" value={slot.attachment ?? ""} onchange={(e) => slotSet({ attachment: (e.target as HTMLSelectElement).value || null })}>
            <option value="">(nenhuma)</option>
            {#each slot.atts as a}<option value={a}>{a}</option>{/each}
          </select>
        {/if}
        {#if slot.attachment}
          <button class="lixo" onclick={() => comecaRen("parte", slot.attachment)} title="renomear esta imagem da camada (as chaves de troca acompanham)">✎</button>
          <button class="lixo" onclick={() => apagarParte(slot.attachment)} title="tirar esta imagem da camada (Ctrl+Z desfaz)">🗑</button>
        {/if}
      </div>
      {#if imagemNoOsso}
        <span class="rotulo" title="Onde a imagem fica dentro do osso da peça (vale para todas as animações). Na tela: Ctrl + arrastar, na Pose base">no osso</span>
        <div class="imagem-osso">
          {#each [["x", "x", 1], ["y", "y", 1], ["rotation", "giro", 1], ["scaleX", "esc x", 0.05], ["scaleY", "esc y", 0.05]] as [k, rot, passo]}
            <label class="mini-campo">{rot}<input type="number" step={passo} value={+(imagemNoOsso as any)[k].toFixed(2)} onchange={(e) => setImagem(k as string, +(e.target as HTMLInputElement).value)} /></label>
          {/each}
        </div>
      {/if}
      <label for="slot-mistura">mistura</label>
      <select id="slot-mistura" value={slot.blend ?? "normal"} onchange={(e) => slotSet({ blend: (e.target as HTMLSelectElement).value })}>
        <option value="normal">normal</option>
        <option value="additive">brilho (aditivo)</option>
        <option value="multiply">multiplicar</option>
        <option value="screen">tela</option>
        {#if ehBoneco}
          <optgroup label="leem o que está embaixo (núcleo)">
            <option value="overlay">sobrepor</option>
            <option value="softLight">luz suave</option>
            <option value="darken">escurecer</option>
            <option value="lighten">clarear</option>
            <option value="difference">diferença</option>
            <option value="colorDodge">subexpor</option>
          </optgroup>
        {/if}
      </select>
      {#if slot.blend === "multiply" || slot.blend === "screen"}
        <span></span>
        <div class="dim">
          {slot.blend === "multiply"
            ? "No jogo (spine-godot) multiplicar ignora a transparência: a imagem inteira escurece o fundo, inclusive as bordas transparentes."
            : "No jogo (spine-godot) tela vira subtração: escurece em vez de clarear."}
        </div>
      {/if}
      {#if ["overlay", "softLight", "darken", "lighten", "difference", "colorDodge"].includes(slot.blend)}
        <span></span>
        <div class="dim">Mistura com o que já está desenhado embaixo. Só no desenho do núcleo e no jogo pelo BonecoSprite; nesta camada efeitos e luz não valem, e cada uma custa uma cópia da tela.</div>
      {/if}
      <span class="rotulo">camada</span>
      <div class="order">
        <button onclick={() => order("back")} title="Para trás de tudo">⇊</button>
        <button onclick={() => order(-1)} title="Para trás da próxima camada que encosta nesta (PageDown)">↓</button>
        <button onclick={() => order(1)} title="Para a frente da próxima camada que encosta nesta (PageUp)">↑</button>
        <button onclick={() => order("front")} title="Na frente de tudo (Shift+PageUp)">⇈</button>
      </div>
      {#if neighbors.length}
        <span></span>
        <div class="order rel">
          <select bind:value={relTo} title="camadas que encostam nesta agora">
            <option value="">encosta em...</option>
            {#each neighbors as n}<option value={n}>{n}</option>{/each}
          </select>
          <button disabled={!relTo} onclick={() => relTo && slot && app.placeLayer(slot.name, relTo, "front")} title="Na frente desta camada">na frente</button>
          <button disabled={!relTo} onclick={() => relTo && slot && app.placeLayer(slot.name, relTo, "back")} title="Atrás desta camada">atrás</button>
        </div>
      {/if}
      {#if desenho}
        <span></span>
        <div class="mesh">
          {#if app.drawEdit?.slot !== slot.name}
            <button class="edit" onclick={() => startDrawEdit(slot.name)} title="Mexer nas formas desta imagem com a caneta e a seleção (vai para a Pose base). Atalho: dois cliques na peça">✏️ Desenhar</button>
          {/if}
        </div>
      {/if}
      {#if app.drawEdit?.slot === slot.name}
        <div class="wide"><DrawPanel /></div>
      {/if}
      {#if attKind?.type === "text" && slot.attachment}
        <div class="wide"><Texto slot={slot.name} parte={slot.attachment} /></div>
      {/if}
      {#if attKind?.type === "region" && slot.attachment && !desenho}
        <div class="wide"><NoveFatias slot={slot.name} parte={slot.attachment} /></div>
      {/if}
      {#if attKind && !desenho && (attKind.type === "region" || attKind.type === "mesh")}
        <span></span>
        <div class="mesh">
          <button onclick={() => abrirDesenhar()} title="Transforma esta imagem em desenho vetorial (cada cor vira uma camada de formas com curvas) e abre o Desenhar; Ctrl+Z volta para a imagem">✒️ Vetorizar e desenhar</button>
        </div>
      {/if}
      {#if attKind && !desenho && attKind.type !== "text"}
        <span></span>
        <div class="mesh">
          {#if attKind.type === "region"}
            <button onclick={makeMesh} title="Transforma a imagem em malha, para deformar com o pincel">🫧 Deixar deformável</button>
            {#if sequencia}
              <button onclick={virarSequencia} title="As imagens {sequencia.base}{sequencia.sep}1 a {sequencia.base}{sequencia.sep}{sequencia.n} passam a ser quadros desta imagem (flipbook); o quadro mostrado anima pela timeline (sequência)">🎞 Virar sequência ({sequencia.n} quadros)</button>
            {/if}
          {:else if attKind.type === "mesh" || attKind.type === "linkedmesh"}
            {#if attKind.type === "mesh"}
              <button onclick={bindToBones} title="Prende a malha aos ossos proximos, para dobrar junto">🦴 {attKind.weighted ? "Refazer dobra" : "Dobrar com os ossos"}</button>
              {#if attKind.weighted}
                <button onclick={() => app.run({ cmd: "mesh.unbind", args: { slot: slot.name, attachment: slot.attachment, skin: app.skinDe(slot.name, slot.attachment) } }, `solta ${slot.attachment} dos ossos`) && app.avisar(`${slot.attachment} não tem mais pesos: segue só o osso da camada, na forma da Pose base.`)} title="Tira os pesos: a malha volta a seguir só o osso da camada">✂ Soltar dos ossos</button>
              {/if}
              <select value="" onchange={(e) => { malhaLigada((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="Outra imagem que usa esta mesma malha e os mesmos pesos (troca de textura que dobra igual)">
                <option value="">+ malha ligada com a imagem…</option>
                {#each imagensAtlas as im}<option value={im}>{im}</option>{/each}
              </select>
            {/if}
            {#if app.meshEdit?.slot !== slot.name}
              <button class="edit" onclick={() => startMeshEdit(slot.name, slot.attachment)} title="Mover, criar e apagar pontos da malha e pintar quanto cada osso puxa (vai para a Pose base)">✏️ Editar malha</button>
            {/if}
          {/if}
        </div>
      {/if}
      {#if app.meshEdit?.slot === slot.name}
        <div class="wide"><MeshPanel /></div>
      {/if}
      {#if color}
        <label for="slot-cor">cor</label>
        <div class="color">
          <input id="slot-cor" type="color" value={color.rgb} oninput={(e) => setColor((e.target as HTMLInputElement).value, color.a)} />
          <input type="range" min="0" max="1" step="0.01" value={color.a} title="transparência" oninput={(e) => setColor(color.rgb, +(e.target as HTMLInputElement).value)} />
        </div>
      {/if}
    </div>
    {#if ehBoneco}
      <div class="efeitos">
        <div class="dim small secao" title="Outro .boneco desenhado no lugar desta camada (na ordem de desenho dela), preso ao osso dela, tocando a animação dele">◆ Instâncias</div>
        {#each instancias as i (i.name)}
          {@const f = doFilho[caminhoFilho(i.boneco)]}
          <div class="ef">
            <div class="efnome">
              {#if renInst === i.name}
                <!-- svelte-ignore a11y_autofocus -->
                <input class="ren" bind:value={textoInst} onkeydown={(e) => (e.key === "Enter" ? renomearInst() : e.key === "Escape" && (renInst = null))} onblur={renomearInst} autofocus />
              {:else}
                <button class="nome-t" ondblclick={() => ((renInst = i.name), (textoInst = i.name))} title="{i.boneco} · dois cliques para renomear">◆ {i.name}</button>
              {/if}
              <button onclick={() => app.entrarInstancia(i.name)} title="abrir {i.boneco} para editar (← no topo volta)">entrar ↳</button>
              <button onclick={() => embutir(i.name)} title="trazer o filho para dentro deste personagem (o caminho de volta do extrair)">embutir</button>
              <button class="tira" onclick={() => app.run({ cmd: "instance.delete", args: { name: i.name } }, `apaga ${i.name}`)} title="apagar a instância">✕</button>
            </div>
            <label class="efcampo" title="a animação do filho (sem: a pose de montagem dele)">
              <span>anima</span>
              <select value={i.animation ?? ""} onchange={(e) => instSet(i.name, "animation", (e.target as HTMLSelectElement).value || undefined)}>
                <option value="">(pose de montagem)</option>
                {#each animsDe(i, f) as a}<option value={a}>{a}</option>{/each}
              </select>
              <span></span>
            </label>
            {#if (f?.skins.length ?? 0) > 1}
              <label class="efcampo">
                <span>skin</span>
                <select value={i.skin ?? "default"} onchange={(e) => instSet(i.name, "skin", (e.target as HTMLSelectElement).value)}>
                  {#each f!.skins as s}<option value={s}>{s}</option>{/each}
                </select>
                <span></span>
              </label>
            {/if}
            <label class="efcampo" title="o tempo do filho anda nessa velocidade">
              <span>velocidade</span>
              <input type="range" min="0" max="3" step="0.05" value={i.speed ?? 1} oninput={(e) => instSet(i.name, "speed", +(e.target as HTMLInputElement).value, true)} />
              <span class="num">{(i.speed ?? 1).toFixed(2)}</span>
            </label>
            <label class="efcampo" title="de onde a animação do filho começa (segundos)">
              <span>começa em</span>
              <input type="range" min="0" max="5" step="0.05" value={i.start ?? 0} oninput={(e) => instSet(i.name, "start", +(e.target as HTMLInputElement).value, true)} />
              <span class="num">{(i.start ?? 0).toFixed(2)}</span>
            </label>
            <label class="efcampo"><span>repete</span><input type="checkbox" checked={i.loop !== false} onchange={(e) => instSet(i.name, "loop", (e.target as HTMLInputElement).checked)} /><span></span></label>
            <div class="imagem-osso">
              {#each [["x", "x", 1], ["y", "y", 1], ["rotation", "giro", 1], ["scaleX", "esc x", 0.05], ["scaleY", "esc y", 0.05]] as [k, rot, passo]}
                <label class="mini-campo">{rot}<input type="number" step={passo} value={+(i[k as string] ?? (String(k).startsWith("scale") ? 1 : 0)).toFixed(2)} onchange={(e) => instSet(i.name, k as string, +(e.target as HTMLInputElement).value)} /></label>
              {/each}
            </div>
            {#if !animando}
              {@const ator = atorDe(i.name)}
              {#if !ator}
                <label class="efcampo" title="o palco (docs/PALCO.md): a simulação move esta instância como um personagem do jogo">
                  <span>🎮 ator</span>
                  <select value="" onchange={(e) => tornarAtor(i.name, (e.target as HTMLSelectElement).value)}>
                    <option value="">(não é ator)</option>
                    {#each TIPOS_ATOR as [t, rot]}<option value={t}>{rot}</option>{/each}
                  </select>
                  <span></span>
                </label>
              {:else}
                <div class="ator">
                  <label class="efcampo" title="o papel no jogo">
                    <span>🎮 ator</span>
                    <select value={ator.type} onchange={(e) => atorSet(ator.name, { type: (e.target as HTMLSelectElement).value })}>
                      {#each TIPOS_ATOR as [t, rot]}<option value={t}>{rot}</option>{/each}
                    </select>
                    <button class="tira" onclick={() => app.run({ cmd: "stage.remove", args: { name: ator.name } }, `${ator.name} deixa de ser ator`)} title="deixa de ser ator (a instância fica)">✕</button>
                  </label>
                  <div class="imagem-osso" title="a caixa que colide: largura e altura, com o meio de baixo nos pés (o osso)">
                    <label class="mini-campo">caixa L<input type="number" min="1" value={ator.box?.[0] ?? 16} onchange={(e) => atorSet(ator.name, { box: [+(e.target as HTMLInputElement).value, ator.box?.[1] ?? 16] })} /></label>
                    <label class="mini-campo">A<input type="number" min="1" value={ator.box?.[1] ?? 16} onchange={(e) => atorSet(ator.name, { box: [ator.box?.[0] ?? 16, +(e.target as HTMLInputElement).value] })} /></label>
                    {#if ator.type === "player" || ator.type === "patrol"}
                      <label class="mini-campo">velocidade<input type="number" min="0" step="10" value={ator.speed ?? (ator.type === "patrol" ? 40 : 100)} onchange={(e) => atorSet(ator.name, { speed: +(e.target as HTMLInputElement).value })} /></label>
                    {/if}
                    {#if ator.type === "player"}
                      <label class="mini-campo">pulo<input type="number" min="0" step="10" value={ator.jump ?? 300} onchange={(e) => atorSet(ator.name, { jump: +(e.target as HTMLInputElement).value })} /></label>
                    {/if}
                    {#if ator.type === "patrol"}
                      <label class="mini-campo">começa olhando<select value={String(ator.side ?? 1)} onchange={(e) => atorSet(ator.name, { side: +(e.target as HTMLSelectElement).value })}><option value="1">→</option><option value="-1">←</option></select></label>
                    {/if}
                  </div>
                  {#if ator.type === "player" || ator.type === "patrol"}
                    <div class="imagem-osso" title="a animação do boneco em cada estado (sem: a de mesmo nome, se houver)">
                      {#each [["idle", "parado"], ["walk", "andando"], ["jump", "pulo"], ["dead", "morto"]] as [k, rot]}
                        <label class="mini-campo">{rot}<select value={ator.animations?.[k] ?? ""} onchange={(e) => atorSet(ator.name, { animations: { [k]: (e.target as HTMLSelectElement).value || undefined } })}>
                          <option value="">({rot})</option>
                          {#each animsDe(i, f) as a}<option value={a}>{a}</option>{/each}
                        </select></label>
                      {/each}
                    </div>
                  {/if}
                  <label class="efcampo" title="a gravidade do palco inteiro, px/s² para baixo">
                    <span>gravidade</span>
                    <input type="range" min="0" max="4000" step="50" value={palco?.gravity ?? 900} oninput={(e) => app.run({ cmd: "stage.set", args: { gravity: +(e.target as HTMLInputElement).value } }, "gravidade do palco", "palco-gravidade", true)} />
                    <span class="num">{palco?.gravity ?? 900}</span>
                  </label>
                </div>
              {/if}
            {/if}
          </div>
        {/each}
        {#if !animando && bonecosPossiveis.length}
          <select value="" onchange={(e) => { novaInstancia((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="outro .boneco desenhado no lugar desta camada">
            <option value="">+ instância de…</option>
            {#each bonecosPossiveis as b}<option value={b.rel}>{b.nome}</option>{/each}
          </select>
        {/if}
      </div>
    {/if}
    {#if geleiaOuMalha}
      <div class="efeitos">
        <div class="dim small secao" title="Vira a malha como um cilindro (cabeça, tronco, objeto redondo): os traços deslizam, a borda que se afasta encolhe. Grava uma chave de deformar no instante da régua. A malha precisa ter pontos por dentro.">🔄 Girar em 2,5D</div>
        {#if animando}
          <div class="ef">
            {#each [["vira", "vira", "para os lados (à direita: positivo)"], ["olha", "olha", "para cima e para baixo"]] as [k, rot, dica]}
              <label class="efcampo" title={dica}>
                <span>{rot}</span>
                <input type="range" min="-60" max="60" step="1" value={(giro as any)[k]} oninput={(e) => (((giro as any)[k] = +(e.target as HTMLInputElement).value), girar())} onchange={() => giroSeq++} />
                <span class="num">{(giro as any)[k]}°</span>
              </label>
            {/each}
            <label class="efcampo" title="quanto a borda que se afasta encolhe">
              <span>perspectiva</span>
              <input type="range" min="0" max="1" step="0.05" bind:value={giro.persp} onchange={() => (giro.vira || giro.olha) && (girar(), giroSeq++)} />
              <span class="num">{giro.persp.toFixed(2)}</span>
            </label>
          </div>
        {:else}
          <div class="dim small">Abra uma animação: o giro vira uma chave no instante da régua.</div>
        {/if}
      </div>
    {/if}
    {#if geleia}
      <div class="efeitos">
        <div class="dim small secao" title="A malha fica mole: balança quando o osso mexe e assenta (só no desenho do núcleo e no jogo; não muda o rig). A moleza começa em 0 perto do osso da peça (presa) e chega a 1 na ponta.">
          <label class="ck"><input type="checkbox" checked={!!geleia.j} onchange={(e) => setGeleia({ enabled: (e.target as HTMLInputElement).checked }, (e.target as HTMLInputElement).checked ? "geleia ligada" : "geleia desligada")} /> 🍮 Geleia</label>
        </div>
        {#if geleia.j}
          <div class="ef">
            <div class="presets">
              {#each [["gelatina", "gelatina"], ["borracha", "borracha"], ["slime", "slime"], ["agua_viva", "água-viva"]] as [v, t]}
                <button onclick={() => setGeleia({ preset: v }, `geleia ${t}`)}>{t}</button>
              {/each}
            </div>
            {#each CAMPOS_GELEIA as c}
              <label class="efcampo" title={c.dica}>
                <span>{c.label}</span>
                <input type="range" min={c.min} max={c.max} step={c.step} value={geleia.j[c.k] ?? 0} oninput={(e) => setGeleia({ [c.k]: +(e.target as HTMLInputElement).value }, `geleia: ${c.label}`, true)} onchange={() => seqGeleia++} />
                <span class="num">{(+(geleia.j[c.k] ?? 0)).toFixed(c.step < 1 ? 1 : 0)}</span>
              </label>
            {/each}
            <label class="efcampo" title="como a moleza sobe a partir do osso: à esquerda tudo mole por igual, à direita só a ponta mole">
              <span>base firme</span>
              <input type="range" min="0.3" max="4" step="0.1" value="1.5" onchange={(e) => setGeleia({ wobble: "auto", curve: +(e.target as HTMLInputElement).value }, "moleza da geleia")} />
              <span class="num"></span>
            </label>
            <div class="dim small">Toque uma animação para ver balançar.</div>
          </div>
        {/if}
      </div>
    {/if}
    {#if ehBoneco}
      <div class="efeitos">
        <div class="dim small secao" title="Contorno, brilho, dissolver, ajuste de cor e partículas desta parte. Aparecem no desenho núcleo e no jogo. {app.mode === 'animate' && app.play.animation ? 'Mexer grava chave neste instante.' : 'Na Pose base muda o valor inicial.'}">Efeitos e partículas</div>
        {#each efeitos as ef (ef.n)}
          <div class="ef">
            <div class="efnome" title={EFEITOS[ef.n].dica}>
              <span>{EFEITOS[ef.n].nome}</span>
              {#if ef.v.color}<input type="color" value={"#" + ef.v.color.slice(0, 6)} title="cor" oninput={(e) => setEfeito(ef.n, "color", (e.target as HTMLInputElement).value.slice(1) + ef.v.color.slice(6, 8))} />{/if}
              {#if app.mode !== "animate" || !app.play.animation}<button class="tira" onclick={() => tirar(ef.n)} title="tirar o efeito do setup">✕</button>{/if}
            </div>
            {#each EFEITOS[ef.n].campos as c}
              <label class="efcampo">
                <span>{c.label}</span>
                <input type="range" min={c.min ?? 0} max={c.max} step={c.step} value={ef.v[c.k]} oninput={(e) => setEfeito(ef.n, c.k, +(e.target as HTMLInputElement).value)} />
                <span class="num">{(+ef.v[c.k]).toFixed(c.step < 1 ? 2 : 0)}</span>
              </label>
            {/each}
          </div>
        {/each}
        {#each mosaicosDoSlot as mo (mo.name)}
          <div class="ef">
            <div class="efnome" title="mosaico: {mo.columns} × {mo.rows} células de {mo.cell[0]} × {mo.cell[1]}, {mo.palette?.length ?? 0} imagens na paleta">
              <span class="nome-t">🧩 {mo.name}</span>
              {#if app.mosaicEdit?.name !== mo.name}<button onclick={() => startMosaicEdit(mo.name)} title="pintar este mosaico na tela">🖌️ pintar</button>{/if}
              <button class="tira" onclick={() => app.run({ cmd: "mosaic.delete", args: { name: mo.name } }, `apaga ${mo.name}`)} title="apagar o mosaico">✕</button>
            </div>
            {#if app.mosaicEdit?.name === mo.name}<MosaicPanel />{/if}
          </div>
        {/each}
        {#each emissores as em (em.p.name)}
          <div class="ef">
            <div class="efnome" title="emissor de partículas: nasce do osso {em.p.bone ?? slot.bone}, imagem {em.p.image}">
              {#if renLista === `p:${em.p.name}`}
                <!-- svelte-ignore a11y_autofocus -->
                <input class="ren" bind:value={textoLista} onkeydown={(e) => (e.key === "Enter" ? renomearLista() : e.key === "Escape" && (renLista = null))} onblur={renomearLista} autofocus />
              {:else}
                <button class="nome-t" ondblclick={() => ((renLista = `p:${em.p.name}`), (textoLista = em.p.name))} title="dois cliques para renomear">✦ {em.p.name}</button>
              {/if}
              {#if animando && em.p.type !== "lightning"}<button onclick={() => rajada(em.p.name)} title="rajada: 12 nascem de uma vez neste instante">rajada</button>{/if}
              {#if !animando}<button class="tira" onclick={() => app.run({ cmd: "particles.delete", args: { name: em.p.name } }, `apaga ${em.p.name}`)} title="apagar o emissor">✕</button>{/if}
            </div>
            {#each camposDe(em.p).filter((c) => !animando || c.k === "rate") as c}
              <label class="efcampo" title={c.dica}>
                <span>{c.label}</span>
                <input type="range" min="0" max={c.max} step={c.step} value={em.v(c.k)} oninput={(e) => setP(em.p.name, c.k, +(e.target as HTMLInputElement).value, em.p[c.k])} />
                <span class="num">{(+em.v(c.k)).toFixed(c.step < 1 ? 2 : 0)}</span>
              </label>
            {/each}
          </div>
        {/each}
        {#if !animando}
          <div class="presets">
            <button onclick={() => novoEmissor("particles")} title="partículas que nascem do osso desta camada e desenham logo depois dela">+ partículas</button>
            <button onclick={() => novoEmissor("lightning")} title="um raio: linha quebrada que sai do osso desta camada, refeita a cada instante">+ raio</button>
            <button onclick={() => novoEmissor("orbit")} title="partículas girando em volta do osso desta camada, passando atrás e na frente">+ órbita</button>
            <button onclick={novoMosaico} title="mosaico: uma grade de imagens do atlas presa a esta camada (mapa, chão, parede), pintada na tela; grade, isométrica ou em perspectiva">+ mosaico</button>
            {#if app.asset?.tres?.endsWith(".boneco")}
              <select value="" onfocus={() => app.carregarEfeitos()} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).value = ""; if (v && slot) app.efeitoDaBiblioteca(v, slot.name); }} title="um efeito pronto da biblioteca (fumaça, puff, poeira, explosão...): as imagens entram no personagem e o emissor nasce nesta camada">
                <option value="">+ efeito…</option>
                {#each app.efeitosLista ?? [] as ef}<option value={ef.nome} title={ef.texto}>{ef.titulo}</option>{/each}
              </select>
              <select value="" onchange={(e) => { const v = +(e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).value = ""; if (v && slot) app.olhoMaluco(slot.name, v); }} title="olhos de boneco com a pupila solta, colados em lugares sorteados desta camada (a pupila cai e rola quando a peça mexe)">
                <option value="">+ olho maluco…</option>
                {#each [1, 2, 3, 5] as n}<option value={n}>{n === 1 ? "um, em lugar sorteado" : `${n}, em lugares sorteados`}</option>{/each}
              </select>
            {/if}
          </div>
        {/if}
        {#if faltam.length && (app.mode !== "animate" || !app.play.animation)}
          <select value="" onchange={(e) => { ligar((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }} title="liga um efeito nesta camada">
            <option value="">+ efeito...</option>
            {#each faltam as n}<option value={n}>{EFEITOS[n].nome}: {EFEITOS[n].dica}</option>{/each}
          </select>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .insp {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .order.rel select {
    flex: 1;
    min-width: 0;
  }
  .order.rel button {
    font-size: 11px;
    padding: 2px 6px;
  }
  .order {
    display: flex;
    gap: 4px;
  }
  .order button {
    flex: 1;
    padding: 4px;
  }
  .quick button {
    width: 100%;
    text-align: left;
    margin-top: 4px;
  }
  .mesh {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mesh button {
    width: 100%;
    text-align: left;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .relevo-b {
    font-size: 11px;
    padding: 2px 6px;
    margin-left: 6px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .presets button {
    font-size: 11px;
    padding: 3px 6px;
  }
  .efeitos {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ef {
    border: 1px solid var(--line, #3a3448);
    border-radius: 6px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .efnome {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .efnome span {
    flex: 1;
  }
  .efnome input[type="color"] {
    width: 30px;
    height: 22px;
    padding: 0 2px;
  }
  .efnome .tira {
    padding: 0 6px;
  }
  .efcampo {
    display: grid;
    grid-template-columns: 56px 1fr 40px;
    align-items: center;
    gap: 6px;
  }
  .efcampo .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .color {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .color input[type="color"] {
    width: 34px;
    height: 26px;
    padding: 0 2px;
  }
  .cons {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .con {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 2px 6px;
    align-items: center;
    background: #1a1820;
    padding: 5px 8px;
    border-radius: 8px;
    font-size: 12px;
  }
  .con > .alvo-ik,
  .con > .slider {
    grid-column: 1 / -1;
  }
  .copia {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    grid-column: 1 / -1;
  }
  .copia label {
    display: flex;
    gap: 3px;
    align-items: center;
  }
  .num-c {
    width: 56px;
  }
  .ord {
    display: flex;
  }
  .ctype {
    color: var(--accent2);
  }
  .cname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .con .slider {
    grid-column: 1 / 3;
    display: flex;
    gap: 6px;
    align-items: center;
    cursor: default;
  }
  .con .slider input {
    flex: 1;
  }
  .x {
    padding: 2px 6px;
    grid-row: 1 / 3;
    grid-column: 3;
  }
  .fine summary {
    cursor: pointer;
    color: var(--dim);
    font-size: 12px;
    margin-bottom: 6px;
  }
  .title {
    font-weight: 600;
    font-size: 15px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .so-skin {
    display: flex;
    gap: 4px;
    align-items: center;
    font-size: 12px;
    color: var(--accent2);
  }
  .nome-t {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    cursor: text;
    text-align: left;
  }
  .ren {
    flex: 1;
    min-width: 0;
    font-size: 14px;
  }
  .lixo {
    margin-left: auto;
    background: none;
    border: none;
    padding: 2px 5px;
    opacity: 0.55;
    font-size: 13px;
  }
  .lixo:hover {
    opacity: 1;
  }
  .lixo.armado {
    opacity: 1;
    background: #5a1f2c;
    border-radius: 6px;
  }
  .imagem-linha {
    display: flex;
    gap: 2px;
    align-items: center;
    min-width: 0;
  }
  .imagem-linha select {
    flex: 1;
    min-width: 0;
  }
  .imagem-linha .lixo {
    margin-left: 0;
  }
  .title.slot {
    margin-top: 10px;
  }
  .small {
    font-size: 12px;
  }
  .fields {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 6px 8px;
    align-items: center;
  }
  .alvo-ik {
    display: flex;
    gap: 4px;
    align-items: center;
    font-size: 11px;
    cursor: default;
  }
  .alvo-ik select {
    max-width: 110px;
  }
  .imagem-osso {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }
  .mini-campo {
    display: flex;
    flex-direction: column;
    font-size: 11px;
    cursor: default;
  }
  .mini-campo input {
    width: 100%;
    min-width: 0;
  }
  label,
  .rotulo {
    color: var(--dim);
    font-size: 12px;
    cursor: ew-resize;
    user-select: none;
  }
  input,
  select {
    width: 100%;
  }
  .ico {
    font-size: 12px;
  }
</style>
