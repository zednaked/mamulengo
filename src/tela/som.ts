// O som de um jogo na web (o papel do AudioStreamPlayer): um nome, laco, volume de 0 a 100 (linear) e a
// partir de que segundo. Web Audio. Os arquivos baixam logo (preparar) e o audio so comeca no primeiro
// toque (regra do navegador: ligar): o laco pedido antes disso fica guardado e comeca no toque. Duas
// chaves, como num menu de som: musica (as trilhas) e efeitos (o resto); desligar para o que esta
// tocando daquele tipo, religar volta os lacos pedidos.
//
//   const som = new Som("sons/", { trilhas: ["ambiente"], arquivo: (n) => n + ".ogg" });
//   som.preparar(["ambiente", "clique"]);  canvas.addEventListener("pointerdown", () => som.ligar());
//   som.tocar("ambiente", true, 40);  som.tocar("clique");  som.chaves(false, true);
export type OpcoesSom = {
  trilhas?: string[]; // os nomes que valem como musica
  arquivo?: (nome: string) => string; // o arquivo de um nome, dentro da pasta (padrao: nome + ".ogg")
};
export class Som {
  private ctx?: AudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private tocando = new Map<string, { fonte: AudioBufferSourceNode; ganho: GainNode }[]>();
  private bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private lacosPedidos = new Map<string, number>(); // o laco que deve estar tocando (nome -> volume)
  private trilhas: string[];
  private arquivo: (nome: string) => string;
  musica = true;
  efeitos = true;
  aoTocar?: (nome: string, volume: number, de: number) => void; // para conferir a sequencia

  constructor(private pasta: string, opcoes: OpcoesSom = {}) {
    this.trilhas = opcoes.trilhas ?? [];
    this.arquivo = opcoes.arquivo ?? ((n) => n + ".ogg");
  }

  // baixa os arquivos (sem decodificar: isso precisa do AudioContext, que so nasce no toque)
  preparar(nomes: string[]) {
    for (const n of nomes)
      if (!this.bytes.has(n)) this.bytes.set(n, fetch(this.pasta + this.arquivo(n)).then((r) => (r.ok ? r.arrayBuffer() : null), () => null));
  }
  // o primeiro toque liga o audio, e os lacos pedidos comecam
  ligar() {
    if (this.ctx) return void (this.ctx.state === "suspended" && this.ctx.resume());
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    for (const [n, v] of this.lacosPedidos) void this.tocar(n, true, v);
  }
  private permitido(nome: string) {
    return this.trilhas.includes(nome) ? this.musica : this.efeitos;
  }
  private async buffer(nome: string) {
    if (!this.ctx) return null;
    const b = this.buffers.get(nome);
    if (b) return b;
    this.preparar([nome]);
    const dados = await this.bytes.get(nome);
    if (!dados || !this.ctx) return null;
    try {
      const dec = await this.ctx.decodeAudioData(dados.slice(0));
      this.buffers.set(nome, dec);
      return dec;
    } catch {
      return null;
    }
  }
  async tocar(nome: string, loop = false, volume = 100, de = 0) {
    if (loop) {
      this.lacosPedidos.set(nome, volume);
      if (this.tocandoAgora(nome)) return;
    }
    if (!this.permitido(nome)) return;
    this.aoTocar?.(nome, volume, de);
    if (!this.ctx) return;
    const b = await this.buffer(nome);
    if (!b || !this.ctx || (loop && (!this.lacosPedidos.has(nome) || this.tocandoAgora(nome)))) return;
    const fonte = this.ctx.createBufferSource();
    fonte.buffer = b;
    fonte.loop = loop;
    const ganho = this.ctx.createGain();
    ganho.gain.value = volume / 100;
    fonte.connect(ganho).connect(this.ctx.destination);
    fonte.start(0, Math.max(0, de));
    const lista = this.tocando.get(nome) ?? [];
    lista.push({ fonte, ganho });
    this.tocando.set(nome, lista);
    fonte.onended = () => {
      const l = this.tocando.get(nome);
      const i = l?.findIndex((x) => x.fonte === fonte) ?? -1;
      if (l && i >= 0) l.splice(i, 1);
    };
  }
  parar(nome: string) {
    this.lacosPedidos.delete(nome);
    for (const { fonte } of this.tocando.get(nome) ?? []) fonte.stop();
    this.tocando.delete(nome);
  }
  // apaga em `dur` segundos (ate -60 dB) e para
  apagar(nome: string, dur: number) {
    this.lacosPedidos.delete(nome);
    if (!this.ctx) return;
    const agora = this.ctx.currentTime;
    for (const { fonte, ganho } of this.tocando.get(nome) ?? []) {
      ganho.gain.setValueAtTime(ganho.gain.value, agora);
      ganho.gain.linearRampToValueAtTime(0.001, agora + dur);
      fonte.stop(agora + dur);
    }
    this.tocando.delete(nome);
  }
  tocandoAgora(nome: string) {
    return (this.tocando.get(nome)?.length ?? 0) > 0;
  }
  // as duas chaves: desligar para o que esta tocando daquele tipo; religar volta os lacos pedidos
  chaves(musica: boolean, efeitos: boolean) {
    this.musica = musica;
    this.efeitos = efeitos;
    for (const n of [...this.tocando.keys()])
      if (!this.permitido(n)) {
        for (const { fonte } of this.tocando.get(n) ?? []) fonte.stop();
        this.tocando.delete(n);
      }
    for (const [n, v] of this.lacosPedidos) if (this.permitido(n) && !this.tocandoAgora(n)) void this.tocar(n, true, v);
  }
  // a aba escondida: o audio para e volta junto
  pausar(sim: boolean) {
    if (!this.ctx) return;
    void (sim ? this.ctx.suspend() : this.ctx.resume());
  }
}
