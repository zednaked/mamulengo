// Video WebM sem depender do relogio: cada quadro vai para o VideoEncoder (WebCodecs)
// com o tempo exato e os pedacos codificados sao empacotados num Matroska minimo
// (EBML header, Info, Tracks, Clusters com SimpleBlocks). Sem Cues: os players
// tocam e repetem do inicio normalmente.

type Chunk = { data: Uint8Array; ms: number; key: boolean };

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
};

type El = { id: number; body: Uint8Array | El[] | number | string | { float: number } };

function idBytes(id: number): number[] {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return out;
}

function uint(v: number): number[] {
  const out: number[] = [];
  do {
    out.unshift(v & 255);
    v = Math.floor(v / 256);
  } while (v > 0);
  return out;
}

// tamanho em vint de 8 bytes (sempre cabe, simples de escrever)
function size8(n: number): number[] {
  const out = [0x01];
  for (let i = 6; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 255);
  return out;
}

function encode(el: El): Uint8Array {
  let body: Uint8Array;
  const b = el.body;
  if (b instanceof Uint8Array) body = b;
  else if (Array.isArray(b)) body = concat(b.map(encode));
  else if (typeof b === "number") body = new Uint8Array(uint(b));
  else if (typeof b === "string") body = new TextEncoder().encode(b);
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, b.float);
    body = new Uint8Array(dv.buffer);
  }
  return concat([new Uint8Array([...idBytes(el.id), ...size8(body.length)]), body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function muxWebm(chunks: Chunk[], o: { width: number; height: number; codec: "V_VP8" | "V_VP9"; fps: number; durationMs: number }): Blob {
  const clusters: El[] = [];
  let cur: { start: number; blocks: El[] } | null = null;
  const close = () => cur && clusters.push({ id: ID.Cluster, body: [{ id: ID.Timecode, body: cur.start }, ...cur.blocks] });
  for (const c of chunks) {
    if (!cur || c.key || c.ms - cur.start > 30000) {
      close();
      cur = { start: c.ms, blocks: [] };
    }
    const rel = c.ms - cur.start;
    const head = new Uint8Array([0x81, (rel >> 8) & 255, rel & 255, c.key ? 0x80 : 0]);
    cur.blocks.push({ id: ID.SimpleBlock, body: concat([head, c.data]) });
  }
  close();
  const header: El = {
    id: ID.EBML,
    body: [
      { id: ID.EBMLVersion, body: 1 },
      { id: ID.EBMLReadVersion, body: 1 },
      { id: ID.EBMLMaxIDLength, body: 4 },
      { id: ID.EBMLMaxSizeLength, body: 8 },
      { id: ID.DocType, body: "webm" },
      { id: ID.DocTypeVersion, body: 4 },
      { id: ID.DocTypeReadVersion, body: 2 },
    ],
  };
  const segment: El = {
    id: ID.Segment,
    body: [
      {
        id: ID.Info,
        body: [
          { id: ID.TimecodeScale, body: 1_000_000 },
          { id: ID.MuxingApp, body: "mamulengo" },
          { id: ID.WritingApp, body: "mamulengo" },
          { id: ID.Duration, body: { float: o.durationMs } },
        ],
      },
      {
        id: ID.Tracks,
        body: [
          {
            id: ID.TrackEntry,
            body: [
              { id: ID.TrackNumber, body: 1 },
              { id: ID.TrackUID, body: 1 },
              { id: ID.TrackType, body: 1 },
              { id: ID.FlagLacing, body: 0 },
              { id: ID.CodecID, body: o.codec },
              { id: ID.DefaultDuration, body: Math.round(1e9 / o.fps) },
              { id: ID.Video, body: [{ id: ID.PixelWidth, body: o.width }, { id: ID.PixelHeight, body: o.height }] },
            ],
          },
        ],
      },
      ...clusters,
    ],
  };
  return new Blob([encode(header) as BlobPart, encode(segment) as BlobPart], { type: "video/webm" });
}

// Codifica quadros (gerados sob demanda) com tempo exato. null se o navegador nao tem
// WebCodecs com VP9/VP8 (quem chama cai para o MediaRecorder).
export async function encodeWebm(
  count: number,
  fps: number,
  size: [number, number],
  frame: (i: number) => CanvasImageSource,
  progress?: (done: number) => void,
): Promise<Blob | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const [width, height] = size;
  const base = { width, height, bitrate: 8_000_000, framerate: fps };
  let cfg: VideoEncoderConfig | null = null;
  let codec: "V_VP8" | "V_VP9" = "V_VP9";
  for (const [c, id] of [
    ["vp09.00.40.08", "V_VP9"],
    ["vp8", "V_VP8"],
  ] as const) {
    const s = await VideoEncoder.isConfigSupported({ ...base, codec: c }).catch(() => null);
    if (s?.supported) {
      cfg = { ...base, codec: c };
      codec = id;
      break;
    }
  }
  if (!cfg) return null;
  const chunks: Chunk[] = [];
  let failed: any = null;
  const enc = new VideoEncoder({
    output: (c) => {
      const data = new Uint8Array(c.byteLength);
      c.copyTo(data);
      chunks.push({ data, ms: Math.round(c.timestamp / 1000), key: c.type === "key" });
    },
    error: (e) => (failed = e),
  });
  enc.configure(cfg);
  const us = 1e6 / fps;
  for (let i = 0; i < count; i++) {
    const vf = new VideoFrame(frame(i), { timestamp: Math.round(i * us), duration: Math.round(us) });
    // um quadro-chave por segundo: o player consegue pular e repetir rapido
    enc.encode(vf, { keyFrame: i % Math.max(1, Math.round(fps)) === 0 });
    vf.close();
    progress?.(i + 1);
    while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    if (failed) throw failed;
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  chunks.sort((a, b) => a.ms - b.ms);
  return muxWebm(chunks, { width, height, codec, fps, durationMs: (count * 1000) / fps });
}
