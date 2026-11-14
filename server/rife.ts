// O RIFE (rife-ncnn-vulkan, interpolacao de quadros na placa por Vulkan) para os intermediarios do
// Atelie (src/core/intermediarios.ts faz a conta dos pixels). Nao vem com o Mamulengo: o binario e os
// modelos ficam onde o usuario instalou (MAMULENGO_RIFE = a pasta com rife-ncnn-vulkan e rife-v4.6,
// ou o primeiro ~/.local/opt/rife/rife-ncnn-vulkan-*). MAMULENGO_RIFE_GPU escolhe a placa (-g).
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const MODELO = "rife-v4.6";

export function pastaDoRife(): string | null {
  const ok = (p: string) => existsSync(join(p, "rife-ncnn-vulkan")) && existsSync(join(p, MODELO));
  if (process.env.MAMULENGO_RIFE) return ok(process.env.MAMULENGO_RIFE) ? process.env.MAMULENGO_RIFE : null;
  const base = join(homedir(), ".local/opt/rife");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).sort().reverse()) if (d.startsWith("rife-ncnn-vulkan") && ok(join(base, d))) return join(base, d);
  return null;
}

// o quadro entre a e b (PNGs) no instante t (0 a 1); um por vez (a placa e uma so)
let fila: Promise<unknown> = Promise.resolve();
export function interpolar(a: Buffer, b: Buffer, t: number): Promise<Buffer> {
  const p = fila.then(() => rodar(a, b, t));
  fila = p.catch(() => {});
  return p;
}

function rodar(a: Buffer, b: Buffer, t: number): Promise<Buffer> {
  const pasta = pastaDoRife();
  if (!pasta) return Promise.reject(new Error("o RIFE nao esta instalado (rife-ncnn-vulkan com o modelo rife-v4.6 em ~/.local/opt/rife, ou MAMULENGO_RIFE)"));
  const dir = mkdtempSync(join(tmpdir(), "mamulengo-rife-"));
  const [pa, pb, po] = ["a.png", "b.png", "t.png"].map((n) => join(dir, n));
  writeFileSync(pa, a);
  writeFileSync(pb, b);
  // -x -z: as duas TTAs (o traco sai mais firme e o giro deixa de ser fusao, medido no ProCraft)
  const args = ["-0", pa, "-1", pb, "-o", po, "-m", join(pasta, MODELO), "-s", t.toFixed(4), "-x", "-z"];
  if (process.env.MAMULENGO_RIFE_GPU) args.push("-g", process.env.MAMULENGO_RIFE_GPU);
  return new Promise((ok, erro) => {
    execFile(join(pasta, "rife-ncnn-vulkan"), args, { timeout: 120_000 }, (e, _out, err) => {
      try {
        if (e || !existsSync(po)) return erro(new Error(`o RIFE falhou: ${String(err || e?.message).slice(-300)}`));
        ok(readFileSync(po));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
