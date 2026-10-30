// .boneco binario (docs/FORMATO.md "Binario"): a mesma arvore do texto, menor e mais rapida de
// ler. Textos numa tabela (cada chave e nome uma vez so), numeros como decimal compacto
// (mantissa e casas, lido como mantissa / 10^casas, o mesmo double que o texto da) e listas de
// numeros empacotadas com uma escala so. Json::ler reconhece o binario pelo comeco ("BNCB").
#pragma once

#include <string>
#include <string_view>

#include "mamulengo/json.h"

namespace mamulengo {

// o comeco do arquivo binario: "BNCB" e a versao
constexpr char MAGICA_BINARIO[5] = {'B', 'N', 'C', 'B', 1};

inline bool eh_binario(std::string_view b) { return b.size() >= 5 && b.substr(0, 5) == std::string_view(MAGICA_BINARIO, 5); }

// a arvore em binario (os bytes num std::string). Cada numero sai com o valor exato que tem na
// arvore: o que nao cabe num decimal compacto vai como double cru
std::string codificar_binario(const Json& j);

// le o binario; em erro devolve false e preenche `erro`
bool ler_binario(std::string_view b, Json& out, std::string* erro);

}  // namespace mamulengo
