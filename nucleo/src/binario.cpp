// .boneco binario (docs/FORMATO.md "Binario"). Depois da magica ("BNCB", versao 1):
//   tabela de textos: n (varint), cada um: tamanho (varint) e os bytes (utf-8)
//   o valor raiz
// Um valor e um byte de tipo e o que ele pede:
//   0 nulo, 1 falso, 2 verdadeiro
//   3 inteiro: zigzag varint
//   4 decimal: zigzag varint m e 1 byte e (0 a 22): o numero e m / 10^e
//   5 double cru: 8 bytes, little endian
//   6 texto: indice na tabela (varint)
//   7 lista: n (varint) e n valores
//   8 objeto: n (varint) e n pares: indice da chave (varint) e o valor
//   9 lista de numeros: n (varint), 1 byte e, 1 byte passo e n zigzag varint: com passo 0, cada
//     um e m; com passo p (1 ou 2), os p primeiros sao m e os outros a diferenca para o m de p
//     antes (pares x, y andam de 2 em 2). O numero e m / 10^e
// Com |m| < 2^53 e 10^e exato em double (e <= 22), m / 10^e e uma divisao so, arredondada
// certo: da o mesmo double que o texto decimal lido pelo leitor de JSON. O codificador confere
// cada numero e manda como double cru o que nao volta igual.
#include "mamulengo/binario.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <climits>
#include <cstdint>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace mamulengo {

namespace {

constexpr int MAX_CASAS = 22;
constexpr double LIMITE_M = 9007199254740992.0;  // 2^53
const double POT10[MAX_CASAS + 1] = {1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
                                     1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22};

enum : uint8_t { NULO, FALSO, VERDADEIRO, INTEIRO, DECIMAL, CRU, TEXTO, LISTA, OBJETO, NUMEROS };

// o menor e com v == m / 10^e exatamente (m inteiro, |m| < 2^53); false se nao ha
bool decimal(double v, int64_t& m, int& e) {
  if (!std::isfinite(v) || (v == 0 && std::signbit(v))) return false;
  for (e = 0; e <= MAX_CASAS; ++e) {
    const double x = std::nearbyint(v * POT10[e]);
    if (std::fabs(x) >= LIMITE_M) return false;
    if (x / POT10[e] == v) {
      m = int64_t(x);
      return true;
    }
  }
  return false;
}

class Escritor {
 public:
  std::string out;

  void codificar(const Json& raiz) {
    juntar_textos(raiz);
    out.append(MAGICA_BINARIO, 5);
    varint(uint64_t(textos_.size()));
    for (const std::string* s : textos_) {
      varint(s->size());
      out.append(*s);
    }
    valor(raiz);
  }

 private:
  std::unordered_map<std::string_view, uint32_t> indice_;
  std::vector<const std::string*> textos_;

  void texto_tabela(const std::string& s) {
    if (indice_.emplace(s, uint32_t(textos_.size())).second) textos_.push_back(&s);
  }
  void juntar_textos(const Json& j) {
    if (j.texto()) texto_tabela(j.str());
    for (const Json& x : j.itens()) juntar_textos(x);
    for (const auto& [k, v] : j.campos()) {
      texto_tabela(k);
      juntar_textos(v);
    }
  }

  void varint(uint64_t x) {
    while (x >= 0x80) {
      out.push_back(char(uint8_t(x) | 0x80));
      x >>= 7;
    }
    out.push_back(char(x));
  }
  void zigzag(int64_t m) { varint((uint64_t(m) << 1) ^ uint64_t(m >> 63)); }

  void numero(double v) {
    int64_t m;
    int e;
    if (decimal(v, m, e)) {
      out.push_back(char(e == 0 ? INTEIRO : DECIMAL));
      zigzag(m);
      if (e) out.push_back(char(e));
      return;
    }
    out.push_back(char(CRU));
    uint64_t b;
    std::memcpy(&b, &v, 8);
    for (int i = 0; i < 8; ++i) out.push_back(char(uint8_t(b >> (i * 8))));
  }

  // lista so de numeros que cabem todos numa escala so: a lista empacotada
  bool numeros(const std::vector<Json>& itens) {
    if (itens.size() < 2) return false;
    int casas = 0;
    for (const Json& x : itens) {
      int64_t m;
      int e;
      if (!x.numero() || !decimal(x.num(), m, e)) return false;
      casas = std::max(casas, e);
    }
    std::vector<int64_t> ms;
    ms.reserve(itens.size());
    for (const Json& x : itens) {
      const double y = std::nearbyint(x.num() * POT10[casas]);
      if (std::fabs(y) >= LIMITE_M || y / POT10[casas] != x.num()) return false;
      ms.push_back(int64_t(y));
    }
    // o passo que da menos bytes: diferencas pequenas tambem comprimem melhor (gzip, brotli)
    auto tam = [](uint64_t x) { int n = 1; while (x >= 0x80) x >>= 7, ++n; return n; };
    auto zz = [](int64_t m) { return (uint64_t(m) << 1) ^ uint64_t(m >> 63); };
    int passo = 0;
    size_t menor = SIZE_MAX;
    for (int p = 0; p <= 2; ++p) {
      size_t b = 0;
      for (size_t k = 0; k < ms.size(); ++k) b += tam(zz(p && k >= size_t(p) ? ms[k] - ms[k - size_t(p)] : ms[k]));
      if (b < menor) menor = b, passo = p;
    }
    out.push_back(char(NUMEROS));
    varint(itens.size());
    out.push_back(char(casas));
    out.push_back(char(passo));
    for (size_t k = 0; k < ms.size(); ++k) zigzag(passo && k >= size_t(passo) ? ms[k] - ms[k - size_t(passo)] : ms[k]);
    return true;
  }

  void valor(const Json& j) {
    switch (j.tipo()) {
      case Json::Tipo::Nulo: out.push_back(char(NULO)); break;
      case Json::Tipo::Logico: out.push_back(char(j.sim() ? VERDADEIRO : FALSO)); break;
      case Json::Tipo::Numero: numero(j.num()); break;
      case Json::Tipo::Texto:
        out.push_back(char(TEXTO));
        varint(indice_.find(j.str())->second);
        break;
      case Json::Tipo::Lista:
        if (numeros(j.itens())) break;
        out.push_back(char(LISTA));
        varint(j.itens().size());
        for (const Json& x : j.itens()) valor(x);
        break;
      case Json::Tipo::Objeto:
        out.push_back(char(OBJETO));
        varint(j.campos().size());
        for (const auto& [k, v] : j.campos()) {
          varint(indice_.find(k)->second);
          valor(v);
        }
        break;
    }
  }
};

}  // namespace

class LeitorBinario {
 public:
  LeitorBinario(std::string_view b) : p_(reinterpret_cast<const uint8_t*>(b.data())), fim_(p_ + b.size()) {}
  std::string erro;

  bool ler(Json& out) {
    if (size_t(fim_ - p_) < 5 || std::memcmp(p_, MAGICA_BINARIO, 5) != 0) return falha("nao e um .boneco binario (versao 1)");
    p_ += 5;
    uint64_t n;
    if (!varint(n) || n > uint64_t(fim_ - p_)) return falha("tabela de textos invalida");
    textos_.resize(size_t(n));
    for (std::string& s : textos_) {
      uint64_t t;
      if (!varint(t) || t > uint64_t(fim_ - p_)) return falha("texto invalido");
      s.assign(reinterpret_cast<const char*>(p_), size_t(t));
      p_ += t;
    }
    if (!valor(out, 0)) return false;
    return p_ == fim_ || falha("lixo depois do valor");
  }

 private:
  const uint8_t* p_;
  const uint8_t* fim_;
  std::vector<std::string> textos_;

  bool falha(const char* msg) {
    if (erro.empty()) erro = msg;
    return false;
  }
  bool byte(uint8_t& b) {
    if (p_ >= fim_) return falha("fim inesperado");
    b = *p_++;
    return true;
  }
  bool varint(uint64_t& x) {
    x = 0;
    for (int s = 0; s < 64; s += 7) {
      uint8_t b;
      if (!byte(b)) return false;
      x |= uint64_t(b & 0x7f) << s;
      if (!(b & 0x80)) return true;
    }
    return falha("varint longo demais");
  }
  bool zigzag(int64_t& m) {
    uint64_t x;
    if (!varint(x)) return false;
    m = int64_t(x >> 1) ^ -int64_t(x & 1);
    return true;
  }
  bool casas(int& e) {
    uint8_t b;
    if (!byte(b)) return false;
    if (b > MAX_CASAS) return falha("casas decimais demais");
    e = b;
    return true;
  }
  bool indice(const std::string*& s) {
    uint64_t i;
    if (!varint(i)) return false;
    if (i >= textos_.size()) return falha("indice de texto fora da tabela");
    s = &textos_[size_t(i)];
    return true;
  }
  static void num(Json& out, double v) {
    out.tipo_ = Json::Tipo::Numero;
    out.num_ = v;
  }

  bool valor(Json& out, int fundo) {
    if (fundo > 256) return falha("aninhamento demais");
    uint8_t t;
    if (!byte(t)) return false;
    switch (t) {
      case NULO: return true;
      case FALSO:
      case VERDADEIRO:
        out.tipo_ = Json::Tipo::Logico;
        out.log_ = t == VERDADEIRO;
        return true;
      case INTEIRO: {
        int64_t m;
        if (!zigzag(m)) return false;
        num(out, double(m));
        return true;
      }
      case DECIMAL: {
        int64_t m;
        int e;
        if (!zigzag(m) || !casas(e)) return false;
        num(out, double(m) / POT10[e]);
        return true;
      }
      case CRU: {
        if (fim_ - p_ < 8) return falha("fim inesperado");
        uint64_t b = 0;
        for (int i = 0; i < 8; ++i) b |= uint64_t(p_[i]) << (i * 8);
        p_ += 8;
        double v;
        std::memcpy(&v, &b, 8);
        num(out, v);
        return true;
      }
      case TEXTO: {
        const std::string* s;
        if (!indice(s)) return false;
        out.tipo_ = Json::Tipo::Texto;
        out.str_ = *s;
        return true;
      }
      case LISTA: {
        uint64_t n;
        if (!varint(n) || n > uint64_t(fim_ - p_)) return falha("lista invalida");
        out.tipo_ = Json::Tipo::Lista;
        out.itens_.resize(size_t(n));
        for (Json& x : out.itens_)
          if (!valor(x, fundo + 1)) return false;
        return true;
      }
      case OBJETO: {
        uint64_t n;
        if (!varint(n) || n > uint64_t(fim_ - p_)) return falha("objeto invalido");
        out.tipo_ = Json::Tipo::Objeto;
        out.campos_.resize(size_t(n));
        for (auto& [k, v] : out.campos_) {
          const std::string* s;
          if (!indice(s)) return false;
          k = *s;
          if (!valor(v, fundo + 1)) return false;
        }
        return true;
      }
      case NUMEROS: {
        uint64_t n;
        int e;
        uint8_t passo;
        if (!varint(n) || n > uint64_t(fim_ - p_) || !casas(e) || !byte(passo) || passo > 2) return falha("lista de numeros invalida");
        out.tipo_ = Json::Tipo::Lista;
        out.itens_.resize(size_t(n));
        std::vector<int64_t> ms(static_cast<size_t>(n));
        for (size_t k = 0; k < ms.size(); ++k) {
          int64_t d;
          if (!zigzag(d)) return false;
          ms[k] = passo && k >= passo ? ms[k - passo] + d : d;
          num(out.itens_[k], e ? double(ms[k]) / POT10[e] : double(ms[k]));
        }
        return true;
      }
    }
    return falha("tipo de valor desconhecido");
  }
};

std::string codificar_binario(const Json& j) {
  Escritor w;
  w.codificar(j);
  return std::move(w.out);
}

bool ler_binario(std::string_view b, Json& out, std::string* erro) {
  LeitorBinario l(b);
  out = Json();
  if (!l.ler(out)) {
    if (erro) *erro = l.erro;
    out = Json();
    return false;
  }
  return true;
}

}  // namespace mamulengo
