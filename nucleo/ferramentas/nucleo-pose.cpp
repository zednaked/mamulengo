// nucleo-pose <x.boneco> <animacao|-> <t1,t2,...> [--repetir N]
// Escreve em stdout o JSON do contrato (docs/NUCLEO.md "Contrato da ferramenta de teste").
// --caixa cpu|gpu: em vez das poses, por instante, o desenho (com o recorte na CPU ou no stencil):
//   triangulos desenhados e a caixa dos vertices que eles usam, uma linha por instante
// --repetir N: calcula cada pose N vezes (do zero) e escreve o tempo medio em stderr.
// --quadros N: toca a animacao N quadros seguidos a 60 por segundo, como no jogo (aplicar,
//   relogio, mundo e vertices de todos os slots), e escreve o tempo medio por quadro; depois,
//   o mesmo laco separando a pose (aplicar e mundo) do desenho (desenhar, o que o jogo chama).
#include <chrono>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "mamulengo/desenho.h"
#include "mamulengo/pose.h"
#include "saida.h"

using namespace mamulengo;

namespace {

// calcula a pose no instante t do zero, como um personagem novo (docs/NUCLEO.md "Relogio")
void posar(Esqueleto& e, int anim, double t) {
  e.setup();
  e.atualizar_mundo();  // a fisica reinicia na pose de setup
  // o primeiro quadro e no instante 0 (dt = 0); depois passos de 1/64 s e o resto
  const double passo = 1.0 / 64;
  double acc = 0, dt = 0;
  while (true) {
    e.aplicar(anim, acc);
    e.avancar(dt);
    e.atualizar_mundo();
    if (acc >= t) break;
    dt = std::min(passo, t - acc);
    acc += dt;
    if (t - acc < 1e-12) acc = t;
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr, "uso: nucleo-pose <x.boneco> <animacao|-> <t1,t2,...> [--repetir N]\n");
    return 2;
  }
  int repetir = 0, quadros = 0;
  const char* caixa = nullptr;
  for (int i = 4; i + 1 < argc; ++i) {
    if (!std::strcmp(argv[i], "--caixa")) caixa = argv[i + 1];
    if (!std::strcmp(argv[i], "--repetir")) repetir = std::atoi(argv[i + 1]);
    if (!std::strcmp(argv[i], "--quadros")) quadros = std::atoi(argv[i + 1]);
  }

  std::ifstream f(argv[1], std::ios::binary);
  if (!f) {
    std::fprintf(stderr, "nao abri %s\n", argv[1]);
    return 1;
  }
  std::stringstream ss;
  ss << f.rdbuf();
  const std::string texto = ss.str();
  std::string erro;
  auto modelo = ler_boneco(texto, argv[1], abrir_do_disco(), &erro);
  if (!modelo) {
    std::fprintf(stderr, "%s: %s\n", argv[1], erro.c_str());
    return 1;
  }
  int anim = -1;
  if (std::strcmp(argv[2], "-") != 0) {
    anim = modelo->animacao(argv[2]);
    if (anim < 0) {
      std::fprintf(stderr, "animacao desconhecida: %s\n", argv[2]);
      return 1;
    }
  }
  std::vector<double> tempos;
  {
    std::string lista = argv[3];
    size_t p = 0;
    while (p <= lista.size()) {
      size_t q = lista.find(',', p);
      if (q == std::string::npos) q = lista.size();
      if (q > p) {
        const double t = std::strtod(lista.substr(p, q - p).c_str(), nullptr);
        if (!std::isfinite(t) || t < 0) {
          std::fprintf(stderr, "instante invalido: %s\n", lista.substr(p, q - p).c_str());
          return 2;
        }
        tempos.push_back(t);
      }
      p = q + 1;
    }
  }

  Esqueleto e(modelo);
  const Modelo& m = *modelo;

  if (caixa) {
    Desenho d;
    d.recorte_cpu = !std::strcmp(caixa, "cpu");
    for (double t : tempos) {
      posar(e, anim, t);
      d.limpar();
      desenhar(e, d);
      double x0 = 1e30, y0 = 1e30, x1 = -1e30, y1 = -1e30;
      size_t tris = 0, recortes = 0;
      for (const Lote& l : d.lotes) {
        if (l.comando == Comando::ComecaRecorte) ++recortes;
        if (l.comando != Comando::Triangulos) continue;
        tris += l.quantos / 3;
        for (uint32_t k = l.inicio; k < l.inicio + l.quantos; ++k) {
          const float* v = d.vertices.data() + size_t(d.indices[k]) * 8;
          x0 = std::min(x0, double(v[0])), x1 = std::max(x1, double(v[0]));
          y0 = std::min(y0, double(v[1])), y1 = std::max(y1, double(v[1]));
        }
      }
      std::printf("%g %zu triangulos, %zu recortes, caixa %.3f %.3f %.3f %.3f\n", t, tris, recortes, x0, y0, x1, y1);
    }
    return 0;
  }

  if (repetir > 0) {
    auto t0 = std::chrono::steady_clock::now();
    size_t poses = 0;
    for (int r = 0; r < repetir; ++r)
      for (double t : tempos) {
        posar(e, anim, t);
        std::vector<double> v;
        for (size_t s = 0; s < m.slots.size(); ++s) e.vertices(int(s), v);
        ++poses;
      }
    auto t1 = std::chrono::steady_clock::now();
    std::fprintf(stderr, "%.6f ms por pose\n", std::chrono::duration<double, std::milli>(t1 - t0).count() / double(poses));
  }

  if (quadros > 0) {
    e.setup();
    e.atualizar_mundo();
    std::vector<double> v;
    double soma = 0;
    auto t0 = std::chrono::steady_clock::now();
    for (int q = 0; q < quadros; ++q) {
      e.aplicar(anim, q / 60.0);
      e.avancar(1 / 60.0);
      e.atualizar_mundo();
      for (size_t s = 0; s < m.slots.size(); ++s)
        if (e.vertices(int(s), v)) soma += v[0];
    }
    auto t1 = std::chrono::steady_clock::now();
    std::fprintf(stderr, "%.6f ms por quadro (%g)\n", std::chrono::duration<double, std::milli>(t1 - t0).count() / quadros, soma);
    // o mesmo laco separando a pose (aplicar e mundo) do desenho (desenhar, o que o jogo chama)
    e.setup();
    e.atualizar_mundo();
    Desenho d;
    double ms_pose = 0, ms_desenho = 0;
    size_t verts = 0;
    for (int q = 0; q < quadros; ++q) {
      const auto a0 = std::chrono::steady_clock::now();
      e.aplicar(anim, q / 60.0);
      e.avancar(1 / 60.0);
      e.atualizar_mundo();
      const auto a1 = std::chrono::steady_clock::now();
      d.limpar();
      desenhar(e, d);
      const auto a2 = std::chrono::steady_clock::now();
      ms_pose += std::chrono::duration<double, std::milli>(a1 - a0).count();
      ms_desenho += std::chrono::duration<double, std::milli>(a2 - a1).count();
      verts += d.vertices.size() / 8;
    }
    std::fprintf(stderr, "pose %.4f ms, desenho %.4f ms por quadro (%zu vertices, %zu lotes)\n", ms_pose / quadros, ms_desenho / quadros, verts / size_t(quadros), d.lotes.size());
  }

  std::string out = "{\"quadros\":[";
  std::vector<double> v;
  for (size_t qi = 0; qi < tempos.size(); ++qi) {
    const double t = tempos[qi];
    posar(e, anim, t);
    if (qi) out += ',';
    out += "{\"t\":";
    escreve_num(out, t);
    out += ',';
    escreve_pose(out, e, v);
    out += '}';
  }
  out += "]}\n";
  std::fwrite(out.data(), 1, out.size(), stdout);
  return 0;
}
