// Papeis dos elementos (docs/NUCLEO.md "Papeis"): a area de toque e os estados dos botoes.
#include "mamulengo/papeis.h"

#include <algorithm>
#include <cmath>

namespace mamulengo {

namespace {

// a parte do slot conta para a area? (visivel, de um tipo com caixa)
bool conta(const Esqueleto& e, const DadosPapel& d, int s) {
  const EstadoSlot& es = e.slots()[size_t(s)];
  if (es.parte < 0 || !(es.cor.a > 0)) return false;
  if (!e.ativo(e.modelo().slots[size_t(s)].osso)) return false;
  const TipoParte t = e.modelo().partes[size_t(es.parte)].tipo;
  if (t == TipoParte::Texto) return d.area_texto;
  return t == TipoParte::Regiao || t == TipoParte::Malha || t == TipoParte::MalhaLigada;
}

void quad(std::vector<double>& tri, const double* v) {
  // (0, 1, 2) e (2, 3, 0): a ordem dos cantos da regiao
  tri.insert(tri.end(), {v[0], v[1], v[2], v[3], v[4], v[5], v[4], v[5], v[6], v[7], v[0], v[1]});
}

bool dentro(const double* t, double x, double y) {
  const double d1 = (x - t[2]) * (t[1] - t[3]) - (t[0] - t[2]) * (y - t[3]);
  const double d2 = (x - t[4]) * (t[3] - t[5]) - (t[2] - t[4]) * (y - t[5]);
  const double d3 = (x - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (y - t[1]);
  const bool neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

}  // namespace

int area_papel(const Esqueleto& e, int k, std::vector<double>& tri) {
  tri.clear();
  const Modelo& m = e.modelo();
  const DadosPapel& d = m.papeis[size_t(k)];
  if (d.osso < 0 || !e.ativo(d.osso)) return -1;
  // a posicao de cada slot na ordem de desenho
  const std::vector<int>& ordem = e.ordem();
  auto posicao = [&](int s) {
    for (size_t i = 0; i < ordem.size(); ++i)
      if (ordem[i] == s) return int(i);
    return -1;
  };
  int topo = -1;
  std::vector<double> v;
  for (int s : d.slots_area) {
    if (d.tem_caixa) {
      // a caixa: a posicao do slot mais alto do grupo que aparece
      if (e.slots()[size_t(s)].parte >= 0 && e.slots()[size_t(s)].cor.a > 0) topo = std::max(topo, posicao(s));
      continue;
    }
    if (!conta(e, d, s)) continue;
    const size_t antes = tri.size();
    if (e.cantos_fatias(s, v) == 8) quad(tri, v.data());
    else {
      const size_t n = e.vertices(s, v);
      const Parte& p = e.parte_desenho(e.slots()[size_t(s)].parte);
      if (p.tipo == TipoParte::Regiao || p.tipo == TipoParte::Texto) {
        if (n == 8) quad(tri, v.data());
      } else
        for (size_t t = 0; t + 2 < p.triangulos.size(); t += 3) {
          const size_t a = p.triangulos[t], b = p.triangulos[t + 1], c = p.triangulos[t + 2];
          if ((std::max({a, b, c}) + 1) * 2 > n) continue;
          tri.insert(tri.end(), {v[a * 2], v[a * 2 + 1], v[b * 2], v[b * 2 + 1], v[c * 2], v[c * 2 + 1]});
        }
    }
    if (tri.size() > antes) topo = std::max(topo, posicao(s));
  }
  if (d.tem_caixa) {
    const Matriz& w = e.mundo()[size_t(d.osso)];
    const double l = d.caixa_x - d.caixa_l / 2, r = d.caixa_x + d.caixa_l / 2, b = d.caixa_y - d.caixa_a / 2, t = d.caixa_y + d.caixa_a / 2;
    const double c[8] = {l, b, l, t, r, t, r, b};
    double q[8];
    for (int i = 0; i < 4; ++i) {
      q[i * 2] = w.a * c[i * 2] + w.b * c[i * 2 + 1] + w.x;
      q[i * 2 + 1] = w.c * c[i * 2] + w.d * c[i * 2 + 1] + w.y;
    }
    quad(tri, q);
  }
  return topo;
}

bool caixa_papel(const Esqueleto& e, int k, double out[4]) {
  std::vector<double> tri;
  area_papel(e, k, tri);
  if (tri.empty()) return false;
  out[0] = out[2] = tri[0];
  out[1] = out[3] = tri[1];
  for (size_t i = 0; i < tri.size(); i += 2) {
    out[0] = std::min(out[0], tri[i]), out[2] = std::max(out[2], tri[i]);
    out[1] = std::min(out[1], tri[i + 1]), out[3] = std::max(out[3], tri[i + 1]);
  }
  return true;
}

int papel_no_ponto(const Esqueleto& e, double x, double y) {
  const Modelo& m = e.modelo();
  if (!std::isfinite(x) || !std::isfinite(y)) return -1;
  int melhor = -1, melhor_pos = -2;
  std::vector<double> tri;
  for (int k = 0; k < int(m.papeis.size()); ++k) {
    if (m.papeis[size_t(k)].tipo == TipoPapel::Texto) continue;
    const int pos = area_papel(e, k, tri);
    bool acertou = false;
    for (size_t t = 0; t + 6 <= tri.size() && !acertou; t += 6) acertou = dentro(&tri[t], x, y);
    // o de cima na ordem de desenho; empatando, o que vem depois na lista
    if (acertou && pos >= melhor_pos) melhor = k, melhor_pos = pos;
  }
  return melhor;
}

// ---- os estados dos botoes

Interface::Interface(std::shared_ptr<const Modelo> m) : m_(std::move(m)) {
  desligado_.resize(m_->papeis.size());
  estado_.assign(m_->papeis.size(), -1);
  for (size_t k = 0; k < m_->papeis.size(); ++k) desligado_[k] = m_->papeis[k].desligado ? 1 : 0;
}

// o estado sem animacao cai no mais perto: em cima e desligado no normal, apertado no em cima
int Interface::animacao(int k, int estado) const {
  const DadosPapel& d = m_->papeis[size_t(k)];
  for (int s = estado; s >= 0; s = (s == BotaoApertado ? BotaoEmCima : (s == BotaoNormal ? -1 : BotaoNormal)))
    if (d.estados[s] >= 0) return d.estados[s];
  return -1;
}

void Interface::por(Estado& st, int k, int estado, bool mix) {
  const DadosPapel& d = m_->papeis[size_t(k)];
  if (d.tipo != TipoPapel::Botao) return;
  if (estado_[size_t(k)] == estado) return;
  const int antes = estado_[size_t(k)] < 0 ? -1 : animacao(k, estado_[size_t(k)]);
  estado_[size_t(k)] = estado;
  const int a = animacao(k, estado);
  if (a < 0 || a == antes) return;
  // o normal e o desligado ficam em laco (o botao que pulsa); o em cima e o apertado param no fim
  Entrada* en = st.tocar(d.trilha, a, estado == BotaoNormal || estado == BotaoDesligado);
  en->mix_duracao = mix ? d.mix : 0;
}

int Interface::repouso(int k) const {
  if (desligado_[size_t(k)]) return BotaoDesligado;
  if (apertado_ == k) return sobre_ == k ? BotaoApertado : BotaoNormal;
  if (apertado_ < 0 && sobre_ == k) return BotaoEmCima;
  return BotaoNormal;
}

void Interface::refazer(Estado& st) {
  for (int k = 0; k < int(m_->papeis.size()); ++k) por(st, k, repouso(k), iniciado_);
}

void Interface::iniciar(Estado& st) {
  std::fill(estado_.begin(), estado_.end(), -1);
  sobre_ = apertado_ = -1;
  iniciado_ = false;
  refazer(st);
  iniciado_ = true;
}

void Interface::mover(const Esqueleto& e, Estado& st, double x, double y) {
  sobre_ = papel_no_ponto(e, x, y);
  refazer(st);
}

void Interface::apertar(const Esqueleto& e, Estado& st, double x, double y) {
  sobre_ = papel_no_ponto(e, x, y);
  apertado_ = sobre_ >= 0 && !desligado_[size_t(sobre_)] ? sobre_ : -1;
  refazer(st);
}

void Interface::soltar(const Esqueleto& e, Estado& st, double x, double y, bool dedo) {
  sobre_ = papel_no_ponto(e, x, y);
  if (apertado_ >= 0 && sobre_ == apertado_ && !desligado_[size_t(apertado_)]) toques.push_back(apertado_);
  apertado_ = -1;
  if (dedo) sobre_ = -1;
  refazer(st);
}

void Interface::sair(Estado& st) {
  sobre_ = apertado_ = -1;
  refazer(st);
}

void Interface::desligar(Estado& st, int k, bool desligado) {
  desligado_[size_t(k)] = desligado ? 1 : 0;
  if (desligado && apertado_ == k) apertado_ = -1;
  refazer(st);
}

}  // namespace mamulengo
