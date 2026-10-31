// BonecoData e BonecoSprite (boneco_godot.h): leitura do .boneco, o passo de cada quadro e o
// desenho. O desenho usa uma malha por item que fica de um quadro para o outro: so os
// vertices sao regravados, e a superficie so e refeita quando os indices mudam.
#include "boneco_godot.h"

#include <cstring>

#include "mamulengo/json.h"

#ifdef GDEXTENSION
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/resource_loader.hpp>
#include <godot_cpp/classes/time.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#define BONECO_CARREGA(p) ResourceLoader::get_singleton()->load(p)
#define BONECO_USEC() int64_t(Time::get_singleton()->get_ticks_usec())
#define BONECO_ERRO(m) UtilityFunctions::push_error(m)
#define BONECO_EXISTE(p) FileAccess::file_exists(p)
#define BONECO_EDITOR() Engine::get_singleton()->is_editor_hint()
#else
#include "core/config/engine.h"
#include "core/io/file_access.h"
#include "core/io/resource_loader.h"
#include "core/object/class_db.h"
#include "core/os/os.h"
#define BONECO_CARREGA(p) ResourceLoader::load(p)
#define BONECO_USEC() int64_t(OS::get_singleton()->get_ticks_usec())
#define BONECO_ERRO(m) ERR_PRINT(m)
#define BONECO_EXISTE(p) FileAccess::exists(p)
#define BONECO_EDITOR() Engine::get_singleton()->is_editor_hint()
#endif

using mamulengo::Blend;
using mamulengo::Comando;

namespace {

std::string padrao(const String &s) {
  CharString c = s.utf8();
  return std::string(c.get_data(), size_t(c.length()));
}

// ---- materiais (um por passo de blend e pma, compartilhados por todos os sprites)

enum Passo { NORMAL_PMA, ADITIVO, MULTIPLICA, MULTIPLICA_MOTOR, TELA_MUL, TELA_ADD, PASSOS };

// dentro de funcao: no godot-cpp o RID so pode ser construido depois que a extensao inicia
struct Materiais {
  RID material[PASSOS][2];
  RID shader[PASSOS][2];
  // os shaders proprios (os materiais sao de cada item: valores do slot, luzes do quadro): por
  // passo, com efeitos e/ou com luz (indice efeitos + 2 x luz, de 1 a 3)
  RID shader_proprio[PASSOS][4];
};
Materiais &cache() {
  static Materiais m;
  return m;
}

// cor do quadro: textura (com o pma desfeito) vezes a cor do vertice, alfa simples
const char *MODO[PASSOS] = {"blend_mix", "blend_add", "blend_mul", "blend_mul", "blend_mul", "blend_add"};
const char *SAIDA[PASSOS] = {
    "c",
    "c",
    // destino x mix(1, cor, alfa): a parte transparente nao mexe
    "vec4(mix(vec3(1.0), c.rgb, c.a), 1.0)",
    // o multiply do Godot: destino x cor, sem olhar o alfa
    "c",
    // tela em dois passos: destino x (1 - s), depois + s (s = cor x alfa)
    "vec4(vec3(1.0) - c.rgb * c.a, 1.0)",
    "c",
};

// os efeitos de um slot (docs/NUCLEO.md "Efeitos"; o mesmo de src/render/desenhista.ts): ef sao
// os 23 canais (linha 0-4, brilho 5-10, dissolver 11-17, tingir 18-22); a textura so vale
// dentro da caixa da imagem
const char *EFEITOS =
    "uniform bool pma = false;\nuniform float ef[23];\nuniform vec4 caixa;\nuniform vec2 pagina = vec2(1.0);\nvarying vec4 cor_v;\n"
    "void vertex() { cor_v = COLOR; }\n"
    "vec4 T(sampler2D tx, vec2 uv) {\n"
    "  if (uv.x < caixa.x || uv.y < caixa.y || uv.x > caixa.z || uv.y > caixa.w) return vec4(0.0);\n"
    "  vec4 t = texture(tx, uv);\n  if (pma && t.a > 0.0) t.rgb /= t.a;\n  return t;\n}\n"
    "float hash(uint i, uint j) {\n"
    "  uint x = i * 1664525u + j * 1013904223u;\n"
    "  x ^= x >> 16u; x *= 2146121005u; x ^= x >> 15u; x *= 2221713035u; x ^= x >> 16u;\n"
    "  return float(x) / 4294967295.0;\n}\n"
    "float ruido(vec2 p) {\n"
    "  vec2 c = floor(p); vec2 f = p - c;\n  f = f * f * (3.0 - 2.0 * f);\n"
    "  uint i = uint(int(c.x)); uint j = uint(int(c.y));\n"
    "  return mix(mix(hash(i, j), hash(i + 1u, j), f.x), mix(hash(i, j + 1u), hash(i + 1u, j + 1u), f.x), f.y);\n}\n"
    "vec4 sobre(vec4 cima, vec4 baixo) {\n"
    "  float a = cima.a + baixo.a * (1.0 - cima.a);\n"
    "  return a > 0.0 ? vec4((cima.rgb * cima.a + baixo.rgb * baixo.a * (1.0 - cima.a)) / a, a) : vec4(0.0);\n}\n"
    "void fragment() {\n"
    "  vec2 px = 1.0 / pagina;\n"
    "  vec4 t = T(TEXTURE, UV);\n"
    "  vec4 C = vec4(t.rgb * cor_v.rgb, t.a * cor_v.a);\n"
    "  float ft = ef[22] * ef[21];\n"
    "  if (ft > 0.0) C.rgb = mix(C.rgb, vec3(ef[18], ef[19], ef[20]), ft);\n"
    "  vec4 U = vec4(0.0);\n"
    "  bool opaco = C.a >= 1.0;\n"
    "  if (!opaco && ef[9] > 0.0 && ef[8] > 0.0) {\n"
    "    float B = 0.0;\n"
    "    for (int i = 1; i <= 6; i++) {\n"
    "      float w = pow(1.0 - float(i - 1) / 6.0, 2.0);\n"
    "      if (B >= w) break;\n"
    "      for (int k = 0; k < 16; k++) {\n"
    "        float g = (float(k) + 0.5 * float(i % 2)) * 6.2831853 / 16.0;\n"
    "        B = max(B, T(TEXTURE, UV + vec2(cos(g), sin(g)) * ef[10] * float(i) / 6.0 * px).a * w);\n"
    "        if (B >= w) break;\n"
    "      }\n"
    "    }\n"
    "    U = vec4(ef[5], ef[6], ef[7], min(1.0, ef[8] * ef[9] * B));\n"
    "  }\n"
    "  if (!opaco && ef[4] > 0.0 && ef[3] > 0.0) {\n"
    "    float A = 0.0;\n"
    "    for (int k = 0; k < 24; k++) {\n"
    "      if (A >= 1.0) break;\n"
    "      float g = float(k) * 6.2831853 / 24.0;\n"
    "      vec2 d = vec2(cos(g), sin(g)) * ef[4] * px;\n"
    "      A = max(A, max(T(TEXTURE, UV + d).a, max(T(TEXTURE, UV + d * 0.6666667).a, T(TEXTURE, UV + d * 0.3333333).a)));\n"
    "    }\n"
    "    U = sobre(vec4(ef[0], ef[1], ef[2], ef[3] * A), U);\n"
    "  }\n"
    "  U.a *= cor_v.a;\n"
    "  vec4 c = opaco ? C : sobre(C, U);\n"
    "  if (ef[11] > 0.0) {\n"
    "    float n = ruido(UV * pagina / max(ef[17], 1.0));\n"
    "    if (n < ef[11]) discard;\n"
    "    if (n < ef[11] + ef[16]) c.rgb = mix(c.rgb, vec3(ef[12], ef[13], ef[14]), ef[15]);\n"
    "  }\n";

// luzes (docs/NUCLEO.md "Luzes"; a mesma conta de src/render/desenhista.ts): a normal do relevo
// girada para o mundo pelas derivadas de tela, ambiente mais cada luz com cor x max(N.L, 0) x
// atenuacao^2; luzZ e a camada da luz menos a do lote (soma na altura e entra na distancia). mundo_v
// e o ponto no espaco do esqueleto (y para cima)
const char *LUZ =
    "uniform sampler2D relevo : filter_linear;\nuniform vec3 ambiente = vec3(1.0);\nuniform int nluz = 0;\n"
    "uniform vec4 luzP[8];\nuniform vec3 luzC[8];\nuniform float luzZ[8];\nvarying vec2 mundo_v;\n"
    "vec3 luz(vec2 uv, vec2 mundo) {\n"
    "  vec3 n = texture(relevo, uv).rgb * 2.0 - 1.0;\n"
    "  vec2 dpx = dFdx(mundo); vec2 dpy = dFdy(mundo); vec2 dux = dFdx(uv); vec2 duy = dFdy(uv);\n"
    "  float det = dux.x * duy.y - duy.x * dux.y;\n"
    "  vec3 N = vec3(0.0, 0.0, 1.0);\n"
    "  if (abs(det) > 1e-14) {\n"
    "    vec2 ju = (dpx * duy.y - dpy * dux.y) / det; vec2 jv = (dpy * dux.x - dpx * duy.x) / det;\n"
    "    N = normalize(vec3(n.x * normalize(ju) - n.y * normalize(jv), n.z));\n"
    "  }\n"
    "  vec3 soma = ambiente;\n"
    "  for (int i = 0; i < 8; i++) {\n"
    "    if (i >= nluz) break;\n"
    "    vec3 L = vec3(luzP[i].xy - mundo, luzP[i].z + luzZ[i]);\n"
    "    float at = clamp(1.0 - length(vec3(L.xy, luzZ[i])) / luzP[i].w, 0.0, 1.0);\n"
    "    soma += luzC[i] * max(dot(N, normalize(L)), 0.0) * at * at;\n"
    "  }\n"
    "  return soma;\n}\n";

// o shader proprio de um item: com os efeitos do slot, com luz, ou os dois
RID shader_proprio(Passo passo, bool efeitos, bool luz) {
  RID &sh = cache().shader_proprio[passo][int(efeitos) + 2 * int(luz)];
  if (sh.is_valid()) return sh;
  String codigo = String("shader_type canvas_item;\nrender_mode ") + MODO[passo] + ";\n" + (luz ? LUZ : "");
  const String vertice = luz ? "void vertex() { cor_v = COLOR; mundo_v = vec2(VERTEX.x, -VERTEX.y); }\n" : "void vertex() { cor_v = COLOR; }\n";
  if (efeitos) {
    String e = String(EFEITOS).replace("void vertex() { cor_v = COLOR; }\n", vertice);
    if (luz) e = e.replace("ef[19], ef[20]), ft);\n", "ef[19], ef[20]), ft);\n  C.rgb *= luz(UV, mundo_v);\n");
    codigo += e + "  COLOR = " + SAIDA[passo] + ";\n}\n";
  } else {
    codigo += String("uniform bool pma = false;\nvarying vec4 cor_v;\n") + vertice +
              "void fragment() {\n  vec4 t = texture(TEXTURE, UV);\n  if (pma && t.a > 0.0) t.rgb /= t.a;\n  vec4 c = t * cor_v;\n" +
              (luz ? "  c.rgb *= luz(UV, mundo_v);\n" : "") + "  COLOR = " + SAIDA[passo] + ";\n}\n";
  }
  RenderingServer *rs = RenderingServer::get_singleton();
  sh = rs->shader_create();
  rs->shader_set_code(sh, codigo);
  return sh;
}

RID material_passo(Passo passo, bool pma) {
  RID &m = cache().material[passo][pma ? 1 : 0];
  if (m.is_valid()) return m;
  const char *const *modo = MODO;
  const char *const *saida = SAIDA;
  String codigo = String("shader_type canvas_item;\nrender_mode ") + modo[passo] +
                  ";\nuniform bool pma = false;\nvarying vec4 cor_v;\nvoid vertex() { cor_v = COLOR; }\n"
                  "void fragment() {\n  vec4 t = texture(TEXTURE, UV);\n  if (pma && t.a > 0.0) t.rgb /= t.a;\n  vec4 c = t * cor_v;\n  COLOR = " +
                  saida[passo] + ";\n}\n";
  RenderingServer *rs = RenderingServer::get_singleton();
  RID &sh = cache().shader[passo][pma ? 1 : 0];
  sh = rs->shader_create();
  rs->shader_set_code(sh, codigo);
  m = rs->material_create();
  rs->material_set_shader(m, sh);
  rs->material_set_param(m, "pma", pma);
  return m;
}

}  // namespace

// libera os materiais compartilhados (no fim do modulo ou da extensao)
void boneco_liberar_materiais() {
  RenderingServer *rs = RenderingServer::get_singleton();
  if (!rs) return;
  for (int p = 0; p < PASSOS; p++)
    for (int k = 0; k < 2; k++) {
      if (cache().material[p][k].is_valid()) rs->free_rid(cache().material[p][k]);
      if (cache().shader[p][k].is_valid()) rs->free_rid(cache().shader[p][k]);
      cache().material[p][k] = RID();
      cache().shader[p][k] = RID();
    }
  for (int p = 0; p < PASSOS; p++)
    for (int k = 0; k < 4; k++) {
      if (cache().shader_proprio[p][k].is_valid()) rs->free_rid(cache().shader_proprio[p][k]);
      cache().shader_proprio[p][k] = RID();
    }
}

// ---- BonecoData

namespace {
// os BonecoData vivos por caminho (sem segurar: o ultimo Ref que sai apaga e tira daqui)
std::unordered_map<std::string, BonecoData *> &vivos() {
  static std::unordered_map<std::string, BonecoData *> m;
  return m;
}
}  // namespace

BonecoData::~BonecoData() {
  auto it = vivos().find(padrao(caminho));
  if (it != vivos().end() && it->second == this) vivos().erase(it);
}

Ref<BonecoData> BonecoData::carregar(const String &p_caminho) {
  auto it = vivos().find(padrao(p_caminho));
  if (it != vivos().end()) return Ref<BonecoData>(it->second);
  Ref<BonecoData> d;
  d.instantiate();
  d->caminho = p_caminho;
  if (!BONECO_EXISTE(p_caminho)) {
    d->erro = "nao existe: " + p_caminho;
    return d;
  }
  // texto ou binario (o nucleo reconhece o binario pelo comeco): os bytes como estao
  const PackedByteArray bytes = FileAccess::get_file_as_bytes(p_caminho);
  const std::string t(reinterpret_cast<const char *>(bytes.ptr()), size_t(bytes.size()));
  std::string erro;
  // instancias (docs/NUCLEO.md "Instancias"): os filhos pelo FileAccess, relativos a pasta deste
  // arquivo (o leitor recebe so o nome; "res://" nao passa pela normalizacao de caminho)
  const String pasta = p_caminho.get_base_dir();
  const mamulengo::AbrirArquivo abrir = [&pasta](const std::string &c, std::string &texto) {
    const String p = pasta.path_join(String::utf8(c.c_str())).simplify_path();
    if (!BONECO_EXISTE(p)) return false;
    const PackedByteArray b = FileAccess::get_file_as_bytes(p);
    texto.assign(reinterpret_cast<const char *>(b.ptr()), size_t(b.size()));
    return true;
  };
  d->modelo = mamulengo::ler_boneco(t, p_caminho.get_file().utf8().get_data(), abrir, &erro);
  if (!d->modelo) {
    d->erro = String::utf8(erro.c_str());
    BONECO_ERRO("boneco: " + p_caminho + ": " + d->erro);
    return d;
  }
  // a caixa do cabecalho (o leitor do nucleo nao guarda: so a pose e o desenho)
  const mamulengo::Json j = mamulengo::Json::ler(t, nullptr);
  if (j.objeto()) {
    const mamulengo::Json &e = j["esqueleto"];
    d->caixa = Rect2(e.num("x", 0), e.num("y", 0), e.num("largura", 0), e.num("altura", 0));
  }
  // as paginas do desenho: as deste arquivo e as dos filhos das instancias (relativas a ele)
  for (const mamulengo::Pagina &pg : d->modelo->paginas_desenho) {
    const String p = pasta.path_join(String::utf8(pg.arquivo.c_str())).simplify_path();
    Ref<Texture2D> tex = BONECO_CARREGA(p);
    if (tex.is_null()) BONECO_ERRO("boneco: nao carreguei a pagina " + p);
    d->paginas.push_back(tex);
    // o relevo da pagina (docs/NUCLEO.md "Luzes"): sem ele a pagina fica sem luz
    Ref<Texture2D> rel;
    if (!pg.relevo.empty()) {
      rel = BONECO_CARREGA(pasta.path_join(String::utf8(pg.relevo.c_str())).simplify_path());
      if (rel.is_null()) BONECO_ERRO("boneco: nao carreguei o relevo " + String::utf8(pg.relevo.c_str()));
    }
    d->relevos.push_back(rel);
  }
  vivos()[padrao(p_caminho)] = d.ptr();
  return d;
}

PackedStringArray BonecoData::get_animation_names() const {
  PackedStringArray out;
  if (modelo)
    for (const mamulengo::Animacao &a : modelo->animacoes) out.push_back(String::utf8(a.nome.c_str()));
  return out;
}

float BonecoData::get_animation_duration(const String &p_nome) const {
  if (!modelo) return 0;
  const int a = modelo->animacao(padrao(p_nome));
  return a >= 0 ? float(modelo->animacoes[size_t(a)].duracao) : 0.0f;
}

void BonecoData::_bind_methods() {
  ClassDB::bind_static_method("BonecoData", D_METHOD("carregar", "caminho"), &BonecoData::carregar);
  ClassDB::bind_method(D_METHOD("get_animation_names"), &BonecoData::get_animation_names);
  ClassDB::bind_method(D_METHOD("get_animation_duration", "nome"), &BonecoData::get_animation_duration);
  ClassDB::bind_method(D_METHOD("get_skeleton_rect"), &BonecoData::get_skeleton_rect);
  ClassDB::bind_method(D_METHOD("get_error"), &BonecoData::get_error);
  ClassDB::bind_method(D_METHOD("get_boneco_path"), &BonecoData::get_boneco_path);
}

void BonecoEntrada::_bind_methods() {
  ClassDB::bind_method(D_METHOD("get_animation_name"), &BonecoEntrada::get_animation_name);
  ClassDB::bind_method(D_METHOD("get_track_index"), &BonecoEntrada::get_track_index);
  ClassDB::bind_method(D_METHOD("get_loop"), &BonecoEntrada::get_loop);
  ClassDB::bind_method(D_METHOD("is_valid"), &BonecoEntrada::is_valid);
  ClassDB::bind_method(D_METHOD("set_reverse", "reverso"), &BonecoEntrada::set_reverse);
  ClassDB::bind_method(D_METHOD("get_reverse"), &BonecoEntrada::get_reverse);
  ClassDB::bind_method(D_METHOD("set_mix_duration", "mix"), &BonecoEntrada::set_mix_duration);
  ClassDB::bind_method(D_METHOD("get_mix_duration"), &BonecoEntrada::get_mix_duration);
  ClassDB::bind_method(D_METHOD("set_mix_duration_and_delay", "mix", "atraso"), &BonecoEntrada::set_mix_duration_and_delay);
  ClassDB::bind_method(D_METHOD("set_delay", "atraso"), &BonecoEntrada::set_delay);
  ClassDB::bind_method(D_METHOD("get_delay"), &BonecoEntrada::get_delay);
  ClassDB::bind_method(D_METHOD("set_track_time", "tempo"), &BonecoEntrada::set_track_time);
  ClassDB::bind_method(D_METHOD("get_track_time"), &BonecoEntrada::get_track_time);
  ClassDB::bind_method(D_METHOD("get_animation_time"), &BonecoEntrada::get_animation_time);
  ClassDB::bind_method(D_METHOD("set_time_scale", "escala"), &BonecoEntrada::set_time_scale);
  ClassDB::bind_method(D_METHOD("get_time_scale"), &BonecoEntrada::get_time_scale);
  ClassDB::bind_method(D_METHOD("set_alpha", "alfa"), &BonecoEntrada::set_alpha);
  ClassDB::bind_method(D_METHOD("get_alpha"), &BonecoEntrada::get_alpha);
  ClassDB::bind_method(D_METHOD("is_complete"), &BonecoEntrada::is_complete);
}

// ---- BonecoSprite

BonecoSprite::BonecoSprite() { desenho.recorte_cpu = true; }

BonecoSprite::~BonecoSprite() {
  _esquecer_entradas();
  _liberar_itens();
}

// ---- entradas vistas pelo GDScript

void BonecoSprite::_ao_descartar(void *dono, const mamulengo::Entrada *en) {
  BonecoSprite *s = static_cast<BonecoSprite *>(dono);
  auto it = s->entradas.find(en->id);
  if (it == s->entradas.end()) return;
  it->second->en = nullptr;
  it->second->estado = nullptr;
  s->mortas[en->id] = it->second;
  s->entradas.erase(it);
}

void BonecoSprite::_esquecer_entradas() {
  for (auto &par : entradas) {
    par.second->en = nullptr;
    par.second->estado = nullptr;
  }
  entradas.clear();
  mortas.clear();
}

Ref<BonecoEntrada> BonecoSprite::_embrulho(mamulengo::Entrada *en) {
  if (!en) return Ref<BonecoEntrada>();
  auto it = entradas.find(en->id);
  if (it != entradas.end()) return it->second;
  Ref<BonecoEntrada> r = _entrada(en->trilha, en->animacao, en->loop);
  r->en = en;
  r->estado = estado.get();
  entradas[en->id] = r;
  return r;
}

void BonecoSprite::_liberar_itens() {
  RenderingServer *rs = RenderingServer::get_singleton();
  if (!rs) return;
  for (int i = 0; i < itens.size(); i++) rs->free_rid(itens[i]);
  for (int i = 0; i < malhas.size(); i++) rs->free_rid(malhas[i]);
  for (int i = 0; i < material_efeito.size(); i++)
    if (material_efeito[i].is_valid()) rs->free_rid(material_efeito[i]);
  itens.clear();
  malhas.clear();
  material_item.clear();
  material_efeito.clear();
  passo_efeito.clear();
  indices_item.clear();
  vertices_item.clear();
  enviado_v.clear();
  enviado_a.clear();
  cru_item.clear();
  caixa_item.clear();
}

void BonecoSprite::set_data(const Ref<BonecoData> &p_data) {
  data = p_data;
  _montar();
}

void BonecoSprite::set_boneco(const String &p_caminho) {
  boneco = p_caminho;
  if (p_caminho.is_empty()) {
    set_data(Ref<BonecoData>());
    return;
  }
  Ref<BonecoData> d = BonecoData::carregar(p_caminho);
  set_data(d->modelo ? d : Ref<BonecoData>());
}

void BonecoSprite::set_float_clock(bool p) {
  float_clock = p;
  if (esq) esq->relogio_float = p;
  if (estado) estado->relogio_float = p;
}

// o dt do quadro com a escala do no (em float com float_clock)
double BonecoSprite::_dt(float p_dt) const {
  if (!playing) return 0.0;
  return float_clock ? double(p_dt * time_scale) : double(p_dt) * time_scale;
}

void BonecoSprite::set_preview(const String &p_animacao) {
  preview = p_animacao;
  _previa();
}

// no editor: a previa toca em laco; sem previa (ou no jogo), a pose de setup
void BonecoSprite::_previa() {
  if (!estado || !BONECO_EDITOR()) return;
  estado->limpar();
  esq->setup();
  const int a = preview.is_empty() ? -1 : data->modelo->animacao(padrao(preview));
  if (a >= 0) {
    estado->tocar(0, a, true);
    estado->avancar(0);
    estado->aplicar(*esq);
  }
  esq->atualizar_mundo();
  estado->ler_eventos(eventos);
  mortas.clear();
  _desenhar();
}

void BonecoSprite::_montar() {
  _esquecer_entradas();
  estado.reset();
  esq.reset();
  if (data.is_null() || !data->modelo) {
    _liberar_itens();
    queue_redraw();
    return;
  }
  esq = std::make_unique<mamulengo::Esqueleto>(data->modelo);
  estado = std::make_unique<mamulengo::Estado>(data->modelo);
  estado->ao_descartar = &BonecoSprite::_ao_descartar;
  estado->dono = this;
  esq->relogio_float = float_clock;
  estado->relogio_float = float_clock;
  _aplicar_mix();
  esq->setup();
  esq->atualizar_mundo();
  if (BONECO_EDITOR() && !preview.is_empty()) {
    _previa();
    return;
  }
  _desenhar();
}

void BonecoSprite::_aplicar_mix() {
  if (!estado) return;
  if (mix_jogo >= 0) estado->mix_padrao = mix_jogo;
  for (const ParMix &p : pares_mix) {
    const int de = data->modelo->animacao(padrao(p.de)), para = data->modelo->animacao(padrao(p.para));
    if (de >= 0 && para >= 0) estado->definir_mix(de, para, p.tempo);
  }
}

void BonecoSprite::set_default_mix(float p_tempo) {
  mix_jogo = p_tempo < 0 ? 0 : p_tempo;
  if (estado) estado->mix_padrao = mix_jogo;
}

float BonecoSprite::get_default_mix() const {
  if (estado) return float(estado->mix_padrao);
  return mix_jogo < 0 ? 0 : mix_jogo;
}

void BonecoSprite::set_mix(const String &p_de, const String &p_para, float p_tempo) {
  bool achou = false;
  for (ParMix &p : pares_mix)
    if (p.de == p_de && p.para == p_para) {
      p.tempo = p_tempo;
      achou = true;
    }
  if (!achou) pares_mix.push_back(ParMix{p_de, p_para, p_tempo});
  if (!estado) return;
  const int de = data->modelo->animacao(padrao(p_de)), para = data->modelo->animacao(padrao(p_para));
  if (de < 0 || para < 0) {
    BONECO_ERRO("boneco: set_mix com animacao desconhecida " + p_de + " -> " + p_para);
    return;
  }
  estado->definir_mix(de, para, p_tempo);
}

void BonecoSprite::set_playing(bool p) { playing = p; }

Ref<BonecoEntrada> BonecoSprite::_entrada(int trilha, int animacao, bool loop) const {
  Ref<BonecoEntrada> r;
  r.instantiate();
  if (data.is_valid() && data->modelo && animacao >= 0) r->animacao = String::utf8(data->modelo->animacoes[size_t(animacao)].nome.c_str());
  r->trilha = trilha;
  r->loop = loop;
  return r;
}

Ref<BonecoEntrada> BonecoSprite::set_animation(const String &p_nome, bool p_loop, int p_trilha) {
  if (!estado) return Ref<BonecoEntrada>();
  const int a = data->modelo->animacao(padrao(p_nome));
  if (a < 0) {
    BONECO_ERRO("boneco: animacao desconhecida " + p_nome);
    return Ref<BonecoEntrada>();
  }
  Ref<BonecoEntrada> r = _embrulho(estado->tocar(p_trilha, a, p_loop));
  _avisar();
  return r;
}

Ref<BonecoEntrada> BonecoSprite::add_animation(const String &p_nome, float p_atraso, bool p_loop, int p_trilha) {
  if (!estado) return Ref<BonecoEntrada>();
  const int a = data->modelo->animacao(padrao(p_nome));
  if (a < 0) {
    BONECO_ERRO("boneco: animacao desconhecida " + p_nome);
    return Ref<BonecoEntrada>();
  }
  Ref<BonecoEntrada> r = _embrulho(estado->enfileirar(p_trilha, a, p_loop, p_atraso));
  _avisar();
  return r;
}

Ref<BonecoEntrada> BonecoSprite::set_empty_animation(int p_trilha, float p_mix) {
  if (!estado) return Ref<BonecoEntrada>();
  Ref<BonecoEntrada> r = _embrulho(estado->vazio(p_trilha, p_mix));
  _avisar();
  return r;
}

void BonecoSprite::clear_tracks() {
  if (!estado) return;
  estado->limpar();
  _avisar();
}

void BonecoSprite::clear_track(int p_trilha) {
  if (!estado) return;
  estado->limpar_trilha(p_trilha);
  _avisar();
}

Ref<BonecoEntrada> BonecoSprite::get_current(int p_trilha) const {
  mamulengo::Entrada *e = estado ? estado->entrada(p_trilha) : nullptr;
  if (!e || e->animacao < 0) return Ref<BonecoEntrada>();
  return const_cast<BonecoSprite *>(this)->_embrulho(e);
}

PackedStringArray BonecoSprite::get_animation_names() const { return data.is_valid() ? data->get_animation_names() : PackedStringArray(); }

void BonecoSprite::set_to_setup_pose() {
  if (!esq) return;
  esq->setup();
  esq->atualizar_mundo();
  _desenhar();
}

void BonecoSprite::update_skeleton(float p_dt) {
  if (!esq) return;
  // escondido: so o relogio das trilhas (e os avisos), como o spine-godot
  if (!pose_when_hidden && is_inside_tree() && !is_visible_in_tree()) {
    estado->avancar(_dt(p_dt));
    _avisar();
    return;
  }
  // o relogio so com `medir` ligado: no web cada leitura e uma chamada ao JavaScript
  if (!medir) {
    _passo(_dt(p_dt));
    _desenhar();
    return;
  }
  const int64_t t0 = BONECO_USEC();
  _passo(_dt(p_dt));
  const int64_t t1 = BONECO_USEC();
  _desenhar();
  last_update_usec = t1 - t0;
  last_draw_usec = BONECO_USEC() - t1;
}

// um quadro na ordem do nucleo: estado, o jogo mexe nos slots, fisica e mundo, avisos
void BonecoSprite::_passo(double dt) {
  estado->avancar(dt);
  estado->aplicar(*esq);
  static const StringName antes_do_mundo("before_world_transforms_change");
  emit_signal(antes_do_mundo, this);
  esq->avancar(dt);
  esq->atualizar_mundo();
  _avisar();
}

// os eventos desde a ultima leitura viram sinais, com a mesma entrada que o GDScript recebeu.
// Tambem logo depois de set_animation, add_animation e limpar, como o spine-godot (o inicio sai
// no mesmo quadro em que o jogo toca); um sinal que toca outra animacao nao reentra: os eventos
// novos saem na volta seguinte do laco
void BonecoSprite::_avisar() {
  if (avisando || !estado) return;
  avisando = true;
  while (estado && !estado->eventos().empty()) {
    std::vector<mamulengo::Evento> lidos;
    estado->ler_eventos(lidos);
    _emitir(lidos);
  }
  mortas.clear();
  avisando = false;
}

void BonecoSprite::_emitir(const std::vector<mamulengo::Evento> &lidos) {
  for (const mamulengo::Evento &ev : lidos) {
    if (!estado) return;
    Ref<BonecoEntrada> r;
    auto it = entradas.find(ev.entrada);
    if (it != entradas.end()) {
      r = it->second;
    } else if ((it = mortas.find(ev.entrada)) != mortas.end()) {
      r = it->second;
    } else {
      // ninguem pediu esta entrada ainda: a viva com esse numero (na trilha, saindo ou na
      // fila), ou uma que so tem o nome
      mamulengo::Entrada *en = estado->entrada(ev.trilha);
      while (en && en->id != ev.entrada) en = en->de;
      if (!en)
        for (en = estado->entrada(ev.trilha); en && en->id != ev.entrada;) en = en->proxima;
      r = en ? _embrulho(en) : _entrada(ev.trilha, ev.animacao, false);
    }
    switch (ev.tipo) {
      case mamulengo::TipoEvento::Inicio: emit_signal("animation_started", r); break;
      case mamulengo::TipoEvento::Interrompida: emit_signal("animation_interrupted", r); break;
      case mamulengo::TipoEvento::Completa: emit_signal("animation_completed", r); break;
      case mamulengo::TipoEvento::Fim: emit_signal("animation_ended", r); break;
      case mamulengo::TipoEvento::Usuario: {
        const String nome = ev.evento >= 0 ? String::utf8(data->modelo->eventos[size_t(ev.evento)].nome.c_str()) : String();
        emit_signal("animation_event", r, nome, ev.inteiro, ev.decimal, String::utf8(ev.texto.c_str()));
        break;
      }
    }
  }
}

bool BonecoSprite::has_bone(const String &p_osso) const { return esq && esq->modelo().osso(padrao(p_osso)) >= 0; }

bool BonecoSprite::has_slot(const String &p_slot) const { return esq && esq->modelo().slot(padrao(p_slot)) >= 0; }

PackedFloat64Array BonecoSprite::get_bone_world(const String &p_osso) const {
  PackedFloat64Array out;
  const int i = esq ? esq->modelo().osso(padrao(p_osso)) : -1;
  if (i < 0) return out;
  // o nucleo e y para cima; o no, y para baixo: a matriz vira F M F com F = (1, -1)
  const mamulengo::Matriz &w = esq->mundo()[size_t(i)];
  for (double v : {w.x, -w.y, w.a, -w.b, -w.c, w.d}) out.push_back(v);
  return out;
}

Dictionary BonecoSprite::get_bones_world() const {
  Dictionary out;
  if (!esq) return out;
  const mamulengo::Modelo &m = esq->modelo();
  for (size_t i = 0; i < m.ossos.size(); ++i) {
    const mamulengo::Matriz &w = esq->mundo()[i];
    PackedFloat64Array v;
    for (double x : {w.x, -w.y, w.a, w.b, -w.c, -w.d}) v.push_back(x);
    out[String::utf8(m.ossos[i].nome.c_str())] = v;
  }
  return out;
}

PackedFloat64Array BonecoSprite::get_bone_local(const String &p_osso) const {
  PackedFloat64Array out;
  const int i = esq ? esq->modelo().osso(padrao(p_osso)) : -1;
  if (i < 0) return out;
  const mamulengo::Local &l = esq->local[size_t(i)];
  for (double v : {l.x, l.y, l.rotacao, l.escala_x, l.escala_y, l.cisalha_x, l.cisalha_y}) out.push_back(v);
  return out;
}

Color BonecoSprite::get_slot_color(const String &p_slot) const {
  const int i = esq ? esq->modelo().slot(padrao(p_slot)) : -1;
  if (i < 0) return Color();
  const mamulengo::Cor &c = esq->slots()[size_t(i)].cor;
  return Color(c.r, c.g, c.b, c.a);
}

void BonecoSprite::set_slot_color(const String &p_slot, const Color &p_cor) {
  const int i = esq ? esq->modelo().slot(padrao(p_slot)) : -1;
  if (i < 0) return;
  // fica ate uma timeline de cor mudar o slot (o jogo chama no before_world_transforms_change)
  esq->slot(i).cor = mamulengo::Cor{float(p_cor.r), float(p_cor.g), float(p_cor.b), float(p_cor.a)};
}

void BonecoSprite::set_slot_attachment(const String &p_slot, const String &p_parte) {
  const int i = esq ? esq->modelo().slot(padrao(p_slot)) : -1;
  if (i < 0) return;
  const mamulengo::Modelo &m = esq->modelo();
  int parte = -1;
  if (!p_parte.is_empty()) {
    const int id = m.id_parte(padrao(p_parte));
    parte = id >= 0 ? m.parte_de(0, i, id) : -1;
  }
  // fica ate uma timeline de parte mudar o slot
  esq->mudar_parte(i, parte);
  esq->atualizar_mundo();
  _desenhar();
}

String BonecoSprite::get_slot_setup_attachment(const String &p_slot) const {
  const int i = esq ? esq->modelo().slot(padrao(p_slot)) : -1;
  if (i < 0) return "";
  const int id = esq->modelo().slots[size_t(i)].parte_setup;
  return id >= 0 ? String::utf8(esq->modelo().nomes_partes[size_t(id)].c_str()) : String();
}

Rect2 BonecoSprite::get_skeleton_bounds() const {
  const std::vector<float> &v = desenho.vertices;
  if (v.size() < 8) return Rect2();
  Rect2 r(Vector2(v[0], -v[1]), Vector2());
  for (size_t i = 8; i + 1 < v.size(); i += 8) r.expand_to(Vector2(v[i], -v[i + 1]));
  return r;
}

// ---- desenho

void BonecoSprite::_desenhar() {
  desenho.limpar();
  if (!esq || !is_inside_tree()) return;
  mamulengo::desenhar(*esq, desenho);
  RenderingServer *rs = RenderingServer::get_singleton();

  // itens: um por lote; o blend tela ocupa dois (os dois passos)
  struct Item {
    int lote;
    RID material;
    Passo passo;
    bool pma;
  };
  std::vector<Item> lista;
  for (int l = 0; l < int(desenho.lotes.size()); ++l) {
    const mamulengo::Lote &lt = desenho.lotes[size_t(l)];
    if (lt.comando != Comando::Triangulos || lt.quantos == 0) continue;
    const bool pma = lt.pagina >= 0 && lt.pagina < int(data->modelo->paginas_desenho.size()) && data->modelo->paginas_desenho[size_t(lt.pagina)].pma;
    switch (lt.blend) {
      case Blend::Aditivo: lista.push_back({l, material_passo(ADITIVO, pma), ADITIVO, pma}); break;
      case Blend::Multiplica: lista.push_back({l, material_passo(MULTIPLICA, pma), MULTIPLICA, pma}); break;
      case Blend::MultiplicaMotor: lista.push_back({l, material_passo(MULTIPLICA_MOTOR, pma), MULTIPLICA_MOTOR, pma}); break;
      case Blend::Tela:
        lista.push_back({l, material_passo(TELA_MUL, pma), TELA_MUL, pma});
        lista.push_back({l, material_passo(TELA_ADD, pma), TELA_ADD, pma});
        break;
      default: lista.push_back({l, pma ? material_passo(NORMAL_PMA, true) : RID(), NORMAL_PMA, pma});
    }
  }
  const RID pai = get_canvas_item();
  while (itens.size() < int(lista.size())) {
    RID it = rs->canvas_item_create();
    rs->canvas_item_set_parent(it, pai);
    rs->canvas_item_set_draw_index(it, itens.size());
    itens.push_back(it);
    malhas.push_back(rs->mesh_create());
    material_item.push_back(RID());
    material_efeito.push_back(RID());
    passo_efeito.push_back(-1);
    indices_item.push_back(Vector<int>());
    vertices_item.push_back(0);
    enviado_v.push_back(PackedByteArray());
    enviado_a.push_back(PackedByteArray());
    cru_item.emplace_back();
    caixa_item.emplace_back();
  }

  const int64_t fmt = int64_t(BONECO_RS::ARRAY_FORMAT_VERTEX) | int64_t(BONECO_RS::ARRAY_FORMAT_COLOR) | int64_t(BONECO_RS::ARRAY_FORMAT_TEX_UV) |
                      int64_t(BONECO_RS::ARRAY_FORMAT_INDEX) | int64_t(BONECO_RS::ARRAY_FLAG_USE_2D_VERTICES);
  const float *vd = desenho.vertices.data();
  const uint32_t *id = desenho.indices.data();
  Vector<int> indices;
  for (int k = 0; k < itens.size(); k++) {
    const RID it = itens[k];
    rs->canvas_item_clear(it);
    if (k >= int(lista.size())) continue;
    const mamulengo::Lote &lt = desenho.lotes[size_t(lista[size_t(k)].lote)];
    // luz: o relevo da pagina carregado e um grupo de luz no lote
    const Ref<Texture2D> rel = lt.luz >= 0 && lt.pagina >= 0 && lt.pagina < data->relevos.size() ? data->relevos[lt.pagina] : Ref<Texture2D>();
    const bool luz = rel.is_valid();
    if (lt.efeito >= 0 || luz) {
      // slot com efeitos ou iluminado: o material proprio do item, com os valores deste quadro
      const Item &li = lista[size_t(k)];
      const bool efeitos = lt.efeito >= 0;
      if (!material_efeito[k].is_valid()) material_efeito.write[k] = rs->material_create();
      const RID me = material_efeito[k];
      const int chave = int(li.passo) * 4 + int(efeitos) + 2 * int(luz);
      if (passo_efeito[k] != chave) {
        rs->material_set_shader(me, shader_proprio(li.passo, efeitos, luz));
        passo_efeito.write[k] = chave;
      }
      if (efeitos) {
        const mamulengo::EfeitosLote &el = desenho.efeitos[size_t(lt.efeito)];
        PackedFloat32Array ef;
        ef.resize(mamulengo::CANAIS_SHADER);
        memcpy(ef.ptrw(), el.valores.v, sizeof(float) * mamulengo::CANAIS_SHADER);
        rs->material_set_param(me, "ef", ef);
        rs->material_set_param(me, "caixa", Vector4(el.caixa[0], el.caixa[1], el.caixa[2], el.caixa[3]));
        rs->material_set_param(me, "pagina", Vector2(el.pagina[0], el.pagina[1]));
      }
      if (luz) {
        const mamulengo::GrupoLuz &g = desenho.grupos_luz[size_t(lt.luz)];
        Array p4, c3;
        PackedFloat32Array z;
        for (int q = 0; q < mamulengo::MAX_LUZES; q++) {
          const float *l = g.luzes[q];
          p4.push_back(Vector4(l[0], l[1], l[2], l[6]));
          c3.push_back(Vector3(l[3], l[4], l[5]));
          z.push_back(l[7] - lt.profundidade);
        }
        rs->material_set_param(me, "relevo", rel->get_rid());
        rs->material_set_param(me, "ambiente", Vector3(g.ambiente[0], g.ambiente[1], g.ambiente[2]));
        rs->material_set_param(me, "nluz", g.quantas);
        rs->material_set_param(me, "luzP", p4);
        rs->material_set_param(me, "luzC", c3);
        rs->material_set_param(me, "luzZ", z);
      }
      rs->material_set_param(me, "pma", li.pma);
      lista[size_t(k)].material = me;
    }
    if (material_item[k] != lista[size_t(k)].material) {
      rs->canvas_item_set_material(it, lista[size_t(k)].material);
      material_item.write[k] = lista[size_t(k)].material;
    }
    // os vertices que o lote usa, renumerados a partir de 0
    uint32_t vmin = UINT32_MAX, vmax = 0;
    for (uint32_t q = 0; q < lt.quantos; q++) {
      vmin = MIN(vmin, id[lt.inicio + q]);
      vmax = MAX(vmax, id[lt.inicio + q]);
    }
    const int nv = int(vmax - vmin + 1);
    indices.resize(int(lt.quantos));
    int *iw = indices.ptrw();
    for (uint32_t q = 0; q < lt.quantos; q++) iw[q] = int(id[lt.inicio + q] - vmin);
    const float *v0 = vd + size_t(vmin) * 8;
    const RID malha = malhas[k];
    const bool igual = vertices_item[k] == nv && indices_item[k].size() == indices.size() && memcmp(indices_item[k].ptr(), indices.ptr(), sizeof(int) * size_t(indices.size())) == 0;
    // peca parada: os mesmos vertices crus do ultimo envio, nada a empacotar nem enviar
    std::vector<float> &cru = cru_item[size_t(k)];
    const bool parado = igual && cru.size() == size_t(nv) * 8 && memcmp(cru.data(), v0, sizeof(float) * cru.size()) == 0;
    if (!parado) {
      cru.assign(v0, v0 + size_t(nv) * 8);
      Rect2 c(Vector2(v0[0], -v0[1]), Vector2());
      for (int q = 1; q < nv; q++) c.expand_to(Vector2(v0[q * 8], -v0[q * 8 + 1]));
      caixa_item[size_t(k)] = c;
    }
    const Rect2 caixa = caixa_item[size_t(k)];
    if (!parado && igual) {
      // mesmo desenho: so regrava posicao, cor e uv
      const int64_t vs = rs->mesh_surface_get_format_vertex_stride(fmt, nv);
      const int64_t as = rs->mesh_surface_get_format_attribute_stride(fmt, nv);
      const int64_t oc = rs->mesh_surface_get_format_offset(fmt, nv, BONECO_RS::ARRAY_COLOR);
      const int64_t ou = rs->mesh_surface_get_format_offset(fmt, nv, BONECO_RS::ARRAY_TEX_UV);
      bytes_v.resize(int(vs * nv));
      bytes_a.resize(int(as * nv));
      uint8_t *vb = bytes_v.ptrw();
      uint8_t *ab = bytes_a.ptrw();
      for (int q = 0; q < nv; q++) {
        const float *s = v0 + q * 8;
        const float xy[2] = {s[0], -s[1]};
        memcpy(vb + q * vs, xy, 8);
        const uint8_t c8[4] = {uint8_t(CLAMP(s[4] * 255.0f, 0.0f, 255.0f)), uint8_t(CLAMP(s[5] * 255.0f, 0.0f, 255.0f)), uint8_t(CLAMP(s[6] * 255.0f, 0.0f, 255.0f)),
                               uint8_t(CLAMP(s[7] * 255.0f, 0.0f, 255.0f))};
        memcpy(ab + q * as + oc, c8, 4);
        memcpy(ab + q * as + ou, s + 2, 8);
      }
      const auto igual_bytes = [](const PackedByteArray &a, const PackedByteArray &b) { return a.size() == b.size() && memcmp(a.ptr(), b.ptr(), size_t(a.size())) == 0; };
      if (!igual_bytes(bytes_v, enviado_v[k])) {
        rs->mesh_surface_update_vertex_region(malha, 0, 0, bytes_v);
        enviado_v.write[k] = bytes_v;
        enviado_v.write[k].resize(bytes_v.size());  // copia propria (o bytes_v e reusado)
      }
      if (!igual_bytes(bytes_a, enviado_a[k])) {
        rs->mesh_surface_update_attribute_region(malha, 0, 0, bytes_a);
        enviado_a.write[k] = bytes_a;
        enviado_a.write[k].resize(bytes_a.size());
      }
    } else if (!parado) {
      PackedVector2Array pos, uv;
      PackedColorArray cor;
      PackedInt32Array ind;
      pos.resize(nv);
      uv.resize(nv);
      cor.resize(nv);
      for (int q = 0; q < nv; q++) {
        const float *s = v0 + q * 8;
        pos.set(q, Vector2(s[0], -s[1]));
        uv.set(q, Vector2(s[2], s[3]));
        cor.set(q, Color(s[4], s[5], s[6], s[7]));
      }
      ind.resize(indices.size());
      for (int q = 0; q < indices.size(); q++) ind.set(q, indices[q]);
      Array arrays;
      arrays.resize(BONECO_RS::ARRAY_MAX);
      arrays[BONECO_RS::ARRAY_VERTEX] = pos;
      arrays[BONECO_RS::ARRAY_COLOR] = cor;
      arrays[BONECO_RS::ARRAY_TEX_UV] = uv;
      arrays[BONECO_RS::ARRAY_INDEX] = ind;
      rs->mesh_clear(malha);
      // sem compressao: os vertices sao regravados crus nos quadros seguintes
      rs->mesh_add_surface_from_arrays(malha, BONECO_RS::PRIMITIVE_TRIANGLES, arrays, Array(), Dictionary(), 0);
      indices_item.write[k] = indices;
      vertices_item.write[k] = nv;
      enviado_v.write[k] = PackedByteArray();
      enviado_a.write[k] = PackedByteArray();
    }
    // a malha guarda o retangulo de quando foi criada: o do quadro vai como o do item
    rs->canvas_item_set_custom_rect(it, true, caixa);
    Ref<Texture2D> tex = lt.pagina >= 0 && lt.pagina < data->paginas.size() ? data->paginas[lt.pagina] : Ref<Texture2D>();
    rs->canvas_item_add_mesh(it, malha, Transform2D(), Color(1, 1, 1), tex.is_valid() ? tex->get_rid() : RID());
  }
}

void BonecoSprite::_notification(int p_what) {
  switch (p_what) {
    case NOTIFICATION_READY:
      set_process_internal(true);
      break;
    case NOTIFICATION_ENTER_TREE:
      // os itens sao filhos do canvas item do no, que vive tanto quanto ele: sair e voltar
      // para a arvore (o jogo reorganiza pecas) nao precisa recriar nada
      if (itens.is_empty()) _desenhar();
      break;
    case NOTIFICATION_INTERNAL_PROCESS:
      if (!manual) update_skeleton(float(get_process_delta_time()));
      break;
  }
}

void BonecoSprite::_bind_methods() {
  ClassDB::bind_method(D_METHOD("set_data", "data"), &BonecoSprite::set_data);
  ClassDB::bind_method(D_METHOD("get_data"), &BonecoSprite::get_data);
  ClassDB::bind_method(D_METHOD("set_boneco", "caminho"), &BonecoSprite::set_boneco);
  ClassDB::bind_method(D_METHOD("get_boneco"), &BonecoSprite::get_boneco);
  ClassDB::bind_method(D_METHOD("set_preview", "animacao"), &BonecoSprite::set_preview);
  ClassDB::bind_method(D_METHOD("get_preview"), &BonecoSprite::get_preview);
  ClassDB::bind_method(D_METHOD("set_pose_when_hidden", "pousar"), &BonecoSprite::set_pose_when_hidden);
  ClassDB::bind_method(D_METHOD("set_float_clock", "float32"), &BonecoSprite::set_float_clock);
  ClassDB::bind_method(D_METHOD("get_float_clock"), &BonecoSprite::get_float_clock);
  ClassDB::bind_method(D_METHOD("get_pose_when_hidden"), &BonecoSprite::get_pose_when_hidden);
  ClassDB::bind_method(D_METHOD("set_time_scale", "escala"), &BonecoSprite::set_time_scale);
  ClassDB::bind_method(D_METHOD("get_time_scale"), &BonecoSprite::get_time_scale);
  ClassDB::bind_method(D_METHOD("set_playing", "tocando"), &BonecoSprite::set_playing);
  ClassDB::bind_method(D_METHOD("get_playing"), &BonecoSprite::get_playing);
  // o data nao vai para a cena (o BonecoData nao se salva): a cena guarda o caminho em `boneco`
  ADD_PROPERTY(PropertyInfo(Variant::OBJECT, "data", PROPERTY_HINT_RESOURCE_TYPE, "BonecoData", PROPERTY_USAGE_NONE), "set_data", "get_data");
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "boneco", PROPERTY_HINT_FILE, "*.boneco"), "set_boneco", "get_boneco");
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "preview"), "set_preview", "get_preview");
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "pose_when_hidden"), "set_pose_when_hidden", "get_pose_when_hidden");
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "float_clock"), "set_float_clock", "get_float_clock");
  ADD_PROPERTY(PropertyInfo(Variant::FLOAT, "time_scale"), "set_time_scale", "get_time_scale");
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "playing"), "set_playing", "get_playing");
  ClassDB::bind_method(D_METHOD("set_medir", "medir"), &BonecoSprite::set_medir);
  ClassDB::bind_method(D_METHOD("get_medir"), &BonecoSprite::get_medir);
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "medir"), "set_medir", "get_medir");
  ClassDB::bind_method(D_METHOD("set_manual", "manual"), &BonecoSprite::set_manual);
  ClassDB::bind_method(D_METHOD("get_manual"), &BonecoSprite::get_manual);
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "manual"), "set_manual", "get_manual");
  ClassDB::bind_method(D_METHOD("set_animation", "nome", "loop", "trilha"), &BonecoSprite::set_animation, DEFVAL(true), DEFVAL(0));
  ClassDB::bind_method(D_METHOD("add_animation", "nome", "atraso", "loop", "trilha"), &BonecoSprite::add_animation, DEFVAL(0.0), DEFVAL(true), DEFVAL(0));
  ClassDB::bind_method(D_METHOD("get_current", "trilha"), &BonecoSprite::get_current, DEFVAL(0));
  ClassDB::bind_method(D_METHOD("set_empty_animation", "trilha", "mix"), &BonecoSprite::set_empty_animation, DEFVAL(0), DEFVAL(0.0));
  ClassDB::bind_method(D_METHOD("clear_tracks"), &BonecoSprite::clear_tracks);
  ClassDB::bind_method(D_METHOD("clear_track", "trilha"), &BonecoSprite::clear_track, DEFVAL(0));
  ClassDB::bind_method(D_METHOD("set_default_mix", "tempo"), &BonecoSprite::set_default_mix);
  ClassDB::bind_method(D_METHOD("get_default_mix"), &BonecoSprite::get_default_mix);
  ClassDB::bind_method(D_METHOD("set_mix", "de", "para", "tempo"), &BonecoSprite::set_mix);
  ClassDB::bind_method(D_METHOD("get_animation_names"), &BonecoSprite::get_animation_names);
  ClassDB::bind_method(D_METHOD("set_to_setup_pose"), &BonecoSprite::set_to_setup_pose);
  ClassDB::bind_method(D_METHOD("update_skeleton", "delta"), &BonecoSprite::update_skeleton);
  ClassDB::bind_method(D_METHOD("has_bone", "osso"), &BonecoSprite::has_bone);
  ClassDB::bind_method(D_METHOD("has_slot", "slot"), &BonecoSprite::has_slot);
  ClassDB::bind_method(D_METHOD("get_bone_world", "osso"), &BonecoSprite::get_bone_world);
  ClassDB::bind_method(D_METHOD("get_bone_local", "osso"), &BonecoSprite::get_bone_local);
  ClassDB::bind_method(D_METHOD("get_bones_world"), &BonecoSprite::get_bones_world);
  ClassDB::bind_method(D_METHOD("get_slot_color", "slot"), &BonecoSprite::get_slot_color);
  ClassDB::bind_method(D_METHOD("set_slot_color", "slot", "cor"), &BonecoSprite::set_slot_color);
  ClassDB::bind_method(D_METHOD("set_slot_attachment", "slot", "parte"), &BonecoSprite::set_slot_attachment);
  ClassDB::bind_method(D_METHOD("get_slot_setup_attachment", "slot"), &BonecoSprite::get_slot_setup_attachment);
  ClassDB::bind_method(D_METHOD("get_skeleton_bounds"), &BonecoSprite::get_skeleton_bounds);
  ClassDB::bind_method(D_METHOD("get_last_update_usec"), &BonecoSprite::get_last_update_usec);
  ClassDB::bind_method(D_METHOD("get_last_draw_usec"), &BonecoSprite::get_last_draw_usec);
  ADD_SIGNAL(MethodInfo("before_world_transforms_change", PropertyInfo(Variant::OBJECT, "sprite")));
  ADD_SIGNAL(MethodInfo("animation_started", PropertyInfo(Variant::OBJECT, "entrada")));
  ADD_SIGNAL(MethodInfo("animation_interrupted", PropertyInfo(Variant::OBJECT, "entrada")));
  ADD_SIGNAL(MethodInfo("animation_completed", PropertyInfo(Variant::OBJECT, "entrada")));
  ADD_SIGNAL(MethodInfo("animation_ended", PropertyInfo(Variant::OBJECT, "entrada")));
  ADD_SIGNAL(MethodInfo("animation_event", PropertyInfo(Variant::OBJECT, "entrada"), PropertyInfo(Variant::STRING, "nome"), PropertyInfo(Variant::INT, "inteiro"),
                        PropertyInfo(Variant::FLOAT, "decimal"), PropertyInfo(Variant::STRING, "texto")));
}
