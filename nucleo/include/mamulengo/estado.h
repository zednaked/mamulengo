// Estado de animacao: trilhas, fila, mix e eventos (docs/NUCLEO.md "Estado").
//
// Cada trilha toca uma entrada (uma animacao com relogio proprio) e guarda a fila das que vem
// depois. Trocar de animacao com mix mistura a que sai com a que entra durante o tempo do mix;
// as trilhas de cima se aplicam por cima das de baixo. O Estado nao volta o esqueleto ao setup:
// o que nenhuma timeline toca fica como estava, inclusive o que o jogo mudou nos slots.
//
// Ordem por quadro de `d` segundos (a do oraculo):
//   estado.avancar(d);       // relogios, trocas da fila, fim dos mixes
//   estado.aplicar(e);       // timelines com mix sobre o esqueleto, eventos do intervalo
//   /* o jogo muda cores e partes de slots aqui */
//   e.avancar(d);            // relogio do esqueleto (fisica)
//   e.atualizar_mundo();
//   estado.ler_eventos(lista);
#pragma once

#include <cfloat>
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_set>
#include <vector>

#include "mamulengo/modelo.h"
#include "mamulengo/pose.h"

namespace mamulengo {

class Estado;

// Uma animacao tocando numa trilha. Os campos podem ser mudados logo depois de tocar ou
// enfileirar (o mix_duracao e o atraso, por exemplo); o ponteiro vale ate o evento de fim.
struct Entrada {
  int animacao = -1;  // indice em Modelo::animacoes; -1 e a animacao vazia
  int trilha = 0;
  bool loop = false;
  bool somar = false;     // trilha de cima que soma em vez de substituir
  // nao recalcula se cada timeline segura (docs/NUCLEO.md "Estado", modos); o Estado liga
  // quando a entrada perde a de baixo enquanto ja sai para outra
  bool manter_segura = false;
  double limiar_eventos = 0;       // saindo de um mix: eventos ate esta fracao do mix
  double limiar_partes = 0;        // saindo: trocas de parte ate esta fracao
  double limiar_alfa_partes = 0;   // trocas de parte so com alfa a partir disto
  double limiar_ordem = 0;         // saindo: ordem de desenho ate esta fracao

  double inicio = 0, fim = 0;      // trecho da animacao que toca (fim: a duracao)
  double atraso = 0;               // na fila: segundos depois do inicio da anterior
  double tempo = 0;                // relogio da entrada (cresce sem parar)
  double tempo_fim = DBL_MAX;      // a entrada acaba quando o relogio passa daqui
  double escala_tempo = 1;
  double alfa = 1;
  double mix_tempo = 0, mix_duracao = 0;

  // tempo dentro da animacao (com a volta do loop)
  double tempo_animacao() const;
  // quando a entrada completa (fim da volta atual no loop)
  double tempo_completa() const;

  Entrada* anterior = nullptr;  // na fila
  Entrada* proxima = nullptr;
  Entrada* de = nullptr;    // a entrada que esta saindo (mix)
  Entrada* para = nullptr;  // a entrada que esta entrando

 private:
  friend class Estado;
  double ultimo = -1, prox_ultimo = -1;       // tempo de animacao no aplicar anterior
  double tempo_ant = -1, prox_tempo_ant = -1; // relogio no aplicar anterior (-1: nunca aplicada)
  double alfa_total = 0;
  std::vector<uint8_t> modo;           // por timeline: como mistura (docs/NUCLEO.md "Estado")
  std::vector<Entrada*> modo_mix;      // por timeline no modo de segurar com mix: a entrada que manda
  std::vector<double> rotacoes;        // por timeline de girar: total e diferenca do quadro anterior
  bool descartada = false;
};

enum class TipoEvento : uint8_t { Inicio, Interrompida, Fim, Completa, Usuario };

struct Evento {
  TipoEvento tipo = TipoEvento::Inicio;
  int trilha = 0;
  int animacao = -1;  // -1: a animacao vazia
  // usuario: a definicao (indice em Modelo::eventos), o tempo da chave e os valores
  int evento = -1;
  double tempo = 0;
  int inteiro = 0;
  double decimal = 0;
  std::string texto;
  double volume = 1, balanco = 0;
};

class Estado {
 public:
  explicit Estado(std::shared_ptr<const Modelo> modelo);
  ~Estado();
  Estado(const Estado&) = delete;
  Estado& operator=(const Estado&) = delete;

  const Modelo& modelo() const { return *m_; }

  // mix de uma animacao para outra; comecam no `mix` do .boneco
  double mix_padrao = 0;
  void definir_mix(int de, int para, double tempo);
  double mix(int de, int para) const;

  // multiplica o dt de todas as trilhas
  double escala_tempo = 1;

  // corta o que a trilha toca e toca a animacao (com o mix de-para)
  Entrada* tocar(int trilha, int animacao, bool loop);
  // poe a animacao na fila da trilha. atraso <= 0: entra quando a ultima da fila completa,
  // menos o mix (e mais o atraso, se negativo); atraso > 0: segundos depois do inicio da ultima
  Entrada* enfileirar(int trilha, int animacao, bool loop, double atraso = 0);
  // corta para a animacao vazia: as timelines da atual saem em `mix` segundos de volta ao setup
  Entrada* vazio(int trilha, double mix);
  Entrada* enfileirar_vazio(int trilha, double mix, double atraso = 0);
  // para todas as trilhas (eventos de fim); o esqueleto fica como esta
  void limpar();
  void limpar_trilha(int trilha);

  // anda os relogios, troca as entradas da fila e termina os mixes
  void avancar(double dt);
  // aplica as trilhas sobre o esqueleto; devolve se alguma trilha foi aplicada
  bool aplicar(Esqueleto& e);

  // a animacao tocando na trilha (-1 se nada ou a vazia)
  int atual(int trilha) const;
  Entrada* entrada(int trilha) const;

  // eventos desde a ultima leitura, na ordem em que aconteceram
  const std::vector<Evento>& eventos() const { return eventos_; }
  void ler_eventos(std::vector<Evento>& saida);  // troca a lista com `saida` e esvazia

 private:
  struct Tl;
  std::shared_ptr<const Modelo> m_;
  std::vector<Entrada*> trilhas_;
  std::vector<std::unique_ptr<Entrada>> vivas_;
  std::vector<std::vector<Tl>> tls_;                  // por animacao: as timelines em ordem
  std::vector<std::unordered_set<uint64_t>> ids_;     // por animacao: as propriedades
  std::unordered_set<uint64_t> usados_;
  std::vector<int> disparados_;                       // chaves de evento do aplicar atual
  std::vector<Evento> eventos_;
  struct ParMix {
    int de, para;
    double tempo;
  };
  std::vector<ParMix> pares_;
  int sem_chave_ = 0;
  bool mudou_ = false;

  Entrada* nova(int trilha, int animacao, bool loop, Entrada* ultima);
  Entrada* expandir(int trilha);
  void por_atual(int trilha, Entrada* atual, bool interromper);
  void limpar_fila(Entrada* e);
  bool avancar_de(Entrada* para, double dt);
  double aplicar_de(Entrada* para, Esqueleto& e, Mistura mist);
  void aplicar_timeline(Esqueleto& e, const Entrada& en, const Tl& tl, double ultimo, double t, double alfa, Mistura mist, bool sai,
                        bool coletar);
  void girar(Esqueleto& e, const TimelineOsso& to, double t, double alfa, Mistura mist, Entrada& en, size_t i, bool primeiro);
  void parte(Esqueleto& e, const TimelineParte& tp, double t, Mistura mist, bool partes);
  void disparar(const Animacao& an, double ultimo, double t);
  void enfileirar_eventos(Entrada* en, double t_anim);
  void recalcular_modos();
  void calcular_modos(Entrada* en);
  void emitir(TipoEvento tipo, const Entrada* en);
  void descartar(Entrada* en);
  void recolher();
};

}  // namespace mamulengo
