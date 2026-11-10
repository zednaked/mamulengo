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
  // geleia (docs/NUCLEO.md "Geleia"): posicao e velocidade de cada vertice em mundo, o alvo (onde
  // o rig poe) no relogio anterior, o tempo que sobrou do ultimo passo e a saida (vertices em
  // mundo como a peca aparece); parte -1: sem geleia
  std::vector<double> geleia_p, geleia_v, geleia_alvo, geleia_xy;
  double geleia_t = -1, geleia_sobra = 0;
  int geleia_parte = -1;
  // os slots que seguem esta geleia: slot, triangulo (indice do primeiro vertice em triangulos) e
  // as coordenadas baricentricas do centro dele, tiradas quando a geleia comecou
  struct Seguidor {
    int slot, tri;
    double b0, b1, b2;
  };
  std::vector<Seguidor> geleia_seguem;
  // quanto este slot anda por seguir uma geleia (somado aos vertices dele)
  double segue_dx = 0, segue_dy = 0;
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
  int var = -1;     // a variacao da imagem (sorteada no nascimento; -1: a imagem do emissor)
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
  double tempo = 0;  // slider (o mix e o `mix` de cima)
  // fisica: parametros
  double inercia = 1, forca = 100, amortecimento = 1, massa_inv = 1, vento = 0, gravidade = 0;
  // fisica: memoria entre quadros
  bool reiniciar = true;
  double relogio = 0;   // relogio do esqueleto na ultima atualizacao
  double sobra = 0;     // tempo acumulado ainda nao integrado
  double ox = 0, oy = 0;          // ultima posicao do osso (origem)
  double px = 0, py = 0;          // ultima posicao da ponta do osso
  double dx = 0, dy = 0, vx = 0, vy = 0;  // translacao: desvio e velocidade
  double dx_ant = 0, dy_ant = 0;  // translacao: o desvio de antes do ultimo passo (a interpolacao)
  double rx = 0, ry = 0;          // translacao: a origem do osso no rig (sem a fisica) no quadro anterior
  double rot = 0, vrot = 0, rot_ant = 0, saida = 0;  // rotacao (radianos), velocidade, passo anterior
  double esc = 0, vesc = 0;       // escala
  double ax = 0, ay = 0;          // deslocamento herdado pela inercia, ainda a aplicar
};

class Esqueleto;

// estado de uma instancia (docs/NUCLEO.md "Instancias"): o esqueleto do filho e o que a timeline
// dela pede. Copiar copia o filho inteiro (o checkpoint do editor guarda o estado todo)
struct EstadoInstancia {
  std::unique_ptr<Esqueleto> e;
  int animacao = -1;
  double inicio = 0, velocidade = 1;
  bool laco = true;
  int segue_inst = -1, segue_osso = -1;  // o osso de outra instancia que ela segue (-1: o dela)
  // a timeline da instancia pos o tempo do filho neste quadro (senao: inicio + velocidade x relogio)
  bool por_timeline = false;
  double tempo_filho = 0;
  // mistura (a chave em vigor tem mix e comecou ha menos que ele): a animacao anterior no tempo
  // dela e quanto da nova (0 a 1)
  int mix_animacao = -1;
  double mix_tempo = 0, mix_alfa = 1;
  bool mix_laco = true;
  // o ultimo calculo (um filho sem memoria parado no mesmo instante e lugar nao e refeito)
  bool pronto = false;
  int ultima_anim = -2;
  double ultimo_t = 0, ultimo_alfa = 1;
  double ultima_base[6] = {0};
  EstadoInstancia() = default;
  EstadoInstancia(const EstadoInstancia& o);
  EstadoInstancia& operator=(const EstadoInstancia& o);
  EstadoInstancia(EstadoInstancia&&) noexcept = default;
  EstadoInstancia& operator=(EstadoInstancia&&) noexcept = default;
  ~EstadoInstancia();
};

class Esqueleto {
 public:
  explicit Esqueleto(std::shared_ptr<const Modelo> modelo);

  const Modelo& modelo() const { return *m_; }

  // pose de setup (local, slots, ordem) e fisica reiniciada; nao recalcula o mundo
  void setup();
  // volta a pose local ao setup e aplica a animacao no tempo dela (em loop se `loop`)
  void aplicar(int animacao, double tempo, bool loop = true);
  // a mistura de duas animacoes (docs/NUCLEO.md "Instancias"): as duas aplicadas desde o setup e a
  // pose local de cada uma misturada por `alfa` (0: so `de`, 1: so `para`); as rajadas so da `para`
  void aplicar_cruzado(int de, double tempo_de, bool loop_de, int para, double tempo_para, bool loop_para, double alfa);

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
  // a instancia passa a tocar o que a chave em vigor pede (degrau; `sai`: nao mexe)
  void aplicar_instancia(const TimelineInstancia& ti, double t, Mistura mist, bool sai);
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
  // avanca o relogio do esqueleto (a fisica integra pelo relogio); o das instancias anda junto
  void avancar(double dt);
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
  void skin(int s) {
    skin_ = s;
    atualizar_ativos();
  }
  // o osso esta ativo (nao e so de outra skin, nem pende de um que e); slot de osso inativo nao
  // desenha
  bool ativo(int osso) const { return ativos_.empty() || ativos_[size_t(osso)]; }
  int skin() const { return skin_; }

  std::vector<Local> local;
  // instancias (docs/NUCLEO.md "Instancias"): a matriz que leva os ossos raiz para o mundo do
  // pai (o osso da instancia vezes a posicao dela); sem base, os raiz ficam no mundo
  Matriz base;
  bool tem_base = false;
  std::vector<EstadoInstancia>& instancias() { return inst_; }
  const std::vector<EstadoInstancia>& instancias() const { return inst_; }
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

  // ---- tela (docs/NUCLEO.md "Tela"): a janela em pixels de quem mostra o boneco inteiro
  // a vista: o retangulo do mundo (y para cima, canto de baixo e da esquerda) que aparece na
  // janela e quantos pixels da janela cabem numa unidade do mundo
  struct Vista {
    double escala = 1, x = 0, y = 0, largura = 0, altura = 0;
  };
  // muda a janela: a vista sai na hora; a correcao dos ossos ancorados, no proximo
  // atualizar_mundo. 0 x 0 (o padrao): a arte base, sem correcao
  void janela(double largura, double altura);
  const Vista& vista() const { return vista_; }
  double janela_largura() const { return janela_w_; }
  double janela_altura() const { return janela_h_; }
  // o setup do modelo mudou (o editor remenda ossos): refaz a correcao no proximo atualizar_mundo
  void tela_mudou() { tela_sujo_ = true; }

  // ---- texto (docs/NUCLEO.md "Texto"): o nucleo nao desenha letras. Quem mostra o boneco monta a
  // imagem de cada parte de texto (k: indice em Modelo::textos) numa pagina so dela, a pagina dos
  // textos, de indice Modelo::paginas_desenho.size(), e diz onde: `ret` e o retangulo da imagem
  // no espaco da caixa (o meio da caixa na origem, y para cima: esquerda, baixo, direita, cima),
  // antes da transformacao da parte; `uv` e u0, v0 (canto de cima e da esquerda), u1, v1 na pagina.
  // Dai em diante a parte desenha como uma regiao (cor do slot, ordem, recorte, efeitos)
  void imagem_texto(int k, const double ret[4], const float uv[4]);
  // sem imagem: a parte nao desenha (o clique e a caixa seguem a caixa do texto)
  void sem_imagem_texto(int k);
  // o tamanho da pagina dos textos em pixels (os efeitos medem a margem nela)
  void pagina_textos(int largura, int altura) { pagina_textos_.largura = largura, pagina_textos_.altura = altura; }
  // quanto o texto k ocupa depois do estouro (largura e altura usadas, nas unidades da caixa): a
  // regiao com nove-fatias que acompanha o slot dele cresce junto (docs/NUCLEO.md "Nove-fatias").
  // 0 x 0: sem medida (o tamanho base)
  void medida_texto(int k, double largura, double altura);
  // a parte como ela desenha: a de texto vira a regiao da imagem entregue (ou da caixa, sem
  // pagina); a regiao com nove-fatias, a malha da grade (docs/NUCLEO.md "Nove-fatias")
  const Parte& parte_desenho(int parte) const {
    const Parte& p = m_->partes[size_t(parte)];
    if (p.tipo == TipoParte::Texto) return textos_[size_t(p.texto)];
    return p.fatias >= 0 ? fatiadas_[size_t(p.fatias)] : p;
  }
  // nove-fatias: a malha da grade de cada regiao fatiada (vertices no osso, uvs, triangulos), os
  // pontos por eixo (nx, ny) e o tamanho L x A em que foi feita
  struct Fatiada {
    int nx = 0, ny = 0;
    double largura = 0, altura = 0, ex = 1, ey = 1;
  };
  const std::vector<Fatiada>& fatiadas() const { return fatiadas_info_; }
  // os 4 cantos de fora da grade em mundo (a caixa da parte, para o clique), na ordem da regiao;
  // devolve 8, ou 0 se o slot nao mostra regiao fatiada
  size_t cantos_fatias(int slot, std::vector<double>& out) const;
  // a pagina pelo indice do desenho (a dos textos inclusive)
  const Pagina& pagina(int i) const { return size_t(i) < m_->paginas.size() ? m_->paginas[size_t(i)] : pagina_textos_; }

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
  std::vector<EstadoInstancia> inst_;
  // texto: por parte de texto, a regiao que ela desenha (sem imagem: pagina -1)
  std::vector<Parte> textos_;
  Pagina pagina_textos_;
  // nove-fatias: a malha de cada regiao fatiada, a medida de cada texto e, com a correcao da tela,
  // a parte linear do mundo de setup de cada osso na arte base (lin0_) e corrigido (lin1_)
  std::vector<Parte> fatiadas_;
  std::vector<Fatiada> fatiadas_info_;
  std::vector<double> medidas_;
  std::vector<double> lin0_, lin1_;
  void refazer_fatias();
  void refazer_fatia(size_t i);
  void luzes_setup();
  void instancias_setup();
  void atualizar_instancias();
  // aplicar sem as rajadas (a animacao que sai numa mistura)
  bool sem_rajadas_ = false;
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
  // tela: a janela, a vista e, por osso ancorado, o que soma (x, y, rotacao, cisalhas) e o que
  // multiplica (escalas) na pose local
  double janela_w_ = 0, janela_h_ = 0;
  Vista vista_;
  bool tela_sujo_ = false;
  struct Correcao {
    int osso;
    Local d;
  };
  std::vector<Correcao> correcao_;
  void calcular_vista();
  void calcular_tela();
  void restricao_ik(int r);
  void restricao_caminho(int r);
  void restricao_fisica(int r);
  void restricao_transformacao(int r);
  void restricao_slider(int r);
  // o que os sliders mudaram nos slots vale so neste quadro: os slots de antes deles, devolvidos
  // no proximo aplicar (os ossos ja voltam no fim de atualizar_mundo)
  struct SlotAntes {
    int parte;
    Cor cor;
    Efeitos efeitos;
    std::vector<double> deform;
  };
  std::vector<SlotAntes> slots_antes_slider_;

 public:
  void devolver_slider();

 private:
  void atualizar_particulas();
  void atualizar_geleia();
  std::vector<char> ativos_;
  void atualizar_ativos();
  // pose local a partir do mundo (depois que uma restricao mexe no mundo do osso)
  Local local_de_mundo(int i) const;
  // depois de uma restricao que escreve no mundo: leva o mundo para a pose local, para que uma
  // restricao seguinte num ancestral, ao recalcular este osso, nao desfaca o que ela fez
  void mundo_para_local(int i);
};

}  // namespace mamulengo
