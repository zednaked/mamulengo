// Pose: aplicar animacao (docs/NUCLEO.md "Pose local", "Slots"), mundo dos ossos ("Mundo",
// "Ordem de atualizacao") e vertices ("Partes e vertices").
#include "mamulengo/pose.h"

#include <algorithm>
#include <cmath>

namespace mamulengo {

Esqueleto::Esqueleto(std::shared_ptr<const Modelo> modelo) : m_(std::move(modelo)) {
  const Modelo& m = *m_;
  local.resize(m.ossos.size());
  mundo_.resize(m.ossos.size());
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

void Esqueleto::setup() {
  const Modelo& m = *m_;
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
  }
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

inline bool tem_vertices(TipoParte t) { return t != TipoParte::Regiao && t != TipoParte::Ponto; }

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
  for (int i = 0; i < CANAIS_EFEITOS; ++i) {
    const bool sem_teto = i == LINHA_LARGURA || i == BRILHO_FORCA || i == BRILHO_RAIO;
    v[i] = std::max(v[i], 0.0f);
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
    }
  }
  for (size_t i = 0; i < m.emissores.size(); ++i) emis_[i].taxa = m.emissores[i].taxa;
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
  const double de = ai == ultima_anim_ ? ultimo_tempo_ : -1;
  if (!(ai == ultima_anim_ && t == ultimo_tempo_))
    for (const TimelineRajada& tr : an.rajadas) aplicar_rajada(tr, de, t);
  ultima_anim_ = ai;
  ultimo_tempo_ = t;
  for (const TimelineTaxa& tt : an.taxas) aplicar_taxa(tt, t, 1, Mistura::Setup);

  // a mesma ordem do Estado: partes (o deformar so vale para a parte que o slot mostra), cores,
  // ossos, restricoes, deformar, ordem de desenho
  for (const TimelineParte& tp : an.partes) mudar_parte(tp.slot, parte_no_tempo(tp, t, nullptr));
  for (const TimelineCor& tc : an.cores) aplicar_cor(tc, t, 1, Mistura::Setup);
  for (const TimelineEfeito& te : an.efeitos) aplicar_efeito(te, t, 1, Mistura::Setup);
  for (const TimelineOsso& to : an.ossos) aplicar_osso(to, t, 1, Mistura::Setup, false);
  for (const TimelineRestricao& tr : an.restricoes) aplicar_restricao(tr, t, 1, Mistura::Setup, false);
  for (const TimelineDeformar& td : an.deformar) aplicar_deformar(td, t, 1, Mistura::Setup);
  for (const TimelineOrdem& to : an.ordem) aplicar_ordem(to, t, Mistura::Setup, false);
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
    w = Matriz{la, lb, lc, ld, l.x, l.y};
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

void Esqueleto::atualizar_mundo() {
  const Modelo& m = *m_;
  const int n = int(m.ossos.size());
  // as restricoes de IK e de transformacao (alvo local) mexem na pose local para recalcular o
  // mundo; no fim a pose local volta a de antes delas (a animada). Sem isso, com o Estado (que
  // nao volta ao setup a cada quadro), o que a restricao fez num quadro ficava para o seguinte
  // e somava: IK com mix 0,5 chegava ao alvo inteiro em poucos quadros
  antes_ = local;
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
    }
    for (int o : descendentes_[r]) mundo_osso(o);
  }
  local.swap(antes_);
  atualizar_particulas();
}

Local Esqueleto::local_de_mundo(int i) const {
  // decompoe o mundo do osso relativo ao pai em rotacao, escala e cisalha (cisalha_x = 0)
  const Modelo& m = *m_;
  const Matriz& w = mundo_[size_t(i)];
  const int pai = m.ossos[size_t(i)].pai;
  Matriz l = w;
  if (pai >= 0) {
    const Matriz& p = mundo_[size_t(pai)];
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

size_t Esqueleto::vertices(int si, std::vector<double>& out) const {
  const EstadoSlot& s = slots_[size_t(si)];
  if (s.parte < 0) return 0;
  const Parte& p = m_->partes[size_t(s.parte)];
  if (p.tipo == TipoParte::Regiao) {
    out.resize(8);
    const Matriz& w = mundo_[size_t(m_->slots[size_t(si)].osso)];
    for (int i = 0; i < 4; ++i) {
      const double x = p.cantos[i * 2], y = p.cantos[i * 2 + 1];
      out[size_t(i) * 2] = w.a * x + w.b * y + w.x;
      out[size_t(i) * 2 + 1] = w.c * x + w.d * y + w.y;
    }
    return 8;
  }
  if (p.tipo == TipoParte::Malha || p.tipo == TipoParte::MalhaLigada) {
    out.resize(size_t(p.num_vertices) * 2);
    vertices_geometria(si, p, out.data());
    return out.size();
  }
  return 0;
}

}  // namespace mamulengo
