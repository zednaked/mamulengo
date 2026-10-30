// Teste do BonecoSprite (a GDExtension do nucleo) no Godot oficial, headless: monta um
// projeto de passagem com o pessoa (CC0), a extensao compilada e nucleo/godot/teste/teste_boneco.gd,
// e roda. Sai com o codigo do teste (0 se todas as conferencias passaram).
//
//   npx tsx tools/boneco-godot-teste.ts [--godot godot] [--so nucleo/godot/bin/libboneco.linux.template_debug.x86_64.so] [--pasta dir]
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const godot = opt("godot", "godot");
const so = resolve(opt("so", join(RAIZ, "nucleo", "godot", "bin", "libboneco.linux.template_debug.x86_64.so")));
const pasta = resolve(opt("pasta", join(tmpdir(), "boneco-godot-teste")));
if (!existsSync(so)) throw new Error(`falta a extensao: ${so} (scons -C nucleo/godot, ver o cabecalho do SConstruct)`);

rmSync(pasta, { recursive: true, force: true });
mkdirSync(join(pasta, "pessoa"), { recursive: true });
mkdirSync(join(pasta, "bin"), { recursive: true });
writeFileSync(join(pasta, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="boneco-godot-teste"\n');
copyFileSync(so, join(pasta, "bin", "libboneco.so"));
writeFileSync(join(pasta, "boneco.gdextension"), '[configuration]\nentry_symbol = "boneco_library_init"\ncompatibility_minimum = "4.5"\n\n[libraries]\nlinux.x86_64 = "res://bin/libboneco.so"\n');
for (const f of ["pessoa.boneco", "pessoa.webp"]) copyFileSync(join(RAIZ, "tests", "boneco", "pessoa", f), join(pasta, "pessoa", f));
// o mesmo personagem em binario (nucleo-binario, do build nativo)
const bin = spawnSync(join(RAIZ, "nucleo", "build", "nucleo-binario"), [join(pasta, "pessoa", "pessoa.boneco"), join(pasta, "pessoa", "pessoa-binario.boneco")], { encoding: "utf8" });
if (bin.status !== 0) throw new Error(`nucleo-binario: ${bin.stderr || bin.error} (compile o nucleo: cmake --build nucleo/build)`);
copyFileSync(join(RAIZ, "nucleo", "godot", "teste", "teste_boneco.gd"), join(pasta, "teste_boneco.gd"));

// a primeira abertura importa a pagina e registra a extensao
spawnSync(godot, ["--headless", "--path", pasta, "--import"], { stdio: "ignore", timeout: 300000 });
const r = spawnSync(godot, ["--headless", "--path", pasta, "-s", "res://teste_boneco.gd"], { encoding: "utf8", timeout: 300000 });
process.stdout.write(r.stdout ?? "");
const erros = (r.stderr ?? "").split("\n").filter((l) => /SCRIPT ERROR|^ERROR/.test(l));
for (const l of erros) console.log("  ! " + l);
const ok = r.status === 0 && /FAILURES: 0/.test(r.stdout ?? "") && erros.length === 0;
process.exit(ok ? 0 : 1);
