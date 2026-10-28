// Leitor de JSON recursivo descendente. Numeros com std::from_chars (nao depende da
// localidade do processo, que no Godot ou no navegador pode ter virgula decimal).
#include "mamulengo/json.h"

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

  bool numero(Json& out) {
    // from_chars nao aceita '+' nem o zero a esquerda do JSON e tudo bem: o JSON tambem nao
    double v = 0;
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
  LeitorJson l(texto);
  Json out;
  if (!l.valor(out, 0) || !l.fim()) {
    if (erro) *erro = l.erro;
    return Json();
  }
  return out;
}

}  // namespace mamulengo
