// Pose: aplicar animacao (docs/NUCLEO.md "Pose local", "Slots"), mundo dos ossos ("Mundo",
// "Ordem de atualizacao") e vertices ("Partes e vertices").
#include "mamulengo/pose.h"

#include <algorithm>
#include <cmath>

namespace mamulengo {

// pi com todos os algarismos (o M_PI nao existe no mingw estrito; o PI do modelo e o do Spine, em
// float, e mudaria o slider)
constexpr double PI_EXATO = 3.14159265358979323846;


EstadoInstancia::EstadoInstancia(const EstadoInstancia& o)
    : e(o.e ? std::make_unique<Esqueleto>(*o.e) : nullptr), animacao(o.animacao), inicio(o.inicio), velocidade(o.velocidade), laco(o.laco),
      por_timeline(o.por_timeline), tempo_filho(o.tempo_filho), mix_animacao(o.mix_animacao), mix_tempo(o.mix_tempo), mix_alfa(o.mix_alfa), mix_laco(o.mix_laco),
      pronto(o.pronto), ultima_anim(o.ultima_anim), ultimo_t(o.ultimo_t), ultimo_alfa(o.ultimo_alfa) {
  std::copy(o.ultima_base, o.ultima_base + 6, ultima_base);
}
EstadoInstancia& EstadoInstancia::operator=(const EstadoInstancia& o) {
  if (this != &o) *this = EstadoInstancia(o);
  return *this;
}
EstadoInstancia::~EstadoInstancia() = default;

Esqueleto::Esqueleto(std::shared_ptr<const Modelo> modelo) : m_(std::move(modelo)) {
  const Modelo& m = *m_;
  inst_.resize(m.instancias.size());
  for (size_t i = 0; i < m.instancias.size(); ++i) {
    const DadosInstancia& d = m.instancias[i];
    inst_[i].e = std::make_unique<Esqueleto>(m.filhos[size_t(d.filho)]);
    inst_[i].e->skin(d.skin);
    inst_[i].e->tem_base = true;
  }
  local.resize(m.ossos.size());
  mundo_.resize(m.ossos.size());
  // texto: a regiao de cada parte de texto, ainda sem imagem (os cantos sao a caixa)
  textos_.reserve(m.textos.size());
  for (const DadosTexto& t : m.textos) {
    const Parte& o = m.partes[size_t(t.parte)];
    Parte p;
    p.tipo = TipoParte::Regiao;
    p.nome = o.nome;
    p.slot = o.slot;
    p.texto = o.texto;
    std::copy(o.cantos, o.cantos + 8, p.cantos);
    textos_.push_back(std::move(p));
  }
  // nove-fatias: a malha de cada regiao fatiada, feita ja no tamanho base
  medidas_.assign(m.textos.size() * 2, 0);
  fatiadas_.resize(m.fatias.size());
  fatiadas_info_.resize(m.fatias.size());
  for (size_t i = 0; i < m.fatias.size(); ++i) {
    const Parte& o = m.partes[size_t(m.fatias[i].parte)];
    Parte& p = fatiadas_[i];
    p.tipo = TipoParte::Malha;
    p.nome = o.nome;
    p.slot = o.slot;
    p.fatias = int(i);
    p.cor = o.cor;
    p.pagina = o.pagina;
  }
  refazer_fatias();
  calcular_vista();
  slots_.resize(m.slots.size());
  rest_.resize(m.restricoes.size());
  emis_.resize(m.emissores.size());
  // descendentes de cada restricao, em ordem de hierarquia (o pai vem antes no arquivo)
  descendentes_.resize(m.restricoes.size());
  for (size_t r = 0; r < m.restricoes.size(); ++r) {
    const DadosRestricao& d = m.restricoes[r];
    std::vector<char> marca(m.ossos.size(), 0);
    auto marcar = [&](int o) { marca[size_t(o)] = 1; };
    switch (d.tipo) {
      case TipoRestricao::IK: for (int o : d.ik.ossos) marcar(o); break;
      case TipoRestricao::Caminho: for (int o : d.caminho.ossos) marcar(o); break;
      case TipoRestricao::Transformacao: for (int o : d.transf.ossos) marcar(o); break;
      case TipoRestricao::Fisica: marcar(d.fisica.osso); break;
      case TipoRestricao::Slider:
        // os ossos que a animacao do slider mexe
        if (d.slider.animacao >= 0)
          for (const TimelineOsso& to : m.animacoes[size_t(d.slider.animacao)].ossos) marcar(to.osso);
        break;
    }
    for (size_t i = 0; i < m.ossos.size(); ++i) {
      if (marca[i]) continue;
      int p = m.ossos[i].pai;
      if (p >= 0 && marca[size_t(p)]) {
        marca[i] = 2;
        descendentes_[r].push_back(int(i));
      }
    }
  }
  setup();
}

// Slider (docs/NUCLEO.md "Slider"): a animacao dele entra inteira no instante t, por cima da pose
// atual, na medida do mix (somar: soma o valor das chaves). Os slots mexidos so valem neste quadro
void Esqueleto::restricao_slider(int ri) {
  const Modelo& m = *m_;
  const DadosSlider& d = m.restricoes[size_t(ri)].slider;
  const EstadoRestricao& e = rest_[size_t(ri)];
  if (d.animacao < 0 || e.mix <= 0) return;
  const Animacao& an = m.animacoes[size_t(d.animacao)];
  double t;
  if (d.osso >= 0) {
    double v = 0;
    const Matriz& w = mundo_[size_t(d.osso)];
    const Local& l = local[size_t(d.osso)];
    switch (d.prop) {
      case PropSlider::Girar: {
        // como a fonte da transformacao: a rotacao de mundo em [0, 360)
        if (d.local) v = l.rotacao;
        else {
          v = std::fmod(std::atan2(w.c, w.a) * 180 / PI_EXATO, 360.0);
          if (v < 0) v += 360;
        }
        break;
      }
      case PropSlider::X: v = d.local ? l.x : w.x; break;
      case PropSlider::Y: v = d.local ? l.y : w.y; break;
      case PropSlider::EscalaX: v = d.local ? l.escala_x : std::sqrt(w.a * w.a + w.c * w.c); break;
      case PropSlider::EscalaY: v = d.local ? l.escala_y : std::sqrt(w.b * w.b + w.d * w.d); break;
      case PropSlider::CisalhaY: v = d.local ? l.cisalha_y : (std::atan2(w.d, w.b) - std::atan2(w.c, w.a)) * 180 / PI_EXATO - 90; break;
    }
    t = (v - d.de) * d.escala + d.para;
  } else {
    // sem osso, um tempo negativo deixa o slider parado (nao aplica nada), como no oraculo
    if (e.tempo < 0) return;
    t = e.tempo;
  }
  const double dur = an.duracao;
  if (d.repetir && dur > 0) {
    t = std::fmod(t, dur);
    if (t < 0) t += dur;
  } else {
    t = std::clamp(t, 0.0, std::max(0.0, dur));
  }
  // os slots de antes (uma vez por quadro, antes do primeiro slider)
  if (slots_antes_slider_.empty())
    for (const EstadoSlot& s : slots_) slots_antes_slider_.push_back({s.parte, s.cor, s.efeitos, s.deform});
  const Mistura mist = d.somar ? Mistura::Soma : Mistura::Substitui;
  const double a = std::min(1.0, e.mix);
  for (const TimelineParte& tp : an.partes) mudar_parte(tp.slot, parte_no_tempo(tp, t, nullptr));
  for (const TimelineCor& tc : an.cores) aplicar_cor(tc, t, a, mist);
  for (const TimelineEfeito& te : an.efeitos) aplicar_efeito(te, t, a, mist);
  for (const TimelineOsso& to : an.ossos) aplicar_osso(to, t, a, mist, false);
  for (const TimelineDeformar& td : an.deformar) aplicar_deformar(td, t, a, mist);
  // o mundo dos ossos que a animacao mexeu, do pai para o filho (os filhos que ela nao mexe vem
  // depois, pela lista da restricao)
  std::vector<char> mexe(m.ossos.size(), 0);
  for (const TimelineOsso& to : an.ossos) mexe[size_t(to.osso)] = 1;
  for (size_t i = 0; i < m.ossos.size(); ++i)
    if (mexe[i]) mundo_osso(int(i));
}

void Esqueleto::devolver_slider() {
  if (slots_antes_slider_.empty()) return;
  for (size_t i = 0; i < slots_.size() && i < slots_antes_slider_.size(); ++i) {
    SlotAntes& a = slots_antes_slider_[i];
    EstadoSlot& s = slots_[i];
    s.parte = a.parte;
    s.cor = a.cor;
    s.efeitos = a.efeitos;
    s.deform.swap(a.deform);
  }
  slots_antes_slider_.clear();
}

void Esqueleto::atualizar_ativos() {
  const Modelo& m = *m_;
  ativos_.assign(m.ossos.size(), 1);
  if (m.skins.empty()) return;
  const auto& lista = m.skins[size_t(skin_)].ossos;
  for (size_t i = 0; i < m.ossos.size(); ++i) {
    const DadosOsso& d = m.ossos[i];
    bool a = !d.so_skin || std::find(lista.begin(), lista.end(), int(i)) != lista.end();
    if (d.pai >= 0) a = a && ativos_[size_t(d.pai)];
    ativos_[i] = a;
  }
}

void Esqueleto::setup() {
  const Modelo& m = *m_;
  atualizar_ativos();
  for (size_t i = 0; i < m.ossos.size(); ++i) {
    const DadosOsso& d = m.ossos[i];
    local[i] = Local{d.x, d.y, d.rotacao, d.escala_x, d.escala_y, d.cisalha_x, d.cisalha_y};
  }
  ordem_.resize(m.slots.size());
  for (size_t i = 0; i < m.slots.size(); ++i) {
    ordem_[i] = int(i);
    EstadoSlot& s = slots_[i];
    s.cor = m.slots[i].cor;
    s.efeitos = m.slots[i].efeitos;
    s.parte = m.parte_de(skin_, int(i), m.slots[i].parte_setup);
    s.deform.clear();
    s.borrar_atual.clear();
    s.borrar_ant.clear();
    s.borrar_t = s.borrar_t_ant = -1;
    s.rastro.clear();
    s.geleia_p.clear(), s.geleia_v.clear(), s.geleia_alvo.clear(), s.geleia_xy.clear();
    s.geleia_t = -1, s.geleia_sobra = 0, s.geleia_parte = -1;
    s.geleia_seguem.clear();
    s.segue_dx = s.segue_dy = 0;
  }
  luzes_setup();
  instancias_setup();
  for (EstadoInstancia& in : inst_) in.e->setup(), in.pronto = false;
  for (size_t i = 0; i < m.emissores.size(); ++i) {
    emis_[i] = EstadoEmissor{};
    emis_[i].taxa = m.emissores[i].taxa;
  }
  ultima_anim_ = -1;
  for (size_t r = 0; r < m.restricoes.size(); ++r) {
    const DadosRestricao& d = m.restricoes[r];
    EstadoRestricao& e = rest_[r];
    e = EstadoRestricao{};
    switch (d.tipo) {
      case TipoRestricao::IK:
        e.mix = d.ik.mix;
        e.suavidade = d.ik.suavidade;
        e.dobra = d.ik.dobra;
        e.comprime = d.ik.comprime;
        e.estica = d.ik.estica;
        break;
      case TipoRestricao::Transformacao:
        e.mix_girar = d.transf.mix_girar;
        e.mix_x = d.transf.mix_x;
        e.mix_y = d.transf.mix_y;
        e.mix_escala_x = d.transf.mix_escala_x;
        e.mix_escala_y = d.transf.mix_escala_y;
        e.mix_cisalha_y = d.transf.mix_cisalha_y;
        break;
      case TipoRestricao::Caminho:
        e.mix_girar = d.caminho.mix_girar;
        e.mix_x = d.caminho.mix_x;
        e.mix_y = d.caminho.mix_y;
        e.posicao = d.caminho.posicao;
        e.espacamento = d.caminho.espacamento;
        break;
      case TipoRestricao::Slider:
        e.mix = d.slider.mix;
        e.tempo = d.slider.tempo;
        break;
      case TipoRestricao::Fisica:
        e.inercia = d.fisica.inercia;
        e.forca = d.fisica.forca;
        e.amortecimento = d.fisica.amortecimento;
        e.massa_inv = d.fisica.massa_inv;
        e.vento = d.fisica.vento;
        e.gravidade = d.fisica.gravidade;
        e.mix = d.fisica.mix;
        e.reiniciar = true;
        break;
    }
  }
  relogio_ = 0;
}

namespace {

// valor relativo ao setup (girar, mover, cisalhar): docs/NUCLEO.md "Estado", misturas
inline double relativo(double atual, double setup, const Timeline& tl, int k, int c, double t, double alfa, Mistura mist) {
  if (k < 0) {
    if (mist == Mistura::Setup) return setup;
    if (mist == Mistura::Primeira) return atual + (setup - atual) * alfa;
    return atual;
  }
  double v = tl.valor(k, c, t);
  switch (mist) {
    case Mistura::Setup: return setup + v * alfa;
    case Mistura::Primeira:
    case Mistura::Substitui: v += setup - atual; break;
    case Mistura::Soma: break;
  }
  return atual + v * alfa;
}

inline double sinal(double v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

// escala: o valor da chave multiplica o setup; misturando, o sinal vem do lado que manda
inline double escala(double atual, double setup, const Timeline& tl, int k, int c, double t, double alfa, Mistura mist, bool sai) {
  if (k < 0) {
    if (mist == Mistura::Setup) return setup;
    if (mist == Mistura::Primeira) return atual + (setup - atual) * alfa;
    return atual;
  }
  const double x = tl.valor(k, c, t) * setup;
  if (alfa == 1) return mist == Mistura::Soma ? atual + x - setup : x;
  if (mist == Mistura::Soma) return atual + (x - setup) * alfa;
  if (sai) {
    const double b = mist == Mistura::Setup ? setup : atual;
    return b + (std::abs(x) * sinal(b) - b) * alfa;
  }
  const double b = std::abs(mist == Mistura::Setup ? setup : atual) * sinal(x);
  return b + (x - b) * alfa;
}

// valor absoluto (parametros das restricoes)
inline double absoluto(double atual, double setup, double v, bool antes, double alfa, Mistura mist) {
  if (antes) {
    if (mist == Mistura::Setup) return setup;
    if (mist == Mistura::Primeira) return atual + (setup - atual) * alfa;
    return atual;
  }
  if (alfa == 1) return v;
  if (mist == Mistura::Setup) return setup + (v - setup) * alfa;
  return atual + (v - atual) * alfa;
}

inline bool tem_vertices(TipoParte t) { return t != TipoParte::Regiao && t != TipoParte::Ponto && t != TipoParte::Texto; }

}  // namespace

void Esqueleto::aplicar_osso(const TimelineOsso& to, double t, double alfa, Mistura mist, bool sai) {
  const int k = to.tl.chave(t);
  Local& l = local[size_t(to.osso)];
  const DadosOsso& d = m_->ossos[size_t(to.osso)];
  const Timeline& tl = to.tl;
  switch (to.prop) {
    case PropOsso::Girar: l.rotacao = relativo(l.rotacao, d.rotacao, tl, k, 0, t, alfa, mist); break;
    case PropOsso::Mover:
      l.x = relativo(l.x, d.x, tl, k, 0, t, alfa, mist);
      l.y = relativo(l.y, d.y, tl, k, 1, t, alfa, mist);
      break;
    case PropOsso::MoverX: l.x = relativo(l.x, d.x, tl, k, 0, t, alfa, mist); break;
    case PropOsso::MoverY: l.y = relativo(l.y, d.y, tl, k, 0, t, alfa, mist); break;
    case PropOsso::Escalar:
      l.escala_x = escala(l.escala_x, d.escala_x, tl, k, 0, t, alfa, mist, sai);
      l.escala_y = escala(l.escala_y, d.escala_y, tl, k, 1, t, alfa, mist, sai);
      break;
    case PropOsso::EscalarX: l.escala_x = escala(l.escala_x, d.escala_x, tl, k, 0, t, alfa, mist, sai); break;
    case PropOsso::EscalarY: l.escala_y = escala(l.escala_y, d.escala_y, tl, k, 0, t, alfa, mist, sai); break;
    case PropOsso::Cisalhar:
      l.cisalha_x = relativo(l.cisalha_x, d.cisalha_x, tl, k, 0, t, alfa, mist);
      l.cisalha_y = relativo(l.cisalha_y, d.cisalha_y, tl, k, 1, t, alfa, mist);
      break;
    case PropOsso::CisalharX: l.cisalha_x = relativo(l.cisalha_x, d.cisalha_x, tl, k, 0, t, alfa, mist); break;
    case PropOsso::CisalharY: l.cisalha_y = relativo(l.cisalha_y, d.cisalha_y, tl, k, 0, t, alfa, mist); break;
  }
}

void Esqueleto::aplicar_cor(const TimelineCor& tc, double t, double alfa, Mistura mist) {
  const int k = tc.tl.chave(t);
  Cor& c = slots_[size_t(tc.slot)].cor;
  const Cor& s = m_->slots[size_t(tc.slot)].cor;
  const bool rgb = tc.prop != PropCor::Alfa, a = tc.prop != PropCor::Rgb;
  float v[4] = {c.r, c.g, c.b, c.a};
  const float sv[4] = {s.r, s.g, s.b, s.a};
  const int c0 = rgb ? 0 : 3, c1 = a ? 4 : 3;
  if (k < 0) {
    if (mist == Mistura::Setup) {
      for (int i = c0; i < c1; ++i) v[i] = sv[i];
    } else if (mist == Mistura::Primeira) {
      for (int i = c0; i < c1; ++i) v[i] = float(v[i] + (sv[i] - v[i]) * alfa);
    } else {
      return;
    }
  } else {
    for (int i = c0; i < c1; ++i) {
      const double x = tc.tl.valor(k, i - c0, t);
      if (alfa == 1) {
        v[i] = float(x);
      } else {
        if (mist == Mistura::Setup) v[i] = sv[i];
        v[i] = float(v[i] + (x - v[i]) * alfa);
      }
    }
  }
  // o oraculo limita cada canal a [0, 1] (a bezier pode passar do valor das chaves)
  c.r = std::clamp(v[0], 0.0f, 1.0f);
  c.g = std::clamp(v[1], 0.0f, 1.0f);
  c.b = std::clamp(v[2], 0.0f, 1.0f);
  c.a = std::clamp(v[3], 0.0f, 1.0f);
}

float Efeitos::margem() const {
  float m = 0;
  if (linha()) m = std::max(m, v[LINHA_LARGURA]);
  if (brilho()) m = std::max(m, v[BRILHO_RAIO]);
  return m;
}

void Efeitos::limitar() {
  // o ajuste tem faixas proprias: matiz livre (graus), saturacao e contraste de 0 a 4,
  // luminosidade de -1 a 1, desfoque a partir de 0
  v[AJUSTE_SATURACAO] = std::min(std::max(v[AJUSTE_SATURACAO], 0.0f), 4.0f);
  v[AJUSTE_CONTRASTE] = std::min(std::max(v[AJUSTE_CONTRASTE], 0.0f), 4.0f);
  v[AJUSTE_LUMINOSIDADE] = std::min(std::max(v[AJUSTE_LUMINOSIDADE], -1.0f), 1.0f);
  v[AJUSTE_DESFOQUE] = std::max(v[AJUSTE_DESFOQUE], 0.0f);
  for (int i = 0; i < EFEITO_INICIO[int(TipoEfeito::Ajuste)]; ++i) {
    const bool sem_teto = i == LINHA_LARGURA || i == BRILHO_FORCA || i == BRILHO_RAIO || i == DISSOLVER_GRAO || i == BORRAR_FORCA || i == BORRAR_LIMITE || i == RASTRO_COPIAS || i == RASTRO_INTERVALO;
    v[i] = std::max(v[i], i == DISSOLVER_GRAO ? 1.0f : 0.0f);
    if (!sem_teto) v[i] = std::min(v[i], 1.0f);
  }
}

// como aplicar_cor, para os canais de um efeito
void Esqueleto::aplicar_efeito(const TimelineEfeito& te, double t, double alfa, Mistura mist) {
  const int k = te.tl.chave(t);
  Efeitos& e = slots_[size_t(te.slot)].efeitos;
  const Efeitos& s = m_->slots[size_t(te.slot)].efeitos;
  const int c0 = EFEITO_INICIO[int(te.tipo)], nc = EFEITO_CANAIS[int(te.tipo)];
  if (k < 0) {
    if (mist == Mistura::Setup) {
      for (int i = 0; i < nc; ++i) e.v[c0 + i] = s.v[c0 + i];
    } else if (mist == Mistura::Primeira) {
      for (int i = 0; i < nc; ++i) e.v[c0 + i] = float(e.v[c0 + i] + (s.v[c0 + i] - e.v[c0 + i]) * alfa);
    }
    return;
  }
  for (int i = 0; i < nc; ++i) {
    const double x = te.tl.valor(k, i, t);
    float& v = e.v[c0 + i];
    if (alfa == 1) {
      v = float(x);
    } else {
      if (mist == Mistura::Setup) v = s.v[c0 + i];
      v = float(v + (x - v) * alfa);
    }
  }
  e.limitar();
}

void Esqueleto::luzes_setup() {
  const Modelo& m = *m_;
  luzes_.resize(m.luzes.size());
  for (size_t i = 0; i < m.luzes.size(); ++i) std::copy(m.luzes[i].v, m.luzes[i].v + CANAIS_LUZ, luzes_[i].begin());
  std::copy(m.ambiente, m.ambiente + CANAIS_AMBIENTE, ambiente_);
}

void Esqueleto::aplicar_luz(const TimelineLuz& tl, double t, double alfa, Mistura mist) {
  const Modelo& m = *m_;
  float* v = tl.luz >= 0 ? luzes_[size_t(tl.luz)].data() : ambiente_;
  const float* s = tl.luz >= 0 ? m.luzes[size_t(tl.luz)].v : m.ambiente;
  const int nc = tl.tl.canais;
  const int k = tl.tl.chave(t);
  if (k < 0) {
    if (mist == Mistura::Setup) {
      for (int i = 0; i < nc; ++i) v[i] = s[i];
    } else if (mist == Mistura::Primeira) {
      for (int i = 0; i < nc; ++i) v[i] = float(v[i] + (s[i] - v[i]) * alfa);
    }
    return;
  }
  for (int i = 0; i < nc; ++i) {
    const double x = tl.tl.valor(k, i, t);
    if (alfa == 1) {
      v[i] = float(x);
    } else {
      if (mist == Mistura::Setup) v[i] = s[i];
      v[i] = float(v[i] + (x - v[i]) * alfa);
    }
  }
  limitar_luz(v, nc);
}

void Esqueleto::aplicar_taxa(const TimelineTaxa& tt, double t, double alfa, Mistura mist) {
  const int k = tt.tl.chave(t);
  double& v = emis_[size_t(tt.emissor)].taxa;
  const double s = m_->emissores[size_t(tt.emissor)].taxa;
  if (k < 0) {
    if (mist == Mistura::Setup) v = s;
    else if (mist == Mistura::Primeira) v += (s - v) * alfa;
    return;
  }
  const double x = tt.tl.valor(k, 0, t);
  if (alfa == 1) {
    v = x;
  } else {
    if (mist == Mistura::Setup) v = s;
    v += (x - v) * alfa;
  }
  v = std::max(v, 0.0);
}

void Esqueleto::aplicar_rajada(const TimelineRajada& tr, double de, double ate) {
  int n = 0;
  for (size_t k = 0; k < tr.tempos.size(); ++k) {
    const double t = tr.tempos[k];
    if (ate >= de ? (t > de && t <= ate) : (t > de || t <= ate)) n += tr.quantidades[k];
  }
  emis_[size_t(tr.emissor)].pendentes += n;
}

namespace {
// o hash inteiro dos efeitos (docs/NUCLEO.md "Efeitos"), de 0 a 1
double sorteio(uint32_t i, uint32_t j) {
  uint32_t x = i * 1664525u + j * 1013904223u;
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return double(x) / 4294967295.0;
}
}  // namespace

void Esqueleto::atualizar_particulas() {
  const Modelo& m = *m_;
  for (size_t ie = 0; ie < m.emissores.size(); ++ie) {
    const DadosEmissor& d = m.emissores[ie];
    EstadoEmissor& e = emis_[ie];
    double dt = 0;
    if (e.reiniciar) {
      e.reiniciar = false;
    } else {
      dt = std::max(relogio_ - e.relogio, 0.0);
    }
    e.relogio = relogio_;
    // o raio e a orbita nao tem particulas vivas: sao desenhados do relogio (desenho.cpp)
    if (d.raio || d.orbita) continue;
    // 1 e 2: envelhecer e mover
    if (dt > 0) {
      const double arrasto = std::exp(-d.arrasto * dt);
      size_t n = 0;
      for (Particula& p : e.vivas) {
        p.idade += dt;
        if (p.idade >= p.vida) continue;
        p.vx *= arrasto;
        p.vy = p.vy * arrasto - d.gravidade * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.giro * dt;
        e.vivas[n++] = p;
      }
      e.vivas.resize(n);
    }
    // 3: nascer
    e.acumulado += e.taxa * dt;
    int nascem = int(std::floor(e.acumulado));
    e.acumulado -= nascem;
    nascem += e.pendentes;
    e.pendentes = 0;
    if (nascem <= 0) continue;
    const Matriz& w = mundo_[size_t(d.osso)];
    const double ox = w.a * d.x + w.b * d.y + w.x, oy = w.c * d.x + w.d * d.y + w.y;
    for (int k = 0; k < nascem; ++k) {
      const uint32_t idx = e.nascidas++;
      if (int(e.vivas.size()) >= d.maximo) continue;
      const uint32_t j = d.semente * 8u;
      const double s_vida = sorteio(idx, j), s_vel = sorteio(idx, j + 1), s_dir = sorteio(idx, j + 2), s_giro = sorteio(idx, j + 3);
      const double ang = (d.angulo + (s_dir - 0.5) * d.abertura) * GRAU;
      // a direcao no osso levada ao mundo (so a direcao)
      double dx = w.a * std::cos(ang) + w.b * std::sin(ang), dy = w.c * std::cos(ang) + w.d * std::sin(ang);
      const double len = std::hypot(dx, dy);
      if (len > 1e-9) dx /= len, dy /= len;
      const double vel = d.velocidade[0] + (d.velocidade[1] - d.velocidade[0]) * s_vel;
      Particula p;
      p.x = ox;
      p.y = oy;
      p.vx = dx * vel;
      p.vy = dy * vel;
      p.vida = d.vida[0] + (d.vida[1] - d.vida[0]) * s_vida;
      p.giro = d.giro[0] + (d.giro[1] - d.giro[0]) * s_giro;
      p.fase = sorteio(idx, j + 4);
      if (!d.variacoes.empty()) p.var = std::min(int(sorteio(idx, j + 5) * double(d.variacoes.size())), int(d.variacoes.size()) - 1);
      e.vivas.push_back(p);
    }
  }
}

void Esqueleto::aplicar_deformar(const TimelineDeformar& td, double t, double alfa, Mistura mist) {
  const Modelo& m = *m_;
  EstadoSlot& s = slots_[size_t(td.slot)];
  if (s.parte < 0 || !tem_vertices(m.partes[size_t(s.parte)].tipo) || m.partes[size_t(s.parte)].deform_de != td.parte) return;
  // o deformar guarda deslocamentos: o setup e o vetor zero
  if (s.deform.empty()) mist = Mistura::Setup;
  const int k = td.tl.chave(t);
  const size_t n = td.chaves.empty() ? 0 : td.chaves[0].size();
  if (k < 0) {
    if (mist == Mistura::Setup || (mist == Mistura::Primeira && alfa == 1)) {
      s.deform.clear();
    } else if (mist == Mistura::Primeira) {
      s.deform.resize(n, 0.0);
      for (double& v : s.deform) v *= 1 - alfa;
    }
    return;
  }
  const std::vector<double>& a = td.chaves[size_t(k)];
  const bool ultima = size_t(k) + 1 >= td.chaves.size();
  const double f = ultima ? 0 : td.tl.fracao(k, t);
  const std::vector<double>* b = ultima ? nullptr : &td.chaves[size_t(k) + 1];
  auto valor = [&](size_t i) { return b ? a[i] + ((*b)[i] - a[i]) * f : a[i]; };
  if (s.deform.size() != n) s.deform.assign(n, 0.0);
  if (alfa == 1) {
    if (mist == Mistura::Soma)
      for (size_t i = 0; i < n; ++i) s.deform[i] += valor(i);
    else
      for (size_t i = 0; i < n; ++i) s.deform[i] = valor(i);
    return;
  }
  switch (mist) {
    case Mistura::Setup:
      for (size_t i = 0; i < n; ++i) s.deform[i] = valor(i) * alfa;
      break;
    case Mistura::Primeira:
    case Mistura::Substitui:
      for (size_t i = 0; i < n; ++i) s.deform[i] += (valor(i) - s.deform[i]) * alfa;
      break;
    case Mistura::Soma:
      for (size_t i = 0; i < n; ++i) s.deform[i] += valor(i) * alfa;
      break;
  }
}

void Esqueleto::aplicar_ordem(const TimelineOrdem& to, double t, Mistura mist, bool sai) {
  auto do_setup = [&] {
    for (size_t i = 0; i < ordem_.size(); ++i) ordem_[i] = int(i);
  };
  if (sai) {
    if (mist == Mistura::Setup) do_setup();
    return;
  }
  int k = -1;
  for (size_t i = 0; i < to.tempos.size() && to.tempos[i] <= t; ++i) k = int(i);
  if (k < 0) {
    if (mist == Mistura::Setup || mist == Mistura::Primeira) do_setup();
    return;
  }
  if (to.ordens[size_t(k)].empty()) do_setup();
  else ordem_ = to.ordens[size_t(k)];
}

void Esqueleto::aplicar_restricao(const TimelineRestricao& tr, double t, double alfa, Mistura mist, bool sai) {
  const Modelo& m = *m_;
  const int k = tr.tl.chave(t);
  const bool antes = k < 0;
  auto um = [&](int c) { return antes ? 0.0 : tr.tl.valor(k, c, t); };
  auto aplica = [&](EstadoRestricao& e, const DadosRestricao& d) {
    auto abs = [&](double& v, double setup, double x) { v = absoluto(v, setup, x, antes, alfa, mist); };
    switch (tr.prop) {
      case PropRestricao::IkMix: {
        abs(e.mix, d.ik.mix, um(0));
        abs(e.suavidade, d.ik.suavidade, um(1));
        // os logicos: do setup antes da primeira chave e saindo de um mix desde o setup
        const bool do_setup = antes ? (mist == Mistura::Setup || mist == Mistura::Primeira) : (mist == Mistura::Setup && sai);
        const bool da_chave = !antes && !sai;
        if (do_setup) e.dobra = d.ik.dobra, e.comprime = d.ik.comprime, e.estica = d.ik.estica;
        else if (da_chave) e.dobra = tr.dobra[size_t(k)], e.comprime = tr.comprime[size_t(k)], e.estica = tr.estica[size_t(k)];
        break;
      }
      case PropRestricao::TransfMix:
        abs(e.mix_girar, d.transf.mix_girar, um(0));
        abs(e.mix_x, d.transf.mix_x, um(1));
        abs(e.mix_y, d.transf.mix_y, um(2));
        abs(e.mix_escala_x, d.transf.mix_escala_x, um(3));
        abs(e.mix_escala_y, d.transf.mix_escala_y, um(4));
        abs(e.mix_cisalha_y, d.transf.mix_cisalha_y, um(5));
        break;
      case PropRestricao::CaminhoPosicao: abs(e.posicao, d.caminho.posicao, um(0)); break;
      case PropRestricao::CaminhoEspacamento: abs(e.espacamento, d.caminho.espacamento, um(0)); break;
      case PropRestricao::CaminhoMix:
        abs(e.mix_girar, d.caminho.mix_girar, um(0));
        abs(e.mix_x, d.caminho.mix_x, um(1));
        abs(e.mix_y, d.caminho.mix_y, um(2));
        break;
      case PropRestricao::FisicaInercia: abs(e.inercia, d.fisica.inercia, um(0)); break;
      case PropRestricao::FisicaForca: abs(e.forca, d.fisica.forca, um(0)); break;
      case PropRestricao::FisicaAmortecimento: abs(e.amortecimento, d.fisica.amortecimento, um(0)); break;
      case PropRestricao::FisicaMassa: abs(e.massa_inv, d.fisica.massa_inv, antes || um(0) == 0 ? 0.0 : 1.0 / um(0)); break;
      case PropRestricao::FisicaVento: abs(e.vento, d.fisica.vento, um(0)); break;
      case PropRestricao::FisicaGravidade: abs(e.gravidade, d.fisica.gravidade, um(0)); break;
      case PropRestricao::FisicaMix: abs(e.mix, d.fisica.mix, um(0)); break;
      case PropRestricao::FisicaReiniciar: break;  // TODO: reiniciar no tempo da chave
      case PropRestricao::SliderTempo: abs(e.tempo, d.slider.tempo, um(0)); break;
      case PropRestricao::SliderMix: abs(e.mix, d.slider.mix, um(0)); break;
    }
  };
  if (tr.restricao >= 0) {
    aplica(rest_[size_t(tr.restricao)], m.restricoes[size_t(tr.restricao)]);
  } else {
    for (size_t r = 0; r < m.restricoes.size(); ++r)
      if (m.restricoes[r].tipo == TipoRestricao::Fisica) aplica(rest_[r], m.restricoes[r]);
  }
}

int Esqueleto::parte_no_tempo(const TimelineParte& tp, double t, bool* antes) const {
  int k = -1;
  for (size_t i = 0; i < tp.tempos.size() && tp.tempos[i] <= t; ++i) k = int(i);
  if (antes) *antes = k < 0;
  if (k < 0) return parte_setup(tp.slot);
  return tp.nomes[size_t(k)] < 0 ? -1 : m_->parte_de(skin_, tp.slot, tp.nomes[size_t(k)]);
}

int Esqueleto::parte_setup(int si) const { return m_->parte_de(skin_, si, m_->slots[size_t(si)].parte_setup); }

int Esqueleto::parte(int si, std::string_view nome) const { return m_->parte_de(skin_, si, m_->id_parte(nome)); }

void Esqueleto::mudar_parte(int si, int p) {
  EstadoSlot& s = slots_[size_t(si)];
  if (p == s.parte) return;
  const Modelo& m = *m_;
  const bool mesma_deform = p >= 0 && s.parte >= 0 && tem_vertices(m.partes[size_t(p)].tipo) && tem_vertices(m.partes[size_t(s.parte)].tipo) &&
                            m.partes[size_t(p)].deform_de == m.partes[size_t(s.parte)].deform_de;
  if (!mesma_deform) s.deform.clear();
  s.parte = p;
}

void Esqueleto::aplicar(int ai, double tempo, bool loop) {
  const Modelo& m = *m_;
  devolver_slider();
  // volta ao setup local, dos slots, da ordem e dos parametros das restricoes (a fisica
  // guarda a memoria dela)
  for (size_t i = 0; i < m.ossos.size(); ++i) {
    const DadosOsso& d = m.ossos[i];
    local[i] = Local{d.x, d.y, d.rotacao, d.escala_x, d.escala_y, d.cisalha_x, d.cisalha_y};
  }
  for (size_t i = 0; i < m.slots.size(); ++i) {
    ordem_[i] = int(i);
    slots_[i].cor = m.slots[i].cor;
    slots_[i].efeitos = m.slots[i].efeitos;
    mudar_parte(int(i), parte_setup(int(i)));
  }
  luzes_setup();
  for (size_t r = 0; r < m.restricoes.size(); ++r) {
    const DadosRestricao& d = m.restricoes[r];
    EstadoRestricao& e = rest_[r];
    switch (d.tipo) {
      case TipoRestricao::IK:
        e.mix = d.ik.mix, e.suavidade = d.ik.suavidade, e.dobra = d.ik.dobra;
        e.comprime = d.ik.comprime, e.estica = d.ik.estica;
        break;
      case TipoRestricao::Transformacao:
        e.mix_girar = d.transf.mix_girar, e.mix_x = d.transf.mix_x, e.mix_y = d.transf.mix_y;
        e.mix_escala_x = d.transf.mix_escala_x, e.mix_escala_y = d.transf.mix_escala_y;
        e.mix_cisalha_y = d.transf.mix_cisalha_y;
        break;
      case TipoRestricao::Caminho:
        e.mix_girar = d.caminho.mix_girar, e.mix_x = d.caminho.mix_x, e.mix_y = d.caminho.mix_y;
        e.posicao = d.caminho.posicao, e.espacamento = d.caminho.espacamento;
        break;
      case TipoRestricao::Fisica:
        e.inercia = d.fisica.inercia, e.forca = d.fisica.forca, e.amortecimento = d.fisica.amortecimento;
        e.massa_inv = d.fisica.massa_inv, e.vento = d.fisica.vento, e.gravidade = d.fisica.gravidade;
        e.mix = d.fisica.mix;
        break;
      case TipoRestricao::Slider:
        e.mix = d.slider.mix, e.tempo = d.slider.tempo;
        break;
    }
  }
  for (size_t i = 0; i < m.emissores.size(); ++i) emis_[i].taxa = m.emissores[i].taxa;
  instancias_setup();
  // o deformar vem todo da animacao
  for (EstadoSlot& s : slots_) s.deform.clear();
  if (ai < 0 || ai >= int(m.animacoes.size())) {
    ultima_anim_ = -1;
    return;
  }
  const Animacao& an = m.animacoes[size_t(ai)];
  double t = tempo;
  if (loop && an.duracao > 0) t = std::fmod(t, an.duracao);
  // rajadas desde a ultima vez (na primeira, desde antes do 0)
  if (!sem_rajadas_) {
    const double de = ai == ultima_anim_ ? ultimo_tempo_ : -1;
    if (!(ai == ultima_anim_ && t == ultimo_tempo_))
      for (const TimelineRajada& tr : an.rajadas) aplicar_rajada(tr, de, t);
    ultima_anim_ = ai;
    ultimo_tempo_ = t;
  }
  for (const TimelineTaxa& tt : an.taxas) aplicar_taxa(tt, t, 1, Mistura::Setup);
  for (const TimelineLuz& tl : an.luzes) aplicar_luz(tl, t, 1, Mistura::Setup);

  // a mesma ordem do Estado: partes (o deformar so vale para a parte que o slot mostra), cores,
  // ossos, restricoes, deformar, ordem de desenho
  for (const TimelineParte& tp : an.partes) mudar_parte(tp.slot, parte_no_tempo(tp, t, nullptr));
  for (const TimelineCor& tc : an.cores) aplicar_cor(tc, t, 1, Mistura::Setup);
  for (const TimelineEfeito& te : an.efeitos) aplicar_efeito(te, t, 1, Mistura::Setup);
  for (const TimelineOsso& to : an.ossos) aplicar_osso(to, t, 1, Mistura::Setup, false);
  for (const TimelineRestricao& tr : an.restricoes) aplicar_restricao(tr, t, 1, Mistura::Setup, false);
  for (const TimelineDeformar& td : an.deformar) aplicar_deformar(td, t, 1, Mistura::Setup);
  for (const TimelineOrdem& to : an.ordem) aplicar_ordem(to, t, Mistura::Setup, false);
  for (const TimelineInstancia& ti : an.instancias) aplicar_instancia(ti, t, Mistura::Setup, false);
}

// ---- instancias (docs/NUCLEO.md "Instancias")

void Esqueleto::aplicar_cruzado(int de, double tempo_de, bool loop_de, int para, double tempo_para, bool loop_para, double alfa) {
  if (alfa >= 1) return aplicar(para, tempo_para, loop_para);
  // a pose da que sai (sem rajadas), guardada
  sem_rajadas_ = true;
  aplicar(de, tempo_de, loop_de);
  sem_rajadas_ = false;
  const std::vector<Local> l_de = local;
  const std::vector<EstadoSlot> s_de = slots_;
  const std::vector<int> o_de = ordem_;
  const auto luz_de = luzes_;
  float amb_de[CANAIS_AMBIENTE];
  std::copy(ambiente_, ambiente_ + CANAIS_AMBIENTE, amb_de);
  std::vector<double> taxa_de(emis_.size());
  for (size_t i = 0; i < emis_.size(); ++i) taxa_de[i] = emis_[i].taxa;
  const std::vector<EstadoRestricao> r_de = rest_;
  // a que entra, e a mistura
  aplicar(para, tempo_para, loop_para);
  const double a = std::max(0.0, alfa);
  auto mix = [a](double x, double y) { return x + (y - x) * a; };
  for (size_t i = 0; i < local.size(); ++i) {
    Local& l = local[i];
    const Local& d = l_de[i];
    double dr = std::fmod(l.rotacao - d.rotacao, 360.0);
    if (dr > 180) dr -= 360;
    if (dr < -180) dr += 360;
    l.rotacao = d.rotacao + dr * a;
    l.x = mix(d.x, l.x), l.y = mix(d.y, l.y);
    l.escala_x = mix(d.escala_x, l.escala_x), l.escala_y = mix(d.escala_y, l.escala_y);
    l.cisalha_x = mix(d.cisalha_x, l.cisalha_x), l.cisalha_y = mix(d.cisalha_y, l.cisalha_y);
  }
  for (size_t i = 0; i < slots_.size(); ++i) {
    EstadoSlot& s = slots_[i];
    const EstadoSlot& d = s_de[i];
    s.cor = Cor{float(mix(d.cor.r, s.cor.r)), float(mix(d.cor.g, s.cor.g)), float(mix(d.cor.b, s.cor.b)), float(mix(d.cor.a, s.cor.a))};
    for (int c = 0; c < CANAIS_EFEITOS; ++c) s.efeitos.v[c] = float(mix(d.efeitos.v[c], s.efeitos.v[c]));
    // a imagem e a ordem trocam no meio da mistura; o deformar mistura se for da mesma imagem
    if (a < 0.5 && d.parte != s.parte) {
      mudar_parte(int(i), d.parte);
      s.deform = d.deform;
    } else if (d.parte == s.parte && d.deform.size() == s.deform.size()) {
      for (size_t k = 0; k < s.deform.size(); ++k) s.deform[k] = mix(d.deform[k], s.deform[k]);
    } else if (d.parte == s.parte && s.deform.empty() && !d.deform.empty()) {
      s.deform = d.deform;
      for (double& v : s.deform) v *= 1 - a;
    }
  }
  if (a < 0.5) ordem_ = o_de;
  for (size_t i = 0; i < luzes_.size(); ++i)
    for (int c = 0; c < CANAIS_LUZ; ++c) luzes_[i][size_t(c)] = float(mix(luz_de[i][size_t(c)], luzes_[i][size_t(c)]));
  for (int c = 0; c < CANAIS_AMBIENTE; ++c) ambiente_[c] = float(mix(amb_de[c], ambiente_[c]));
  for (size_t i = 0; i < emis_.size(); ++i) emis_[i].taxa = mix(taxa_de[i], emis_[i].taxa);
  for (size_t i = 0; i < rest_.size(); ++i) {
    EstadoRestricao& r = rest_[i];
    const EstadoRestricao& d = r_de[i];
    for (auto campo : {&EstadoRestricao::mix, &EstadoRestricao::suavidade, &EstadoRestricao::mix_girar, &EstadoRestricao::mix_x, &EstadoRestricao::mix_y, &EstadoRestricao::mix_escala_x,
                       &EstadoRestricao::mix_escala_y, &EstadoRestricao::mix_cisalha_y, &EstadoRestricao::posicao, &EstadoRestricao::espacamento, &EstadoRestricao::inercia,
                       &EstadoRestricao::forca, &EstadoRestricao::amortecimento, &EstadoRestricao::massa_inv, &EstadoRestricao::vento, &EstadoRestricao::gravidade})
      r.*campo = mix(d.*campo, r.*campo);
  }
}

void Esqueleto::instancias_setup() {
  for (size_t i = 0; i < inst_.size(); ++i) {
    const DadosInstancia& d = m_->instancias[i];
    EstadoInstancia& in = inst_[i];
    in.animacao = d.animacao;
    in.inicio = d.inicio;
    in.velocidade = d.velocidade;
    in.laco = d.laco;
    in.segue_inst = d.segue_inst, in.segue_osso = d.segue_osso;
    in.por_timeline = false;
  }
}

void Esqueleto::aplicar_instancia(const TimelineInstancia& ti, double t, Mistura mist, bool sai) {
  if (sai) return;
  int k = -1;
  for (size_t i = 0; i < ti.tempos.size() && ti.tempos[i] <= t; ++i) k = int(i);
  EstadoInstancia& in = inst_[size_t(ti.instancia)];
  if (k < 0) {
    if (mist == Mistura::Setup || mist == Mistura::Primeira) {
      const DadosInstancia& d = m_->instancias[size_t(ti.instancia)];
      in.animacao = d.animacao, in.inicio = d.inicio, in.velocidade = d.velocidade, in.laco = d.laco;
      in.segue_inst = d.segue_inst, in.segue_osso = d.segue_osso;
      in.por_timeline = false;
    }
    return;
  }
  const size_t c = size_t(k);
  in.animacao = ti.animacoes[c];
  in.inicio = ti.inicios[c];
  in.velocidade = ti.velocidades[c];
  in.laco = ti.lacos[c] != 0;
  in.segue_inst = ti.segue_insts[c], in.segue_osso = ti.segue_ossos[c];
  in.tempo_filho = in.inicio + in.velocidade * (t - ti.tempos[c]);
  in.por_timeline = true;
  // mistura: a chave tem mix, comecou ha menos que ele e troca a animacao; a anterior continua no
  // tempo dela
  in.mix_alfa = 1;
  const double passou = t - ti.tempos[c];
  if (c > 0 && ti.mixes[c] > 0 && passou < ti.mixes[c] && ti.animacoes[c - 1] != ti.animacoes[c]) {
    in.mix_animacao = ti.animacoes[c - 1];
    in.mix_tempo = ti.inicios[c - 1] + ti.velocidades[c - 1] * (t - ti.tempos[c - 1]);
    in.mix_laco = ti.lacos[c - 1] != 0;
    in.mix_alfa = passou / ti.mixes[c];
  }
}

void Esqueleto::avancar(double dt) {
  relogio_ = f32(relogio_ + dt);
  for (EstadoInstancia& in : inst_) in.e->avancar(dt * in.velocidade);
}

// cada instancia visivel: a base (o osso vezes a posicao da instancia), a animacao do filho no
// tempo dele e o mundo do filho. Filho sem memoria no mesmo instante e lugar: nada a refazer
void Esqueleto::atualizar_instancias() {
  const Modelo& m = *m_;
  for (size_t i = 0; i < inst_.size(); ++i) {
    const DadosInstancia& d = m.instancias[i];
    EstadoInstancia& in = inst_[i];
    const bool por_tl = in.por_timeline;
    in.por_timeline = false;
    const double alfa = por_tl ? in.mix_alfa : 1;
    in.mix_alfa = 1;
    if (slots_[size_t(d.slot)].cor.a <= 0) continue;
    // o osso da instancia, ou o de outra instancia (ja calculada: vem antes na lista)
    const Matriz& w = in.segue_inst >= 0 ? inst_[size_t(in.segue_inst)].e->mundo()[size_t(in.segue_osso)] : mundo_[size_t(d.osso)];
    const double r = d.rotacao * GRAU;
    const double la = std::cos(r) * d.escala_x, lb = -std::sin(r) * d.escala_y;
    const double lc = std::sin(r) * d.escala_x, ld = std::cos(r) * d.escala_y;
    Matriz b;
    b.a = w.a * la + w.b * lc;
    b.b = w.a * lb + w.b * ld;
    b.c = w.c * la + w.d * lc;
    b.d = w.c * lb + w.d * ld;
    b.x = w.a * d.x + w.b * d.y + w.x;
    b.y = w.c * d.x + w.d * d.y + w.y;
    Esqueleto& f = *in.e;
    double t = por_tl ? in.tempo_filho : in.inicio + in.velocidade * relogio_;
    const Modelo& fm = f.modelo();
    if (in.animacao >= 0) {
      const double dur = fm.animacoes[size_t(in.animacao)].duracao;
      if (in.laco && dur > 0) {
        t = std::fmod(t, dur);
        if (t < 0) t += dur;
      } else {
        t = std::min(std::max(t, 0.0), dur);
      }
    } else {
      t = 0;
    }
    const double nb[6] = {b.a, b.b, b.c, b.d, b.x, b.y};
    if (alfa >= 1 && fm.sem_memoria && in.pronto && in.ultima_anim == in.animacao && in.ultimo_t == t && std::equal(nb, nb + 6, in.ultima_base)) continue;
    f.base = b;
    if (alfa < 1) {
      // a anterior no tempo dela (no laco dela ou no limite), misturada com a nova
      double td = in.mix_tempo;
      if (in.mix_animacao >= 0) {
        const double dd = fm.animacoes[size_t(in.mix_animacao)].duracao;
        if (in.mix_laco && dd > 0) td = std::fmod(td, dd), td += td < 0 ? dd : 0;
        else td = std::min(std::max(td, 0.0), dd);
      } else {
        td = 0;
      }
      f.aplicar_cruzado(in.mix_animacao, td, false, in.animacao, t, false, alfa);
      in.pronto = false;  // a mistura nao entra no atalho
    } else {
      f.aplicar(in.animacao, t, false);
    }
    f.atualizar_mundo();
    in.pronto = alfa >= 1;
    in.ultima_anim = in.animacao;
    in.ultimo_t = t;
    in.ultimo_alfa = alfa;
    std::copy(nb, nb + 6, in.ultima_base);
  }
}

void Esqueleto::mundo_osso(int i) {
  const Modelo& m = *m_;
  const Local& l = local[size_t(i)];
  const double rx = (l.rotacao + l.cisalha_x) * GRAU;
  const double ry = (l.rotacao + 90 + l.cisalha_y) * GRAU;
  const double la = std::cos(rx) * l.escala_x, lb = std::cos(ry) * l.escala_y;
  const double lc = std::sin(rx) * l.escala_x, ld = std::sin(ry) * l.escala_y;
  Matriz& w = mundo_[size_t(i)];
  const int pai = m.ossos[size_t(i)].pai;
  if (pai < 0) {
    if (!tem_base) {
      w = Matriz{la, lb, lc, ld, l.x, l.y};
      return;
    }
    // raiz de uma instancia: no mundo do pai pela base
    const Matriz& p = base;
    w.a = p.a * la + p.b * lc;
    w.b = p.a * lb + p.b * ld;
    w.c = p.c * la + p.d * lc;
    w.d = p.c * lb + p.d * ld;
    w.x = p.a * l.x + p.b * l.y + p.x;
    w.y = p.c * l.x + p.d * l.y + p.y;
    return;
  }
  const Matriz& p = mundo_[size_t(pai)];
  w.x = p.a * l.x + p.b * l.y + p.x;
  w.y = p.c * l.x + p.d * l.y + p.y;
  const Heranca h = m.ossos[size_t(i)].heranca;
  if (h == Heranca::SemEscala || h == Heranca::SemEscalaOuReflexo) {
    // sem a escala do pai (docs/NUCLEO.md, "Mundo"): o eixo x do osso e a direcao que a
    // rotacao local tem no mundo do pai, normalizada; o eixo y e o perpendicular (+90 graus),
    // invertido se o pai espelha (so em SemEscala). Escala e cisalha locais por cima.
    const double r = l.rotacao * GRAU;
    double za = p.a * std::cos(r) + p.b * std::sin(r);
    double zc = p.c * std::cos(r) + p.d * std::sin(r);
    const double s = std::sqrt(za * za + zc * zc);
    if (s > 0.00001) za /= s, zc /= s;
    const double sinal = (h == Heranca::SemEscala && p.a * p.d - p.b * p.c < 0) ? -1 : 1;
    const double ry2 = std::atan2(zc, za) + 90 * GRAU;
    const double zb = std::cos(ry2) * sinal, zd = std::sin(ry2) * sinal;
    const double hx = l.cisalha_x * GRAU, hy = (90 + l.cisalha_y) * GRAU;
    const double sa = std::cos(hx) * l.escala_x, sb = std::cos(hy) * l.escala_y;
    const double sc = std::sin(hx) * l.escala_x, sd = std::sin(hy) * l.escala_y;
    w.a = za * sa + zb * sc;
    w.b = za * sb + zb * sd;
    w.c = zc * sa + zd * sc;
    w.d = zc * sb + zd * sd;
    return;
  }
  w.a = p.a * la + p.b * lc;
  w.b = p.a * lb + p.b * ld;
  w.c = p.c * la + p.d * lc;
  w.d = p.c * lb + p.d * ld;
}

// ---- tela (docs/NUCLEO.md "Tela")

void Esqueleto::janela(double largura, double altura) {
  if (largura == janela_w_ && altura == janela_h_) return;
  janela_w_ = largura > 0 ? largura : 0;
  janela_h_ = altura > 0 ? altura : 0;
  calcular_vista();
  tela_sujo_ = true;
}

void Esqueleto::calcular_vista() {
  const DadosTela& t = m_->tela;
  const double bw = t.largura, bh = t.altura;
  if (!(janela_w_ > 0 && janela_h_ > 0) || !(bw > 0 && bh > 0)) {
    // sem janela (ou sem arte base): a arte inteira, 1 pixel por unidade
    vista_ = Vista{1, t.x, t.y, bw, bh};
    return;
  }
  const double sx = janela_w_ / bw, sy = janela_h_ / bh;
  double s = 1;
  switch (t.encaixe) {
    case Encaixe::Caber: s = std::min(sx, sy); break;
    case Encaixe::Cobrir: s = std::max(sx, sy); break;
    case Encaixe::Largura: s = sx; break;
    case Encaixe::Altura: s = sy; break;
  }
  // a janela inteira, em unidades do mundo, com o meio dela no meio da arte
  vista_.escala = s;
  vista_.largura = janela_w_ / s;
  vista_.altura = janela_h_ / s;
  vista_.x = t.x + (bw - vista_.largura) / 2;
  vista_.y = t.y + (bh - vista_.altura) / 2;
}

void Esqueleto::calcular_tela() {
  tela_sujo_ = false;
  correcao_.clear();
  lin0_.clear();
  lin1_.clear();
  const Modelo& m = *m_;
  const DadosTela& t = m.tela;
  // so o boneco de cima: o filho de uma instancia segue o osso do pai
  if (t.ancoras.empty() || tem_base || !(t.largura > 0 && t.altura > 0)) return;
  const Vista& v = vista_;
  if (v.largura == t.largura && v.altura == t.altura && v.x == t.x && v.y == t.y) return;
  const int n = int(m.ossos.size());
  // o mundo do setup (sem animacao nem restricoes) com a arte base: onde cada osso esta nela
  std::vector<Local> guardado = local;
  for (int i = 0; i < n; ++i) {
    const DadosOsso& d = m.ossos[size_t(i)];
    local[size_t(i)] = Local{d.x, d.y, d.rotacao, d.escala_x, d.escala_y, d.cisalha_x, d.cisalha_y};
  }
  for (int i = 0; i < n; ++i) mundo_osso(i);
  const std::vector<Matriz> base0 = mundo_;
  const double kx = v.largura / t.largura, ky = v.altura / t.altura;
  // em ordem de hierarquia: o osso ancorado vai para o alvo; o resto acompanha o pai
  size_t k = 0;
  for (int i = 0; i < n; ++i) {
    if (k >= t.ancoras.size() || t.ancoras[k].osso != i) {
      mundo_osso(i);
      continue;
    }
    const DadosAncora& a = t.ancoras[k++];
    const Matriz& w0 = base0[size_t(i)];
    // a fracao da janela onde o osso se prende (x da esquerda, y de cima); esticando, a do proprio
    // osso na arte
    const double fx = a.estica_x ? (w0.x - t.x) / t.largura : a.x;
    const double fy = a.estica_y ? (t.y + t.altura - w0.y) / t.altura : a.y;
    // o ponto da ancora na vista menos o mesmo ponto na arte: o deslocamento ate ele nao muda
    Matriz alvo = w0;
    alvo.x = w0.x + (v.x - t.x) + fx * (v.largura - t.largura);
    alvo.y = w0.y + (v.y - t.y) + (1 - fy) * (v.altura - t.altura);
    if (a.estica_x) alvo.a *= kx, alvo.b *= kx;
    if (a.estica_y) alvo.c *= ky, alvo.d *= ky;
    // cobrir sem deformar: a caixa em volta do alvo, escalada por igual (nunca menos que a arte)
    // ate cobrir a vista; um lado em que o ponto do osso nao fica dentro da caixa nao conta
    double cobre = 1;
    if (a.cobre) {
      const double esq = w0.x - a.cobre_x, dir = a.cobre_x + a.cobre_largura - w0.x;
      const double baixo = w0.y - a.cobre_y, cima = a.cobre_y + a.cobre_altura - w0.y;
      if (esq > 0) cobre = std::max(cobre, (alvo.x - v.x) / esq);
      if (dir > 0) cobre = std::max(cobre, (v.x + v.largura - alvo.x) / dir);
      if (baixo > 0) cobre = std::max(cobre, (alvo.y - v.y) / baixo);
      if (cima > 0) cobre = std::max(cobre, (v.y + v.altura - alvo.y) / cima);
      alvo.a *= cobre, alvo.b *= cobre, alvo.c *= cobre, alvo.d *= cobre;
    }
    const DadosOsso& d = m.ossos[size_t(i)];
    Local nl = local[size_t(i)];
    const int pai = d.pai;
    const bool pai_igual = pai < 0 || (mundo_[size_t(pai)].a == base0[size_t(pai)].a && mundo_[size_t(pai)].b == base0[size_t(pai)].b &&
                                       mundo_[size_t(pai)].c == base0[size_t(pai)].c && mundo_[size_t(pai)].d == base0[size_t(pai)].d);
    if (!a.estica_x && !a.estica_y && cobre == 1 && pai_igual) {
      // so a posicao: o ponto no espaco do pai
      if (pai < 0) nl.x = alvo.x, nl.y = alvo.y;
      else {
        const Matriz& p = mundo_[size_t(pai)];
        const double det = p.a * p.d - p.b * p.c;
        const double dx = alvo.x - p.x, dy = alvo.y - p.y;
        nl.x = (p.d * dx - p.b * dy) / det;
        nl.y = (-p.c * dx + p.a * dy) / det;
      }
    } else if (d.heranca == Heranca::Normal) {
      mundo_[size_t(i)] = alvo;
      nl = local_de_mundo(i);
    } else {
      // heranca diferente da normal: a decomposicao nao inverte o mundo; so a posicao
      mundo_[size_t(i)] = alvo;
      const Local q = local_de_mundo(i);
      nl.x = q.x, nl.y = q.y;
    }
    const Local& s0 = local[size_t(i)];
    Correcao c{i, Local{nl.x - s0.x, nl.y - s0.y, nl.rotacao - s0.rotacao, s0.escala_x != 0 ? nl.escala_x / s0.escala_x : 1,
                        s0.escala_y != 0 ? nl.escala_y / s0.escala_y : 1, nl.cisalha_x - s0.cisalha_x, nl.cisalha_y - s0.cisalha_y}};
    correcao_.push_back(c);
    local[size_t(i)] = nl;
    mundo_osso(i);
  }
  local.swap(guardado);
  // nove-fatias: a parte linear do mundo de setup na arte base e corrigido (o esticar da janela)
  if (!m.fatias.empty()) {
    lin0_.resize(size_t(n) * 4);
    lin1_.resize(size_t(n) * 4);
    for (int i = 0; i < n; ++i) {
      const Matriz &a = base0[size_t(i)], &b = mundo_[size_t(i)];
      double* l0 = &lin0_[size_t(i) * 4];
      double* l1 = &lin1_[size_t(i) * 4];
      l0[0] = a.a, l0[1] = a.b, l0[2] = a.c, l0[3] = a.d;
      l1[0] = b.a, l1[1] = b.b, l1[2] = b.c, l1[3] = b.d;
    }
  }
}

void Esqueleto::atualizar_mundo() {
  const Modelo& m = *m_;
  const int n = int(m.ossos.size());
  if (tela_sujo_) {
    calcular_tela();
    if (!m.fatias.empty()) refazer_fatias();
  }
  // as restricoes de IK e de transformacao (alvo local) mexem na pose local para recalcular o
  // mundo; no fim a pose local volta a de antes delas (a animada). Sem isso, com o Estado (que
  // nao volta ao setup a cada quadro), o que a restricao fez num quadro ficava para o seguinte
  // e somava: IK com mix 0,5 chegava ao alvo inteiro em poucos quadros
  antes_ = local;
  // a correcao da tela (calculada no setup) vale por cima da pose animada, so neste calculo
  for (const Correcao& c : correcao_) {
    Local& l = local[size_t(c.osso)];
    l.x += c.d.x, l.y += c.d.y, l.rotacao += c.d.rotacao;
    l.escala_x *= c.d.escala_x, l.escala_y *= c.d.escala_y;
    l.cisalha_x += c.d.cisalha_x, l.cisalha_y += c.d.cisalha_y;
  }
  for (int i = 0; i < n; ++i) mundo_osso(i);
  for (size_t r = 0; r < m.restricoes.size(); ++r) {
    const DadosRestricao& d = m.restricoes[r];
    if (d.so_skin) {
      const auto& lst = m.skins[size_t(skin_)].restricoes;
      if (std::find(lst.begin(), lst.end(), int(r)) == lst.end()) continue;
    }
    switch (d.tipo) {
      case TipoRestricao::IK: restricao_ik(int(r)); break;
      case TipoRestricao::Caminho: restricao_caminho(int(r)); break;
      case TipoRestricao::Fisica: restricao_fisica(int(r)); break;
      case TipoRestricao::Transformacao: restricao_transformacao(int(r)); break;
      case TipoRestricao::Slider: restricao_slider(int(r)); break;
    }
    for (int o : descendentes_[r]) mundo_osso(o);
  }
  local.swap(antes_);
  atualizar_particulas();
  if (!inst_.empty()) atualizar_instancias();
  atualizar_geleia();
  // borrar: os vertices deste relogio; o do relogio anterior vira o `ant` quando o relogio anda
  // (varios atualizar_mundo no mesmo relogio so trocam o atual). Relogio que volta: sem anterior
  for (size_t i = 0; i < slots_.size(); ++i) {
    EstadoSlot& s = slots_[i];
    if (!s.efeitos.borrar()) {
      if (s.borrar_t >= 0) s.borrar_atual.clear(), s.borrar_ant.clear(), s.borrar_t = s.borrar_t_ant = -1;
      continue;
    }
    if (s.borrar_t != relogio_) {
      if (s.borrar_t >= 0 && relogio_ > s.borrar_t) {
        s.borrar_ant.swap(s.borrar_atual);
        s.borrar_t_ant = s.borrar_t;
      } else {
        s.borrar_ant.clear();
        s.borrar_t_ant = -1;
      }
    }
    vertices(int(i), s.borrar_atual);
    s.borrar_t = relogio_;
  }
  // rastro: um quadro por relogio (o mesmo relogio de novo so troca o ultimo); relogio que volta
  // apaga; fica so o que as copias ainda podem pedir (o mais novo antes de agora - copias x
  // intervalo e os seguintes)
  for (size_t i = 0; i < slots_.size(); ++i) {
    EstadoSlot& s = slots_[i];
    if (!s.efeitos.rastro()) {
      s.rastro.clear();
      continue;
    }
    auto& q = s.rastro;
    if (!q.empty() && relogio_ < q.back().first) q.clear();
    if (q.empty() || relogio_ > q.back().first) q.emplace_back(relogio_, std::vector<double>());
    vertices(int(i), q.back().second);
    const double corte = relogio_ - s.efeitos.copias() * double(s.efeitos.v[RASTRO_INTERVALO]);
    size_t primeiro = 0;
    while (primeiro + 1 < q.size() && q[primeiro + 1].first <= corte) ++primeiro;
    if (primeiro) q.erase(q.begin(), q.begin() + std::ptrdiff_t(primeiro));
  }
}

void Esqueleto::copias_rastro(int slot, size_t n, std::vector<CopiaRastro>& out) const {
  out.clear();
  const EstadoSlot& s = slots_[size_t(slot)];
  if (!s.efeitos.rastro() || s.rastro.size() < 2) return;
  const int c = s.efeitos.copias();
  const double agora = s.rastro.back().first, intervalo = s.efeitos.v[RASTRO_INTERVALO], alfa = s.efeitos.v[RASTRO_ALFA];
  for (int k = c; k >= 1; --k) {
    // o quadro mais novo com relogio ate agora - k x intervalo
    const double alvo = agora - k * intervalo;
    const std::vector<double>* xy = nullptr;
    for (const auto& [t, v] : s.rastro) {
      if (t > alvo + 1e-9) break;
      xy = &v;
    }
    if (!xy || xy->size() != n) continue;
    out.push_back({xy, float(alfa * (c - k + 1) / c)});
  }
}

bool Esqueleto::borrar(int slot, double* xy, size_t n, float* esmaece) const {
  const EstadoSlot& s = slots_[size_t(slot)];
  const Efeitos& ef = s.efeitos;
  if (!ef.borrar() || s.borrar_t_ant < 0 || s.borrar_ant.size() != n || n < 2) return false;
  const double dt = s.borrar_t - s.borrar_t_ant;
  if (!(dt > 0) || dt > 0.25) return false;  // parado ou um salto (pausa, troca de cena)
  const double forca = ef.v[BORRAR_FORCA], limite = ef.v[BORRAR_LIMITE], esm = ef.v[BORRAR_ESMAECER];
  const size_t nv = n / 2;
  // deslocamento de cada vertice: a velocidade vezes a forca, no maximo `limite`
  std::vector<double> d(n);
  double mx = 0, my = 0, cx = 0, cy = 0;
  for (size_t i = 0; i < nv; ++i) {
    double dx = (xy[i * 2] - s.borrar_ant[i * 2]) / dt * forca, dy = (xy[i * 2 + 1] - s.borrar_ant[i * 2 + 1]) / dt * forca;
    const double l = std::hypot(dx, dy);
    if (l > limite) dx *= limite / l, dy *= limite / l;
    d[i * 2] = dx, d[i * 2 + 1] = dy;
    mx += dx, my += dy, cx += xy[i * 2], cy += xy[i * 2 + 1];
  }
  // o sentido do movimento (a media) e quanto cada vertice esta na traseira: 0 do centro para a
  // frente, 1 no vertice mais atras
  const double ml = std::hypot(mx, my);
  if (ml < 1e-9) return false;
  const double ux = mx / ml, uy = my / ml;
  cx /= double(nv), cy /= double(nv);
  double atras = 0;
  for (size_t i = 0; i < nv; ++i) atras = std::max(atras, -((xy[i * 2] - cx) * ux + (xy[i * 2 + 1] - cy) * uy));
  if (!(atras > 0)) return false;
  for (size_t i = 0; i < nv; ++i) {
    const double w = std::clamp(-((xy[i * 2] - cx) * ux + (xy[i * 2 + 1] - cy) * uy) / atras, 0.0, 1.0);
    xy[i * 2] -= w * d[i * 2];
    xy[i * 2 + 1] -= w * d[i * 2 + 1];
    if (esmaece) esmaece[i] = float(esm * w * std::min(1.0, std::hypot(d[i * 2], d[i * 2 + 1]) / limite));
  }
  return true;
}

Local Esqueleto::local_de_mundo(int i) const {
  // decompoe o mundo do osso relativo ao pai em rotacao, escala e cisalha (cisalha_x = 0)
  const Modelo& m = *m_;
  const Matriz& w = mundo_[size_t(i)];
  const int pai = m.ossos[size_t(i)].pai;
  Matriz l = w;
  // a raiz de uma instancia tem a base como pai
  if (pai >= 0 || tem_base) {
    const Matriz& p = pai >= 0 ? mundo_[size_t(pai)] : base;
    const double det = p.a * p.d - p.b * p.c;
    const double ia = p.d / det, ib = -p.b / det, ic = -p.c / det, id = p.a / det;
    const double dx = w.x - p.x, dy = w.y - p.y;
    l.x = ia * dx + ib * dy;
    l.y = ic * dx + id * dy;
    l.a = ia * w.a + ib * w.c;
    l.b = ia * w.b + ib * w.d;
    l.c = ic * w.a + id * w.c;
    l.d = ic * w.b + id * w.d;
  }
  Local r;
  r.x = l.x;
  r.y = l.y;
  r.cisalha_x = 0;
  r.escala_x = std::sqrt(l.a * l.a + l.c * l.c);
  if (r.escala_x > 1e-4) {
    const double det = l.a * l.d - l.b * l.c;
    r.escala_y = std::copysign(std::sqrt(l.b * l.b + l.d * l.d), det);
    r.cisalha_y = -std::atan2(l.a * l.b + l.c * l.d, det) * RAD;
    r.rotacao = std::atan2(l.c, l.a) * RAD;
  } else {
    r.escala_x = 0;
    r.escala_y = std::sqrt(l.b * l.b + l.d * l.d);
    r.cisalha_y = 0;
    r.rotacao = 90 - std::atan2(l.d, l.b) * RAD;
  }
  return r;
}

void Esqueleto::mundo_para_local(int i) {
  // so na heranca normal, onde local_de_mundo inverte mundo_osso; nas outras o osso fica com a
  // pose local de antes (nenhum personagem medido junta as duas coisas)
  if (m_->ossos[size_t(i)].heranca == Heranca::Normal) local[size_t(i)] = local_de_mundo(i);
}

void Esqueleto::vertices_geometria(int si, const Parte& p, double* out) const {
  const EstadoSlot& s = slots_[size_t(si)];
  const bool def = !s.deform.empty() && int(s.deform.size()) == p.tamanho_deform();
  if (!p.pesada()) {
    const Matriz& w = mundo_[size_t(m_->slots[size_t(si)].osso)];
    const double* v = p.vertices.data();
    const double* dv = def ? s.deform.data() : nullptr;
    for (int i = 0; i < p.num_vertices; ++i) {
      double x = v[i * 2], y = v[i * 2 + 1];
      if (dv) x += dv[i * 2], y += dv[i * 2 + 1];
      out[i * 2] = w.a * x + w.b * y + w.x;
      out[i * 2 + 1] = w.c * x + w.d * y + w.y;
    }
    return;
  }
  const double* dv = def ? s.deform.data() : nullptr;
  for (int i = 0; i < p.num_vertices; ++i) {
    double ox = 0, oy = 0;
    for (int e = p.pesos_inicio[size_t(i)]; e < p.pesos_inicio[size_t(i) + 1]; ++e) {
      const Matriz& w = mundo_[size_t(p.pesos_osso[size_t(e)])];
      double x = p.pesos_xyp[size_t(e) * 3], y = p.pesos_xyp[size_t(e) * 3 + 1];
      const double peso = p.pesos_xyp[size_t(e) * 3 + 2];
      if (dv) x += dv[e * 2], y += dv[e * 2 + 1];
      ox += (w.a * x + w.b * y + w.x) * peso;
      oy += (w.c * x + w.d * y + w.y) * peso;
    }
    out[i * 2] = ox;
    out[i * 2 + 1] = oy;
  }
}

void Esqueleto::imagem_texto(int k, const double ret[4], const float uv[4]) {
  if (k < 0 || size_t(k) >= textos_.size()) return;
  const DadosTexto& t = m_->textos[size_t(k)];
  Parte& p = textos_[size_t(k)];
  // o retangulo pela transformacao da parte (escala, rotacao, posicao), na ordem dos cantos da
  // regiao: baixo-esquerda, cima-esquerda, cima-direita, baixo-direita
  const double rot = t.rotacao * GRAU, cs = std::cos(rot), sn = std::sin(rot);
  const double px[4] = {ret[0], ret[0], ret[2], ret[2]}, py[4] = {ret[1], ret[3], ret[3], ret[1]};
  for (int i = 0; i < 4; ++i) {
    const double x = px[i] * t.escala_x, y = py[i] * t.escala_y;
    p.cantos[i * 2] = t.x + x * cs - y * sn;
    p.cantos[i * 2 + 1] = t.y + x * sn + y * cs;
  }
  // uv dos cantos: o de baixo e o v1
  p.uvs = {uv[0], uv[3], uv[0], uv[1], uv[2], uv[1], uv[2], uv[3]};
  p.pagina = int(m_->paginas_desenho.size());
}

void Esqueleto::sem_imagem_texto(int k) {
  if (k < 0 || size_t(k) >= textos_.size()) return;
  Parte& p = textos_[size_t(k)];
  const Parte& o = m_->partes[size_t(m_->textos[size_t(k)].parte)];
  std::copy(o.cantos, o.cantos + 8, p.cantos);
  p.uvs.clear();
  p.pagina = -1;
}

// ---- nove-fatias (docs/NUCLEO.md "Nove-fatias")

namespace {

// os pontos (destino d na parte, origem s na imagem) e os pedacos (pares de pontos) de um eixo
struct EixoFatias {
  std::vector<double> d, s;
  std::vector<int> pedacos;
};

void eixo_fatias(double tam, double mE, double mD, double L, double e, ModoFatia modo, double p0, double p1, EixoFatias& out) {
  out.d.clear(), out.s.clear(), out.pedacos.clear();
  if (!(L > 0) || !(tam > 0)) return;
  struct Pedaco {
    double d0, d1, s0, s1;
  };
  Pedaco pc[2 * 64 + 4];
  int np = 0;
  double cE = e > 0 ? mE / e : mE, cD = e > 0 ? mD / e : mD;
  if (cE + cD > L) {
    const double k = L / (cE + cD);
    cE *= k, cD *= k;
  }
  const double dl = -L / 2, dr = L / 2;
  if (mE > 0 && cE > 0) pc[np++] = {dl, dl + cE, 0, std::min(mE, tam)};
  const double a = dl + cE, b = dr - cD, vao = b - a;
  const double s0 = std::min(mE, tam), s1 = std::max(s0, tam - mD), mo = s1 - s0;
  if (vao > 0) {
    if (!(mo > 0) || modo == ModoFatia::Esticar) {
      pc[np++] = {a, b, s0, s1};
    } else {
      const double peca = e > 0 ? mo / e : mo;
      bool caber = modo == ModoFatia::RepetirCaber;
      long n = caber ? std::max(1L, std::lround(vao / peca)) : long(std::ceil(vao / peca - 1e-9));
      if (n < 1) n = 1;
      if (n > 64) n = 64, caber = true;
      for (long k = 0; k < n; ++k) {
        if (caber) {
          pc[np++] = {a + vao * double(k) / double(n), k + 1 == n ? b : a + vao * double(k + 1) / double(n), s0, s1};
        } else {
          const double d0 = a + double(k) * peca, d1 = k + 1 == n ? b : d0 + peca;
          pc[np++] = {d0, d1, s0, k + 1 == n ? s0 + (d1 - d0) / peca * mo : s1};
        }
      }
    }
  }
  if (mD > 0 && cD > 0) pc[np++] = {b, dr, std::max(0.0, tam - mD), tam};
  // o corte do atlas: so ha pixels em [p0, p1] da origem
  for (int k = 0; k < np; ++k) {
    Pedaco q = pc[k];
    const double c0 = std::max(q.s0, p0), c1 = std::min(q.s1, p1);
    if (q.s1 > q.s0) {
      if (!(c1 > c0)) continue;
      const double f = (q.d1 - q.d0) / (q.s1 - q.s0);
      if (c0 != q.s0) q.d0 = q.d0 + (c0 - q.s0) * f;
      if (c1 != q.s1) q.d1 = pc[k].d0 + (c1 - pc[k].s0) * f;
      q.s0 = c0, q.s1 = c1;
    } else if (q.s0 < p0 || q.s0 > p1) {
      continue;
    }
    if (!(q.d1 > q.d0)) continue;
    int i0;
    if (!out.d.empty() && out.d.back() == q.d0 && out.s.back() == q.s0) i0 = int(out.d.size()) - 1;
    else {
      i0 = int(out.d.size());
      out.d.push_back(q.d0), out.s.push_back(q.s0);
    }
    out.d.push_back(q.d1), out.s.push_back(q.s1);
    out.pedacos.push_back(i0), out.pedacos.push_back(int(out.d.size()) - 1);
  }
}

}  // namespace

void Esqueleto::medida_texto(int k, double largura, double altura) {
  if (k < 0 || size_t(k) * 2 + 1 >= medidas_.size()) return;
  largura = largura > 0 ? largura : 0, altura = altura > 0 ? altura : 0;
  if (medidas_[size_t(k) * 2] == largura && medidas_[size_t(k) * 2 + 1] == altura) return;
  medidas_[size_t(k) * 2] = largura;
  medidas_[size_t(k) * 2 + 1] = altura;
  for (size_t i = 0; i < m_->fatias.size(); ++i)
    if (m_->fatias[i].texto == k) refazer_fatia(i);
}

void Esqueleto::refazer_fatias() {
  for (size_t i = 0; i < fatiadas_.size(); ++i) refazer_fatia(i);
}

void Esqueleto::refazer_fatia(size_t i) {
  const Modelo& m = *m_;
  const DadosFatias& d = m.fatias[i];
  const Parte& o = m.partes[size_t(d.parte)];
  Parte& p = fatiadas_[i];
  Fatiada& fi = fatiadas_info_[i];
  // o tamanho: o base, ou o do texto acompanhado mais o respiro
  double L = d.caixa_l, A = d.caixa_a;
  if (d.texto >= 0) {
    const DadosTexto& t = m.textos[size_t(d.texto)];
    const double tl = medidas_[size_t(d.texto) * 2], ta = medidas_[size_t(d.texto) * 2 + 1];
    if (tl > 0 && d.escala_x != 0) L = std::max(L, tl * std::abs(t.escala_x / d.escala_x) + 2 * d.respiro_x);
    if (ta > 0 && d.escala_y != 0) A = std::max(A, ta * std::abs(t.escala_y / d.escala_y) + 2 * d.respiro_y);
  }
  // o esticar da janela: os eixos da regiao no osso pelo mundo corrigido e pelo da arte base
  const double rot = d.rotacao * GRAU, cs = std::cos(rot), sn = std::sin(rot);
  double ex = 1, ey = 1;
  if (!lin0_.empty()) {
    const size_t b = size_t(m.slots[size_t(o.slot)].osso) * 4;
    const double* l0 = &lin0_[b];
    const double* l1 = &lin1_[b];
    auto comp = [](const double* l, double x, double y) { return std::hypot(l[0] * x + l[1] * y, l[2] * x + l[3] * y); };
    const double ux = cs * d.escala_x, uy = sn * d.escala_x, vx = -sn * d.escala_y, vy = cs * d.escala_y;
    const double a0 = comp(l0, ux, uy), b0 = comp(l0, vx, vy);
    if (a0 > 0) ex = comp(l1, ux, uy) / a0;
    if (b0 > 0) ey = comp(l1, vx, vy) / b0;
  }
  fi.largura = L, fi.altura = A, fi.ex = ex, fi.ey = ey;
  EixoFatias X, Y;
  eixo_fatias(d.largura, d.esquerda, d.direita, L, ex, d.eixo_x, d.p0x, d.p1x, X);
  eixo_fatias(d.altura, d.baixo, d.cima, A, ey, d.eixo_y, d.p0y, d.p1y, Y);
  const int nx = int(X.d.size()), ny = int(Y.d.size());
  if (nx < 2 || ny < 2) {
    fi.nx = fi.ny = 0;
    p.num_vertices = 0;
    p.vertices.clear(), p.uvs.clear(), p.triangulos.clear();
    return;
  }
  fi.nx = nx, fi.ny = ny;
  p.num_vertices = nx * ny;
  p.vertices.resize(size_t(nx * ny) * 2);
  const bool com_uv = o.uvs.size() == 8;
  p.uvs.resize(com_uv ? size_t(nx * ny) * 2 : 0);
  const double pw = d.p1x - d.p0x, ph = d.p1y - d.p0y;
  for (int iy = 0; iy < ny; ++iy)
    for (int ix = 0; ix < nx; ++ix) {
      const size_t v = size_t(iy * nx + ix) * 2;
      const double lx = X.d[size_t(ix)] * d.escala_x, ly = Y.d[size_t(iy)] * d.escala_y;
      p.vertices[v] = d.x + lx * cs - ly * sn;
      p.vertices[v + 1] = d.y + lx * sn + ly * cs;
      if (!com_uv) continue;
      const double fu = pw > 0 ? (X.s[size_t(ix)] - d.p0x) / pw : 0, fv = ph > 0 ? (Y.s[size_t(iy)] - d.p0y) / ph : 0;
      // os uvs da regiao: baixo-esquerda, cima-esquerda, cima-direita, baixo-direita
      const float* u = o.uvs.data();
      p.uvs[v] = float(u[0] + fu * (u[6] - u[0]) + fv * (u[2] - u[0]));
      p.uvs[v + 1] = float(u[1] + fu * (u[7] - u[1]) + fv * (u[3] - u[1]));
    }
  p.triangulos.clear();
  for (size_t j = 0; j + 1 < Y.pedacos.size(); j += 2)
    for (size_t k = 0; k + 1 < X.pedacos.size(); k += 2) {
      const int ya = Y.pedacos[j], yb = Y.pedacos[j + 1], xa = X.pedacos[k], xb = X.pedacos[k + 1];
      const uint16_t be = uint16_t(ya * nx + xa), ce = uint16_t(yb * nx + xa), cd = uint16_t(yb * nx + xb), bd = uint16_t(ya * nx + xb);
      p.triangulos.insert(p.triangulos.end(), {be, ce, cd, cd, bd, be});
    }
}

size_t Esqueleto::cantos_fatias(int si, std::vector<double>& out) const {
  const EstadoSlot& s = slots_[size_t(si)];
  if (s.parte < 0) return 0;
  const int f = m_->partes[size_t(s.parte)].fatias;
  if (f < 0) return 0;
  const Fatiada& fi = fatiadas_info_[size_t(f)];
  if (fi.nx < 2 || fi.ny < 2) return 0;
  const Parte& p = fatiadas_[size_t(f)];
  const Matriz& w = mundo_[size_t(m_->slots[size_t(si)].osso)];
  const int idx[4] = {0, (fi.ny - 1) * fi.nx, fi.ny * fi.nx - 1, fi.nx - 1};
  out.resize(8);
  for (int c = 0; c < 4; ++c) {
    const double x = p.vertices[size_t(idx[c]) * 2], y = p.vertices[size_t(idx[c]) * 2 + 1];
    out[size_t(c) * 2] = w.a * x + w.b * y + w.x + s.segue_dx;
    out[size_t(c) * 2 + 1] = w.c * x + w.d * y + w.y + s.segue_dy;
  }
  return 8;
}

size_t Esqueleto::vertices(int si, std::vector<double>& out) const {
  const EstadoSlot& s = slots_[size_t(si)];
  if (s.parte < 0) return 0;
  const Parte& p = parte_desenho(s.parte);
  if (p.fatias >= 0 && p.tipo == TipoParte::Malha) {
    // a grade da regiao fatiada: no osso, sem deformar
    out.resize(size_t(p.num_vertices) * 2);
    const Matriz& w = mundo_[size_t(m_->slots[size_t(si)].osso)];
    for (size_t k = 0; k < out.size(); k += 2) {
      const double x = p.vertices[k], y = p.vertices[k + 1];
      out[k] = w.a * x + w.b * y + w.x + s.segue_dx;
      out[k + 1] = w.c * x + w.d * y + w.y + s.segue_dy;
    }
    return out.size();
  }
  if (p.tipo == TipoParte::Regiao) {
    out.resize(8);
    const Matriz& w = mundo_[size_t(m_->slots[size_t(si)].osso)];
    for (int i = 0; i < 4; ++i) {
      const double x = p.cantos[i * 2], y = p.cantos[i * 2 + 1];
      out[size_t(i) * 2] = w.a * x + w.b * y + w.x + s.segue_dx;
      out[size_t(i) * 2 + 1] = w.c * x + w.d * y + w.y + s.segue_dy;
    }
    return 8;
  }
  if (p.tipo == TipoParte::Malha || p.tipo == TipoParte::MalhaLigada) {
    out.resize(size_t(p.num_vertices) * 2);
    // malha mole: a saida da geleia (do mesmo relogio e da mesma parte)
    if (s.geleia_parte == s.parte && s.geleia_xy.size() == out.size()) std::copy(s.geleia_xy.begin(), s.geleia_xy.end(), out.begin());
    else vertices_geometria(si, p, out.data());
    if (s.segue_dx != 0 || s.segue_dy != 0)
      for (size_t k = 0; k < out.size(); k += 2) out[k] += s.segue_dx, out[k + 1] += s.segue_dy;
    return out.size();
  }
  return 0;
}

// Geleia (docs/NUCLEO.md "Geleia"): cada vertice da malha mole e uma massa puxada por uma mola
// para onde o rig o poe e pelos vizinhos (a diferenca entre eles volta a do rig). Integra em passos
// fixos de 1/120 s pelo relogio do esqueleto, com o alvo andando em linha reta do relogio anterior
// ao atual. Relogio que volta, salto de mais de 0,25 s ou parte trocada: volta ao rig, parada
void Esqueleto::atualizar_geleia() {
  const Modelo& m = *m_;
  for (EstadoSlot& s : slots_) s.segue_dx = s.segue_dy = 0;
  for (size_t si = 0; si < slots_.size(); ++si) {
    EstadoSlot& s = slots_[si];
    const Parte* p = s.parte >= 0 ? &m.partes[size_t(s.parte)] : nullptr;
    if (!p || p->tipo != TipoParte::Malha || !p->geleia.ativa) {
      if (s.geleia_parte >= 0) s.geleia_p.clear(), s.geleia_v.clear(), s.geleia_alvo.clear(), s.geleia_xy.clear(), s.geleia_parte = -1, s.geleia_t = -1;
      continue;
    }
    const Geleia& g = p->geleia;
    const size_t n = size_t(p->num_vertices) * 2;
    std::vector<double>& alvo = tmp_;
    alvo.resize(n);
    vertices_geometria(int(si), *p, alvo.data());
    const double dt = relogio_ - s.geleia_t;
    if (s.geleia_parte != s.parte || s.geleia_p.size() != n || s.geleia_t < 0 || dt < 0 || dt > 0.25) {
      s.geleia_p = alvo;
      s.geleia_v.assign(n, 0);
      s.geleia_alvo = alvo;
      s.geleia_sobra = 0;
      s.geleia_parte = s.parte;
      // quem segue: o centro de cada slot agora, no triangulo que o contem (ou no mais perto)
      s.geleia_seguem.clear();
      std::vector<double> xy;
      for (int sg : g.seguem) {
        const size_t nv = vertices(sg, xy);
        if (!nv) continue;
        double cx = 0, cy = 0;
        for (size_t k = 0; k < nv; k += 2) cx += xy[k], cy += xy[k + 1];
        cx /= double(nv / 2), cy /= double(nv / 2);
        EstadoSlot::Seguidor best{sg, -1, 0, 0, 0};
        double fora = 1e300;
        for (size_t t = 0; t + 2 < p->triangulos.size(); t += 3) {
          const size_t a = size_t(p->triangulos[t]) * 2, b = size_t(p->triangulos[t + 1]) * 2, c = size_t(p->triangulos[t + 2]) * 2;
          const double det = (alvo[b + 1] - alvo[c + 1]) * (alvo[a] - alvo[c]) + (alvo[c] - alvo[b]) * (alvo[a + 1] - alvo[c + 1]);
          if (std::abs(det) < 1e-12) continue;
          const double l1 = ((alvo[b + 1] - alvo[c + 1]) * (cx - alvo[c]) + (alvo[c] - alvo[b]) * (cy - alvo[c + 1])) / det;
          const double l2 = ((alvo[c + 1] - alvo[a + 1]) * (cx - alvo[c]) + (alvo[a] - alvo[c]) * (cy - alvo[c + 1])) / det;
          const double l3 = 1 - l1 - l2;
          const double f = -std::min({l1, l2, l3});
          if (f < fora) fora = f, best = {sg, int(t), l1, l2, l3};
        }
        if (best.tri >= 0) s.geleia_seguem.push_back(best);
      }
    } else if (dt > 0) {
      const double h = 1.0 / 120;
      const double perda = std::exp(-g.amortecimento * h);
      double feito = 0;
      s.geleia_sobra += dt;
      std::vector<double>& P = s.geleia_p;
      std::vector<double>& V = s.geleia_v;
      std::vector<double> a(n), t(n);
      while (s.geleia_sobra >= h) {
        s.geleia_sobra -= h;
        feito += h;
        // o alvo deste passo: entre o do relogio anterior e o de agora
        const double f = std::min(1.0, feito / dt);
        for (size_t k = 0; k < n; ++k) t[k] = s.geleia_alvo[k] + (alvo[k] - s.geleia_alvo[k]) * f;
        for (size_t k = 0; k < n; k += 2) {
          a[k] = g.rigidez * (t[k] - P[k]);
          a[k + 1] = g.rigidez * (t[k + 1] - P[k + 1]) - g.gravidade;
        }
        for (size_t e = 0; e + 1 < g.arestas.size(); e += 2) {
          const size_t i = size_t(g.arestas[e]) * 2, j = size_t(g.arestas[e + 1]) * 2;
          const double dx = g.contagio * ((t[i] - t[j]) - (P[i] - P[j]));
          const double dy = g.contagio * ((t[i + 1] - t[j + 1]) - (P[i + 1] - P[j + 1]));
          a[i] += dx, a[i + 1] += dy;
          a[j] -= dx, a[j + 1] -= dy;
        }
        for (size_t k = 0; k < n; k += 2) {
          // preso (moleza 0): fica no rig e segura os vizinhos
          if (g.moleza[k / 2] <= 0) {
            P[k] = t[k], P[k + 1] = t[k + 1], V[k] = V[k + 1] = 0;
            continue;
          }
          V[k] = (V[k] + a[k] / g.massa * h) * perda;
          V[k + 1] = (V[k + 1] + a[k + 1] / g.massa * h) * perda;
          P[k] += V[k] * h;
          P[k + 1] += V[k + 1] * h;
        }
      }
      s.geleia_alvo = alvo;
    } else {
      // o relogio parado (um filho congelado, o editor pausado arrastando ossos): a massa anda com
      // o rig, guardando o desvio que tinha (sem isso ela ficava parada no mundo e o corpo
      // entortava quando o pai mexia)
      std::vector<double>& P = s.geleia_p;
      for (size_t k = 0; k < n; ++k) P[k] += alvo[k] - s.geleia_alvo[k];
      s.geleia_alvo = alvo;
    }
    s.geleia_t = relogio_;
    // a saida: o rig mais o desvio da massa, na medida da moleza de cada vertice
    s.geleia_xy.resize(n);
    for (size_t k = 0; k < n; k += 2) {
      const double w = g.moleza[k / 2];
      s.geleia_xy[k] = alvo[k] + (s.geleia_p[k] - alvo[k]) * w;
      s.geleia_xy[k + 1] = alvo[k + 1] + (s.geleia_p[k + 1] - alvo[k + 1]) * w;
    }
    // quem segue anda com o deslocamento da malha no ponto dele
    for (const EstadoSlot::Seguidor& sg : s.geleia_seguem) {
      const size_t a = size_t(p->triangulos[size_t(sg.tri)]) * 2, b = size_t(p->triangulos[size_t(sg.tri) + 1]) * 2, c = size_t(p->triangulos[size_t(sg.tri) + 2]) * 2;
      EstadoSlot& f = slots_[size_t(sg.slot)];
      f.segue_dx += sg.b0 * (s.geleia_xy[a] - alvo[a]) + sg.b1 * (s.geleia_xy[b] - alvo[b]) + sg.b2 * (s.geleia_xy[c] - alvo[c]);
      f.segue_dy += sg.b0 * (s.geleia_xy[a + 1] - alvo[a + 1]) + sg.b1 * (s.geleia_xy[b + 1] - alvo[b + 1]) + sg.b2 * (s.geleia_xy[c + 1] - alvo[c + 1]);
    }
  }
}

}  // namespace mamulengo
