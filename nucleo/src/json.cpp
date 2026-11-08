// Leitor de JSON recursivo descendente. Numeros com std::from_chars (nao depende da
// localidade do processo, que no Godot ou no navegador pode ter virgula decimal).
#include "mamulengo/json.h"

#include "mamulengo/binario.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include <charconv>
#include <cstdint>

namespace mamulengo {

namespace {
const Json& nulo_estatico() {
  static const Json n;
  return n;
}
}  // namespace

const Json& Json::operator[](size_t i) const {
  if (tipo_ != Tipo::Lista || i >= itens_.size()) return nulo_estatico();
  return itens_[i];
}

const Json* Json::acha(std::string_view chave) const {
  if (tipo_ != Tipo::Objeto) return nullptr;
  for (const auto& [k, v] : campos_)
    if (k == chave) return &v;
  return nullptr;
}

const Json& Json::operator[](std::string_view chave) const {
  const Json* j = acha(chave);
  return j ? *j : nulo_estatico();
}

double Json::num(std::string_view chave, double padrao) const {
  const Json* j = acha(chave);
  return j && j->numero() ? j->num_ : padrao;
}

std::string Json::str(std::string_view chave, const std::string& padrao) const {
  const Json* j = acha(chave);
  return j && j->texto() ? j->str_ : padrao;
}

bool Json::sim(std::string_view chave, bool padrao) const {
  const Json* j = acha(chave);
  return j && j->logico() ? j->log_ : padrao;
}

class LeitorJson {
 public:
  LeitorJson(std::string_view t) : p_(t.data()), fim_(t.data() + t.size()), ini_(t.data()) {}

  bool valor(Json& out, int fundo) {
    if (fundo > 256) return falha("aninhamento demais");
    espacos();
    if (p_ >= fim_) return falha("fim inesperado");
    char c = *p_;
    if (c == '{') return objeto(out, fundo);
    if (c == '[') return lista(out, fundo);
    if (c == '"') {
      out.tipo_ = Json::Tipo::Texto;
      return texto(out.str_);
    }
    if (c == 't') return palavra("true", out, Json::Tipo::Logico, true);
    if (c == 'f') return palavra("false", out, Json::Tipo::Logico, false);
    if (c == 'n') return palavra("null", out, Json::Tipo::Nulo, false);
    return numero(out);
  }

  bool fim() {
    espacos();
    return p_ == fim_ || falha("lixo depois do valor");
  }

  std::string erro;

 private:
  const char* p_;
  const char* fim_;
  const char* ini_;

  bool falha(const char* msg) {
    if (erro.empty()) erro = std::string(msg) + " (byte " + std::to_string(p_ - ini_) + ")";
    return false;
  }

  void espacos() {
    while (p_ < fim_ && (*p_ == ' ' || *p_ == '\n' || *p_ == '\r' || *p_ == '\t')) ++p_;
  }

  bool palavra(const char* w, Json& out, Json::Tipo t, bool v) {
    const char* q = p_;
    for (const char* s = w; *s; ++s, ++q)
      if (q >= fim_ || *q != *s) return falha("palavra invalida");
    p_ = q;
    out.tipo_ = t;
    out.log_ = v;
    return true;
  }

  // Caminho rapido (Clinger): ate 19 digitos significativos, mantissa ate 2^53 e expoente decimal
  // em [-22, 22]. A mantissa e 10^e sao doubles exatos, entao uma multiplicacao ou divisao da o
  // double mais proximo, o mesmo do strtod e do from_chars. Quase todo numero de um .boneco cai
  // aqui. Sem isso, no wasm o strtod da musl faz as contas em long double de 128 bits emulado
  // (fmodl, __multf3): era mais da metade do tempo de ler um .boneco no editor e no navegador.
  bool numero_rapido(double& v) {
    static const double POT[] = {1e0,  1e1,  1e2,  1e3,  1e4,  1e5,  1e6,  1e7,  1e8,  1e9,  1e10, 1e11,
                                 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22};
    const char* q = p_;
    const auto digito = [&](const char* c) { return c < fim_ && *c >= '0' && *c <= '9'; };
    bool neg = false;
    if (q < fim_ && *q == '-') {
      neg = true;
      ++q;
    }
    if (!digito(q)) return false;
    uint64_t m = 0;
    int dig = 0, e10 = 0;
    const auto soma = [&](char c) {
      if (!m && c == '0') return true;  // zero a esquerda nao conta como digito
      if (dig >= 19) return false;
      m = m * 10 + uint64_t(c - '0');
      ++dig;
      return true;
    };
    for (; digito(q); ++q)
      if (!soma(*q)) return false;
    if (q < fim_ && *q == '.') {
      ++q;
      if (!digito(q)) return false;
      for (; digito(q); ++q, --e10)
        if (!soma(*q)) return false;
    }
    if (q < fim_ && (*q == 'e' || *q == 'E')) {
      ++q;
      bool eneg = false;
      if (q < fim_ && (*q == '+' || *q == '-')) eneg = *q++ == '-';
      if (!digito(q)) return false;
      int ex = 0;
      for (; digito(q); ++q) {
        if (ex > 10000) return false;
        ex = ex * 10 + (*q - '0');
      }
      e10 += eneg ? -ex : ex;
    }
    if (m == 0)
      v = 0.0;
    else if (m <= (uint64_t(1) << 53) && e10 >= -22 && e10 <= 22)
      v = e10 < 0 ? double(m) / POT[-e10] : double(m) * POT[e10];
    else
      return false;
    if (neg) v = -v;
    p_ = q;
    return true;
  }

  bool numero(Json& out) {
    // from_chars nao aceita '+' nem o zero a esquerda do JSON e tudo bem: o JSON tambem nao
    double v = 0;
    if (numero_rapido(v)) {
      out.tipo_ = Json::Tipo::Numero;
      out.num_ = v;
      return true;
    }
#if defined(_LIBCPP_VERSION)
    // a libc++ (a do zig, na GDExtension para Linux antigo) nao tem from_chars de double:
    // strtod numa copia do numero (o Godot nao muda o LC_NUMERIC, o ponto continua ponto)
    char buf[64];
    size_t n = 0;
    while (p_ + n < fim_ && n < sizeof(buf) - 1 && std::strchr("+-.0123456789eE", p_[n])) {
      buf[n] = p_[n];
      ++n;
    }
    buf[n] = 0;
    char* fim_num = nullptr;
    v = std::strtod(buf, &fim_num);
    if (fim_num == buf) return falha("numero invalido");
    p_ += fim_num - buf;
#else
    auto r = std::from_chars(p_, fim_, v);
    if (r.ec != std::errc() || r.ptr == p_) return falha("numero invalido");
    p_ = r.ptr;
#endif
    out.tipo_ = Json::Tipo::Numero;
    out.num_ = v;
    return true;
  }

  static void utf8(std::string& s, uint32_t c) {
    if (c < 0x80) {
      s += char(c);
    } else if (c < 0x800) {
      s += char(0xC0 | (c >> 6));
      s += char(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
      s += char(0xE0 | (c >> 12));
      s += char(0x80 | ((c >> 6) & 0x3F));
      s += char(0x80 | (c & 0x3F));
    } else {
      s += char(0xF0 | (c >> 18));
      s += char(0x80 | ((c >> 12) & 0x3F));
      s += char(0x80 | ((c >> 6) & 0x3F));
      s += char(0x80 | (c & 0x3F));
    }
  }

  bool hex4(uint32_t& v) {
    if (fim_ - p_ < 4) return falha("\\u curto");
    v = 0;
    for (int i = 0; i < 4; ++i) {
      char c = *p_++;
      v <<= 4;
      if (c >= '0' && c <= '9') v |= uint32_t(c - '0');
      else if (c >= 'a' && c <= 'f') v |= uint32_t(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') v |= uint32_t(c - 'A' + 10);
      else return falha("\\u invalido");
    }
    return true;
  }

  bool texto(std::string& s) {
    ++p_;  // aspas
    while (true) {
      if (p_ >= fim_) return falha("texto sem fim");
      char c = *p_++;
      if (c == '"') return true;
      if (c != '\\') {
        s += c;
        continue;
      }
      if (p_ >= fim_) return falha("escape sem fim");
      char e = *p_++;
      switch (e) {
        case '"': s += '"'; break;
        case '\\': s += '\\'; break;
        case '/': s += '/'; break;
        case 'b': s += '\b'; break;
        case 'f': s += '\f'; break;
        case 'n': s += '\n'; break;
        case 'r': s += '\r'; break;
        case 't': s += '\t'; break;
        case 'u': {
          uint32_t c1;
          if (!hex4(c1)) return false;
          if (c1 >= 0xD800 && c1 < 0xDC00 && fim_ - p_ >= 6 && p_[0] == '\\' && p_[1] == 'u') {
            p_ += 2;
            uint32_t c2;
            if (!hex4(c2)) return false;
            c1 = 0x10000 + ((c1 - 0xD800) << 10) + (c2 - 0xDC00);
          }
          utf8(s, c1);
          break;
        }
        default: return falha("escape invalido");
      }
    }
  }

  bool lista(Json& out, int fundo) {
    ++p_;
    out.tipo_ = Json::Tipo::Lista;
    espacos();
    if (p_ < fim_ && *p_ == ']') {
      ++p_;
      return true;
    }
    while (true) {
      out.itens_.emplace_back();
      if (!valor(out.itens_.back(), fundo + 1)) return false;
      espacos();
      if (p_ >= fim_) return falha("lista sem fim");
      char c = *p_++;
      if (c == ']') return true;
      if (c != ',') return falha("esperava , ou ]");
    }
  }

  bool objeto(Json& out, int fundo) {
    ++p_;
    out.tipo_ = Json::Tipo::Objeto;
    espacos();
    if (p_ < fim_ && *p_ == '}') {
      ++p_;
      return true;
    }
    while (true) {
      espacos();
      if (p_ >= fim_ || *p_ != '"') return falha("esperava chave");
      out.campos_.emplace_back();
      if (!texto(out.campos_.back().first)) return false;
      espacos();
      if (p_ >= fim_ || *p_++ != ':') return falha("esperava :");
      if (!valor(out.campos_.back().second, fundo + 1)) return false;
      espacos();
      if (p_ >= fim_) return falha("objeto sem fim");
      char c = *p_++;
      if (c == '}') return true;
      if (c != ',') return falha("esperava , ou }");
    }
  }
};

Json Json::ler(std::string_view texto, std::string* erro) {
  if (eh_binario(texto)) {
    Json out;
    ler_binario(texto, out, erro);
    return out;
  }
  LeitorJson l(texto);
  Json out;
  if (!l.valor(out, 0) || !l.fim()) {
    if (erro) *erro = l.erro;
    return Json();
  }
  return out;
}

namespace {
void aspas_json(std::string& o, const std::string& s) {
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

void escreve_json(std::string& o, const Json& j) {
  switch (j.tipo()) {
    case Json::Tipo::Nulo: o += "null"; break;
    case Json::Tipo::Logico: o += j.sim() ? "true" : "false"; break;
    case Json::Tipo::Numero: {
      char b[40];
#if defined(__cpp_lib_to_chars) && __cpp_lib_to_chars >= 201611L
      // o mais curto que volta ao mesmo double, sem o strtod (no wasm ele conta em long double)
      const auto r = std::to_chars(b, b + sizeof b, j.num());
      o.append(b, r.ptr);
#else
      for (int p = 1; p <= 17; ++p) {
        std::snprintf(b, sizeof b, "%.*g", p, j.num());
        if (std::strtod(b, nullptr) == j.num()) break;
      }
      o += b;
#endif
      break;
    }
    case Json::Tipo::Texto: aspas_json(o, j.str()); break;
    case Json::Tipo::Lista:
      o += '[';
      for (size_t i = 0; i < j.itens().size(); ++i) {
        if (i) o += ',';
        escreve_json(o, j.itens()[i]);
      }
      o += ']';
      break;
    case Json::Tipo::Objeto:
      o += '{';
      for (size_t i = 0; i < j.campos().size(); ++i) {
        if (i) o += ',';
        aspas_json(o, j.campos()[i].first);
        o += ':';
        escreve_json(o, j.campos()[i].second);
      }
      o += '}';
      break;
  }
}
}  // namespace

std::string escrever_json(const Json& j) {
  std::string o;
  escreve_json(o, j);
  return o;
}

}  // namespace mamulengo
