// Ponte do nucleo para o navegador (wasm): modelos, instancias e o desenho num buffer que o
// JavaScript le direto da memoria do wasm. Ids sao indices; nada e liberado a nao ser as
// instancias (mm_limpar_instancias), que e o que a pagina troca o tempo todo.
#include <emscripten/emscripten.h>

#include <memory>
#include <string>
#include <vector>

#include "mamulengo/desenho.h"
#include "mamulengo/modelo.h"
#include "mamulengo/pose.h"

using namespace mamulengo;

namespace {

struct Instancia {
  Esqueleto e;
  int anim = -1;
  bool loop = true;
  double tempo = 0;
  explicit Instancia(std::shared_ptr<const Modelo> m) : e(std::move(m)) {}
};

std::vector<std::shared_ptr<const Modelo>> modelos;
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

EMSCRIPTEN_KEEPALIVE double mm_tempo(int inst) { return instancias[size_t(inst)]->tempo; }

// desenho: mm_limpar_desenho, um mm_desenhar por instancia e os ponteiros abaixo
EMSCRIPTEN_KEEPALIVE void mm_limpar_desenho() { desenho.limpar(); }
EMSCRIPTEN_KEEPALIVE void mm_desenhar(int inst) { desenhar(instancias[size_t(inst)]->e, desenho); }
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
