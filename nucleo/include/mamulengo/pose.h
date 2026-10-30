// Instancia de um personagem: a pose local (animada), o mundo de cada osso, o estado dos
// slots e das restricoes (inclusive a fisica, que guarda memoria entre quadros).
//
// Uso tipico (o que a ferramenta nucleo-pose faz para cada instante):
//   Esqueleto e(modelo);
//   e.setup();                       // pose de setup, fisica reiniciada
//   for cada passo: e.aplicar(anim, tempo); e.avancar(dt); e.atualizar_mundo();
//   e.vertices(slot, saida);
//
// No jogo, com trilhas, fila e mix (mamulengo/estado.h), por quadro de `d` segundos:
//   estado.avancar(d); estado.aplicar(e); /* o jogo muda slots */ e.avancar(d); e.atualizar_mundo();
// O Estado aplica as timelines com peso pelas funcoes `aplicar_*` abaixo, sem voltar ao setup:
// o que nenhuma timeline toca fica como estava (inclusive o que o jogo mudou).
#pragma once

#include <array>
#include <memory>
#include <string_view>
#include <vector>

#include "mamulengo/modelo.h"

namespace mamulengo {

// matriz de mundo de um osso: [a b x; c d y], y para cima
struct Matriz {
  double a = 1, b = 0, c = 0, d = 1, x = 0, y = 0;
};

// pose local de um osso
struct Local {
  double x = 0, y = 0, rotacao = 0, escala_x = 1, escala_y = 1, cisalha_x = 0, cisalha_y = 0;
};

struct EstadoSlot {
  int parte = -1;  // indice em Modelo::partes; -1 sem parte
  Cor cor;
  Efeitos efeitos;
  std::vector<double> deform;  // deslocamentos dos vertices (ou das entradas de peso); vazio: sem deformar
  int marca = 0;  // uso do Estado: se a parte foi posta por uma timeline neste aplicar
  // borrar (docs/NUCLEO.md "Borrar"): os vertices em mundo no relogio atual e no anterior em
  // que o mundo foi calculado (so de slot com borrar ligado; relogio -1: ainda nao ha)
  std::vector<double> borrar_atual, borrar_ant;
  double borrar_t = -1, borrar_t_ant = -1;
  // rastro (docs/NUCLEO.md "Rastro"): os vertices em mundo dos quadros recentes, do mais antigo
  // ao atual, com o relogio de cada um (so de slot com rastro ligado)
  std::vector<std::pair<double, std::vector<double>>> rastro;
};

// uma copia do rastro: os vertices (x, y) e o quanto do alfa da peca ela tem
struct CopiaRastro {
  const std::vector<double>* xy = nullptr;
  float alfa = 0;
};

// Como uma timeline mistura o valor dela com o que ja esta na pose, com peso `alfa`:
// - Setup: parte do setup (setup + (valor - setup) * alfa); antes da primeira chave, o setup;
// - Primeira: parte do valor atual; antes da primeira chave, puxa o atual para o setup;
// - Substitui: parte do valor atual; antes da primeira chave, nao mexe;
// - Soma: soma o valor da timeline (relativo ao setup) vezes alfa.
enum class Mistura : uint8_t { Setup, Primeira, Substitui, Soma };

// uma particula viva, no espaco do esqueleto
struct Particula {
  double x = 0, y = 0, vx = 0, vy = 0, rot = 0, giro = 0, idade = 0, vida = 1;
  double fase = 0;  // do balanco (onda), sorteada no nascimento
};

// estado de um emissor: a taxa animavel e a memoria entre quadros
struct EstadoEmissor {
  double taxa = 0;
  bool reiniciar = true;
  double relogio = 0, acumulado = 0;
  uint32_t nascidas = 0;  // quantas ja nasceram desde o setup (o indice do sorteio)
  int pendentes = 0;      // rajadas ainda por nascer
  std::vector<Particula> vivas;
};

// valores animaveis das restricoes (comecam nos do modelo a cada aplicar)
struct EstadoRestricao {
  double mix = 1, suavidade = 0;  // ik
  int dobra = 1;
  bool comprime = false, estica = false;
  double mix_girar = 1, mix_x = 1, mix_y = 1, mix_escala_x = 1, mix_escala_y = 1, mix_cisalha_y = 1;  // transf, caminho
  double posicao = 0, espacamento = 0;  // caminho
  // fisica: parametros
  double inercia = 1, forca = 100, amortecimento = 1, massa_inv = 1, vento = 0, gravidade = 0;
  // fisica: memoria entre quadros
  bool reiniciar = true;
  double relogio = 0;   // relogio do esqueleto na ultima atualizacao
  double sobra = 0;     // tempo acumulado ainda nao integrado
  double ox = 0, oy = 0;          // ultima posicao do osso (origem)
  double px = 0, py = 0;          // ultima posicao da ponta do osso
  double dx = 0, dy = 0, vx = 0, vy = 0;  // translacao: desvio e velocidade
  double rot = 0, vrot = 0, rot_ant = 0, saida = 0;  // rotacao (radianos), velocidade, passo anterior
  double esc = 0, vesc = 0;       // escala
  double ax = 0, ay = 0;          // deslocamento herdado pela inercia, ainda a aplicar
};

class Esqueleto {
 public:
  explicit Esqueleto(std::shared_ptr<const Modelo> modelo);

  const Modelo& modelo() const { return *m_; }

  // pose de setup (local, slots, ordem) e fisica reiniciada; nao recalcula o mundo
  void setup();
  // volta a pose local ao setup e aplica a animacao no tempo dela (em loop se `loop`)
  void aplicar(int animacao, double tempo, bool loop = true);

  // ---- timelines com peso (o Estado usa; `sai`: a animacao esta saindo de um mix)
  void aplicar_osso(const TimelineOsso& tl, double t, double alfa, Mistura mist, bool sai);
  void aplicar_cor(const TimelineCor& tl, double t, double alfa, Mistura mist);
  void aplicar_efeito(const TimelineEfeito& tl, double t, double alfa, Mistura mist);
  void aplicar_taxa(const TimelineTaxa& tl, double t, double alfa, Mistura mist);
  // luz (tl.luz >= 0) ou ambiente (tl.luz = -1), como aplicar_cor para os canais dela
  void aplicar_luz(const TimelineLuz& tl, double t, double alfa, Mistura mist);
  // rajadas com tempo em (de, ate]; com ate < de (a animacao deu a volta), as depois de `de` e
  // as ate `ate`
  void aplicar_rajada(const TimelineRajada& tl, double de, double ate);
  void aplicar_deformar(const TimelineDeformar& tl, double t, double alfa, Mistura mist);
  void aplicar_ordem(const TimelineOrdem& tl, double t, Mistura mist, bool sai);
  void aplicar_restricao(const TimelineRestricao& tl, double t, double alfa, Mistura mist, bool sai);
  // a parte que a timeline `parte` pede no tempo t (-1 esconde); `antes`: t antes da primeira chave
  int parte_no_tempo(const TimelineParte& tl, double t, bool* antes) const;
  // a parte do setup do slot (na skin ativa)
  int parte_setup(int slot) const;
  // troca a parte do slot (-1 esconde); o deformar se perde, a menos que a nova parte use as
  // mesmas timelines de deformar que a anterior (malha ligada)
  void mudar_parte(int slot, int parte);

  // ---- acesso do jogo
  // o estado do slot (cor, parte); o jogo pode mudar a cor entre aplicar e atualizar o mundo.
  // Para trocar ou esconder a parte use mudar_parte.
  EstadoSlot& slot(int i) { return slots_[size_t(i)]; }
  // a parte com o nome dado para o slot, na skin ativa ou na default (-1 se nao ha)
  int parte(int slot, std::string_view nome) const;
  std::vector<int>& ordem_desenho() { return ordem_; }
  // avanca o relogio do esqueleto (a fisica integra pelo relogio)
  void avancar(double dt) { relogio_ = f32(relogio_ + dt); }
  // relogio em float32: o relogio, o que a fisica acumula e os passos dela arredondados a
  // float a cada conta, como um runtime que guarda o tempo em float (o oraculo usa double;
  // docs/NUCLEO.md "Relogio")
  bool relogio_float = false;
  double f32(double x) const { return relogio_float ? double(float(x)) : x; }
  double relogio() const { return relogio_; }
  // recalcula o mundo: ossos, depois cada restricao na ordem. A pose local continua a de antes
  // das restricoes (a animada), como a `pose` do oraculo
  void atualizar_mundo();

  // skin ativa (indice em Modelo::skins); nao muda as partes ja nos slots
  void skin(int s) { skin_ = s; }
  int skin() const { return skin_; }

  std::vector<Local> local;
  const std::vector<Matriz>& mundo() const { return mundo_; }
  const std::vector<EstadoSlot>& slots() const { return slots_; }
  const std::vector<int>& ordem() const { return ordem_; }
  std::vector<EstadoRestricao>& restricoes() { return rest_; }
  std::vector<EstadoEmissor>& emissores() { return emis_; }
  // luzes (docs/NUCLEO.md "Luzes"): os canais animados de cada luz e da ambiente
  std::vector<std::array<float, CANAIS_LUZ>>& luzes() { return luzes_; }
  const std::vector<std::array<float, CANAIS_LUZ>>& luzes() const { return luzes_; }
  float* ambiente() { return ambiente_; }
  const float* ambiente() const { return ambiente_; }
  const std::vector<EstadoEmissor>& emissores() const { return emis_; }

  // vertices em mundo da parte do slot (regiao: 4 cantos; malha: 2 numeros por vertice);
  // devolve quantos numeros escreveu (0 se o slot nao mostra regiao nem malha)
  size_t vertices(int slot, std::vector<double>& out) const;
  // vertices em mundo de uma parte com geometria, como o slot a mostraria (com deformar)
  void vertices_geometria(int slot, const Parte& p, double* out) const;
  // borrar (docs/NUCLEO.md "Borrar"): estica para tras os `n` numeros de `xy` (os vertices do
  // slot agora, x e y) pela velocidade desde o relogio anterior; `esmaece`, se nao nulo, recebe
  // por vertice quanto o alfa cai (0 a 1). Devolve false se nao borrou nada
  bool borrar(int slot, double* xy, size_t n, float* esmaece) const;
  // rastro (docs/NUCLEO.md "Rastro"): as copias do slot, da mais antiga para a mais nova (a
  // ordem de desenho, por tras da peca), so as que tem `n` numeros (a mesma parte)
  void copias_rastro(int slot, size_t n, std::vector<CopiaRastro>& out) const;

 private:
  std::shared_ptr<const Modelo> m_;
  std::vector<Matriz> mundo_;
  std::vector<EstadoSlot> slots_;
  std::vector<int> ordem_;
  std::vector<EstadoRestricao> rest_;
  std::vector<EstadoEmissor> emis_;
  std::vector<std::array<float, CANAIS_LUZ>> luzes_;
  float ambiente_[CANAIS_AMBIENTE] = {1, 1, 1, 1, 1};
  void luzes_setup();
  // aplicar() sem Estado: a animacao e o tempo da ultima vez (para as rajadas)
  int ultima_anim_ = -1;
  double ultimo_tempo_ = 0;
  // por restricao: os ossos a recalcular depois dela (descendentes dos controlados)
  std::vector<std::vector<int>> descendentes_;
  int skin_ = 0;
  double relogio_ = 0;
  std::vector<double> tmp_;
  // a pose local antes das restricoes (atualizar_mundo a devolve no fim)
  std::vector<Local> antes_;

  void mundo_osso(int i);
  void restricao_ik(int r);
  void restricao_caminho(int r);
  void restricao_fisica(int r);
  void restricao_transformacao(int r);
  void atualizar_particulas();
  // pose local a partir do mundo (depois que uma restricao mexe no mundo do osso)
  Local local_de_mundo(int i) const;
  // depois de uma restricao que escreve no mundo: leva o mundo para a pose local, para que uma
  // restricao seguinte num ancestral, ao recalcular este osso, nao desfaca o que ela fez
  void mundo_para_local(int i);
};

}  // namespace mamulengo
