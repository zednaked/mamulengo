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
#include <emscripten/emscripten.h>

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
  info += std::string("],\"fisica\":") + (fisica ? "true" : "false") + ",\"slots\":[";
  for (size_t i = 0; i < m.slots.size(); ++i) {
    if (i) info += ',';
    texto_json(info, m.slots[i].nome);
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

}  // extern "C"
