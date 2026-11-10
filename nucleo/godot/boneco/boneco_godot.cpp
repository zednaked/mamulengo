// BonecoData e BonecoSprite (boneco_godot.h): leitura do .boneco, o passo de cada quadro e o
// desenho. O desenho usa uma malha por item que fica de um quadro para o outro: so os
// vertices que mudaram sao regravados, a superficie so e refeita quando os indices mudam, e o
// comando de malha do item fica posto (nada de limpar e repor o item a cada quadro).
#include "boneco_godot.h"

#include <cstring>

#include "mamulengo/json.h"

#ifdef GDEXTENSION
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/font_variation.hpp>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/input_event_screen_drag.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/resource_loader.hpp>
#include <godot_cpp/classes/text_server.hpp>
#include <godot_cpp/classes/theme_db.hpp>
#include <godot_cpp/classes/translation_server.hpp>
#include <godot_cpp/variant/typed_array.hpp>
#define BONECO_FONTES TypedArray<Ref<Font>>
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
#include "core/string/translation_server.h"
#include "scene/theme/theme_db.h"
#include "servers/text_server.h"
#define BONECO_FONTES TypedArray<Font>
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
  RID shader_ajuste;
  RID shader_modo;
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

// a camada de ajuste (docs/NUCLEO.md "Ajuste"; a mesma conta de src/render/desenhista.ts): o que
// ja esta na tela (o backbuffer, copiado antes do item), com desfoque gaussiano, matiz, saturacao,
// luminosidade e contraste, por cima pela mascara (o alfa da imagem; cheia: a tela inteira)
RID shader_ajuste() {
  RID &sh = cache().shader_ajuste;
  if (sh.is_valid()) return sh;
  const char *codigo =
      "shader_type canvas_item;\nrender_mode blend_premul_alpha, unshaded;\n"
      "uniform sampler2D tela : hint_screen_texture, filter_linear;\nuniform bool cheia = false;\nuniform float aj[5];\n"
      "varying vec4 cor_v;\nvarying float px_mundo;\n"
      "void vertex() { cor_v = COLOR; px_mundo = length((CANVAS_MATRIX * MODEL_MATRIX)[0].xy); }\n"
      "vec3 gira(vec3 c, float graus) {\n"
      "  float a = radians(graus), s = sin(a), k = cos(a);\n  vec3 e = vec3(0.57735027);\n"
      "  return c * k + cross(e, c) * s + e * dot(e, c) * (1.0 - k);\n}\n"
      "void fragment() {\n"
      "  float r = aj[4] * px_mundo;\n  vec3 c;\n"
      "  if (r > 0.5) {\n    vec3 s = vec3(0.0); float w = 0.0;\n"
      "    for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {\n"
      "      vec2 o = vec2(float(i), float(j)) / 3.0;\n      float g = exp(-dot(o, o) * 2.0);\n"
      "      s += texture(tela, SCREEN_UV + o * r * SCREEN_PIXEL_SIZE).rgb * g; w += g;\n    }\n"
      "    c = s / w;\n  } else c = texture(tela, SCREEN_UV).rgb;\n"
      "  c = gira(c, aj[0]);\n"
      "  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, aj[1]);\n"
      "  c = clamp((c + aj[2] - 0.5) * aj[3] + 0.5, 0.0, 1.0);\n"
      "  float m = cheia ? 1.0 : texture(TEXTURE, UV).a * cor_v.a;\n"
      "  COLOR = vec4(c * m, m);\n}\n";
  RenderingServer *rs = RenderingServer::get_singleton();
  sh = rs->shader_create();
  rs->shader_set_code(sh, codigo);
  return sh;
}

// os blends que leem a tela (docs/NUCLEO.md "Blends"; a mesma conta de src/render/desenhista.ts):
// o que ja esta desenhado (o backbuffer, copiado antes do item) misturado com a cor da peca pela
// formula do modo, por cima na medida do alfa
RID shader_modo() {
  RID &sh = cache().shader_modo;
  if (sh.is_valid()) return sh;
  const char *codigo =
      "shader_type canvas_item;\nrender_mode blend_premul_alpha, unshaded;\n"
      "uniform sampler2D tela : hint_screen_texture, filter_nearest;\nuniform bool pma = false;\nuniform int modo = 5;\n"
      "varying vec4 cor_v;\nvoid vertex() { cor_v = COLOR; }\n"
      "vec3 mistura(vec3 b, vec3 s) {\n"
      "  if (modo == 5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));\n"
      "  if (modo == 6) {\n"
      "    vec3 D = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));\n"
      "    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (D - b), step(0.5, s));\n  }\n"
      "  if (modo == 7) return min(b, s);\n  if (modo == 8) return max(b, s);\n  if (modo == 9) return abs(b - s);\n"
      "  if (modo == 10) return mix(min(vec3(1.0), b / max(1.0 - s, 1e-5)), vec3(0.0), step(b, vec3(0.0)));\n"
      "  return s;\n}\n"
      "void fragment() {\n"
      "  vec4 t = texture(TEXTURE, UV);\n  if (pma && t.a > 0.0) t.rgb /= t.a;\n"
      "  vec3 c = t.rgb * cor_v.rgb;\n  float a = t.a * cor_v.a;\n"
      "  COLOR = vec4(mistura(texture(tela, SCREEN_UV).rgb, c) * a, a);\n}\n";
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
  if (cache().shader_ajuste.is_valid()) rs->free_rid(cache().shader_ajuste);
  cache().shader_ajuste = RID();
  if (cache().shader_modo.is_valid()) rs->free_rid(cache().shader_modo);
  cache().shader_modo = RID();
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
    d->paginas_rid.push_back(tex.is_valid() ? tex->get_rid() : RID());
    // o relevo da pagina (docs/NUCLEO.md "Luzes"): sem ele a pagina fica sem luz
    Ref<Texture2D> rel;
    if (!pg.relevo.empty()) {
      rel = BONECO_CARREGA(pasta.path_join(String::utf8(pg.relevo.c_str())).simplify_path());
      if (rel.is_null()) BONECO_ERRO("boneco: nao carreguei o relevo " + String::utf8(pg.relevo.c_str()));
    }
    d->relevos.push_back(rel);
  }
  // as fontes dos textos (docs/NUCLEO.md "Texto"), ao lado do .boneco: cada uma com as outras de
  // reserva, na ordem do arquivo
  std::vector<Ref<Font>> base;
  for (const mamulengo::DadosFonte &f : d->modelo->fontes) {
    const String p = pasta.path_join(String::utf8(f.arquivo.c_str())).simplify_path();
    Ref<Font> ff = BONECO_CARREGA(p);
    if (ff.is_null()) BONECO_ERRO("boneco: nao carreguei a fonte " + p);
    base.push_back(ff);
  }
  for (size_t i = 0; i < base.size(); ++i) {
    Ref<FontVariation> v;
    v.instantiate();
    if (base[i].is_valid()) v->set_base_font(base[i]);
    BONECO_FONTES reserva;
    for (size_t k = 0; k < base.size(); ++k)
      if (k != i && base[k].is_valid()) reserva.push_back(base[k]);
    v->set_fallbacks(reserva);
    d->fontes.push_back(v);
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
  copia_item.clear();
  indices_item.clear();
  vertices_item.clear();
  cru_ind_item.clear();
  vmin_item.clear();
  cru_item.clear();
  textura_item.clear();
  posto_item.clear();
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

void BonecoSprite::set_spine_godot_mix(bool p) {
  spine_godot_mix = p;
  if (estado) estado->mix_spine_godot = p;
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
  estado->mix_spine_godot = spine_godot_mix;
  _aplicar_mix();
  esq->janela(janela.x, janela.y);
  textos.assign(data->modelo->textos.size(), EstadoTexto());
  _textos_imagem();
  esq->setup();
  esq->atualizar_mundo();
  // papeis: os botoes no estado inicial (fora do editor)
  ui.reset();
  if (!data->modelo->papeis.empty() && !BONECO_EDITOR()) {
    ui = std::make_unique<mamulengo::Interface>(data->modelo);
    ui->iniciar(*estado);
    _avisar();
  }
  set_process_input(ui && roles_input);
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

// ---- palco (docs/PALCO.md)

bool BonecoSprite::stage_start() {
  if (!esq || !data.is_valid() || !data->modelo || !data->modelo->palco.existe) return false;
  palco = std::make_unique<mamulengo::Palco>(*data->modelo);
  palco->reiniciar(*esq);
  palco_sobra = 0;
  _desenhar();
  return true;
}

void BonecoSprite::stage_stop() {
  palco.reset();
  if (esq) set_to_setup_pose();
}

void BonecoSprite::stage_step(int p_bits, int p_n) {
  if (!palco || !esq) return;
  for (int i = 0; i < p_n; ++i) palco->passo(*esq, uint32_t(p_bits), 1.0 / 60);
  _desenhar();
}

Dictionary BonecoSprite::get_stage_state() const {
  Dictionary d;
  if (!palco) return d;
  d["tick"] = palco->tick;
  d["won"] = palco->venceu;
  d["died"] = palco->morreu;
  d["points"] = palco->pontos;
  Array atores;
  static const char *estados[] = {"idle", "walk", "jump", "dead"};
  const auto &dados = data->modelo->palco.atores;
  for (size_t i = 0; i < palco->atores().size(); ++i) {
    const mamulengo::EstadoAtor &a = palco->atores()[i];
    Dictionary x;
    x["name"] = String::utf8(dados[i].nome.c_str());
    x["position"] = Vector2(float(a.x), float(-a.y));
    x["velocity"] = Vector2(float(a.vx), float(-a.vy));
    x["side"] = a.lado;
    x["on_floor"] = a.chao;
    x["alive"] = a.vivo;
    x["state"] = estados[int(a.estado)];
    atores.push_back(x);
  }
  d["actors"] = atores;
  return d;
}

// ---- tela (docs/NUCLEO.md "Tela")

void BonecoSprite::set_window(const Vector2 &p_tamanho) {
  janela = p_tamanho;
  if (esq) esq->janela(janela.x, janela.y);
}

void BonecoSprite::set_fit_window(bool p) {
  fit_window = p;
  if (fit_window && is_inside_tree()) _encaixar_janela();
}

// a vista no espaco do no (y para baixo): o retangulo do mundo que a janela mostra
Rect2 BonecoSprite::get_view() const {
  if (!esq) return Rect2();
  const mamulengo::Esqueleto::Vista &v = esq->vista();
  return Rect2(float(v.x), float(-(v.y + v.altura)), float(v.largura), float(v.altura));
}

float BonecoSprite::get_view_scale() const { return esq ? float(esq->vista().escala) : 1.0f; }

// a janela e a da viewport, e o no vai para a vista cobrir a viewport: escala da vista e o canto
// de cima e da esquerda dela em (0, 0) (o no direto na viewport, sem camera)
void BonecoSprite::_encaixar_janela() {
  if (!esq) return;
  const Vector2 t = get_viewport_rect().size;
  if (t != janela) set_window(t);
  const mamulengo::Esqueleto::Vista &v = esq->vista();
  const float s = float(v.escala);
  set_rotation(0);
  set_scale(Vector2(s, s));
  set_position(Vector2(float(-v.x) * s, float(v.y + v.altura) * s));
}

void BonecoSprite::update_skeleton(float p_dt) {
  if (!esq) return;
  if (fit_window && is_inside_tree()) _encaixar_janela();
  if (palco) {
    // o jogo: passos fixos de 1/60 s (no maximo 6 por quadro)
    palco_sobra = std::min(palco_sobra + _dt(p_dt), 6.0 / 60);
    int n = 0;
    while (palco_sobra >= 1.0 / 60 - 1e-9) palco_sobra -= 1.0 / 60, ++n;
    if (n) stage_step(palco_teclas, n);
    return;
  }
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
  _textos_medida();
  mamulengo::desenhar(*esq, desenho);
  RenderingServer *rs = RenderingServer::get_singleton();

  // itens: um por lote; o blend tela ocupa dois (os dois passos)
  using Item = ItemLista;
  lista.clear();
  for (int l = 0; l < int(desenho.lotes.size()); ++l) {
    const mamulengo::Lote &lt = desenho.lotes[size_t(l)];
    if (lt.comando == Comando::Ajuste) {
      if (lt.efeito >= 0 && lt.efeito < int(desenho.ajustes.size())) lista.push_back({l, RID(), NORMAL_PMA, false, true});
      continue;
    }
    if (lt.comando != Comando::Triangulos || lt.quantos == 0) continue;
    // a pagina dos textos (virtual): as letras pelo TextServer, no lugar da malha
    if (lt.pagina == int(data->modelo->paginas_desenho.size())) {
      ItemLista li{l, RID(), NORMAL_PMA, false, false, 0};
      li.texto = true;
      lista.push_back(li);
      continue;
    }
    const bool pma = lt.pagina >= 0 && lt.pagina < int(data->modelo->paginas_desenho.size()) && data->modelo->paginas_desenho[size_t(lt.pagina)].pma;
    if (mamulengo::le_tela(lt.blend)) {
      lista.push_back({l, RID(), NORMAL_PMA, pma, false, int(lt.blend)});
      continue;
    }
    switch (lt.blend) {
      case Blend::Aditivo: lista.push_back({l, material_passo(ADITIVO, pma), ADITIVO, pma, false}); break;
      case Blend::Multiplica: lista.push_back({l, material_passo(MULTIPLICA, pma), MULTIPLICA, pma, false}); break;
      case Blend::MultiplicaMotor: lista.push_back({l, material_passo(MULTIPLICA_MOTOR, pma), MULTIPLICA_MOTOR, pma, false}); break;
      case Blend::Tela:
        lista.push_back({l, material_passo(TELA_MUL, pma), TELA_MUL, pma, false});
        lista.push_back({l, material_passo(TELA_ADD, pma), TELA_ADD, pma, false});
        break;
      default: lista.push_back({l, pma ? material_passo(NORMAL_PMA, true) : RID(), NORMAL_PMA, pma, false});
    }
  }
  while (itens.size() < int(lista.size())) {
    const RID pai = get_canvas_item();
    RID it = rs->canvas_item_create();
    rs->canvas_item_set_parent(it, pai);
    rs->canvas_item_set_draw_index(it, itens.size());
    itens.push_back(it);
    malhas.push_back(rs->mesh_create());
    material_item.push_back(RID());
    material_efeito.push_back(RID());
    passo_efeito.push_back(-1);
    copia_item.push_back(false);
    indices_item.push_back(Vector<int>());
    vertices_item.push_back(0);
    cru_ind_item.emplace_back();
    vmin_item.push_back(0);
    cru_item.emplace_back();
    textura_item.emplace_back();
    posto_item.push_back(0);
  }

  const int64_t fmt = int64_t(BONECO_RS::ARRAY_FORMAT_VERTEX) | int64_t(BONECO_RS::ARRAY_FORMAT_COLOR) | int64_t(BONECO_RS::ARRAY_FORMAT_TEX_UV) |
                      int64_t(BONECO_RS::ARRAY_FORMAT_INDEX) | int64_t(BONECO_RS::ARRAY_FLAG_USE_2D_VERTICES);
  // os passos e posicoes do formato (so dependem do formato: vertice 2D, cor e uv)
  static const int64_t vs = rs->mesh_surface_get_format_vertex_stride(fmt, 1);
  static const int64_t as = rs->mesh_surface_get_format_attribute_stride(fmt, 1);
  static const int64_t oc = rs->mesh_surface_get_format_offset(fmt, 1, BONECO_RS::ARRAY_COLOR);
  static const int64_t ou = rs->mesh_surface_get_format_offset(fmt, 1, BONECO_RS::ARRAY_TEX_UV);
  const float *vd = desenho.vertices.data();
  const uint32_t *id = desenho.indices.data();
  for (int k = 0; k < itens.size(); k++) {
    const RID it = itens[k];
    const bool ajuste = k < int(lista.size()) && lista[size_t(k)].ajuste;
    const int modo = k < int(lista.size()) ? lista[size_t(k)].modo : 0;
    // o item comum fica com o comando de malha do quadro anterior (a malha e a mesma, so os
    // vertices mudam); o de ajuste e o que le a tela, e o que sobrou, sao refeitos
    const bool especial = ajuste || modo || k >= int(lista.size());
    if (posto_item[size_t(k)] == 2 || (posto_item[size_t(k)] && especial)) {
      rs->canvas_item_clear(it);
      posto_item[size_t(k)] = 0;
    }
    // a camada de ajuste e os blends que leem a tela: o backbuffer e copiado (a viewport inteira)
    // antes do item
    if (copia_item[k] != (ajuste || modo)) {
      rs->canvas_item_set_copy_to_backbuffer(it, ajuste || modo, Rect2());
      copia_item.write[k] = ajuste || modo;
    }
    if (k >= int(lista.size())) continue;
    const mamulengo::Lote &lt = desenho.lotes[size_t(lista[size_t(k)].lote)];
    if (lista[size_t(k)].texto) {
      // refeito a cada quadro (os comandos de texto nao ficam postos como a malha)
      if (posto_item[size_t(k)]) rs->canvas_item_clear(it);
      if (material_item[k].is_valid()) {
        rs->canvas_item_set_material(it, RID());
        material_item.write[k] = RID();
      }
      _desenhar_textos(it, lt);
      posto_item[size_t(k)] = 2;
      textura_item[size_t(k)] = RID();
      continue;
    }
    if (modo) {
      if (!material_efeito[k].is_valid()) material_efeito.write[k] = rs->material_create();
      const RID me = material_efeito[k];
      if (passo_efeito[k] != PASSOS * 4 + 1) {
        rs->material_set_shader(me, shader_modo());
        passo_efeito.write[k] = PASSOS * 4 + 1;
      }
      rs->material_set_param(me, "modo", modo);
      rs->material_set_param(me, "pma", lista[size_t(k)].pma);
      lista[size_t(k)].material = me;
    }
    if (ajuste) {
      if (!material_efeito[k].is_valid()) material_efeito.write[k] = rs->material_create();
      const RID me = material_efeito[k];
      if (passo_efeito[k] != PASSOS * 4) {
        rs->material_set_shader(me, shader_ajuste());
        passo_efeito.write[k] = PASSOS * 4;
      }
      PackedFloat32Array aj;
      aj.resize(5);
      memcpy(aj.ptrw(), desenho.ajustes[size_t(lt.efeito)].v, sizeof(float) * 5);
      rs->material_set_param(me, "aj", aj);
      rs->material_set_param(me, "cheia", lt.quantos == 0);
      lista[size_t(k)].material = me;
      if (lt.quantos == 0) {
        // sem imagem: um retangulo que cobre qualquer tela (o recorte da viewport corta)
        if (material_item[k] != me) {
          rs->canvas_item_set_material(it, me);
          material_item.write[k] = me;
        }
        const Rect2 tudo(Vector2(-1e6, -1e6), Vector2(2e6, 2e6));
        rs->canvas_item_set_custom_rect(it, true, tudo);
        rs->canvas_item_add_rect(it, tudo, Color(1, 1, 1));
        posto_item[size_t(k)] = 2;
        continue;
      }
    }
    // luz: o relevo da pagina carregado e um grupo de luz no lote
    const Ref<Texture2D> rel = lt.luz >= 0 && lt.pagina >= 0 && lt.pagina < data->relevos.size() ? data->relevos[lt.pagina] : Ref<Texture2D>();
    const bool luz = !ajuste && !modo && rel.is_valid();
    if (!ajuste && !modo && (lt.efeito >= 0 || luz)) {
      // slot com efeitos ou iluminado: o material proprio do item, com os valores deste quadro
      const Item &li = lista[size_t(k)];
      const bool efeitos = lt.efeito >= 0;
      if (!material_efeito[k].is_valid()) material_efeito.write[k] = rs->material_create();
      const RID me = material_efeito[k];
      const int chave = int(li.passo) * 4 + int(efeitos) + 2 * int(luz);
      if (passo_efeito[k] != chave) {
        rs->material_set_shader(me, shader_proprio(Passo(li.passo), efeitos, luz));
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
    // os indices do lote: os mesmos crus do quadro anterior dao a mesma malha (nada a
    // renumerar); senao, os vertices que o lote usa, renumerados a partir de 0
    const uint32_t *ri = id + lt.inicio;
    std::vector<uint32_t> &cru_ind = cru_ind_item[size_t(k)];
    bool igual = cru_ind.size() == size_t(lt.quantos) && memcmp(cru_ind.data(), ri, sizeof(uint32_t) * lt.quantos) == 0;
    uint32_t vmin = vmin_item[size_t(k)];
    int nv = vertices_item[k];
    const auto renumera = [&]() {
      vmin = UINT32_MAX;
      uint32_t vmax = 0;
      for (uint32_t q = 0; q < lt.quantos; q++) {
        vmin = MIN(vmin, ri[q]);
        vmax = MAX(vmax, ri[q]);
      }
      nv = int(vmax - vmin + 1);
      indices_buf.resize(int(lt.quantos));
      int *iw = indices_buf.ptrw();
      for (uint32_t q = 0; q < lt.quantos; q++) iw[q] = int(ri[q] - vmin);
    };
    bool renumerado = false;
    if (!igual) {
      renumera();
      renumerado = true;
      // renumerados iguais (o lote so andou no vetor): a mesma malha
      igual = vertices_item[k] == nv && indices_item[k].size() == indices_buf.size() &&
              memcmp(indices_item[k].ptr(), indices_buf.ptr(), sizeof(int) * size_t(indices_buf.size())) == 0;
      cru_ind.assign(ri, ri + lt.quantos);
      vmin_item[size_t(k)] = vmin;
    }
    const float *v0 = vd + size_t(vmin) * 8;
    const RID malha = malhas[k];
    // a malha tem os vertices de `cru` (os do ultimo envio)
    std::vector<float> &cru = cru_item[size_t(k)];
    bool mudou_caixa = false;
    Rect2 caixa;
    // a caixa do item (a malha guarda o retangulo de quando foi criada: o do quadro vai como o
    // do item)
    const auto faz_caixa = [&]() {
      float x0 = v0[0], x1 = v0[0], y0 = -v0[1], y1 = -v0[1];
      for (int q = 1; q < nv; q++) {
        const float x = v0[q * 8], y = -v0[q * 8 + 1];
        x0 = MIN(x0, x), x1 = MAX(x1, x), y0 = MIN(y0, y), y1 = MAX(y1, y);
      }
      caixa = Rect2(x0, y0, x1 - x0, y1 - y0);
      mudou_caixa = true;
    };
    if (igual && cru.size() == size_t(nv) * 8) {
      // mesmo desenho: so regrava o que mudou (posicao; cor e uv), numa passada
      if (memcmp(cru.data(), v0, sizeof(float) * cru.size()) != 0) {
        const float *c = cru.data();
        bool mp = false, ma = false;
        for (int q = 0; q < nv && !(mp && ma); q++) {
          mp = mp || memcmp(v0 + q * 8, c + q * 8, 8) != 0;
          ma = ma || memcmp(v0 + q * 8 + 2, c + q * 8 + 2, 24) != 0;
        }
        if (mp) {
          bytes_v.resize(int(vs * nv));
          uint8_t *vb = bytes_v.ptrw();
          for (int q = 0; q < nv; q++) {
            const float xy[2] = {v0[q * 8], -v0[q * 8 + 1]};
            memcpy(vb + q * vs, xy, 8);
          }
          rs->mesh_surface_update_vertex_region(malha, 0, 0, bytes_v);
          faz_caixa();
        }
        if (ma) {
          bytes_a.resize(int(as * nv));
          uint8_t *ab = bytes_a.ptrw();
          for (int q = 0; q < nv; q++) {
            const float *sv = v0 + q * 8;
            const uint8_t c8[4] = {uint8_t(CLAMP(sv[4] * 255.0f, 0.0f, 255.0f)), uint8_t(CLAMP(sv[5] * 255.0f, 0.0f, 255.0f)), uint8_t(CLAMP(sv[6] * 255.0f, 0.0f, 255.0f)),
                                   uint8_t(CLAMP(sv[7] * 255.0f, 0.0f, 255.0f))};
            memcpy(ab + q * as + oc, c8, 4);
            memcpy(ab + q * as + ou, sv + 2, 8);
          }
          rs->mesh_surface_update_attribute_region(malha, 0, 0, bytes_a);
        }
        cru.assign(v0, v0 + size_t(nv) * 8);
      }
    } else {
      PackedVector2Array pos, uv;
      PackedColorArray cor;
      PackedInt32Array ind;
      pos.resize(nv);
      uv.resize(nv);
      cor.resize(nv);
      for (int q = 0; q < nv; q++) {
        const float *sv = v0 + q * 8;
        pos.set(q, Vector2(sv[0], -sv[1]));
        uv.set(q, Vector2(sv[2], sv[3]));
        cor.set(q, Color(sv[4], sv[5], sv[6], sv[7]));
      }
      if (!renumerado) renumera();
      ind.resize(indices_buf.size());
      for (int q = 0; q < indices_buf.size(); q++) ind.set(q, indices_buf[q]);
      Array arrays;
      arrays.resize(BONECO_RS::ARRAY_MAX);
      arrays[BONECO_RS::ARRAY_VERTEX] = pos;
      arrays[BONECO_RS::ARRAY_COLOR] = cor;
      arrays[BONECO_RS::ARRAY_TEX_UV] = uv;
      arrays[BONECO_RS::ARRAY_INDEX] = ind;
      rs->mesh_clear(malha);
      // sem compressao: os vertices sao regravados crus nos quadros seguintes
      rs->mesh_add_surface_from_arrays(malha, BONECO_RS::PRIMITIVE_TRIANGLES, arrays, Array(), Dictionary(), 0);
      indices_item.write[k] = indices_buf;
      vertices_item.write[k] = nv;
      cru.assign(v0, v0 + size_t(nv) * 8);
      faz_caixa();
      // a malha refeita: o comando de malha do item e posto de novo
      if (posto_item[size_t(k)]) {
        rs->canvas_item_clear(it);
        posto_item[size_t(k)] = 0;
      }
    }
    const RID tex = lt.pagina >= 0 && lt.pagina < data->paginas_rid.size() ? data->paginas_rid[lt.pagina] : RID();
    if (posto_item[size_t(k)] && textura_item[size_t(k)] != tex) {
      rs->canvas_item_clear(it);
      posto_item[size_t(k)] = 0;
    }
    if (!posto_item[size_t(k)]) {
      if (!mudou_caixa) faz_caixa();
      rs->canvas_item_add_mesh(it, malha, Transform2D(), Color(1, 1, 1), tex);
      // o de ajuste e o que le a tela sao refeitos no quadro seguinte (2)
      posto_item[size_t(k)] = especial ? 2 : 1;
      textura_item[size_t(k)] = tex;
    }
    if (mudou_caixa) rs->canvas_item_set_custom_rect(it, true, caixa);
  }
}

// ---- textos (docs/NUCLEO.md "Texto"): o nucleo poe a caixa no osso; as letras sao do TextServer.
// A pagina dos textos e virtual: cada texto k entrega a caixa inteira com o uv [k, k + 1] (o u
// diz qual texto e), e o lote dessa pagina vira comandos de texto no lugar da malha

namespace {
bool idioma_rtl(const String &l) {
  const String b = l.get_slice("_", 0).get_slice("-", 0);
  return b == "ar" || b == "fa" || b == "he" || b == "ur" || b == "ps" || b == "sd" || b == "ug" || b == "ckb" || b == "yi";
}
Color cor_texto(const mamulengo::Cor &c) { return Color(c.r, c.g, c.b, c.a); }
}  // namespace

void BonecoSprite::_textos_imagem() {
  if (!esq) return;
  for (size_t k = 0; k < data->modelo->textos.size(); ++k) {
    const mamulengo::DadosTexto &t = data->modelo->textos[k];
    const double ret[4] = {-t.largura / 2, -t.altura / 2, t.largura / 2, t.altura / 2};
    const float uv[4] = {float(k), 0, float(k + 1), 1};
    esq->imagem_texto(int(k), ret, uv);
  }
  esq->pagina_textos(1, 1);
}

// nove-fatias (docs/NUCLEO.md "Nove-fatias"): antes do desenho, quanto ocupa cada texto que uma
// regiao fatiada acompanha (a caixa do botao cresce com ele); a diagramacao fica guardada
void BonecoSprite::_textos_medida() {
  const mamulengo::Modelo &m = *data->modelo;
  for (const mamulengo::DadosFatias &f : m.fatias) {
    if (f.texto < 0 || size_t(f.texto) >= textos.size()) continue;
    _diagramar(f.texto);
    const EstadoTexto &e = textos[size_t(f.texto)];
    esq->medida_texto(f.texto, e.usado_w, e.usado_h);
  }
}

String BonecoSprite::_idioma_efetivo() const {
  if (!idioma.is_empty()) return idioma;
  TranslationServer *ts = TranslationServer::get_singleton();
  return ts ? ts->get_locale() : String("pt");
}

void BonecoSprite::set_language(const String &p_idioma) {
  idioma = p_idioma;
  queue_redraw();
  _desenhar();
}

PackedStringArray BonecoSprite::get_languages() const {
  PackedStringArray out;
  if (data.is_valid() && data->modelo)
    for (const std::string &l : data->modelo->traducoes.idiomas) out.push_back(String::utf8(l.c_str()));
  return out;
}

// o texto pelo nome da parte, ou do slot
int BonecoSprite::_texto(const String &p_nome) const {
  if (data.is_null() || !data->modelo) return -1;
  const std::string n = padrao(p_nome);
  const mamulengo::Modelo &m = *data->modelo;
  for (size_t k = 0; k < m.textos.size(); ++k)
    if (m.textos[k].nome == n) return int(k);
  const int s = m.slot(n);
  for (size_t k = 0; k < m.textos.size(); ++k)
    if (s >= 0 && m.partes[size_t(m.textos[k].parte)].slot == s) return int(k);
  return -1;
}

void BonecoSprite::set_text(const String &p_nome, const String &p_valor) {
  const int k = _texto(p_nome);
  if (k < 0) return BONECO_ERRO("boneco: texto desconhecido " + p_nome);
  textos[size_t(k)].livre = true;
  textos[size_t(k)].valor = p_valor;
  _desenhar();
}

void BonecoSprite::set_text_params(const String &p_nome, const Dictionary &p_params) {
  const int k = _texto(p_nome);
  if (k < 0) return BONECO_ERRO("boneco: texto desconhecido " + p_nome);
  Dictionary &d = textos[size_t(k)].params;
  const Array ch = p_params.keys();
  for (int i = 0; i < ch.size(); i++) d[ch[i]] = p_params[ch[i]];
  _desenhar();
}

void BonecoSprite::clear_text(const String &p_nome) {
  const int k = _texto(p_nome);
  if (k < 0) return;
  textos[size_t(k)] = EstadoTexto();
  _desenhar();
}

// a traducao da chave no idioma; sem ela, o texto livre; sem os dois, o primeiro idioma com
// texto e a chave (como src/core/texto.ts); depois os parametros "{nome}"
String BonecoSprite::_mostrado(int k) const {
  const mamulengo::Modelo &m = *data->modelo;
  const mamulengo::DadosTexto &t = m.textos[size_t(k)];
  const EstadoTexto &e = textos[size_t(k)];
  if (e.livre) return e.valor;
  String s;
  if (!t.chave.empty()) {
    const int c = m.traducoes.chave(t.chave);
    const int i = m.traducoes.idioma(padrao(_idioma_efetivo()));
    if (c >= 0 && i >= 0 && !m.traducoes.textos[size_t(c)][size_t(i)].empty()) s = String::utf8(m.traducoes.textos[size_t(c)][size_t(i)].c_str());
    else if (!t.texto.empty()) s = String::utf8(t.texto.c_str());
    else {
      if (c >= 0)
        for (const std::string &x : m.traducoes.textos[size_t(c)])
          if (!x.empty()) {
            s = String::utf8(x.c_str());
            break;
          }
      if (s.is_empty()) s = String::utf8(t.chave.c_str());
    }
  } else s = String::utf8(t.texto.c_str());
  const Array ch = e.params.keys();
  for (int i = 0; i < ch.size(); i++) s = s.replace(String("{") + String(ch[i]) + String("}"), String(e.params[ch[i]]));
  return s;
}

// a diagramacao (a mesma de src/core/texto.ts): linhas, alinhamento, encolher em meio pixel ate o
// minimo, quebrar nas palavras, cortar (aproximado: a linha aparada no fim) e o estouro
void BonecoSprite::_diagramar(int k) {
  const mamulengo::Modelo &m = *data->modelo;
  const mamulengo::DadosTexto &t = m.textos[size_t(k)];
  EstadoTexto &e = textos[size_t(k)];
  const String txt = _mostrado(k);
  const String lang = _idioma_efetivo();
  const bool rtl = idioma_rtl(lang);
  // a fonte: a familia da parte (ou a primeira), ou a do tema
  Ref<Font> fonte;
  for (size_t i = 0; i < m.fontes.size() && i < size_t(data->fontes.size()); ++i)
    if (m.fontes[i].nome == t.familia) fonte = data->fontes[int(i)];
  if (fonte.is_null() && !data->fontes.is_empty()) fonte = data->fontes[0];
  if (fonte.is_null()) fonte = ThemeDB::get_singleton()->get_fallback_font();
  Ref<Font> metrica = fonte;
  if (Ref<FontVariation> fv = fonte; fv.is_valid() && fv->get_base_font().is_valid()) metrica = fv->get_base_font();
  const String ass = txt + String("|") + lang + String("|") + itos(fonte.is_valid() ? int64_t(fonte->get_instance_id()) : 0);
  if (ass == e.assinatura && !e.linhas.empty()) return;
  e.assinatura = ass;
  const auto linha = [&](const String &s, int px) {
    Ref<TextLine> l;
    l.instantiate();
    l->set_direction(rtl ? TextServer::DIRECTION_RTL : TextServer::DIRECTION_LTR);
    l->add_string(s, fonte, px, lang);
    return l;
  };
  const auto largura = [&](const String &s, int px) { return float(linha(s, px)->get_size().x); };
  const float W = float(t.largura), H = float(t.altura);
  float usado_w = 0, usado_h = 0;
  const auto montar = [&](float pxf) {
    const int px = MAX(1, int(Math::round(pxf)));
    // as medidas da fonte da parte (as de reserva, como a arabe, sao mais altas e nao contam: o
    // mesmo do navegador, que mede pela primeira fonte)
    const float asc = metrica.is_valid() ? metrica->get_ascent(px) : px * 0.8f, desc = metrica.is_valid() ? metrica->get_descent(px) : px * 0.2f;
    const float lh = MAX(asc + desc, px * 1.15f);
    PackedStringArray ls = txt.split("\n");
    if (t.estouro == mamulengo::Estouro::Quebrar) {
      PackedStringArray q;
      for (int i = 0; i < ls.size(); i++) {
        String cur;
        const PackedStringArray ps = ls[i].split(" ");
        for (int j = 0; j < ps.size(); j++) {
          const String tt = cur.is_empty() ? ps[j] : cur + String(" ") + ps[j];
          if (!cur.is_empty() && largura(tt, px) > W) q.push_back(cur), cur = ps[j];
          else cur = tt;
        }
        q.push_back(cur);
      }
      ls = q;
    }
    const float total = ls.size() * lh - (lh - (asc + desc));
    const float y0 = t.alinhar_v == 0 ? 0 : t.alinhar_v == 2 ? H - total : (H - total) / 2;
    e.linhas.clear();
    float x0 = 1e30f, x1 = -1e30f;
    for (int i = 0; i < ls.size(); i++) {
      LinhaTexto lt;
      lt.linha = linha(ls[i], px);
      float w = float(lt.linha->get_size().x);
      if (t.estouro == mamulengo::Estouro::Cortar && w > W) {
        lt.linha->set_width(W);
        lt.linha->set_text_overrun_behavior(TextServer::OVERRUN_TRIM_CHAR);
      }
      lt.x = t.alinhar == 0 ? 0 : t.alinhar == 2 ? W - w : (W - w) / 2;
      lt.base = y0 + i * lh + asc;
      x0 = MIN(x0, lt.x), x1 = MAX(x1, lt.x + w);
      if (t.estouro == mamulengo::Estouro::Cortar && lt.base - asc > H) continue;
      e.linhas.push_back(lt);
    }
    usado_w = ls.size() ? x1 - x0 : 0;
    usado_h = total;
    e.usado_w = usado_w, e.usado_h = usado_h;
    e.estoura = usado_w - W > 0.5f || usado_h - H > 0.5f;
  };
  float px = float(t.tamanho);
  montar(px);
  if (t.estouro == mamulengo::Estouro::Encolher && e.estoura) {
    const float min = t.minimo > 0 ? MIN(float(t.minimo), px) : px / 2;
    for (int i = 0; i < 12 && e.estoura && px > min; i++) {
      const float f = MIN(MIN(W / MAX(usado_w, 1e-6f), H / MAX(usado_h, 1e-6f)), 0.98f);
      px = MAX(min, Math::floor(px * f * 2) / 2);
      montar(px);
    }
  }
}

Dictionary BonecoSprite::get_slice_info(const String &p_slot) const {
  Dictionary out;
  if (!esq || data.is_null() || !data->modelo) return out;
  const mamulengo::Modelo &m = *data->modelo;
  const int s = m.slot(padrao(p_slot));
  if (s < 0) return out;
  const int pi = esq->slots()[size_t(s)].parte;
  if (pi < 0 || m.partes[size_t(pi)].fatias < 0) return out;
  const_cast<BonecoSprite *>(this)->_textos_medida();
  const mamulengo::Esqueleto::Fatiada &f = esq->fatiadas()[size_t(m.partes[size_t(pi)].fatias)];
  std::vector<double> c;
  PackedVector2Array cantos;
  if (esq->cantos_fatias(s, c) == 8)
    for (int k = 0; k < 4; ++k) cantos.push_back(Vector2(float(c[size_t(k) * 2]), -float(c[size_t(k) * 2 + 1])));
  out["size"] = Vector2(float(f.largura), float(f.altura));
  out["stretch"] = Vector2(float(f.ex), float(f.ey));
  out["grid"] = Vector2i(f.nx, f.ny);
  out["corners"] = cantos;
  return out;
}

String BonecoSprite::get_text_shown(const String &p_nome) const {
  const int k = _texto(p_nome);
  return k < 0 ? String() : _mostrado(k);
}

Array BonecoSprite::get_text_overflows() const {
  Array out;
  if (data.is_null() || !data->modelo) return out;
  BonecoSprite *eu = const_cast<BonecoSprite *>(this);
  for (size_t k = 0; k < data->modelo->textos.size(); ++k) {
    eu->_diagramar(int(k));
    if (textos[k].estoura) out.push_back(String::utf8(data->modelo->textos[k].nome.c_str()));
  }
  return out;
}

// as letras de um lote da pagina dos textos: cada texto que aparece nele (pelo u), na caixa que o
// nucleo calculou (os cantos da parte do slot), com a cor do vertice (o slot) vezes a do texto.
// O recorte nao corta as letras (o texto aparece inteiro)
void BonecoSprite::_desenhar_textos(const RID &it, const mamulengo::Lote &lt) {
  RenderingServer *rs = RenderingServer::get_singleton();
  const mamulengo::Modelo &m = *data->modelo;
  const float *vd = desenho.vertices.data();
  const uint32_t *id = desenho.indices.data();
  std::vector<char> feito(m.textos.size(), 0);
  std::vector<double> cantos;
  float x0 = 1e30f, y0 = 1e30f, x1 = -1e30f, y1 = -1e30f;
  for (uint32_t q = 0; q + 2 < lt.quantos; q += 3) {
    float umin = 1e30f;
    for (int c = 0; c < 3; c++) umin = MIN(umin, vd[size_t(id[lt.inicio + q + c]) * 8 + 2]);
    const int k = int(Math::floor(umin + 1e-3f));
    if (k < 0 || size_t(k) >= m.textos.size() || feito[size_t(k)]) continue;
    feito[size_t(k)] = 1;
    const mamulengo::DadosTexto &t = m.textos[size_t(k)];
    const int slot = m.partes[size_t(t.parte)].slot;
    if (esq->vertices(slot, cantos) != 8) continue;
    // canto de baixo e da esquerda, de cima e da esquerda, de cima e da direita (y para baixo)
    const Vector2 p0(float(cantos[0]), -float(cantos[1])), p1(float(cantos[2]), -float(cantos[3])), p2(float(cantos[4]), -float(cantos[5]));
    const Transform2D xf((p2 - p1) / float(t.largura), (p0 - p1) / float(t.altura), p1);
    for (const Vector2 &p : {p0, p1, p2, Vector2(float(cantos[6]), -float(cantos[7]))}) x0 = MIN(x0, p.x), y0 = MIN(y0, p.y), x1 = MAX(x1, p.x), y1 = MAX(y1, p.y);
    const float *v = vd + size_t(id[lt.inicio + q]) * 8;
    const Color slot_cor(v[4], v[5], v[6], v[7]);
    _diagramar(k);
    rs->canvas_item_add_set_transform(it, xf);
    for (const LinhaTexto &l : textos[size_t(k)].linhas) {
      const Vector2 pos(l.x, l.base - float(l.linha->get_line_ascent()));
      if (t.sombra) {
        const Color cs = cor_texto(t.cor_sombra) * slot_cor;
        const Vector2 d(float(t.sombra_x), float(t.sombra_y));
        if (t.linha > 0) l.linha->draw_outline(it, pos + d, int(Math::round(t.linha * 2)), cs);
        l.linha->draw(it, pos + d, cs);
      }
      if (t.linha > 0) l.linha->draw_outline(it, pos, int(Math::round(t.linha * 2)), cor_texto(t.cor_linha) * slot_cor);
      l.linha->draw(it, pos, cor_texto(t.cor) * slot_cor);
    }
  }
  rs->canvas_item_add_set_transform(it, Transform2D());
  if (x0 <= x1) {
    // folga para o que passa da caixa (estouro, contorno, sombra)
    const float f = MAX(x1 - x0, y1 - y0);
    rs->canvas_item_set_custom_rect(it, true, Rect2(x0 - f, y0 - f, x1 - x0 + 2 * f, y1 - y0 + 2 * f));
  }
}

// ---- papeis (docs/NUCLEO.md "Papeis")

static const char *const ESTADOS_BOTAO[4] = {"normal", "em_cima", "apertado", "desligado"};

int BonecoSprite::_papel(const String &p_nome) const { return esq ? esq->modelo().papel(padrao(p_nome)) : -1; }

void BonecoSprite::set_roles_input(bool p) {
  roles_input = p;
  set_process_input(ui && roles_input);
}

Array BonecoSprite::get_roles() const {
  Array out;
  if (!esq) return out;
  static const char *const TIPO[] = {"botao", "toque", "texto"};
  const mamulengo::Modelo &m = esq->modelo();
  for (size_t k = 0; k < m.papeis.size(); ++k) {
    const mamulengo::DadosPapel &d = m.papeis[k];
    Dictionary r;
    r["name"] = String::utf8(d.nome.c_str());
    r["type"] = String(TIPO[int(d.tipo)]);
    r["bone"] = d.osso >= 0 ? String::utf8(m.ossos[size_t(d.osso)].nome.c_str()) : String();
    r["slot"] = d.slot >= 0 ? String::utf8(m.slots[size_t(d.slot)].nome.c_str()) : String();
    Dictionary st;
    for (int e = 0; e < 4; ++e)
      if (d.estados[e] >= 0) st[String(ESTADOS_BOTAO[e])] = String::utf8(m.animacoes[size_t(d.estados[e])].nome.c_str());
    r["states"] = st;
    r["track"] = d.trilha;
    r["mix"] = d.mix;
    r["disabled"] = ui ? ui->desligado(int(k)) : d.desligado;
    out.push_back(r);
  }
  return out;
}

String BonecoSprite::role_pointer(int p_tipo, const Vector2 &p_pos) {
  if (!ui || !esq || !estado) return String();
  const double x = p_pos.x, y = -p_pos.y;
  switch (p_tipo) {
    case 0: ui->mover(*esq, *estado, x, y); break;
    case 1: ui->apertar(*esq, *estado, x, y); break;
    case 2: ui->soltar(*esq, *estado, x, y, false); break;
    case 3: ui->soltar(*esq, *estado, x, y, true); break;
    default: ui->sair(*estado);
  }
  const int sob = ui->sobre();
  std::vector<int> tocados;
  tocados.swap(ui->toques);
  const mamulengo::Modelo &m = esq->modelo();
  const String nome = sob >= 0 ? String::utf8(m.papeis[size_t(sob)].nome.c_str()) : String();
  _avisar();
  for (int k : tocados) emit_signal("role_touched", String::utf8(m.papeis[size_t(k)].nome.c_str()));
  return nome;
}

String BonecoSprite::get_role_at(const Vector2 &p_pos) const {
  if (!esq) return String();
  const int k = mamulengo::papel_no_ponto(*esq, p_pos.x, -p_pos.y);
  return k >= 0 ? String::utf8(esq->modelo().papeis[size_t(k)].nome.c_str()) : String();
}

void BonecoSprite::set_role_disabled(const String &p_nome, bool p_desligado) {
  const int k = _papel(p_nome);
  if (k < 0 || !ui) return;
  ui->desligar(*estado, k, p_desligado);
  _avisar();
}

bool BonecoSprite::is_role_disabled(const String &p_nome) const {
  const int k = _papel(p_nome);
  if (k < 0) return false;
  return ui ? ui->desligado(k) : esq->modelo().papeis[size_t(k)].desligado;
}

String BonecoSprite::get_role_state(const String &p_nome) const {
  const int k = _papel(p_nome);
  if (k < 0 || !ui || ui->estado(k) < 0) return String();
  return String(ESTADOS_BOTAO[ui->estado(k)]);
}

void BonecoSprite::show_role_state(const String &p_nome, const String &p_estado) {
  const int k = _papel(p_nome);
  if (k < 0 || !ui) return;
  for (int e = 0; e < 4; ++e)
    if (p_estado == ESTADOS_BOTAO[e]) ui->mostrar(*estado, k, e);
  _avisar();
}

PackedVector2Array BonecoSprite::get_role_area(const String &p_nome) const {
  PackedVector2Array out;
  const int k = _papel(p_nome);
  if (k < 0) return out;
  std::vector<double> tri;
  mamulengo::area_papel(*esq, k, tri);
  for (size_t i = 0; i + 1 < tri.size(); i += 2) out.push_back(Vector2(float(tri[i]), -float(tri[i + 1])));
  return out;
}

void BonecoSprite::_entrada_papeis(const Ref<InputEvent> &p_evento) {
  if (!ui || !roles_input || !is_visible_in_tree()) return;
  const Ref<InputEvent> local = make_input_local(p_evento);
  Ref<InputEventMouseMotion> mm = local;
  Ref<InputEventMouseButton> mb = local;
  Ref<InputEventScreenTouch> st = local;
  Ref<InputEventScreenDrag> sd = local;
  if (mm.is_valid()) role_pointer(0, mm->get_position());
  else if (mb.is_valid() && mb->get_button_index() == MOUSE_BUTTON_LEFT) role_pointer(mb->is_pressed() ? 1 : 2, mb->get_position());
  else if (st.is_valid() && st->get_index() == 0) role_pointer(st->is_pressed() ? 1 : (st->is_canceled() ? 4 : 3), st->get_position());
  else if (sd.is_valid() && sd->get_index() == 0) role_pointer(0, sd->get_position());
}

#ifdef GDEXTENSION
void BonecoSprite::_input(const Ref<InputEvent> &p_evento) { _entrada_papeis(p_evento); }
#else
void BonecoSprite::input(const Ref<InputEvent> &p_evento) { _entrada_papeis(p_evento); }
#endif

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
  ClassDB::bind_method(D_METHOD("set_spine_godot_mix", "enabled"), &BonecoSprite::set_spine_godot_mix);
  ClassDB::bind_method(D_METHOD("get_spine_godot_mix"), &BonecoSprite::get_spine_godot_mix);
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
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "spine_godot_mix"), "set_spine_godot_mix", "get_spine_godot_mix");
  ADD_PROPERTY(PropertyInfo(Variant::FLOAT, "time_scale"), "set_time_scale", "get_time_scale");
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "playing"), "set_playing", "get_playing");
  ClassDB::bind_method(D_METHOD("set_window", "tamanho"), &BonecoSprite::set_window);
  ClassDB::bind_method(D_METHOD("get_window"), &BonecoSprite::get_window);
  ClassDB::bind_method(D_METHOD("set_fit_window", "encaixar"), &BonecoSprite::set_fit_window);
  ClassDB::bind_method(D_METHOD("get_fit_window"), &BonecoSprite::get_fit_window);
  ClassDB::bind_method(D_METHOD("get_view"), &BonecoSprite::get_view);
  ClassDB::bind_method(D_METHOD("get_view_scale"), &BonecoSprite::get_view_scale);
  ADD_PROPERTY(PropertyInfo(Variant::VECTOR2, "window"), "set_window", "get_window");
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "fit_window"), "set_fit_window", "get_fit_window");
  ClassDB::bind_method(D_METHOD("set_language", "idioma"), &BonecoSprite::set_language);
  ClassDB::bind_method(D_METHOD("get_language"), &BonecoSprite::get_language);
  ClassDB::bind_method(D_METHOD("get_languages"), &BonecoSprite::get_languages);
  ClassDB::bind_method(D_METHOD("set_text", "nome", "valor"), &BonecoSprite::set_text);
  ClassDB::bind_method(D_METHOD("set_text_params", "nome", "params"), &BonecoSprite::set_text_params);
  ClassDB::bind_method(D_METHOD("clear_text", "nome"), &BonecoSprite::clear_text);
  ClassDB::bind_method(D_METHOD("get_text_shown", "nome"), &BonecoSprite::get_text_shown);
  ClassDB::bind_method(D_METHOD("get_text_overflows"), &BonecoSprite::get_text_overflows);
  ClassDB::bind_method(D_METHOD("get_slice_info", "slot"), &BonecoSprite::get_slice_info);
  ClassDB::bind_method(D_METHOD("set_roles_input", "ligado"), &BonecoSprite::set_roles_input);
  ClassDB::bind_method(D_METHOD("get_roles_input"), &BonecoSprite::get_roles_input);
  ClassDB::bind_method(D_METHOD("get_roles"), &BonecoSprite::get_roles);
  ClassDB::bind_method(D_METHOD("role_pointer", "tipo", "posicao"), &BonecoSprite::role_pointer);
  ClassDB::bind_method(D_METHOD("get_role_at", "posicao"), &BonecoSprite::get_role_at);
  ClassDB::bind_method(D_METHOD("set_role_disabled", "nome", "desligado"), &BonecoSprite::set_role_disabled);
  ClassDB::bind_method(D_METHOD("is_role_disabled", "nome"), &BonecoSprite::is_role_disabled);
  ClassDB::bind_method(D_METHOD("get_role_state", "nome"), &BonecoSprite::get_role_state);
  ClassDB::bind_method(D_METHOD("show_role_state", "nome", "estado"), &BonecoSprite::show_role_state);
  ClassDB::bind_method(D_METHOD("get_role_area", "nome"), &BonecoSprite::get_role_area);
  ADD_PROPERTY(PropertyInfo(Variant::BOOL, "roles_input"), "set_roles_input", "get_roles_input");
  ADD_SIGNAL(MethodInfo("role_touched", PropertyInfo(Variant::STRING, "nome")));
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "language"), "set_language", "get_language");
  ClassDB::bind_method(D_METHOD("stage_start"), &BonecoSprite::stage_start);
  ClassDB::bind_method(D_METHOD("stage_stop"), &BonecoSprite::stage_stop);
  ClassDB::bind_method(D_METHOD("set_stage_input", "bits"), &BonecoSprite::set_stage_input);
  ClassDB::bind_method(D_METHOD("get_stage_input"), &BonecoSprite::get_stage_input);
  ClassDB::bind_method(D_METHOD("stage_step", "bits", "passos"), &BonecoSprite::stage_step);
  ClassDB::bind_method(D_METHOD("get_stage_state"), &BonecoSprite::get_stage_state);
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
