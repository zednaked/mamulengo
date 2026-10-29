// Montagem do desenho (mamulengo/desenho.h): percorre os slots na ordem de desenho, pega os
// vertices em mundo de cada regiao e malha visivel e junta em lotes.
#include "mamulengo/desenho.h"

#include <algorithm>
#include <cmath>

namespace mamulengo {

namespace {

// ---- recorte na CPU
//
// O poligono do recorte vira pedacos convexos (ele inteiro, se ja for convexo; senao os
// triangulos de um corte por orelhas). Cada triangulo desenhado e cortado contra cada pedaco
// (Sutherland-Hodgman: um semiplano por aresta) e o que sobra vira um leque. A uv de cada
// ponto novo sai do baricentro dele no triangulo original.

struct P2 {
  double x, y;
};

double cruz(P2 o, P2 a, P2 b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

double area2(const std::vector<P2>& p) {
  double s = 0;
  for (size_t i = 0, n = p.size(); i < n; ++i) s += p[i].x * p[(i + 1) % n].y - p[(i + 1) % n].x * p[i].y;
  return s;
}

bool convexo(const std::vector<P2>& p) {
  const size_t n = p.size();
  for (size_t i = 0; i < n; ++i)
    if (cruz(p[i], p[(i + 1) % n], p[(i + 2) % n]) < -1e-9) return false;
  return true;
}

bool dentro_tri(P2 a, P2 b, P2 c, P2 q) { return cruz(a, b, q) >= 0 && cruz(b, c, q) >= 0 && cruz(c, a, q) >= 0; }

// pedacos convexos de um poligono simples, ja no sentido anti-horario
std::vector<std::vector<P2>> pedacos(std::vector<P2> p) {
  std::vector<std::vector<P2>> out;
  if (p.size() < 3) return out;
  if (area2(p) < 0) std::reverse(p.begin(), p.end());
  if (convexo(p)) {
    out.push_back(p);
    return out;
  }
  // corte por orelhas: tira um vertice convexo cujo triangulo nao contem outro vertice
  std::vector<size_t> idx(p.size());
  for (size_t i = 0; i < idx.size(); ++i) idx[i] = i;
  size_t guarda = 0;
  while (idx.size() > 3 && guarda++ < 10000) {
    bool tirou = false;
    for (size_t i = 0, n = idx.size(); i < n; ++i) {
      const P2 a = p[idx[(i + n - 1) % n]], b = p[idx[i]], c = p[idx[(i + 1) % n]];
      if (cruz(a, b, c) <= 1e-12) continue;
      bool vazio = true;
      for (size_t j = 0; j < n && vazio; ++j) {
        if (j == i || j == (i + 1) % n || j == (i + n - 1) % n) continue;
        if (dentro_tri(a, b, c, p[idx[j]])) vazio = false;
      }
      if (!vazio) continue;
      out.push_back({a, b, c});
      idx.erase(idx.begin() + long(i));
      tirou = true;
      break;
    }
    if (!tirou) break;  // poligono degenerado: fica o que deu
  }
  if (idx.size() == 3) out.push_back({p[idx[0]], p[idx[1]], p[idx[2]]});
  return out;
}

// corta o poligono `v` pelo semiplano a esquerda de a->b
void corta(std::vector<P2>& v, P2 a, P2 b, std::vector<P2>& tmp) {
  tmp.clear();
  const size_t n = v.size();
  for (size_t i = 0; i < n; ++i) {
    const P2 p = v[i], q = v[(i + 1) % n];
    const double dp = cruz(a, b, p), dq = cruz(a, b, q);
    if (dp >= 0) tmp.push_back(p);
    if ((dp >= 0) != (dq >= 0)) {
      const double t = dp / (dp - dq);
      tmp.push_back({p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t});
    }
  }
  v.swap(tmp);
}

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

// a malha cresce pelo contorno (os h primeiros vertices, em ordem; 8 floats por vertice: x, y,
// u, v, cor): cada um anda para fora `margem` pixels da textura (docs/NUCLEO.md "Efeitos")
void crescer_malha(float* v, int h, float margem, int W, int H) {
  std::vector<P2> t(static_cast<size_t>(h)), pos(static_cast<size_t>(h));
  P2 c{0, 0};
  for (int i = 0; i < h; ++i) {
    t[size_t(i)] = {double(v[i * 8 + 2]) * W, double(v[i * 8 + 3]) * H};
    pos[size_t(i)] = {v[i * 8], v[i * 8 + 1]};
    c.x += t[size_t(i)].x / h, c.y += t[size_t(i)].y / h;
  }
  for (int i = 0; i < h; ++i) {
    const P2 a = t[size_t((i + h - 1) % h)], b = t[size_t(i)], z = t[size_t((i + 1) % h)];
    // normal de cada aresta vizinha, virada para longe do centro do contorno
    auto normal = [&](P2 p, P2 q) {
      double nx = q.y - p.y, ny = -(q.x - p.x);
      const double l = std::hypot(nx, ny);
      if (l < 1e-9) return P2{0, 0};
      nx /= l, ny /= l;
      if (nx * ((p.x + q.x) / 2 - c.x) + ny * ((p.y + q.y) / 2 - c.y) < 0) nx = -nx, ny = -ny;
      return P2{nx, ny};
    };
    const P2 n1 = normal(a, b), n2 = normal(b, z);
    double nx = n1.x + n2.x, ny = n1.y + n2.y;
    const double l = std::hypot(nx, ny);
    if (l < 1e-9) continue;
    nx = nx / l * margem, ny = ny / l * margem;
    // textura -> mundo perto do vertice, pelas duas arestas: [dp1 dp2] = M [dt1 dt2]
    const P2 pa = pos[size_t((i + h - 1) % h)], pb = pos[size_t(i)], pz = pos[size_t((i + 1) % h)];
    const double t1x = z.x - b.x, t1y = z.y - b.y, t2x = a.x - b.x, t2y = a.y - b.y;
    const double p1x = pz.x - pb.x, p1y = pz.y - pb.y, p2x = pa.x - pb.x, p2y = pa.y - pb.y;
    const double det = t1x * t2y - t2x * t1y;
    double wx, wy;
    if (std::fabs(det) > 1e-9) {
      const double i11 = t2y / det, i12 = -t2x / det, i21 = -t1y / det, i22 = t1x / det;
      const double m11 = p1x * i11 + p2x * i21, m12 = p1x * i12 + p2x * i22;
      const double m21 = p1y * i11 + p2y * i21, m22 = p1y * i12 + p2y * i22;
      wx = m11 * nx + m12 * ny, wy = m21 * nx + m22 * ny;
    } else {
      // vizinhos em linha reta: escala e giro de uma aresta so
      const double lt = std::hypot(t1x, t1y);
      if (lt < 1e-9) continue;
      const double s = std::hypot(p1x, p1y) / lt, rot = std::atan2(p1y, p1x) - std::atan2(t1y, t1x);
      wx = s * (std::cos(rot) * nx - std::sin(rot) * ny), wy = s * (std::sin(rot) * nx + std::cos(rot) * ny);
    }
    v[i * 8] += float(wx);
    v[i * 8 + 1] += float(wy);
    v[i * 8 + 2] += float(nx / W);
    v[i * 8 + 3] += float(ny / H);
  }
}

}  // namespace

void linhas_raio(const Esqueleto& e, int ie, std::vector<std::vector<double>>& linhas) {
  linhas.clear();
  const Modelo& m = e.modelo();
  const DadosEmissor& de = m.emissores[size_t(ie)];
  if (!de.raio || std::min(std::max(e.emissores()[size_t(ie)].taxa, 0.0), 1.0) <= 0) return;
  const Matriz& w = e.mundo()[size_t(de.osso)];
  const P2 S{w.a * de.x + w.b * de.y + w.x, w.c * de.x + w.d * de.y + w.y};
  P2 E;
  if (de.ate >= 0) {
    const Matriz& t = e.mundo()[size_t(de.ate)];
    E = {t.a * de.ate_x + t.b * de.ate_y + t.x, t.c * de.ate_x + t.d * de.ate_y + t.y};
  } else {
    const double g = de.angulo * GRAU;
    double ux = w.a * std::cos(g) + w.b * std::sin(g), uy = w.c * std::cos(g) + w.d * std::sin(g);
    const double ul = std::hypot(ux, uy);
    if (ul > 1e-9) ux /= ul, uy /= ul;
    E = {S.x + ux * de.comprimento, S.y + uy * de.comprimento};
  }
  const uint32_t g = uint32_t(std::floor(e.relogio() / de.troca));
  const uint32_t j = de.semente * 8u + 5u;
  // a linha quebrada de A ate B em n pedacos, desvio em fracao do comprimento
  auto quebrada = [&](P2 A, P2 B, int n, double desvio, uint32_t i0) {
    const double L = std::hypot(B.x - A.x, B.y - A.y);
    const double nx = L > 1e-9 ? -(B.y - A.y) / L : 0, ny = L > 1e-9 ? (B.x - A.x) / L : 0;
    std::vector<double> ln;
    ln.reserve(size_t(n + 1) * 2);
    ln.insert(ln.end(), {A.x, A.y});
    for (int i = 1; i < n; ++i) {
      const double f = double(i) / n, sx = sorteio(g * 64u + i0 + uint32_t(i), j);
      const double off = L * desvio * (2 * sx - 1) * std::sin(PI * f);
      ln.insert(ln.end(), {A.x + (B.x - A.x) * f + nx * off, A.y + (B.y - A.y) * f + ny * off});
    }
    ln.insert(ln.end(), {B.x, B.y});
    linhas.push_back(std::move(ln));
  };
  quebrada(S, E, de.segmentos, de.desvio, 0);
  const double L = std::hypot(E.x - S.x, E.y - S.y), dir = std::atan2(E.y - S.y, E.x - S.x);
  for (int r = 0; r < de.ramos && de.segmentos > 2; ++r) {
    const uint32_t b0 = g * 64u + 40u + uint32_t(r) * 4u;
    const double s1 = sorteio(b0 + 1, j), s2 = sorteio(b0 + 2, j), s3 = sorteio(b0 + 3, j);
    const size_t k = size_t(1 + int(std::floor(s1 * (de.segmentos - 2))));
    const P2 A{linhas[0][k * 2], linhas[0][k * 2 + 1]};
    const double ang = dir + (s2 - 0.5) * PI / 2, comp = L * (0.25 + 0.25 * s3);
    quebrada(A, P2{A.x + std::cos(ang) * comp, A.y + std::sin(ang) * comp}, std::max(2, de.segmentos / 2), de.desvio / 2, 20u + uint32_t(r) * 16u);
  }
}

void desenhar(const Esqueleto& e, Desenho& d) {
  const Modelo& m = e.modelo();
  std::vector<double> mundo;
  std::vector<std::vector<P2>> recorte;  // pedacos convexos do recorte aberto (modo cpu)
  std::vector<double> caixas;            // por pedaco: x0, y0, x1, y1
  std::vector<uint8_t> dentro_v;         // por vertice da peca: dentro do pedaco
  std::vector<P2> poli, tmp;
  int recorte_fim = -2;  // slot que acaba o recorte aberto (-1: o fim do desenho; -2: nenhum)
  // `efeito` >= 0: o lote de um slot com efeitos, sempre novo (os valores sao do slot)
  auto lote = [&](Comando c, int pagina, Blend blend, int efeito = -1) -> Lote& {
    if (c == Comando::Triangulos && efeito < 0 && !d.lotes.empty()) {
      Lote& u = d.lotes.back();
      if (u.comando == c && u.pagina == pagina && u.blend == blend && u.efeito < 0) return u;
    }
    Lote l;
    l.comando = c;
    l.pagina = pagina;
    l.blend = blend;
    l.efeito = efeito;
    l.inicio = uint32_t(d.indices.size());
    d.lotes.push_back(l);
    return d.lotes.back();
  };
  auto fecha_recorte = [&]() {
    if (!d.recorte_cpu) lote(Comando::AcabaRecorte, -1, Blend::Normal);
    recorte.clear();
    recorte_fim = -2;
  };
  // acrescenta o triangulo (vertices ja em d.vertices: base + i, j, k) cortado pelo recorte
  auto tri_cortado = [&](uint32_t i0, uint32_t i1, uint32_t i2) {
    const float* v0 = d.vertices.data() + size_t(i0) * 8;
    const float* v1 = d.vertices.data() + size_t(i1) * 8;
    const float* v2 = d.vertices.data() + size_t(i2) * 8;
    const P2 a{v0[0], v0[1]}, b{v1[0], v1[1]}, c{v2[0], v2[1]};
    const double den = cruz(a, b, c);
    if (std::fabs(den) < 1e-12) return;
    const double tx0 = std::min({a.x, b.x, c.x}), tx1 = std::max({a.x, b.x, c.x});
    const double ty0 = std::min({a.y, b.y, c.y}), ty1 = std::max({a.y, b.y, c.y});
    for (size_t ip = 0; ip < recorte.size(); ++ip) {
      const auto& pc = recorte[ip];
      const double* cx = &caixas[ip * 4];
      // atalho: o triangulo fora da caixa do pedaco nao toca nele
      if (tx1 < cx[0] || tx0 > cx[2] || ty1 < cx[1] || ty0 > cx[3]) continue;
      // atalho: o triangulo inteiro dentro do pedaco vai como esta
      bool todo = true;
      for (size_t e = 0, n = pc.size(); e < n && todo; ++e)
        if (cruz(pc[e], pc[(e + 1) % n], a) < 0 || cruz(pc[e], pc[(e + 1) % n], b) < 0 || cruz(pc[e], pc[(e + 1) % n], c) < 0) todo = false;
      if (todo) {
        d.indices.insert(d.indices.end(), {i0, i1, i2});
        continue;
      }
      poli.assign({a, b, c});
      for (size_t e = 0, n = pc.size(); e < n && poli.size() >= 3; ++e) corta(poli, pc[e], pc[(e + 1) % n], tmp);
      if (poli.size() < 3) continue;
      const uint32_t base = uint32_t(d.vertices.size() / 8);
      // copias antes de crescer o vetor (os ponteiros v0, v1, v2 podem mudar)
      float c0[8], c1[8], c2[8];
      std::copy(v0, v0 + 8, c0);
      std::copy(v1, v1 + 8, c1);
      std::copy(v2, v2 + 8, c2);
      d.vertices.resize(d.vertices.size() + poli.size() * 8);
      float* w = d.vertices.data() + size_t(base) * 8;
      for (const P2& q : poli) {
        // baricentro de q no triangulo original
        const double wa = cruz(q, b, c) / den, wb = cruz(a, q, c) / den, wc = 1 - wa - wb;
        w[0] = float(q.x);
        w[1] = float(q.y);
        w[2] = float(c0[2] * wa + c1[2] * wb + c2[2] * wc);
        w[3] = float(c0[3] * wa + c1[3] * wb + c2[3] * wc);
        std::copy(c0 + 4, c0 + 8, w + 4);
        w += 8;
      }
      for (uint32_t k = 1; k + 1 < poli.size(); ++k) {
        d.indices.push_back(base);
        d.indices.push_back(base + k);
        d.indices.push_back(base + k + 1);
      }
      v0 = d.vertices.data() + size_t(i0) * 8;
      v1 = d.vertices.data() + size_t(i1) * 8;
      v2 = d.vertices.data() + size_t(i2) * 8;
    }
  };
  // as particulas dos emissores do slot (docs/NUCLEO.md "Particulas"), logo depois da parte dele
  std::vector<std::vector<double>> raios;
  auto quad = [&](const float* q, const float* uv, float cr, float cg, float cb, float ca) {
    // q: 4 cantos (x, y); uv: 4 pares; a ordem baixo-esquerda, cima-esquerda, cima-direita,
    // baixo-direita
    const uint32_t base = uint32_t(d.vertices.size() / 8);
    for (int k = 0; k < 4; ++k) d.vertices.insert(d.vertices.end(), {q[k * 2], q[k * 2 + 1], uv[k * 2], uv[k * 2 + 1], cr, cg, cb, ca});
    if (recorte_fim != -2 && d.recorte_cpu) {
      tri_cortado(base, base + 1, base + 2);
      tri_cortado(base + 2, base + 3, base);
    } else {
      d.indices.insert(d.indices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
    }
  };
  // um pedaco do raio: retangulo de largura w de a ate b, a imagem esticada (u ao longo, v de
  // um lado ao outro, nas uvs dos cantos da imagem)
  auto pedaco = [&](const DadosEmissor& de, P2 a, P2 b, double w, float cr, float cg, float cb, float ca) {
    double dx = b.x - a.x, dy = b.y - a.y;
    const double l = std::hypot(dx, dy);
    if (l < 1e-9) return;
    const double nx = -dy / l * w / 2, ny = dx / l * w / 2;
    const float q[8] = {float(a.x - nx), float(a.y - ny), float(a.x + nx), float(a.y + ny), float(b.x + nx), float(b.y + ny), float(b.x - nx), float(b.y - ny)};
    quad(q, de.uvs, cr, cg, cb, ca);
  };
  auto raio = [&](int ie, const DadosEmissor& de, const EstadoEmissor& ee, const EstadoSlot& s) {
    const double intens = std::min(std::max(ee.taxa, 0.0), 1.0);
    const Cor& c0 = de.cores[0];
    const float cr = c0.r * s.cor.r, cg = c0.g * s.cor.g, cb = c0.b * s.cor.b, ca = float(c0.a * s.cor.a * intens);
    if (ca <= 0) return;
    linhas_raio(e, ie, raios);
    for (size_t k = 0; k < raios.size(); ++k) {
      const std::vector<double>& ln = raios[k];
      const double w = k == 0 ? de.largura : de.largura / 2;
      for (size_t i = 0; i + 3 < ln.size(); i += 2) pedaco(de, P2{ln[i], ln[i + 1]}, P2{ln[i + 2], ln[i + 3]}, w, cr, cg, cb, ca);
    }
  };
  auto particulas = [&](int si) {
    if (m.emissores_do_slot.empty()) return;
    const EstadoSlot& s = e.slots()[size_t(si)];
    if (s.cor.a <= 0) return;
    for (int ie : m.emissores_do_slot[size_t(si)]) {
      const DadosEmissor& de = m.emissores[size_t(ie)];
      const EstadoEmissor& ee = e.emissores()[size_t(ie)];
      if (de.pagina < 0 || (!de.raio && ee.vivas.empty())) continue;
      Lote& l = lote(Comando::Triangulos, de.pagina, de.blend >= 0 ? Blend(de.blend) : m.slots[size_t(si)].blend);
      const size_t li = size_t(&l - d.lotes.data());
      if (de.raio) {
        raio(ie, de, ee, s);
        d.lotes[li].quantos = uint32_t(d.indices.size()) - d.lotes[li].inicio;
        continue;
      }
      const size_t nc = de.cores.size();
      for (const Particula& p : ee.vivas) {
        const double f = p.vida > 0 ? std::min(p.idade / p.vida, 1.0) : 1;
        const double esc = de.escala[0] + (de.escala[1] - de.escala[0]) * f;
        // a cor entre os dois tons vizinhos da lista
        const double pos = f * double(nc - 1);
        const size_t k0 = std::min(size_t(pos), nc - 1), k1 = std::min(k0 + 1, nc - 1);
        const double fr = pos - double(k0);
        const Cor &c0 = de.cores[k0], &c1 = de.cores[k1];
        const float cr = float(c0.r + (c1.r - c0.r) * fr) * s.cor.r;
        const float cg = float(c0.g + (c1.g - c0.g) * fr) * s.cor.g;
        const float cb = float(c0.b + (c1.b - c0.b) * fr) * s.cor.b;
        const float ca = float(c0.a + (c1.a - c0.a) * fr) * s.cor.a;
        if (ca <= 0 || esc <= 0) continue;
        double px = p.x;
        if (de.onda[0] != 0) px += de.onda[0] * std::sin(2 * PI * (de.onda[1] * p.idade + p.fase));
        const double cs = std::cos(p.rot * GRAU) * esc, sn = std::sin(p.rot * GRAU) * esc;
        const double l0 = -de.meia_largura, r0 = de.meia_largura, b0 = -de.meia_altura, t0 = de.meia_altura;
        const double cx[4] = {l0, l0, r0, r0}, cy[4] = {b0, t0, t0, b0};
        float q[8];
        for (int k = 0; k < 4; ++k) q[k * 2] = float(px + cx[k] * cs - cy[k] * sn), q[k * 2 + 1] = float(p.y + cx[k] * sn + cy[k] * cs);
        quad(q, de.uvs, cr, cg, cb, ca);
      }
      d.lotes[li].quantos = uint32_t(d.indices.size()) - d.lotes[li].inicio;
    }
  };
  for (int si : e.ordem()) {
    const EstadoSlot& s = e.slots()[size_t(si)];
    const DadosSlot& ds = m.slots[size_t(si)];
    if (s.parte >= 0) {
      const Parte& p = m.partes[size_t(s.parte)];
      if (p.tipo == TipoParte::Recorte) {
        if (recorte_fim != -2) fecha_recorte();
        mundo.assign(size_t(p.num_vertices) * 2, 0);
        e.vertices_geometria(si, p, mundo.data());
        if (d.recorte_cpu) {
          std::vector<P2> pol(size_t(p.num_vertices));
          for (int i = 0; i < p.num_vertices; ++i) pol[size_t(i)] = {mundo[size_t(i) * 2], mundo[size_t(i) * 2 + 1]};
          recorte = pedacos(std::move(pol));
          caixas.assign(recorte.size() * 4, 0);
          for (size_t ip = 0; ip < recorte.size(); ++ip) {
            double* cx = &caixas[ip * 4];
            cx[0] = cx[2] = recorte[ip][0].x;
            cx[1] = cx[3] = recorte[ip][0].y;
            for (const P2& q : recorte[ip]) {
              cx[0] = std::min(cx[0], q.x), cx[2] = std::max(cx[2], q.x);
              cx[1] = std::min(cx[1], q.y), cx[3] = std::max(cx[3], q.y);
            }
          }
          recorte_fim = p.fim == si ? -1 : p.fim;
          continue;
        }
        const uint32_t base = uint32_t(d.vertices.size() / 8);
        for (int i = 0; i < p.num_vertices; ++i)
          d.vertices.insert(d.vertices.end(), {float(mundo[size_t(i) * 2]), float(mundo[size_t(i) * 2 + 1]), 0, 0, 1, 1, 1, 1});
        Lote& l = lote(Comando::ComecaRecorte, -1, Blend::Normal);
        for (int i = 1; i + 1 < p.num_vertices; ++i) d.indices.insert(d.indices.end(), {base, base + uint32_t(i), base + uint32_t(i) + 1});
        l.quantos = uint32_t(d.indices.size()) - l.inicio;
        // o recorte vale do slot seguinte ate o slot `fim` (inclusive); acabar nele mesmo
        // nao fecha nada, entao vale ate o fim do desenho
        recorte_fim = p.fim == si ? -1 : p.fim;
        continue;
      }
      const Cor cs = s.cor, cp = p.cor;
      const float r = cs.r * cp.r, g = cs.g * cp.g, b = cs.b * cp.b, a = cs.a * cp.a;
      // invisivel ou sem imagem: nem calcula os vertices (os brilhos apagados sao muitos)
      if (a <= 0 || p.pagina < 0 || p.uvs.empty()) {
        particulas(si);
        if (recorte_fim >= 0 && si == recorte_fim) fecha_recorte();
        continue;
      }
      const size_t n = e.vertices(si, mundo);
      if (n && p.uvs.size() == n) {
        const uint32_t base = uint32_t(d.vertices.size() / 8);
        d.vertices.resize(d.vertices.size() + n * 4);
        float* w = d.vertices.data() + size_t(base) * 8;
        for (size_t i = 0; i < n; i += 2, w += 8) {
          w[0] = float(mundo[i]);
          w[1] = float(mundo[i + 1]);
          w[2] = p.uvs[i];
          w[3] = p.uvs[i + 1];
          w[4] = r;
          w[5] = g;
          w[6] = b;
          w[7] = a;
        }
        int efeito = -1;
        if (s.efeitos.algum()) {
          // a caixa da imagem na pagina (antes de crescer) e, na regiao com linha ou brilho,
          // os cantos para fora pela margem (docs/NUCLEO.md "Efeitos")
          EfeitosLote el;
          el.valores = s.efeitos;
          el.caixa[0] = el.caixa[2] = p.uvs[0];
          el.caixa[1] = el.caixa[3] = p.uvs[1];
          for (size_t i = 2; i < n; i += 2) {
            el.caixa[0] = std::min(el.caixa[0], p.uvs[i]), el.caixa[2] = std::max(el.caixa[2], p.uvs[i]);
            el.caixa[1] = std::min(el.caixa[1], p.uvs[i + 1]), el.caixa[3] = std::max(el.caixa[3], p.uvs[i + 1]);
          }
          const float margem = s.efeitos.margem();
          const Pagina& pg = m.paginas[size_t(p.pagina)];
          if (p.tipo == TipoParte::Regiao && margem > 0 && pg.largura > 0 && pg.altura > 0) {
            // cantos: baixo-esquerda, cima-esquerda, cima-direita, baixo-direita; ex vai do
            // primeiro ao ultimo, ey do primeiro ao segundo (posicao e uv juntos)
            float* q = d.vertices.data() + size_t(base) * 8;
            float ex[4], ey[4];
            for (int c = 0; c < 4; ++c) ex[c] = q[24 + c] - q[c], ey[c] = q[8 + c] - q[c];
            const double lx = std::hypot(ex[2] * pg.largura, ex[3] * pg.altura);
            const double ly = std::hypot(ey[2] * pg.largura, ey[3] * pg.altura);
            const float fx = lx > 0 ? float(margem / lx) : 0, fy = ly > 0 ? float(margem / ly) : 0;
            static const float sx[4] = {-1, -1, 1, 1}, sy[4] = {-1, 1, 1, -1};
            for (int k = 0; k < 4; ++k)
              for (int c = 0; c < 4; ++c) q[k * 8 + c] += sx[k] * ex[c] * fx + sy[k] * ey[c] * fy;
          }
          el.pagina[0] = float(std::max(pg.largura, 1));
          el.pagina[1] = float(std::max(pg.altura, 1));
          if ((p.tipo == TipoParte::Malha || p.tipo == TipoParte::MalhaLigada) && margem > 0 && p.contorno >= 3 && pg.largura > 0 && pg.altura > 0 &&
              size_t(p.contorno) * 2 <= n)
            crescer_malha(d.vertices.data() + size_t(base) * 8, p.contorno, margem, pg.largura, pg.altura);
          efeito = int(d.efeitos.size());
          d.efeitos.push_back(el);
        }
        Lote& l = lote(Comando::Triangulos, p.pagina, ds.blend, efeito);
        const size_t li = size_t(&l - d.lotes.data());
        // recorte na CPU: primeiro a peca inteira pela caixa dela (fora de todos os pedacos:
        // nada; dentro de um pedaco convexo: os triangulos vao direto), so o resto por triangulo
        int recorte_peca = recorte_fim != -2 && d.recorte_cpu ? 1 : 0;  // 1: cortar por triangulo
        if (recorte_peca) {
          const float* v = d.vertices.data() + size_t(base) * 8;
          double x0 = v[0], x1 = v[0], y0 = v[1], y1 = v[1];
          for (size_t i = 1; i < n / 2; ++i) {
            x0 = std::min(x0, double(v[i * 8])), x1 = std::max(x1, double(v[i * 8]));
            y0 = std::min(y0, double(v[i * 8 + 1])), y1 = std::max(y1, double(v[i * 8 + 1]));
          }
          bool toca = false;
          for (size_t ip = 0; ip < recorte.size(); ++ip) {
            const double* cx = &caixas[ip * 4];
            if (x1 < cx[0] || x0 > cx[2] || y1 < cx[1] || y0 > cx[3]) continue;
            toca = true;
            const auto& pc = recorte[ip];
            const P2 cantos[4] = {{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}};
            bool dentro = true;
            for (size_t ed = 0, ne = pc.size(); ed < ne && dentro; ++ed)
              for (const P2& q : cantos)
                if (cruz(pc[ed], pc[(ed + 1) % ne], q) < 0) {
                  dentro = false;
                  break;
                }
            if (dentro) {
              recorte_peca = 0;
              break;
            }
          }
          if (!toca) recorte_peca = 2;  // 2: fora, nao desenha
        }
        if (recorte_peca == 1) {
          static const uint16_t quad[6] = {0, 1, 2, 2, 3, 0};
          const uint16_t* tri = p.tipo == TipoParte::Regiao ? quad : p.triangulos.data();
          const size_t ntri = p.tipo == TipoParte::Regiao ? 6 : p.triangulos.size();
          if (recorte.size() == 1) {
            // um pedaco so (o caso comum, recorte convexo): cada vertice testado uma vez; o
            // triangulo com os tres dentro vai direto, o resto e cortado
            const auto& pc = recorte[0];
            dentro_v.assign(n / 2, 1);
            const float* v = d.vertices.data() + size_t(base) * 8;
            for (size_t i = 0; i < n / 2; ++i) {
              const P2 q{v[i * 8], v[i * 8 + 1]};
              for (size_t ed = 0, ne = pc.size(); ed < ne; ++ed)
                if (cruz(pc[ed], pc[(ed + 1) % ne], q) < 0) {
                  dentro_v[i] = 0;
                  break;
                }
            }
            for (size_t t = 0; t + 2 < ntri; t += 3) {
              if (dentro_v[tri[t]] && dentro_v[tri[t + 1]] && dentro_v[tri[t + 2]]) {
                d.indices.push_back(base + tri[t]);
                d.indices.push_back(base + tri[t + 1]);
                d.indices.push_back(base + tri[t + 2]);
              } else {
                tri_cortado(base + tri[t], base + tri[t + 1], base + tri[t + 2]);
              }
            }
          } else {
            for (size_t t = 0; t + 2 < ntri; t += 3) tri_cortado(base + tri[t], base + tri[t + 1], base + tri[t + 2]);
          }
        } else if (recorte_peca == 0 && p.tipo == TipoParte::Regiao) {
          d.indices.insert(d.indices.end(), {base, base + 1, base + 2, base + 2, base + 3, base});
        } else if (recorte_peca == 0) {
          for (uint16_t t : p.triangulos) d.indices.push_back(base + t);
        }
        d.lotes[li].quantos = uint32_t(d.indices.size()) - d.lotes[li].inicio;
      }
    }
    particulas(si);
    if (recorte_fim >= 0 && si == recorte_fim) fecha_recorte();
  }
  if (recorte_fim != -2) fecha_recorte();
}

}  // namespace mamulengo
