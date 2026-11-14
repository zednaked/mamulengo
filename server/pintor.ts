// O pintor: o renderer do ProCraft num processo ao lado (pintor/, compilado por tools/pintor.sh),
// para a pintura raster do Atelie. Aqui fica o processo e a conversa com ele: pedidos em fila, cada
// um [u32 JSON][u32 binario][JSON][binario] (pintor/src/main.rs). O editor fala com ele pelo
// WebSocket /api/pintor (server/plugin.ts), uma mensagem binaria por pedido, no mesmo formato sem
// o segundo tamanho: [u32 JSON][JSON][binario].
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PINTOR_BIN = process.env.MAMULENGO_PINTOR ?? join(homedir(), ".cache/mamulengo/pintor/release/mamulengo-pintor");
// a biblioteca de pinceis: a do ProCraft instalado, se houver (so leitura); sem ela, os pinceis
// que vem com o ProCraft
export function bibliotecaDePinceis(): string | null {
  const p = process.env.MAMULENGO_PINCEIS ?? join(homedir(), ".local/share/procraft/brushes/library.json");
  return existsSync(p) ? p : null;
}

export type Resposta = [any, Buffer];

export class Pintor {
  private proc: ChildProcess | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private fila: { ok: (r: Resposta) => void; erro: (e: Error) => void }[] = [];
  private n = 0;

  static disponivel(): boolean {
    return existsSync(PINTOR_BIN);
  }

  private subir() {
    if (this.proc) return;
    if (!Pintor.disponivel()) throw new Error(`o pintor nao foi compilado: rode tools/pintor.sh (esperado em ${PINTOR_BIN})`);
    const p = spawn(PINTOR_BIN, [], { stdio: ["pipe", "pipe", "inherit"] });
    this.proc = p;
    p.stdout!.on("data", (d: Buffer) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      while (this.buf.length >= 8) {
        const nj = this.buf.readUInt32LE(0),
          nb = this.buf.readUInt32LE(4);
        if (this.buf.length < 8 + nj + nb) break;
        const j = JSON.parse(this.buf.subarray(8, 8 + nj).toString("utf8"));
        const b = Buffer.from(this.buf.subarray(8 + nj, 8 + nj + nb));
        this.buf = this.buf.subarray(8 + nj + nb);
        this.fila.shift()?.ok([j, b]);
      }
    });
    const caiu = (por: string) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.buf = Buffer.alloc(0);
      for (const f of this.fila.splice(0)) f.erro(new Error(`o pintor parou (${por})`));
    };
    p.on("exit", (c, s) => caiu(s ?? `codigo ${c}`));
    p.on("error", (e) => caiu(e.message));
    p.stdin!.on("error", () => {});
  }

  // um pedido e a resposta dele (na ordem em que foram feitos)
  pede(m: any, bin: Uint8Array = new Uint8Array(0)): Promise<Resposta> {
    return new Promise((ok, erro) => {
      try {
        this.subir();
      } catch (e: any) {
        return erro(e);
      }
      this.fila.push({ ok, erro });
      const j = Buffer.from(JSON.stringify({ ...m, id: ++this.n }));
      const cab = Buffer.alloc(8);
      cab.writeUInt32LE(j.length, 0);
      cab.writeUInt32LE(bin.length, 4);
      this.proc!.stdin!.write(Buffer.concat([cab, j, bin]));
    });
  }

  parar() {
    const p = this.proc;
    this.proc = null;
    p?.stdin?.end();
    p?.kill();
  }
}

// ---- a ponte com o editor: WebSocket /__pintor

export const PINTOR_PATH = "/__pintor";

// um pedido do editor: [u32 tamanho do JSON][JSON][binario]
function abre(raw: Buffer): [any, Buffer] | null {
  if (raw.length < 4) return null;
  const nj = raw.readUInt32LE(0);
  if (raw.length < 4 + nj) return null;
  try {
    return [JSON.parse(raw.subarray(4, 4 + nj).toString("utf8")), raw.subarray(4 + nj)];
  } catch {
    return null;
  }
}
function fecha(j: any, b: Uint8Array): Buffer {
  const t = Buffer.from(JSON.stringify(j));
  const cab = Buffer.alloc(4);
  cab.writeUInt32LE(t.length, 0);
  return Buffer.concat([cab, t, b]);
}

// Cada aba do editor tem a folha dela (o numero da conexao): o editor nao escolhe arquivo nenhum,
// a biblioteca de pinceis e a do computador (bibliotecaDePinceis). O processo e um so para todas
// as abas, e a biblioteca e lida uma vez (uns 30 s com uma biblioteca grande).
export async function pintorWs(server: { httpServer: any }) {
  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 28 });
  const pintor = new Pintor();
  let n = 0;
  server.httpServer?.on("close", () => {
    for (const c of wss.clients) c.terminate();
    wss.close();
    pintor.parar();
  });
  server.httpServer?.on("upgrade", (req: any, socket: any, head: any) => {
    if (!req.url?.startsWith(PINTOR_PATH)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  wss.on("connection", (ws) => {
    const folha = `aba${++n}`;
    ws.on("message", async (raw: Buffer, binario: boolean) => {
      const m = binario ? abre(raw) : null;
      if (!m) return;
      const [j, bin] = m;
      const id = j.id;
      try {
        if (j.op === "estado") return ws.send(fecha({ id, disponivel: Pintor.disponivel(), biblioteca: !!bibliotecaDePinceis() }, new Uint8Array(0)));
        const pedido = { ...j, folha, ...(j.op === "abrir" ? { biblioteca: bibliotecaDePinceis() } : {}) };
        const [r, b] = await pintor.pede(pedido, bin);
        if (ws.readyState === ws.OPEN) ws.send(fecha({ ...r, id }, b));
      } catch (e: any) {
        if (ws.readyState === ws.OPEN) ws.send(fecha({ id, erro: String(e?.message ?? e) }, new Uint8Array(0)));
      }
    });
    ws.on("close", () => {
      if (Pintor.disponivel()) pintor.pede({ op: "fechar", folha }).catch(() => {});
    });
  });
}
