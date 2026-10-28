// Desenho de uma instancia: a lista do que vai para a placa de video, na ordem de desenho.
// Vertices em mundo (y para cima) com uv da pagina e cor; triangulos em lotes, um lote por
// trecho seguido com a mesma pagina e o mesmo blend. O recorte vira um par de comandos: o
// poligono (que o desenhista marca no stencil, como leque de triangulos) e o fim.
#pragma once

#include <cstdint>
#include <vector>

#include "mamulengo/pose.h"

namespace mamulengo {

enum class Comando : uint8_t { Triangulos, ComecaRecorte, AcabaRecorte };

struct Lote {
  Comando comando = Comando::Triangulos;
  int pagina = -1;
  Blend blend = Blend::Normal;
  uint32_t inicio = 0, quantos = 0;  // em `indices` (ComecaRecorte: o leque do poligono)
};

struct Desenho {
  // true: o recorte e feito aqui, na CPU (os triangulos saem ja cortados e nao ha comandos
  // de recorte); false: o desenhista faz no stencil com ComecaRecorte e AcabaRecorte
  bool recorte_cpu = false;
  // por vertice: x, y, u, v, r, g, b, a (cor sem multiplicar pelo alfa)
  std::vector<float> vertices;
  std::vector<uint32_t> indices;
  std::vector<Lote> lotes;
  void limpar() {
    vertices.clear();
    indices.clear();
    lotes.clear();
  }
};

// monta o desenho da pose atual (depois de atualizar_mundo); acrescenta a `d`, entao varias
// instancias podem ir num desenho so
void desenhar(const Esqueleto& e, Desenho& d);

}  // namespace mamulengo
