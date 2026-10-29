// nucleo-estado <x.boneco> <roteiro.json> [--repetir N]
// Toca um roteiro (tools/nucleo-estado.ts) com o Estado do nucleo e escreve em stdout a pose de
// cada quadro e os eventos:
//   { "quadros": [ { "q": 0, "ossos": {...}, "slots": [...], "vertices": {...} } ],
//     "eventos": [ { "quadro", "tipo", "trilha", "animacao", "nome"?, "tempo"?, ... } ] }
// Por quadro q (a ordem do oraculo):
//   acoes do quadro (tocar, enfileirar, vazio, enfileirar_vazio, limpar, limpar_trilha, escala_tempo);
//   estado.avancar(d); estado.aplicar(e);
//   acoes de slot do quadro (cor, esconder);
//   e.avancar(d); e.atualizar_mundo();
// --repetir N: toca o roteiro N vezes sem escrever a pose e mostra o tempo medio por quadro.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "mamulengo/estado.h"
#include "mamulengo/json.h"
#include "mamulengo/pose.h"
#include "saida.h"

using namespace mamulengo;

namespace {

bool le(const char* arq, std::string& texto) {
  std::ifstream f(arq, std::ios::binary);
  if (!f) return false;
  std::stringstream ss;
  ss << f.rdbuf();
  texto = ss.str();
  return true;
}

const char* nome_tipo(TipoEvento t) {
  switch (t) {
    case TipoEvento::Inicio: return "inicio";
    case TipoEvento::Interrompida: return "interrompida";
    case TipoEvento::Completa: return "completa";
    case TipoEvento::Fim: return "fim";
    case TipoEvento::Usuario: return "usuario";
  }
  return "?";
}

struct Roteiro {
  int quadros = 0;
  double passo = 1.0 / 60;
  std::map<int, std::vector<const Json*>> acoes;
};

// toca o roteiro; `pose` e `eventos` recebem a saida (nulos: so mede)
bool tocar(const std::shared_ptr<const Modelo>& modelo, const Json& r, const Roteiro& rt, std::string* out, std::string* evs) {
  const Modelo& m = *modelo;
  Esqueleto e(modelo);
  Estado st(modelo);
  if (const Json* mx = r.acha("mix"); mx && mx->objeto()) {
    if (mx->acha("padrao")) st.mix_padrao = (*mx)["padrao"].num(0);
    if (const Json* ps = mx->acha("pares"); ps && ps->lista())
      for (const Json& p : ps->itens()) st.definir_mix(m.animacao(p.str("de", "")), m.animacao(p.str("para", "")), p.num("tempo", 0));
  }
  e.setup();
  e.atualizar_mundo();
  std::vector<double> v;
  std::vector<Evento> lidos;
  bool primeiro_ev = true;
  auto anim = [&](const Json& a) {
    const int i = m.animacao(a.str("animacao", ""));
    if (i < 0) std::fprintf(stderr, "animacao desconhecida: %s\n", a.str("animacao", "").c_str());
    return i;
  };
  for (int q = 0; q < rt.quadros; ++q) {
    auto it = rt.acoes.find(q);
    static const std::vector<const Json*> nenhuma;
    const std::vector<const Json*>& acoes = it == rt.acoes.end() ? nenhuma : it->second;
    for (const Json* a : acoes) {
      const std::string tipo = a->str("tipo", "");
      const int t = int(a->num("trilha", 0));
      if (tipo == "tocar") {
        const int i = anim(*a);
        if (i < 0) return false;
        st.tocar(t, i, a->sim("loop", true));
      } else if (tipo == "enfileirar") {
        const int i = anim(*a);
        if (i < 0) return false;
        st.enfileirar(t, i, a->sim("loop", true), a->num("atraso", 0));
      } else if (tipo == "vazio") {
        st.vazio(t, a->num("mix", 0));
      } else if (tipo == "enfileirar_vazio") {
        st.enfileirar_vazio(t, a->num("mix", 0), a->num("atraso", 0));
      } else if (tipo == "limpar") {
        st.limpar();
      } else if (tipo == "limpar_trilha") {
        st.limpar_trilha(t);
      } else if (tipo == "escala_tempo") {
        st.escala_tempo = a->num("valor", 1);
      }
    }
    st.avancar(rt.passo);
    st.aplicar(e);
    for (const Json* a : acoes) {
      const std::string tipo = a->str("tipo", "");
      if (tipo != "cor" && tipo != "esconder") continue;
      const int s = m.slot(a->str("slot", ""));
      if (s < 0) {
        std::fprintf(stderr, "slot desconhecido: %s\n", a->str("slot", "").c_str());
        return false;
      }
      if (tipo == "cor") {
        const Json& c = (*a)["cor"];
        e.slot(s).cor = Cor{float(c[0].num(1)), float(c[1].num(1)), float(c[2].num(1)), float(c[3].num(1))};
      } else {
        e.mudar_parte(s, -1);
      }
    }
    e.avancar(rt.passo);
    e.atualizar_mundo();
    st.ler_eventos(lidos);
    if (out) {
      if (q) *out += ',';
      *out += "{\"q\":";
      escreve_num(*out, q);
      *out += ',';
      escreve_pose(*out, e, v);
      *out += '}';
      for (const Evento& ev : lidos) {
        if (!primeiro_ev) *evs += ',';
        primeiro_ev = false;
        *evs += "{\"quadro\":";
        escreve_num(*evs, q);
        *evs += ",\"tipo\":\"";
        *evs += nome_tipo(ev.tipo);
        *evs += "\",\"trilha\":";
        escreve_num(*evs, ev.trilha);
        *evs += ",\"animacao\":";
        if (ev.animacao >= 0) escreve_texto(*evs, m.animacoes[size_t(ev.animacao)].nome);
        else *evs += "null";
        if (ev.tipo == TipoEvento::Usuario) {
          *evs += ",\"nome\":";
          escreve_texto(*evs, m.eventos[size_t(ev.evento)].nome);
          *evs += ",\"tempo\":";
          escreve_num(*evs, ev.tempo);
          *evs += ",\"inteiro\":";
          escreve_num(*evs, ev.inteiro);
          *evs += ",\"decimal\":";
          escreve_num(*evs, ev.decimal);
          *evs += ",\"texto\":";
          escreve_texto(*evs, ev.texto);
          *evs += ",\"volume\":";
          escreve_num(*evs, ev.volume);
          *evs += ",\"balanco\":";
          escreve_num(*evs, ev.balanco);
        }
        *evs += '}';
      }
    } else {
      for (size_t s = 0; s < m.slots.size(); ++s) e.vertices(int(s), v);
    }
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "uso: nucleo-estado <x.boneco> <roteiro.json> [--repetir N]\n");
    return 2;
  }
  int repetir = 0;
  for (int i = 3; i + 1 < argc; ++i)
    if (!std::strcmp(argv[i], "--repetir")) repetir = std::atoi(argv[i + 1]);
  std::string texto, troteiro, erro;
  if (!le(argv[1], texto)) {
    std::fprintf(stderr, "nao abri %s\n", argv[1]);
    return 1;
  }
  if (!le(argv[2], troteiro)) {
    std::fprintf(stderr, "nao abri %s\n", argv[2]);
    return 1;
  }
  auto modelo = ler_boneco(texto, &erro);
  if (!modelo) {
    std::fprintf(stderr, "%s: %s\n", argv[1], erro.c_str());
    return 1;
  }
  Json r = Json::ler(troteiro, &erro);
  if (!r.objeto()) {
    std::fprintf(stderr, "roteiro invalido: %s\n", erro.c_str());
    return 1;
  }
  // os pares do roteiro substituem os do .boneco (lista vazia: nenhum par), como no comparador
  if (const Json* mx = r.acha("mix"); mx && mx->objeto() && mx->acha("pares")) {
    auto copia = std::make_shared<Modelo>(*modelo);
    copia->mix_pares.clear();
    modelo = std::move(copia);
  }
  Roteiro rt;
  rt.quadros = int(r.num("quadros", 0));
  rt.passo = r.num("passo", 1.0 / 60);
  for (const Json& a : r["acoes"].itens()) rt.acoes[int(a.num("quadro", 0))].push_back(&a);

  if (repetir > 0) {
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < repetir; ++i)
      if (!tocar(modelo, r, rt, nullptr, nullptr)) return 1;
    auto t1 = std::chrono::steady_clock::now();
    std::fprintf(stderr, "%.6f ms por quadro\n", std::chrono::duration<double, std::milli>(t1 - t0).count() / (double(repetir) * rt.quadros));
  }

  std::string out = "{\"quadros\":[", evs;
  if (!tocar(modelo, r, rt, &out, &evs)) return 1;
  out += "],\"eventos\":[";
  out += evs;
  out += "]}\n";
  std::fwrite(out.data(), 1, out.size(), stdout);
  return 0;
}
