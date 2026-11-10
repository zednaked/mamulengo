// Papeis dos elementos (docs/NUCLEO.md "Papeis"): o que um osso e para o codigo do jogo (botao,
// area de toque, texto do codigo), o teste de toque e os estados dos botoes pelo ponteiro.
//
// O teste de toque mora aqui (e nao em quem mostra) porque e conta sobre o mundo que so o nucleo
// tem: a caixa de cada parte, a grade das nove-fatias que cresce com o texto, a ordem de desenho e a
// cor do slot. O mesmo numero no editor, na web e no Godot.
//
// Uso por quadro (as coordenadas no mundo do boneco, y para cima):
//   Interface ui(modelo); ui.iniciar(estado);          // o estado inicial de cada botao
//   ui.mover(e, estado, x, y); ui.apertar(...); ui.soltar(..., dedo);
//   for (int k : ui.toques) ...; ui.toques.clear();     // os papeis tocados (apertou e soltou nele)
#pragma once

#include <memory>
#include <vector>

#include "mamulengo/estado.h"
#include "mamulengo/modelo.h"
#include "mamulengo/pose.h"

namespace mamulengo {

// a area do papel k no mundo como triangulos (6 numeros cada), com o mundo atual do esqueleto;
// devolve a posicao mais alta na ordem de desenho entre as partes da area (-1: sem parte; a caixa
// fica na posicao do slot mais alto do grupo). Vazia se o osso esta inativo ou nada aparece
int area_papel(const Esqueleto& e, int k, std::vector<double>& tri);
// o retangulo da area (min x, min y, max x, max y no mundo); false se vazia
bool caixa_papel(const Esqueleto& e, int k, double out[4]);
// o papel (botao ou toque) no ponto: o de cima na ordem de desenho; -1 nenhum. Os desligados
// contam (um botao desligado ainda cobre o que esta atras dele)
int papel_no_ponto(const Esqueleto& e, double x, double y);

// os estados dos botoes pelo ponteiro (um so: o mouse ou o primeiro dedo)
class Interface {
 public:
  explicit Interface(std::shared_ptr<const Modelo> m);
  // toca o estado de cada botao (normal ou desligado) sem mix
  void iniciar(Estado& st);
  // o ponteiro andou (sem apertar, ou apertado)
  void mover(const Esqueleto& e, Estado& st, double x, double y);
  void apertar(const Esqueleto& e, Estado& st, double x, double y);
  // soltou: toque se apertou e soltou no mesmo papel ligado. dedo: sem "em cima" depois
  void soltar(const Esqueleto& e, Estado& st, double x, double y, bool dedo);
  // o ponteiro saiu da janela (ou o toque foi cancelado)
  void sair(Estado& st);
  void desligar(Estado& st, int k, bool desligado);
  bool desligado(int k) const { return desligado_[size_t(k)] != 0; }
  // o estado mostrado (EstadoBotao); o toque e o texto ficam em BotaoNormal
  int estado(int k) const { return estado_[size_t(k)]; }
  // forca um estado (o jogo mostra o apertado de um botao por um atalho de teclado)
  void mostrar(Estado& st, int k, int estado) { por(st, k, estado, true); }
  int sobre() const { return sobre_; }
  int apertado() const { return apertado_; }
  // os papeis tocados, na ordem; quem le esvazia
  std::vector<int> toques;

 private:
  std::shared_ptr<const Modelo> m_;
  std::vector<uint8_t> desligado_;
  std::vector<int> estado_;
  int sobre_ = -1, apertado_ = -1;
  bool iniciado_ = false;
  int animacao(int k, int estado) const;
  void por(Estado& st, int k, int estado, bool mix);
  // o estado de repouso de k agora (desligado, em cima, apertado ou normal)
  int repouso(int k) const;
  void refazer(Estado& st);
};

}  // namespace mamulengo
