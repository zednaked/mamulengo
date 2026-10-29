// Ponte do nucleo para o navegador (wasm): modelos, instancias e o desenho num buffer que o
// JavaScript le direto da memoria do wasm. Ids sao indices; o modelo so e liberado por
// mm_liberar_modelo (o editor troca de modelo a cada edicao estrutural) e as instancias por
// mm_limpar_instancias (o palco troca o tempo todo).
//
// O editor (src/render/nucleo.ts) usa as instancias com Estado (trilhas, fila e mix):
// mm_reiniciar, mm_estado_tocar, mm_estado_enfileirar e mm_passo. A demo (src/demo/) usa o
// mesmo caminho e mm_posicao para arrastar o personagem. As edicoes rapidas mudam o
// setup do modelo direto (mm_osso_setup, mm_slot_setup, mm_trocar_animacao), sem reler o
// .boneco inteiro.
//
// O editor tambem le a pose daqui (clique, arrasto, gizmos, caixas), sem o spine-core:
// mm_pose_ossos, mm_setup_ossos, mm_pose_slots, mm_vertices_slot e mm_caixa escrevem em
// areas que o JavaScript le direto (HEAPF64). mm_guardar e mm_restaurar sao o checkpoint do
// poseAt (a pose num instante continua do ultimo passo inteiro, como o PoseSim) e
// mm_simular da a pose em varios instantes de uma vez.
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <string>
#include <vector>

#include "mamulengo/desenho.h"
#include "mamulengo/estado.h"
#include "mamulengo/modelo.h"
#include "mamulengo/pose.h"

using namespace mamulengo;

namespace {

struct Instancia {
  std::shared_ptr<const Modelo> modelo;
  Esqueleto e;
  std::unique_ptr<Estado> estado;  // so no uso com trilhas (mm_reiniciar)
  int anim = -1;
  bool loop = true;
  double tempo = 0;
  // deslocamento do personagem no mundo (mm_posicao), somado a posicao e a rotacao locais do
  // osso raiz depois de aplicar a animacao; `posto` e o que ja esta somado
  double px = 0, py = 0, pr = 0, posto_x = 0, posto_y = 0, posto_r = 0;
  void tirar_posicao() {
    Local& raiz = e.local[0];
    raiz.x -= posto_x;
    raiz.y -= posto_y;
    raiz.rotacao -= posto_r;
    posto_x = posto_y = posto_r = 0;
  }
  void por_posicao() {
    Local& raiz = e.local[0];
    raiz.x += px;
    raiz.y += py;
    raiz.rotacao += pr;
    posto_x = px;
    posto_y = py;
    posto_r = pr;
  }
  // checkpoint (mm_guardar): o esqueleto, o Estado e o relogio de um quadro
  struct Guardado {
    Esqueleto e;
    std::unique_ptr<Estado> estado;
    double tempo = 0, posto_x = 0, posto_y = 0, posto_r = 0;
    explicit Guardado(const Esqueleto& x) : e(x) {}
  };
  std::unique_ptr<Guardado> guardado;
  explicit Instancia(std::shared_ptr<const Modelo> m) : modelo(m), e(std::move(m)) {}
};

// os modelos sao criados por ler_boneco (nao sao const de verdade): a ponte muda o setup
// deles nas edicoes rapidas do editor
std::vector<std::shared_ptr<const Modelo>> modelos;
Modelo& mutavel(int modelo) { return const_cast<Modelo&>(*modelos[size_t(modelo)]); }
std::vector<Evento> lidos;
std::vector<std::unique_ptr<Instancia>> instancias;
Desenho desenho;
std::vector<int32_t> lotes;
// leituras da pose (o JavaScript le os numeros direto da memoria)
std::vector<double> saida, saida_ossos, saida_setup, saida_slots;
std::string erro, info;

void texto_json(std::string& s, const std::string& t) {
  s += '"';
  for (char c : t) {
    if (c == '"' || c == '\\') s += '\\';
    s += c;
  }
  s += '"';
}

}  // namespace

extern "C" {

// le um .boneco (texto UTF-8); devolve o id do modelo ou -1 (mm_erro diz o motivo)
EMSCRIPTEN_KEEPALIVE int mm_carregar(const char* texto) {
  auto m = ler_boneco(texto, &erro);
  if (!m) return -1;
  modelos.push_back(std::move(m));
  return int(modelos.size()) - 1;
}

EMSCRIPTEN_KEEPALIVE const char* mm_erro() { return erro.c_str(); }

// solta o modelo (as instancias que ainda o usam continuam valendo); o id nao e reaproveitado
EMSCRIPTEN_KEEPALIVE void mm_liberar_modelo(int modelo) { modelos[size_t(modelo)].reset(); }

// indices por nome (-1 se nao ha)
EMSCRIPTEN_KEEPALIVE int mm_osso(int modelo, const char* nome) { return modelos[size_t(modelo)]->osso(nome); }
EMSCRIPTEN_KEEPALIVE int mm_slot(int modelo, const char* nome) { return modelos[size_t(modelo)]->slot(nome); }
EMSCRIPTEN_KEEPALIVE int mm_animacao(int modelo, const char* nome) { return modelos[size_t(modelo)]->animacao(nome); }

// setup de um osso (os valores do .boneco); vale para as instancias do modelo a partir do
// proximo setup (mm_reiniciar, mm_tocar)
EMSCRIPTEN_KEEPALIVE void mm_osso_setup(int modelo, int osso, double x, double y, double rotacao, double escala_x, double escala_y, double cisalha_x, double cisalha_y, double comprimento) {
  DadosOsso& d = mutavel(modelo).ossos[size_t(osso)];
  d.x = x;
  d.y = y;
  d.rotacao = rotacao;
  d.escala_x = escala_x;
  d.escala_y = escala_y;
  d.cisalha_x = cisalha_x;
  d.cisalha_y = cisalha_y;
  d.comprimento = comprimento;
}

// setup de um slot: cor e parte (nome vazio: sem parte). Devolve 0 sem mudar nada se o nome
// da parte nao existe no modelo (o editor rele o .boneco)
EMSCRIPTEN_KEEPALIVE int mm_slot_setup(int modelo, int slot, float r, float g, float b, float a, const char* parte) {
  Modelo& m = mutavel(modelo);
  int id = -1;
  if (parte && *parte) {
    id = m.id_parte(parte);
    if (id < 0) return 0;
  }
  DadosSlot& d = m.slots[size_t(slot)];
  d.cor = Cor{r, g, b, a};
  d.parte_setup = id;
  return 1;
}

// troca (ou acrescenta) uma animacao do modelo, lida do JSON dela no formato do .boneco.
// As instancias com Estado precisam de mm_reiniciar depois (o Estado prepara as timelines).
EMSCRIPTEN_KEEPALIVE int mm_trocar_animacao(int modelo, const char* nome, const char* json) {
  return ler_animacao(mutavel(modelo), nome, json, &erro) ? 1 : 0;
}

// JSON: { nome, paginas: [{arquivo, largura, altura, pma}], animacoes: [{nome, duracao}] }
EMSCRIPTEN_KEEPALIVE const char* mm_info(int modelo) {
  const Modelo& m = *modelos[size_t(modelo)];
  info = "{\"nome\":";
  texto_json(info, m.nome);
  info += ",\"paginas\":[";
  for (size_t i = 0; i < m.paginas.size(); ++i) {
    const Pagina& p = m.paginas[i];
    info += i ? ",{\"arquivo\":" : "{\"arquivo\":";
    texto_json(info, p.arquivo);
    info += ",\"largura\":" + std::to_string(p.largura) + ",\"altura\":" + std::to_string(p.altura) + ",\"pma\":" + (p.pma ? "true" : "false") + "}";
  }
  bool fisica = false;
  for (const DadosRestricao& r : m.restricoes) fisica = fisica || r.tipo == TipoRestricao::Fisica;
  info += std::string("],\"fisica\":") + (fisica ? "true" : "false") + ",\"ossos\":[";
  for (size_t i = 0; i < m.ossos.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.ossos[i].nome);
    info += ",\"pai\":" + std::to_string(m.ossos[i].pai) + "}";
  }
  info += "],\"slots\":[";
  for (size_t i = 0; i < m.slots.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.slots[i].nome);
    info += ",\"osso\":" + std::to_string(m.slots[i].osso) + ",\"blend\":" + std::to_string(int(m.slots[i].blend)) + "}";
  }
  // partes: tipo na ordem de TipoParte (regiao, malha, malha ligada, recorte, caminho, ponto,
  // caixa), quantos vertices, o contorno, se tem pesos e (caminho) se e fechado
  info += "],\"partes\":[";
  for (size_t i = 0; i < m.partes.size(); ++i) {
    const Parte& p = m.partes[i];
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, p.nome);
    info += ",\"tipo\":" + std::to_string(int(p.tipo)) + ",\"slot\":" + std::to_string(p.slot) + ",\"vertices\":" + std::to_string(p.tipo == TipoParte::Regiao ? 4 : p.num_vertices) +
            ",\"contorno\":" + std::to_string(p.contorno) + ",\"pesada\":" + (p.pesada() ? "true" : "false") + ",\"fechado\":" + (p.fechado ? "true" : "false") + "}";
  }
  info += "],\"animacoes\":[";
  for (size_t i = 0; i < m.animacoes.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.animacoes[i].nome);
    info += ",\"duracao\":" + std::to_string(m.animacoes[i].duracao) + "}";
  }
  info += "]}";
  return info.c_str();
}

EMSCRIPTEN_KEEPALIVE int mm_instancia(int modelo) {
  instancias.push_back(std::make_unique<Instancia>(modelos[size_t(modelo)]));
  return int(instancias.size()) - 1;
}

EMSCRIPTEN_KEEPALIVE void mm_limpar_instancias() { instancias.clear(); }

// comeca a animacao do zero (-1: pose de setup), como um personagem novo: setup, fisica
// reiniciada e o primeiro quadro no instante 0
EMSCRIPTEN_KEEPALIVE void mm_tocar(int inst, int anim, int loop) {
  Instancia& i = *instancias[size_t(inst)];
  i.anim = anim;
  i.loop = loop != 0;
  i.tempo = 0;
  i.e.setup();
  i.e.atualizar_mundo();
  if (anim >= 0) i.e.aplicar(anim, 0, i.loop);
  i.e.atualizar_mundo();
}

EMSCRIPTEN_KEEPALIVE void mm_avancar(int inst, double dt) {
  Instancia& i = *instancias[size_t(inst)];
  i.tempo += dt;
  if (i.anim >= 0) i.e.aplicar(i.anim, i.tempo, i.loop);
  i.e.avancar(dt);
  i.e.atualizar_mundo();
}

// ---- com trilhas (o editor): a mesma conta do PoseSim (src/core/sim.ts) sobre o Estado

// personagem novo: setup, fisica reiniciada (o mundo do setup) e nenhuma trilha
EMSCRIPTEN_KEEPALIVE void mm_reiniciar(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  i.anim = -1;
  i.tempo = 0;
  i.e.setup();
  i.posto_x = i.posto_y = i.posto_r = 0;
  i.por_posicao();
  i.e.atualizar_mundo();
  i.estado = std::make_unique<Estado>(i.modelo);
}

// set_animation com o mix dado (o PoseSim sempre diz o mix)
EMSCRIPTEN_KEEPALIVE void mm_estado_tocar(int inst, int trilha, int anim, int loop, double mix) {
  Entrada* e = instancias[size_t(inst)]->estado->tocar(trilha, anim, loop != 0);
  e->mix_duracao = mix;
}

// add_animation com o atraso ja calculado e o mix dado
EMSCRIPTEN_KEEPALIVE void mm_estado_enfileirar(int inst, int trilha, int anim, int loop, double atraso, double mix) {
  Entrada* e = instancias[size_t(inst)]->estado->enfileirar(trilha, anim, loop != 0, atraso);
  e->mix_duracao = mix;
  e->atraso = atraso;
}

// posicao do personagem no mundo: soma (x, y) e a rotacao (graus) ao osso raiz a partir do
// proximo mm_passo, como o jogo move o no. A fisica ve o movimento (a antena e o cabelo reagem).
EMSCRIPTEN_KEEPALIVE void mm_posicao(int inst, double x, double y, double rotacao) {
  Instancia& i = *instancias[size_t(inst)];
  i.px = x;
  i.py = y;
  i.pr = rotacao;
}

// um quadro de dt segundos, na ordem do jogo; os eventos sao descartados
EMSCRIPTEN_KEEPALIVE void mm_passo(int inst, double dt) {
  Instancia& i = *instancias[size_t(inst)];
  i.tempo += dt;
  i.estado->avancar(dt);
  // o raiz sem o deslocamento antes de aplicar (a animacao pode nao mexer nele) e com o novo depois
  i.tirar_posicao();
  i.estado->aplicar(i.e);
  i.por_posicao();
  i.e.avancar(dt);
  i.e.atualizar_mundo();
  i.estado->ler_eventos(lidos);
  lidos.clear();
}

EMSCRIPTEN_KEEPALIVE double mm_tempo(int inst) { return instancias[size_t(inst)]->tempo; }

// desenho: mm_limpar_desenho, um mm_desenhar por instancia e os ponteiros abaixo
EMSCRIPTEN_KEEPALIVE void mm_limpar_desenho() { desenho.limpar(); }
EMSCRIPTEN_KEEPALIVE void mm_desenhar(int inst) { desenhar(instancias[size_t(inst)]->e, desenho); }
// desenha sem os slots marcados (um byte por slot, nao zero esconde): o olho do editor
EMSCRIPTEN_KEEPALIVE void mm_desenhar_escondendo(int inst, const uint8_t* esconder) {
  Esqueleto& e = instancias[size_t(inst)]->e;
  std::vector<std::pair<int, int>> guardadas;
  for (int s = 0; s < int(e.slots().size()); ++s)
    if (esconder[s]) {
      guardadas.emplace_back(s, e.slot(s).parte);
      e.slot(s).parte = -1;
    }
  desenhar(e, desenho);
  for (auto [s, p] : guardadas) e.slot(s).parte = p;
}
EMSCRIPTEN_KEEPALIVE const float* mm_vertices() { return desenho.vertices.data(); }
EMSCRIPTEN_KEEPALIVE int mm_num_vertices() { return int(desenho.vertices.size() / 8); }
EMSCRIPTEN_KEEPALIVE const uint32_t* mm_indices() { return desenho.indices.data(); }
EMSCRIPTEN_KEEPALIVE int mm_num_indices() { return int(desenho.indices.size()); }
// lotes em 5 inteiros: comando, pagina, blend, inicio, quantos
EMSCRIPTEN_KEEPALIVE const int32_t* mm_lotes() {
  lotes.clear();
  for (const Lote& l : desenho.lotes) lotes.insert(lotes.end(), {int32_t(l.comando), l.pagina, int32_t(l.blend), int32_t(l.inicio), int32_t(l.quantos)});
  return lotes.data();
}
EMSCRIPTEN_KEEPALIVE int mm_num_lotes() { return int(desenho.lotes.size()); }

// ---- leitura da pose (o editor sem o spine-core)

// numeros escritos pela ultima leitura que devolve uma contagem (mm_vertices_slot, mm_caixa,
// mm_parte_triangulos, mm_parte_pesos, mm_simular)
EMSCRIPTEN_KEEPALIVE const double* mm_saida() { return saida.data(); }

// por osso, 14 numeros: o mundo [a, b, c, d, x, y] (y para cima), o comprimento no mundo
// (comprimento do osso vezes o tamanho do eixo x do mundo) e a pose local atual
// [x, y, rotacao, escala_x, escala_y, cisalha_x, cisalha_y]
EMSCRIPTEN_KEEPALIVE const double* mm_pose_ossos(int inst) {
  const Instancia& i = *instancias[size_t(inst)];
  const Modelo& m = *i.modelo;
  const auto& w = i.e.mundo();
  saida_ossos.resize(m.ossos.size() * 14);
  double* o = saida_ossos.data();
  for (size_t k = 0; k < m.ossos.size(); ++k, o += 14) {
    const Matriz& x = w[k];
    const Local& l = i.e.local[k];
    o[0] = x.a, o[1] = x.b, o[2] = x.c, o[3] = x.d, o[4] = x.x, o[5] = x.y;
    o[6] = m.ossos[k].comprimento * std::hypot(x.a, x.c);
    o[7] = l.x, o[8] = l.y, o[9] = l.rotacao, o[10] = l.escala_x, o[11] = l.escala_y, o[12] = l.cisalha_x, o[13] = l.cisalha_y;
  }
  return saida_ossos.data();
}

// por osso, 8 numeros do setup (o do modelo agora, com os remendos): x, y, rotacao,
// escala_x, escala_y, cisalha_x, cisalha_y e comprimento
EMSCRIPTEN_KEEPALIVE const double* mm_setup_ossos(int modelo) {
  const Modelo& m = *modelos[size_t(modelo)];
  saida_setup.resize(m.ossos.size() * 8);
  double* o = saida_setup.data();
  for (const DadosOsso& d : m.ossos) {
    o[0] = d.x, o[1] = d.y, o[2] = d.rotacao, o[3] = d.escala_x, o[4] = d.escala_y, o[5] = d.cisalha_x, o[6] = d.cisalha_y, o[7] = d.comprimento;
    o += 8;
  }
  return saida_setup.data();
}

// por slot, 5 numeros: a parte atual (indice em `partes` do mm_info, -1 sem parte) e a cor
// [r, g, b, a]; depois, a ordem de desenho (um indice de slot por posicao, de tras para frente)
EMSCRIPTEN_KEEPALIVE const double* mm_pose_slots(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  const auto& ss = i.e.slots();
  const auto& ordem = i.e.ordem();
  saida_slots.resize(ss.size() * 5 + ordem.size());
  double* o = saida_slots.data();
  for (const EstadoSlot& s : ss) {
    o[0] = s.parte, o[1] = s.cor.r, o[2] = s.cor.g, o[3] = s.cor.b, o[4] = s.cor.a;
    o += 5;
  }
  for (int k : ordem) *o++ = k;
  return saida_slots.data();
}

// vertices em mundo da parte atual do slot (2 numeros por vertice, em mm_saida): regiao (4
// cantos), malha, e tambem caminho, recorte e caixa (o desenho de depuracao). Devolve quantos
// numeros (0: sem parte, ou ponto)
EMSCRIPTEN_KEEPALIVE int mm_vertices_slot(int inst, int slot) {
  const Instancia& i = *instancias[size_t(inst)];
  const EstadoSlot& s = i.e.slots()[size_t(slot)];
  saida.clear();
  if (s.parte < 0) return 0;
  const Parte& p = i.modelo->partes[size_t(s.parte)];
  switch (p.tipo) {
    case TipoParte::Regiao:
    case TipoParte::Malha:
    case TipoParte::MalhaLigada: return int(i.e.vertices(slot, saida));
    case TipoParte::Recorte:
    case TipoParte::Caminho:
    case TipoParte::Caixa:
      saida.resize(size_t(p.num_vertices) * 2);
      i.e.vertices_geometria(slot, p, saida.data());
      return int(saida.size());
    case TipoParte::Ponto: return 0;
  }
  return 0;
}

// caixa do personagem [x0, y0, x1, y1] em mm_saida: regioes e malhas de todos os slots com
// parte (como o getBounds do spine-core, sem olhar o alfa). Devolve 0 se nao ha nada
EMSCRIPTEN_KEEPALIVE int mm_caixa(int inst) {
  const Instancia& i = *instancias[size_t(inst)];
  double x0 = 1e300, y0 = 1e300, x1 = -1e300, y1 = -1e300;
  std::vector<double> v;
  for (int s : i.e.ordem()) {
    const size_t n = i.e.vertices(s, v);
    for (size_t k = 0; k + 1 < n; k += 2) {
      x0 = std::min(x0, v[k]);
      x1 = std::max(x1, v[k]);
      y0 = std::min(y0, v[k + 1]);
      y1 = std::max(y1, v[k + 1]);
    }
  }
  saida.assign({x0, y0, x1, y1});
  return x0 <= x1 ? 1 : 0;
}

// triangulos de uma parte (regiao: os 2 do retangulo; malha: os do arquivo) em mm_saida
EMSCRIPTEN_KEEPALIVE int mm_parte_triangulos(int modelo, int parte) {
  const Parte& p = modelos[size_t(modelo)]->partes[size_t(parte)];
  saida.clear();
  if (p.tipo == TipoParte::Regiao) saida = {0, 1, 2, 2, 3, 0};
  else
    for (uint16_t t : p.triangulos) saida.push_back(t);
  return int(saida.size());
}

// pesos de uma malha em mm_saida: por vertice, quantos ossos e os pares (osso, peso). 0 sem pesos
EMSCRIPTEN_KEEPALIVE int mm_parte_pesos(int modelo, int parte) {
  const Parte& p = modelos[size_t(modelo)]->partes[size_t(parte)];
  saida.clear();
  if (!p.pesada()) return 0;
  for (int v = 0; v < p.num_vertices; ++v) {
    const int a = p.pesos_inicio[size_t(v)], b = p.pesos_inicio[size_t(v) + 1];
    saida.push_back(b - a);
    for (int e = a; e < b; ++e) {
      saida.push_back(p.pesos_osso[size_t(e)]);
      saida.push_back(p.pesos_xyp[size_t(e) * 3 + 2]);
    }
  }
  return int(saida.size());
}

// pose direta (a cebola): a animacao no tempo t sobre o setup, sem relogio nem fisica: o
// mundo e calculado uma vez so, com a fisica reiniciada ali mesmo (sem o quadro do setup antes,
// a inercia nao ve a diferenca entre o setup e a pose; como o Physics.pose do spine-core)
EMSCRIPTEN_KEEPALIVE void mm_pose_direta(int inst, int anim, double t, int loop) {
  Instancia& i = *instancias[size_t(inst)];
  i.e.setup();
  if (anim >= 0) i.e.aplicar(anim, t, loop != 0);
  i.e.atualizar_mundo();
}

// ---- checkpoint: guarda o quadro atual da instancia (esqueleto com a fisica, Estado, relogio)
// e volta a ele. O modelo nao pode mudar no meio (quem remenda esquece o checkpoint).

EMSCRIPTEN_KEEPALIVE void mm_guardar(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  if (!i.guardado) i.guardado = std::make_unique<Instancia::Guardado>(i.e);
  else i.guardado->e = i.e;
  Instancia::Guardado& g = *i.guardado;
  if (i.estado) {
    if (!g.estado) g.estado = std::make_unique<Estado>(i.modelo);
    g.estado->copiar_de(*i.estado);
  } else g.estado.reset();
  g.tempo = i.tempo;
  g.posto_x = i.posto_x, g.posto_y = i.posto_y, g.posto_r = i.posto_r;
}

// devolve 0 se nao ha checkpoint
EMSCRIPTEN_KEEPALIVE int mm_restaurar(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  if (!i.guardado) return 0;
  const Instancia::Guardado& g = *i.guardado;
  i.e = g.e;
  if (g.estado) {
    if (!i.estado) i.estado = std::make_unique<Estado>(i.modelo);
    i.estado->copiar_de(*g.estado);
  } else i.estado.reset();
  i.tempo = g.tempo;
  i.posto_x = g.posto_x, i.posto_y = g.posto_y, i.posto_r = g.posto_r;
  return 1;
}

EMSCRIPTEN_KEEPALIVE void mm_esquecer(int inst) { instancias[size_t(inst)]->guardado.reset(); }

// ---- varios instantes de uma vez (as medidas): a pose de uma animacao (-1: setup) em cada
// instante com a conta do poseAt do editor (personagem novo, tocar com mix 0, um quadro em 0 e
// passos de 1/64; sem fisica, um passo so ate o instante). Instantes em ordem crescente. Escreve
// em mm_saida, por instante, o mundo de cada osso [a, b, c, d, x, y] e devolve quantos numeros.
// A instancia fica na pose do ultimo instante e o checkpoint dela e trocado.
EMSCRIPTEN_KEEPALIVE int mm_simular(int inst, int anim, int loop, const double* instantes, int n) {
  Instancia& i = *instancias[size_t(inst)];
  const Modelo& m = *i.modelo;
  bool fisica = false;
  for (const DadosRestricao& r : m.restricoes) fisica = fisica || r.tipo == TipoRestricao::Fisica;
  const double PASSO = 1.0 / 64;
  std::vector<double> out;
  out.reserve(size_t(n) * m.ossos.size() * 6);
  auto comecar = [&]() {
    mm_reiniciar(inst);
    if (anim >= 0) {
      mm_estado_tocar(inst, 0, anim, loop, 0);
      mm_passo(inst, 0);
    }
  };
  auto escrever = [&]() {
    for (const Matriz& x : i.e.mundo()) out.insert(out.end(), {x.a, x.b, x.c, x.d, x.x, x.y});
  };
  double feito = 0;
  bool guardou = false;
  for (int k = 0; k < n; ++k) {
    const double t = instantes[k];
    if (!fisica || anim < 0) {
      comecar();
      if (anim >= 0 && t > 0) mm_passo(inst, t);
      escrever();
      continue;
    }
    if (guardou && t > feito) mm_restaurar(inst);
    else {
      comecar();
      feito = 0;
    }
    while (feito + PASSO <= t + 1e-9) {
      mm_passo(inst, PASSO);
      feito += PASSO;
    }
    mm_guardar(inst);
    guardou = true;
    if (t - feito > 0) mm_passo(inst, t - feito);
    escrever();
  }
  saida.swap(out);
  return int(saida.size());
}

}  // extern "C"
