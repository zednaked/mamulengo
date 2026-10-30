// Leitor de JSON pequeno e proprio (sem dependencias). Guarda a arvore inteira; objetos
// mantem a ordem das chaves do arquivo (o .boneco usa a ordem em alguns mapas, como as
// animacoes e as partes de uma skin).
#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace mamulengo {

class Json {
 public:
  enum class Tipo { Nulo, Logico, Numero, Texto, Lista, Objeto };

  Json() = default;

  Tipo tipo() const { return tipo_; }
  bool nulo() const { return tipo_ == Tipo::Nulo; }
  bool numero() const { return tipo_ == Tipo::Numero; }
  bool texto() const { return tipo_ == Tipo::Texto; }
  bool lista() const { return tipo_ == Tipo::Lista; }
  bool objeto() const { return tipo_ == Tipo::Objeto; }
  bool logico() const { return tipo_ == Tipo::Logico; }

  double num(double padrao = 0) const { return tipo_ == Tipo::Numero ? num_ : padrao; }
  bool sim(bool padrao = false) const { return tipo_ == Tipo::Logico ? log_ : padrao; }
  const std::string& str() const { return str_; }

  // lista
  size_t tamanho() const { return tipo_ == Tipo::Lista ? itens_.size() : (tipo_ == Tipo::Objeto ? campos_.size() : 0); }
  const Json& operator[](size_t i) const;
  const std::vector<Json>& itens() const { return itens_; }

  // objeto: devolve um Json nulo se a chave nao existe
  const Json& operator[](std::string_view chave) const;
  const Json* acha(std::string_view chave) const;
  const std::vector<std::pair<std::string, Json>>& campos() const { return campos_; }

  // atalhos para campos opcionais
  double num(std::string_view chave, double padrao) const;
  std::string str(std::string_view chave, const std::string& padrao) const;
  bool sim(std::string_view chave, bool padrao) const;

  // le o texto todo (ou o .boneco binario, reconhecido pelo comeco: mamulengo/binario.h); em
  // erro devolve nulo e preenche `erro`
  static Json ler(std::string_view texto, std::string* erro);

 private:
  friend class LeitorJson;
  friend class LeitorBinario;
  Tipo tipo_ = Tipo::Nulo;
  bool log_ = false;
  double num_ = 0;
  std::string str_;
  std::vector<Json> itens_;
  std::vector<std::pair<std::string, Json>> campos_;
};

}  // namespace mamulengo
