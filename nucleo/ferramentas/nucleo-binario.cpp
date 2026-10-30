// .boneco texto <-> binario (docs/FORMATO.md "Binario"):
//   nucleo-binario <entrada> <saida>         grava a saida em binario (a entrada pode ser texto ou binario)
//   nucleo-binario --texto <entrada> <saida> grava a saida em texto (JSON compacto)
//   nucleo-binario --medir <arquivo> [N=50]  tempo medio de ler o arquivo ate o modelo (ler_boneco)
// Confere sempre: le de volta o que gravou e compara a arvore com a da entrada, numero a numero
// (bit a bit). Escreve os tamanhos.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <algorithm>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include "mamulengo/binario.h"
#include "mamulengo/json.h"
#include "mamulengo/modelo.h"

using namespace mamulengo;

namespace {

bool igual(const Json& a, const Json& b) {
  if (a.tipo() != b.tipo()) return false;
  switch (a.tipo()) {
    case Json::Tipo::Nulo: return true;
    case Json::Tipo::Logico: return a.sim() == b.sim();
    case Json::Tipo::Numero: {
      const double x = a.num(), y = b.num();
      return std::memcmp(&x, &y, sizeof x) == 0;
    }
    case Json::Tipo::Texto: return a.str() == b.str();
    case Json::Tipo::Lista:
      if (a.itens().size() != b.itens().size()) return false;
      for (size_t i = 0; i < a.itens().size(); ++i)
        if (!igual(a.itens()[i], b.itens()[i])) return false;
      return true;
    case Json::Tipo::Objeto:
      if (a.campos().size() != b.campos().size()) return false;
      for (size_t i = 0; i < a.campos().size(); ++i)
        if (a.campos()[i].first != b.campos()[i].first || !igual(a.campos()[i].second, b.campos()[i].second)) return false;
      return true;
  }
  return false;
}

void aspas(std::string& o, const std::string& s) {
  o += '"';
  for (char c : s) {
    if (c == '"' || c == '\\') o += '\\', o += c;
    else if (c == '\n') o += "\\n";
    else if (static_cast<unsigned char>(c) < 0x20) {
      char u[8];
      std::snprintf(u, sizeof u, "\\u%04x", c);
      o += u;
    } else o += c;
  }
  o += '"';
}

// JSON compacto, com os numeros na forma mais curta que volta ao mesmo double
void escreve(std::string& o, const Json& j) {
  switch (j.tipo()) {
    case Json::Tipo::Nulo: o += "null"; break;
    case Json::Tipo::Logico: o += j.sim() ? "true" : "false"; break;
    case Json::Tipo::Numero: {
      char b[40];
      for (int p = 1; p <= 17; ++p) {
        std::snprintf(b, sizeof b, "%.*g", p, j.num());
        if (std::strtod(b, nullptr) == j.num()) break;
      }
      o += b;
      break;
    }
    case Json::Tipo::Texto: aspas(o, j.str()); break;
    case Json::Tipo::Lista:
      o += '[';
      for (size_t i = 0; i < j.itens().size(); ++i) {
        if (i) o += ',';
        escreve(o, j.itens()[i]);
      }
      o += ']';
      break;
    case Json::Tipo::Objeto:
      o += '{';
      for (size_t i = 0; i < j.campos().size(); ++i) {
        if (i) o += ',';
        aspas(o, j.campos()[i].first);
        o += ':';
        escreve(o, j.campos()[i].second);
      }
      o += '}';
      break;
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc >= 3 && !std::strcmp(argv[1], "--medir")) {
    std::ifstream f(argv[2], std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string dados = ss.str();
    const int n = argc > 3 ? std::atoi(argv[3]) : 50;
    std::string erro;
    double melhor = 1e30;
    for (int i = 0; i < n; ++i) {
      const auto t0 = std::chrono::steady_clock::now();
      auto m = ler_boneco(dados, &erro);
      const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      if (!m) {
        std::fprintf(stderr, "%s: %s\n", argv[2], erro.c_str());
        return 1;
      }
      melhor = std::min(melhor, ms);
    }
    std::printf("%.3f\n", melhor);
    return 0;
  }
  const bool texto = argc > 1 && !std::strcmp(argv[1], "--texto");
  if (argc != (texto ? 4 : 3)) {
    std::fprintf(stderr, "uso: nucleo-binario [--texto] <entrada> <saida>\n");
    return 2;
  }
  const char* ent = argv[texto ? 2 : 1];
  const char* sai = argv[texto ? 3 : 2];
  std::ifstream f(ent, std::ios::binary);
  if (!f) {
    std::fprintf(stderr, "nao abri %s\n", ent);
    return 1;
  }
  std::stringstream ss;
  ss << f.rdbuf();
  const std::string dados = ss.str();
  std::string erro;
  const Json j = Json::ler(dados, &erro);
  if (!erro.empty()) {
    std::fprintf(stderr, "%s: %s\n", ent, erro.c_str());
    return 1;
  }
  std::string out;
  if (texto) escreve(out, j);
  else out = codificar_binario(j);
  const Json volta = Json::ler(out, &erro);
  if (!erro.empty() || !igual(j, volta)) {
    std::fprintf(stderr, "%s: o que sai nao volta igual%s%s\n", ent, erro.empty() ? "" : ": ", erro.c_str());
    return 1;
  }
  std::ofstream(sai, std::ios::binary) << out;
  std::printf("%s: %zu -> %zu bytes (%s)\n", sai, dados.size(), out.size(), texto ? "texto" : "binario");
  return 0;
}
