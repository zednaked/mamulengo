// Curvas das timelines: linear, degrau e bezier cubica. A bezier e aproximada por 10 retas
// em parametro uniforme, como faz o oraculo (medido: a solucao exata difere ate 0,57 px numa
// curva de 100 px; ver docs/NUCLEO.md "Descobertas").
#include "mamulengo/modelo.h"

namespace mamulengo {

namespace {

constexpr int SEGMENTOS = 10;

inline double cubica(double p0, double p1, double p2, double p3, double s) {
  const double u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}

// valor no tempo t pela poligonal (t0, v0), amostras..., (t3, v3)
inline double poligonal(double t0, double v0, const double* a, double t3, double v3, double t) {
  double pt = t0, pv = v0;
  for (int i = 0; i < SEGMENTOS - 1; ++i) {
    const double at = a[i * 2], av = a[i * 2 + 1];
    if (at >= t) return at > pt ? pv + (t - pt) / (at - pt) * (av - pv) : pv;
    pt = at, pv = av;
  }
  return t3 > pt ? pv + (t - pt) / (t3 - pt) * (v3 - pv) : pv;
}

}  // namespace

void Timeline::preparar(bool fracao) {
  const size_t n = tempos.size(), nc = size_t(canais);
  amostras.assign(n * nc * (SEGMENTOS - 1) * 2, 0.0);
  for (size_t k = 0; k + 1 < n; ++k) {
    if (Curva(curvas[k]) != Curva::Bezier) continue;
    for (size_t c = 0; c < nc; ++c) {
      const double t0 = tempos[k], t3 = tempos[k + 1];
      const double v0 = fracao ? 0 : valores[k * nc + c], v3 = fracao ? 1 : valores[(k + 1) * nc + c];
      const double* b = &bezier[(k * nc + c) * 4];
      double* a = &amostras[(k * nc + c) * (SEGMENTOS - 1) * 2];
      for (int i = 1; i < SEGMENTOS; ++i) {
        const double s = double(i) / SEGMENTOS;
        a[(i - 1) * 2] = f32(cubica(t0, b[0], b[2], t3, s));
        a[(i - 1) * 2 + 1] = f32(cubica(v0, b[1], b[3], v3, s));
      }
    }
  }
}

int Timeline::chave(double t) const {
  const int n = int(tempos.size());
  if (n == 0 || t < tempos[0]) return -1;
  // busca binaria: ultima chave com tempo <= t
  int lo = 0, hi = n - 1;
  while (lo < hi) {
    const int mid = (lo + hi + 1) / 2;
    if (tempos[size_t(mid)] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

double Timeline::valor(int k, int c, double t) const {
  const size_t kk = size_t(k), nc = size_t(canais);
  const double v0 = valores[kk * nc + size_t(c)];
  if (kk + 1 >= tempos.size()) return v0;
  const Curva cv = Curva(curvas[kk]);
  if (cv == Curva::Degrau) return v0;
  const double t0 = tempos[kk], t3 = tempos[kk + 1];
  const double v3 = valores[(kk + 1) * nc + size_t(c)];
  if (cv == Curva::Linear) return t3 > t0 ? v0 + (v3 - v0) * (t - t0) / (t3 - t0) : v0;
  return poligonal(t0, v0, &amostras[(kk * nc + size_t(c)) * (SEGMENTOS - 1) * 2], t3, v3, t);
}

double Timeline::fracao(int k, double t) const {
  const size_t kk = size_t(k);
  if (kk + 1 >= tempos.size()) return 0;
  const Curva cv = Curva(curvas[kk]);
  if (cv == Curva::Degrau) return 0;
  const double t0 = tempos[kk], t3 = tempos[kk + 1];
  if (cv == Curva::Linear) return t3 > t0 ? (t - t0) / (t3 - t0) : 0;
  return poligonal(t0, 0, &amostras[kk * size_t(canais) * (SEGMENTOS - 1) * 2], t3, 1, t);
}

}  // namespace mamulengo
