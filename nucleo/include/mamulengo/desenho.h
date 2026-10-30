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
  int efeito = -1;  // indice em Desenho::efeitos (o lote de um slot com efeitos), -1 sem efeitos
  int luz = -1;     // indice em Desenho::grupos_luz (lote iluminado: a pagina tem relevo), -1 sem luz
};

// as luzes de um personagem no desenho (docs/NUCLEO.md "Luzes"): a ambiente e ate MAX_LUZES
// pontos em mundo; por ponto x, y, altura, r, g, b (ja vezes alfa e forca) e raio
struct GrupoLuz {
  float ambiente[3] = {1, 1, 1};
  int quantas = 0;
  float luzes[MAX_LUZES][7] = {};
};

// os efeitos de um lote (docs/NUCLEO.md "Efeitos"): os valores e a caixa da imagem na pagina
struct EfeitosLote {
  Efeitos valores;
  float caixa[4] = {0, 0, 1, 1};  // u0, v0, u1, v1
  float pagina[2] = {1, 1};        // largura e altura da pagina, em pixels
};

struct Desenho {
  // true: o recorte e feito aqui, na CPU (os triangulos saem ja cortados e nao ha comandos
  // de recorte); false: o desenhista faz no stencil com ComecaRecorte e AcabaRecorte
  bool recorte_cpu = false;
  // por vertice: x, y, u, v, r, g, b, a (cor sem multiplicar pelo alfa)
  std::vector<float> vertices;
  std::vector<uint32_t> indices;
  std::vector<Lote> lotes;
  std::vector<EfeitosLote> efeitos;
  std::vector<GrupoLuz> grupos_luz;
  void limpar() {
    vertices.clear();
    indices.clear();
    lotes.clear();
    efeitos.clear();
    grupos_luz.clear();
  }
};

// as linhas de um emissor tipo raio no relogio atual (docs/NUCLEO.md "Raio"): a principal e
// os ramos, cada uma uma lista de pontos x, y (vazia se a intensidade e 0)
void linhas_raio(const Esqueleto& e, int emissor, std::vector<std::vector<double>>& linhas);

// as particulas de uma orbita no relogio atual (docs/NUCLEO.md "Orbita"): por particula x, y,
// z (-1 atras a 1 na frente), escala e giro (graus)
void posicoes_orbita(const Esqueleto& e, int emissor, std::vector<double>& out);

// monta o desenho da pose atual (depois de atualizar_mundo); acrescenta a `d`, entao varias
// instancias podem ir num desenho so
void desenhar(const Esqueleto& e, Desenho& d);

}  // namespace mamulengo
