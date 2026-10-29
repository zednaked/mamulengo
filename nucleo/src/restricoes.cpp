// Restricoes: IK, caminho, fisica e transformacao (docs/NUCLEO.md "Restricoes").
#include <algorithm>
#include <cmath>

#include "mamulengo/pose.h"

namespace mamulengo {

namespace {

constexpr double PI2 = PI * 2;

// angulo em (-pi, pi]
inline double embrulha(double r) {
  while (r > PI) r -= PI2;
  while (r < -PI) r += PI2;
  return r;
}

// gira a parte linear da matriz por r radianos (rotacao no mundo)
inline void gira(Matriz& w, double r) {
  const double c = std::cos(r), s = std::sin(r);
  const double a = w.a, b = w.b;
  w.a = c * a - s * w.c;
  w.b = c * b - s * w.d;
  w.c = s * a + c * w.c;
  w.d = s * b + c * w.d;
}

// ---- curva do caminho

struct Cubica {
  double x0, y0, x1, y1, x2, y2, x3, y3;
  void ponto(double s, double& x, double& y) const {
    const double u = 1 - s, a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
    x = a * x0 + b * x1 + c * x2 + d * x3;
    y = a * y0 + b * y1 + c * y2 + d * y3;
  }
  void tangente(double s, double& dx, double& dy) const {
    const double u = 1 - s;
    dx = 3 * u * u * (x1 - x0) + 6 * u * s * (x2 - x1) + 3 * s * s * (x3 - x2);
    dy = 3 * u * u * (y1 - y0) + 6 * u * s * (y2 - y1) + 3 * s * s * (y3 - y2);
  }
  // comprimento pela poligonal de n retas em parametro uniforme
  double poligonal(int n) const {
    double total = 0, px = x0, py = y0;
    for (int i = 1; i <= n; ++i) {
      double x, y;
      ponto(double(i) / n, x, y);
      total += std::hypot(x - px, y - py);
      px = x, py = y;
    }
    return total;
  }
  // parametro na fracao f (0..1) do comprimento: anda pela poligonal de 10 retas e
  // interpola o parametro dentro da reta (como o oraculo; ver "Descobertas")
  double parametro(double f) const {
    constexpr int N = 10;
    double seg[N], total = 0, px = x0, py = y0;
    for (int i = 0; i < N; ++i) {
      double x, y;
      ponto(double(i + 1) / N, x, y);
      seg[i] = std::hypot(x - px, y - py);
      total += seg[i];
      px = x, py = y;
    }
    const double alvo = f * total;
    double acc = 0;
    for (int i = 0; i < N; ++i) {
      if (alvo <= acc + seg[i] || i == N - 1) return seg[i] > 0 ? (i + (alvo - acc) / seg[i]) / N : double(i) / N;
      acc += seg[i];
    }
    return 1;
  }
};

}  // namespace

// ---- IK

namespace {

// ponto do mundo levado ao sistema local de uma matriz (inversa da parte linear)
inline void para_local(const Matriz& p, double wx, double wy, double& lx, double& ly) {
  const double det = p.a * p.d - p.b * p.c;
  const double dx = wx - p.x, dy = wy - p.y;
  lx = (p.d * dx - p.b * dy) / det;
  ly = (p.a * dy - p.c * dx) / det;
}

inline double embrulha_graus(double g) {
  while (g > 180) g -= 360;
  while (g < -180) g += 360;
  return g;
}

}  // namespace

void Esqueleto::restricao_ik(int ri) {
  const Modelo& m = *m_;
  const DadosIK& d = m.restricoes[size_t(ri)].ik;
  const EstadoRestricao& e = rest_[size_t(ri)];
  if (e.mix == 0) return;
  const Matriz& alvo = mundo_[size_t(d.alvo)];
  const Matriz ident;
  auto mundo_pai = [&](int o) -> const Matriz& {
    const int p = m.ossos[size_t(o)].pai;
    return p >= 0 ? mundo_[size_t(p)] : ident;
  };

  if (d.ossos.size() == 1) {
    // um osso: gira (no sistema do pai) para apontar o alvo
    const int o = d.ossos[0];
    Local& l = local[size_t(o)];
    const Matriz& p = mundo_pai(o);
    double tx, ty;
    para_local(p, alvo.x, alvo.y, tx, ty);
    const double quer = std::atan2(ty - l.y, tx - l.x) * RAD - l.cisalha_x;
    l.rotacao += embrulha_graus(quer - l.rotacao) * e.mix;
    if (e.comprime || e.estica) {
      const Matriz& w = mundo_[size_t(o)];
      const double comp = m.ossos[size_t(o)].comprimento * std::sqrt(w.a * w.a + w.c * w.c);
      const double dist = std::hypot(alvo.x - w.x, alvo.y - w.y);
      if (comp > 1e-4) {
        const double f = dist / comp;
        if ((e.comprime && f < 1) || (e.estica && f > 1)) {
          const double s = 1 + (f - 1) * e.mix;
          l.escala_x *= s;
          // `uniforme` nao muda nada no oraculo (medido): so a escala ao longo do osso
          (void)d.uniforme;
        }
      }
    }
    mundo_osso(o);
    return;
  }

  // dois ossos: pai `a` e filho `b`; lei dos cossenos no sistema do pai de `a`
  const int oa = d.ossos[0], ob = d.ossos[1];
  Local& la = local[size_t(oa)];
  Local& lb = local[size_t(ob)];
  const Matriz& pp = mundo_pai(oa);
  // comprimentos no sistema do pai de `a`: do osso a ao b, e do b a ponta dele
  const Matriz& wa = mundo_[size_t(oa)];
  const Matriz& wb = mundo_[size_t(ob)];
  double ax, ay, bx, by, px2, py2, tx, ty;
  para_local(pp, wa.x, wa.y, ax, ay);
  para_local(pp, wb.x, wb.y, bx, by);
  const double cb = m.ossos[size_t(ob)].comprimento;
  para_local(pp, wb.x + wb.a * cb, wb.y + wb.c * cb, px2, py2);
  para_local(pp, alvo.x, alvo.y, tx, ty);
  // osso a com escala nao uniforme (ou cisalha): a ponta de b percorre uma elipse em volta
  // do joelho; resolve o angulo de a numericamente (as duas solucoes sao as duas dobras)
  if (std::fabs(la.escala_x - la.escala_y) > 1e-9 || la.cisalha_x != 0 || la.cisalha_y != 0) {
    const double hx = la.cisalha_x * GRAU, hy = (90 + la.cisalha_y) * GRAU;
    const double s00 = std::cos(hx) * la.escala_x, s01 = std::cos(hy) * la.escala_y;
    const double s10 = std::sin(hx) * la.escala_x, s11 = std::sin(hy) * la.escala_y;
    const double det = s00 * s11 - s01 * s10;
    if (std::fabs(det) < 1e-12) return;
    const double Dx = tx - ax, Dy = ty - ay, delta = std::atan2(Dy, Dx);
    double dist = std::hypot(Dx, Dy);
    // medido: com escala nao uniforme o oraculo poe o filho no eixo x de a (y local = 0)
    lb.y = 0;
    const double rb_comp = cb * lb.escala_x;
    auto v_de = [&](double al, double& vx, double& vy) {
      const double ux = dist * std::cos(al), uy = dist * std::sin(al);
      vx = (s11 * ux - s01 * uy) / det;
      vy = (s00 * uy - s10 * ux) / det;
    };
    auto g = [&](double al) {
      double vx, vy;
      v_de(al, vx, vy);
      return std::hypot(vx - lb.x, vy - lb.y) - std::fabs(rb_comp);
    };
    auto dobra_de = [&](double al) {
      double vx, vy;
      v_de(al, vx, vy);
      // dobra: para que lado o filho vira em relacao a reta da origem de a ate o joelho
      return (lb.x * (vy - lb.y) - lb.y * (vx - lb.x)) * (rb_comp < 0 ? -1 : 1) >= 0 ? 1 : -1;
    };
    const int N = 720;
    // todas as raizes de g em (-pi, pi]
    auto raizes = [&](std::vector<double>& out) {
      out.clear();
      double ga = g(-PI);
      for (int i = 1; i <= N; ++i) {
        const double a0 = -PI + PI2 * (i - 1) / N, a1 = -PI + PI2 * i / N;
        const double gb = g(a1);
        if ((ga <= 0) != (gb <= 0)) {
          double lo = a0, hi = a1, glo = ga;
          for (int k = 0; k < 80; ++k) {
            const double mid = (lo + hi) / 2, gm = g(mid);
            if ((gm <= 0) == (glo <= 0)) lo = mid, glo = gm;
            else hi = mid;
          }
          out.push_back((lo + hi) / 2);
        }
        ga = gb;
      }
    };
    std::vector<double> rs;
    raizes(rs);
    bool fora = false;
    if (rs.empty()) {
      fora = true;
      // fora de alcance: longe demais, o maior alcance na direcao do alvo; perto demais, o
      // menor (procura a distancia em que a elipse comeca a tocar o circulo)
      const bool longe = g(0) > 0;
      double sem = dist, com = longe ? 0 : dist;
      if (!longe) {
        for (int k = 0; k < 40 && rs.empty(); ++k) {
          com = com * 2 + 1;
          dist = com;
          raizes(rs);
        }
      }
      for (int k = 0; k < 60; ++k) {
        dist = (sem + com) / 2;
        raizes(rs);
        if (rs.empty()) sem = dist;
        else com = dist;
      }
      dist = com;
      raizes(rs);
      if (rs.empty()) return;
    }
    double melhor = rs[0];
    for (double rr : rs)
      if (fora ? rr * e.dobra > 0 : dobra_de(rr) == e.dobra) {
        melhor = rr;
        break;
      }
    const double r = delta - melhor;
    double vx, vy;
    v_de(melhor, vx, vy);
    const double psi = std::atan2((vy - lb.y) * (rb_comp < 0 ? -1 : 1), (vx - lb.x) * (rb_comp < 0 ? -1 : 1));
    const double ra = r * RAD - la.cisalha_x * 0;
    const double rbv = psi * RAD - lb.cisalha_x;
    la.rotacao += embrulha_graus(ra - la.rotacao) * e.mix;
    lb.rotacao += embrulha_graus(rbv - lb.rotacao) * e.mix;
    mundo_osso(oa);
    mundo_osso(ob);
    return;
  }
  const double l1 = std::hypot(bx - ax, by - ay);
  const double l2 = std::hypot(px2 - bx, py2 - by);
  double dx = tx - ax, dy = ty - ay;
  double dd = std::hypot(dx, dy);
  // suavidade: perto do alcance, a distancia usada cresce devagar ate o maximo
  if (e.suavidade > 0 && dd > 0) {
    const double sv = e.suavidade;
    const double alcance = l1 + l2;
    const double sobra = dd - alcance + sv;
    if (sobra > 0) {
      const double p = std::min(1.0, sobra / (sv * 2)) - 1;
      const double novo = dd - (sobra - sv * (1 - p * p));
      dx *= novo / dd;
      dy *= novo / dd;
      dd = novo;
    }
  }
  double ang_b;  // angulo interno no joelho (do prolongamento de a para b)
  double cosb = l1 > 0 && l2 > 0 ? (dd * dd - l1 * l1 - l2 * l2) / (2 * l1 * l2) : 1;
  double esticar = 1;
  if (cosb < -1) cosb = -1;
  else if (cosb > 1) {
    cosb = 1;
    if (e.estica && l1 + l2 > 0) esticar = dd / (l1 + l2);
  }
  ang_b = std::acos(cosb) * e.dobra;
  const double ang_a = std::atan2(dy, dx) - std::atan2(l2 * std::sin(ang_b), l1 + l2 * std::cos(ang_b));
  // solucao inteira (mix 1) em rotacoes locais; depois cada osso mistura a sua
  const Local va = la, vb = lb;
  const double desvio_b = std::atan2(by - ay, bx - ax);  // direcao atual de a para b
  const double ra = la.rotacao + embrulha_graus((ang_a - desvio_b) * RAD);
  la.rotacao = ra;
  if (esticar != 1) la.escala_x *= esticar;
  mundo_osso(oa);
  mundo_osso(ob);
  // o filho aponta para o joelho mais l2 na direcao ang_a + ang_b (no sistema do pai de a)
  double rb;
  {
    const Matriz& wb2 = mundo_[size_t(ob)];
    double bx2, by2;
    para_local(pp, wb2.x, wb2.y, bx2, by2);
    const double q = ang_a + ang_b;
    const double qx = bx2 + std::cos(q) * l2, qy = by2 + std::sin(q) * l2;
    const double wx = pp.a * qx + pp.b * qy + pp.x, wy = pp.c * qx + pp.d * qy + pp.y;
    double lx, ly;
    para_local(mundo_[size_t(oa)], wx, wy, lx, ly);
    rb = std::atan2(ly - lb.y, lx - lb.x) * RAD - lb.cisalha_x;
  }
  la = va;
  la.rotacao += embrulha_graus(ra - va.rotacao) * e.mix;
  if (esticar != 1) la.escala_x *= 1 + (esticar - 1) * e.mix;
  lb.rotacao = vb.rotacao + embrulha_graus(rb - vb.rotacao) * e.mix;
  mundo_osso(oa);
  mundo_osso(ob);
}

void Esqueleto::restricao_caminho(int ri) {
  const Modelo& m = *m_;
  const DadosCaminho& d = m.restricoes[size_t(ri)].caminho;
  const EstadoRestricao& e = rest_[size_t(ri)];
  if (e.mix_girar == 0 && e.mix_x == 0 && e.mix_y == 0) return;
  const EstadoSlot& st = slots_[size_t(d.slot)];
  if (st.parte < 0) return;
  const Parte& p = m.partes[size_t(st.parte)];
  if (p.tipo != TipoParte::Caminho || p.num_vertices < 6) return;

  // pontos do caminho no mundo: (entrada, ancora, saida) por ancora
  std::vector<double>& v = tmp_;
  v.resize(size_t(p.num_vertices) * 2);
  vertices_geometria(d.slot, p, v.data());
  const int nanc = p.num_vertices / 3;
  const int ncurvas = p.fechado ? nanc : nanc - 1;
  if (ncurvas < 1) return;
  std::vector<Cubica> cv(static_cast<size_t>(ncurvas));
  std::vector<double> acum(static_cast<size_t>(ncurvas));
  double total = 0;
  for (int i = 0; i < ncurvas; ++i) {
    auto P = [&](int k) {
      k %= p.num_vertices;
      return std::pair<double, double>{v[size_t(k) * 2], v[size_t(k) * 2 + 1]};
    };
    auto [x0, y0] = P(i * 3 + 1);
    auto [x1, y1] = P(i * 3 + 2);
    auto [x2, y2] = P(i * 3 + 3);
    auto [x3, y3] = P(i * 3 + 4);
    cv[size_t(i)] = Cubica{x0, y0, x1, y1, x2, y2, x3, y3};
    // o oraculo mede cada curva pela poligonal de 4 retas (ver "Descobertas")
    if (p.velocidade_constante) total += cv[size_t(i)].poligonal(4);
    else total = i < int(p.comprimentos.size()) ? p.comprimentos[size_t(i)] : total;
    acum[size_t(i)] = total;
  }

  // distancia de cada osso ao longo do caminho (e mais uma depois do ultimo, para onde ele
  // aponta nos modos de cadeia)
  const int nb = int(d.ossos.size());
  std::vector<double> dist(static_cast<size_t>(nb) + 1), comps(static_cast<size_t>(nb));
  double soma_comp = 0;  // proporcional: soma dos comprimentos dos ossos antes do ultimo (medido)
  for (int i = 0; i < nb; ++i) {
    const int o = d.ossos[size_t(i)];
    const Matriz& w = mundo_[size_t(o)];
    comps[size_t(i)] = m.ossos[size_t(o)].comprimento * std::sqrt(w.a * w.a + w.c * w.c);
    if (i + 1 < nb) soma_comp += comps[size_t(i)];
  }
  double pos = e.posicao;
  if (d.modo_posicao == ModoPosicao::Percentual) pos *= total;
  double soma = pos;
  for (int i = 0; i <= nb; ++i) {
    dist[size_t(i)] = soma;
    if (i == nb) break;
    const double comp = comps[size_t(i)];
    switch (d.modo_espacamento) {
      case ModoEspacamento::Comprimento: soma += comp + e.espacamento; break;
      case ModoEspacamento::Fixo: soma += e.espacamento; break;
      case ModoEspacamento::Percentual: soma += e.espacamento * total; break;
      case ModoEspacamento::Proporcional:
        soma += soma_comp > 0 ? e.espacamento * total * comp / soma_comp : 0;
        break;
    }
  }

  // ponto e tangente na distancia s
  auto no_caminho = [&](double s, double& x, double& y, double& ang) {
    if (p.fechado) {
      s = std::fmod(s, total);
      if (s < 0) s += total;
    } else if (s < 0) {
      const Cubica& c = cv[0];
      double dx, dy;
      c.tangente(0, dx, dy);
      ang = std::atan2(dy, dx);
      x = c.x0 + std::cos(ang) * s;
      y = c.y0 + std::sin(ang) * s;
      return;
    } else if (s > total) {
      const Cubica& c = cv.back();
      double dx, dy;
      c.tangente(1, dx, dy);
      ang = std::atan2(dy, dx);
      x = c.x3 + std::cos(ang) * (s - total);
      y = c.y3 + std::sin(ang) * (s - total);
      return;
    }
    int i = 0;
    while (i < ncurvas - 1 && s > acum[size_t(i)]) ++i;
    const double ini = i ? acum[size_t(i) - 1] : 0, len = acum[size_t(i)] - ini;
    const Cubica& c = cv[size_t(i)];
    const double f = len > 0 ? (s - ini) / len : 0;
    const double par = p.velocidade_constante ? c.parametro(f) : f;
    c.ponto(par, x, y);
    double dx, dy;
    c.tangente(par, dx, dy);
    ang = std::atan2(dy, dx);
  };

  const double desloc = d.rotacao * GRAU;
  const bool cadeia = d.modo_girar != ModoGirar::Tangente;
  double px = 0, py = 0;  // nos modos de cadeia: onde comeca o proximo osso (a ponta do anterior)
  for (int i = 0; i < nb; ++i) {
    const int o = d.ossos[size_t(i)];
    Matriz& w = mundo_[size_t(o)];
    double x, y, ang;
    no_caminho(dist[size_t(i)], x, y, ang);
    // nos modos de cadeia o osso aponta do seu comeco para o proximo ponto do caminho
    if (cadeia && i > 0) x = px, y = py;
    double escala = 1;
    if (cadeia) {
      double x2, y2, a2;
      no_caminho(dist[size_t(i) + 1], x2, y2, a2);
      ang = std::atan2(y2 - y, x2 - x);
      if (d.modo_girar == ModoGirar::CadeiaEscala && comps[size_t(i)] > 1e-5)
        escala = std::hypot(x2 - x, y2 - y) / comps[size_t(i)];
    }
    w.x += (x - w.x) * e.mix_x;
    w.y += (y - w.y) * e.mix_y;
    if (escala != 1) {
      const double f = 1 + (escala - 1) * e.mix_girar;
      w.a *= f;
      w.c *= f;
    }
    if (e.mix_girar != 0) {
      const double atual = std::atan2(w.c, w.a);
      gira(w, embrulha(ang + desloc - atual) * e.mix_girar);
    }
    if (cadeia) {
      // medido: so no modo `chain` sem `rotacao`, o proximo osso comeca na ponta deste
      // (girado), misturada com o ponto do caminho por mix_girar; nos outros casos, no caminho
      double x2, y2, a2;
      no_caminho(dist[size_t(i) + 1], x2, y2, a2);
      px = x2, py = y2;
      if (d.modo_girar == ModoGirar::Cadeia && d.rotacao == 0) {
        const double c = m.ossos[size_t(o)].comprimento;
        px += (x + w.a * c - x2) * e.mix_girar;
        py += (y + w.c * c - y2) * e.mix_girar;
      }
    }
    mundo_para_local(o);
  }
}

void Esqueleto::restricao_fisica(int ri) {
  const Modelo& m = *m_;
  const DadosFisica& d = m.restricoes[size_t(ri)].fisica;
  EstadoRestricao& e = rest_[size_t(ri)];
  Matriz& w = mundo_[size_t(d.osso)];
  const double h = f32(d.passo);
  const double dt = std::max(f32(relogio_ - e.relogio), 0.0);
  e.relogio = relogio_;
  const double base = std::atan2(w.c, w.a);  // angulo do osso sem a fisica
  const double comp_mundo = m.ossos[size_t(d.osso)].comprimento * std::sqrt(w.a * w.a + w.c * w.c);
  if (e.reiniciar) {
    e.reiniciar = false;
    e.rot = e.vrot = e.rot_ant = e.saida = 0;
    e.sobra = 0;
  } else if (d.girar != 0 && comp_mundo > 0) {
    // inercia: a ponta do osso tende a ficar onde estava no quadro anterior; o desvio entre
    // a direcao para a ponta antiga e a direcao mostrada entra direto no angulo
    // o deslocamento da origem conta no maximo `limite` px por segundo em cada eixo (no
    // instante 0, com dt = 0, so a rotacao do osso conta)
    const double lim = d.limite * dt;
    const double ox = e.ox + std::clamp(w.x - e.ox, -lim, lim);
    const double oy = e.oy + std::clamp(w.y - e.oy, -lim, lim);
    const double alvo = std::atan2(e.py - oy, e.px - ox);
    const double desvio = embrulha(alvo - base - e.saida) * e.inercia;
    e.rot += desvio;
    e.rot_ant += desvio;
    e.saida += desvio;
  }
  e.sobra = f32(e.sobra + dt);
  const double comp = m.ossos[size_t(d.osso)].comprimento / m.escala_ref;
  const double fd = std::pow(e.amortecimento, 60 * h);
  // a gravidade do primeiro passo usa o angulo mostrado (o do quadro anterior mais a inercia)
  double ang = base + e.saida;
  // o mostrado interpola do desvio de antes do PRIMEIRO passo do quadro (medido com dois passos
  // num quadro: a 1/60 e a 1/50 s; docs/NUCLEO.md "Fisica de rotacao")
  if (e.sobra >= h) e.rot_ant = e.rot;
  while (e.sobra >= h) {
    e.sobra = f32(e.sobra - h);
    if (d.girar != 0) {
      const double forca = (e.vento * std::sin(ang) + e.gravidade * std::cos(ang)) * comp + e.rot * e.forca;
      e.vrot -= forca * e.massa_inv * h;
      e.rot += e.vrot * h;
      e.vrot *= fd;
      ang = base + e.rot;
    }
  }
  const double a = e.sobra / h;
  e.saida = e.rot_ant + (e.rot - e.rot_ant) * a;
  const double r = e.saida * d.girar * e.mix;
  if (r != 0) {
    gira(w, r);
    // medido: sem isso a cabeca perdia a fisica quando o IK do tronco vinha depois na ordem
    if (m.ossos[size_t(d.osso)].heranca == Heranca::Normal) mundo_para_local(d.osso);
    else local[size_t(d.osso)].rotacao += r * RAD;
  }
  // ponta mostrada, para a inercia do proximo quadro
  const double am = base + e.saida;
  e.ox = w.x;
  e.oy = w.y;
  e.px = w.x + std::cos(am) * comp_mundo;
  e.py = w.y + std::sin(am) * comp_mundo;
}

void Esqueleto::restricao_transformacao(int ri) {
  const Modelo& m = *m_;
  const DadosTransformacao& d = m.restricoes[size_t(ri)].transf;
  const EstadoRestricao& e = rest_[size_t(ri)];
  const Matriz& fw = mundo_[size_t(d.fonte)];
  const Local& fl = local[size_t(d.fonte)];
  // medido: os deslocamentos do topo somam no valor da fonte; em mundo, x e y sao o ponto
  // (desl_x, desl_y) no espaco da fonte (gira e escala com ela)
  auto valor_fonte = [&](PropTransf p) -> double {
    if (d.fonte_local) {
      switch (p) {
        case PropTransf::Girar: return fl.rotacao + d.desl_girar;
        case PropTransf::X: return fl.x + d.desl_x;
        case PropTransf::Y: return fl.y + d.desl_y;
        case PropTransf::EscalaX: return fl.escala_x + d.desl_escala_x;
        case PropTransf::EscalaY: return fl.escala_y + d.desl_escala_y;
        case PropTransf::CisalhaY: return fl.cisalha_y + d.desl_cisalha_y;
      }
    }
    switch (p) {
      case PropTransf::Girar: {
        // medido: a rotacao de mundo da fonte sai em [0, 360)
        // medido: com a fonte espelhada (determinante negativo) o deslocamento gira ao contrario
        const double desl = fw.a * fw.d - fw.b * fw.c < 0 ? -d.desl_girar : d.desl_girar;
        double g = std::atan2(fw.c, fw.a) * RAD + desl;
        g = std::fmod(g, 360.0);
        return g < 0 ? g + 360 : g;
      }
      case PropTransf::X: return fw.x + fw.a * d.desl_x + fw.b * d.desl_y;
      case PropTransf::Y: return fw.y + fw.c * d.desl_x + fw.d * d.desl_y;
      case PropTransf::EscalaX: return std::hypot(fw.a, fw.c) + d.desl_escala_x;
      case PropTransf::EscalaY: return std::hypot(fw.b, fw.d) + d.desl_escala_y;
      // medido: sem embrulhar (pode sair -345 em vez de 15; so importa com `limitar`)
      case PropTransf::CisalhaY: return (std::atan2(fw.d, fw.b) - std::atan2(fw.c, fw.a)) * RAD - 90 + d.desl_cisalha_y;
    }
    return 0;
  };
  auto mix_de = [&](PropTransf p) {
    switch (p) {
      case PropTransf::Girar: return e.mix_girar;
      case PropTransf::X: return e.mix_x;
      case PropTransf::Y: return e.mix_y;
      case PropTransf::EscalaX: return e.mix_escala_x;
      case PropTransf::EscalaY: return e.mix_escala_y;
      case PropTransf::CisalhaY: return e.mix_cisalha_y;
    }
    return 0.0;
  };
  for (int o : d.ossos) {
    Matriz& w = mundo_[size_t(o)];
    Local& l = local[size_t(o)];
    for (const DadosTransfDe& de : d.de) {
      const double v = valor_fonte(de.prop) - de.deslocamento;
      for (const DadosTransfPara& pa : de.para) {
        const double mix = mix_de(pa.prop);
        if (mix == 0) continue;
        double t = pa.deslocamento + v * pa.escala;
        if (d.limitar) t = std::clamp(t, std::min(pa.deslocamento, pa.maximo), std::max(pa.deslocamento, pa.maximo));
        if (d.alvo_local) {
          auto vai = [&](double& x, bool angulo) {
            x += d.somar ? t * mix : (angulo ? embrulha_graus(t - x) : t - x) * mix;
          };
          switch (pa.prop) {
            case PropTransf::Girar: vai(l.rotacao, true); break;
            case PropTransf::X: vai(l.x, false); break;
            case PropTransf::Y: vai(l.y, false); break;
            case PropTransf::EscalaX:
              l.escala_x += (d.somar ? t - 1 : t - l.escala_x) * mix;
              break;
            case PropTransf::EscalaY:
              l.escala_y += (d.somar ? t - 1 : t - l.escala_y) * mix;
              break;
            case PropTransf::CisalhaY: vai(l.cisalha_y, true); break;
          }
          continue;
        }
        switch (pa.prop) {
          case PropTransf::Girar: {
            const double atual = std::atan2(w.c, w.a);
            gira(w, (d.somar ? t * GRAU : embrulha(t * GRAU - atual)) * mix);
            break;
          }
          case PropTransf::X: w.x += (d.somar ? t : t - w.x) * mix; break;
          case PropTransf::Y: w.y += (d.somar ? t : t - w.y) * mix; break;
          case PropTransf::EscalaX: {
            const double s = std::hypot(w.a, w.c);
            if (s > 1e-5) {
              const double ns = s + (d.somar ? t - 1 : t - s) * mix;
              w.a *= ns / s;
              w.c *= ns / s;
            }
            break;
          }
          case PropTransf::EscalaY: {
            const double s = std::hypot(w.b, w.d);
            if (s > 1e-5) {
              const double ns = s + (d.somar ? t - 1 : t - s) * mix;
              w.b *= ns / s;
              w.d *= ns / s;
            }
            break;
          }
          case PropTransf::CisalhaY: {
            const double ax = std::atan2(w.c, w.a), ay = std::atan2(w.d, w.b);
            const double atual = embrulha(ay - ax);
            const double quer = d.somar ? atual + t * GRAU : (t + 90) * GRAU;
            const double novo = ax + atual + embrulha(quer - atual) * mix;
            const double s = std::hypot(w.b, w.d);
            w.b = std::cos(novo) * s;
            w.d = std::sin(novo) * s;
            break;
          }
        }
      }
    }
    if (d.alvo_local) mundo_osso(o);
    else mundo_para_local(o);
  }
}

}  // namespace mamulengo
