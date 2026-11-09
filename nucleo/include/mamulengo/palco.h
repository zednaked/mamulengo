// O palco (docs/PALCO.md): o jogo dentro de um .boneco. Cada ator e uma instancia; a simulacao
// anda em passos fixos com a entrada do passo (bits), move os atores contra os ladrilhos solidos de
// um mosaico, aplica as regras do tipo de cada um e escreve no esqueleto: a posicao e o lado no
// osso da instancia, a animacao dela pelo estado e a camada apagada de quem saiu de cena.
// Deterministica: a mesma entrada da sempre o mesmo jogo (o agente joga e mede).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "mamulengo/modelo.h"
#include "mamulengo/pose.h"

namespace mamulengo {

// a entrada de um passo
enum : uint32_t { ENTRADA_ESQUERDA = 1, ENTRADA_DIREITA = 2, ENTRADA_PULO = 4 };

enum class EstadoAtorTipo : uint8_t { Parado, Andando, Pulo, Morto };

struct EstadoAtor {
  double x = 0, y = 0, vx = 0, vy = 0;  // os pes, no espaco do palco (o da raiz)
  int lado = 1;
  bool chao = false, vivo = true;
  EstadoAtorTipo estado = EstadoAtorTipo::Parado;
};

class Palco {
 public:
  explicit Palco(const Modelo& m) : m_(m) {}
  // volta ao comeco: o esqueleto no setup, os atores onde os ossos deles estao
  void reiniciar(Esqueleto& e);
  // um passo de dt segundos com a entrada dada
  void passo(Esqueleto& e, uint32_t entrada, double dt);
  // o estado em JSON: tick, venceu, morreu, pontos e os atores
  std::string json() const;

  int tick = 0, pontos = 0;
  bool venceu = false, morreu = false;
  const std::vector<EstadoAtor>& atores() const { return a_; }

 private:
  const Modelo& m_;
  std::vector<EstadoAtor> a_;
  bool pulo_antes_ = false;
  // a grade solida: origem (canto de cima e da esquerda) e celula
  double ox_ = 0, oy_ = 0, cw_ = 16, ch_ = 16;
  bool solido(double x, double y) const;
  bool solido_celula(int c, int r) const;
  // move no eixo e para na parede; devolve se bateu
  bool mover_x(const DadosAtor& d, EstadoAtor& s, double dx) const;
  bool mover_y(const DadosAtor& d, EstadoAtor& s, double dy) const;
  void escrever(Esqueleto& e);
};

}  // namespace mamulengo
