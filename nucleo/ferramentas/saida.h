// Saida JSON das ferramentas de teste (o contrato do docs/NUCLEO.md): numeros, textos e a pose
// de um esqueleto (ossos, slots na ordem de desenho, vertices).
#pragma once

#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "mamulengo/desenho.h"
#include "mamulengo/pose.h"

namespace mamulengo {

// abre os filhos das instancias (docs/NUCLEO.md "Instancias") do disco: o caminho ja vem relativo
// ao diretorio de trabalho, pelo do arquivo pai
inline const AbrirArquivo& abrir_do_disco() {
  static const AbrirArquivo abrir = [](const std::string& caminho, std::string& texto) {
    std::ifstream f(caminho, std::ios::binary);
    if (!f) return false;
    std::stringstream ss;
    ss << f.rdbuf();
    texto = ss.str();
    return true;
  };
  return abrir;
}

inline void escreve_num(std::string& s, double v) {
  char b[40];
  if (!std::isfinite(v)) {
    s += "null";
    return;
  }
  int n = std::snprintf(b, sizeof b, "%.17g", v);
  s.append(b, size_t(n));
}

inline void escreve_texto(std::string& s, const std::string& t) {
  s += '"';
  for (char c : t) {
    unsigned char u = static_cast<unsigned char>(c);
    if (c == '"' || c == '\\') {
      s += '\\';
      s += c;
    } else if (u < 0x20) {
      char b[8];
      std::snprintf(b, sizeof b, "\\u%04x", u);
      s += b;
    } else {
      s += c;
    }
  }
  s += '"';
}

// "ossos":{...},"slots":[...],"vertices":{...} (sem as chaves de fora)
inline void escreve_pose(std::string& out, const Esqueleto& e, std::vector<double>& v) {
  const Modelo& m = e.modelo();
  out += "\"ossos\":{";
  for (size_t i = 0; i < m.ossos.size(); ++i) {
    if (i) out += ',';
    escreve_texto(out, m.ossos[i].nome);
    const Matriz& w = e.mundo()[i];
    out += ":[";
    const double vals[6] = {w.a, w.b, w.c, w.d, w.x, w.y};
    for (int k = 0; k < 6; ++k) {
      if (k) out += ',';
      escreve_num(out, vals[k]);
    }
    out += ']';
  }
  out += "},\"slots\":[";
  for (size_t k = 0; k < e.ordem().size(); ++k) {
    const int s = e.ordem()[k];
    const EstadoSlot& st = e.slots()[size_t(s)];
    if (k) out += ',';
    out += "{\"nome\":";
    escreve_texto(out, m.slots[size_t(s)].nome);
    out += ",\"parte\":";
    if (st.parte >= 0) escreve_texto(out, m.partes[size_t(st.parte)].nome);
    else out += "null";
    out += ",\"cor\":[";
    const double c[4] = {st.cor.r, st.cor.g, st.cor.b, st.cor.a};
    for (int j = 0; j < 4; ++j) {
      if (j) out += ',';
      escreve_num(out, c[j]);
    }
    out += ']';
    // os efeitos (os 34 canais, docs/NUCLEO.md "Efeitos"), so de quem tem algum ligado
    if (st.efeitos.algum() || st.efeitos.borrar() || st.efeitos.rastro() || st.efeitos.ajuste()) {
      out += ",\"efeitos\":[";
      for (int j = 0; j < CANAIS_EFEITOS; ++j) {
        if (j) out += ',';
        escreve_num(out, st.efeitos.v[j]);
      }
      out += ']';
    }
    out += '}';
  }
  out += "],\"vertices\":{";
  bool primeiro = true;
  for (size_t k = 0; k < e.ordem().size(); ++k) {
    const int s = e.ordem()[k];
    if (!e.vertices(s, v)) continue;
    if (!primeiro) out += ',';
    primeiro = false;
    escreve_texto(out, m.slots[size_t(s)].nome);
    out += ":[";
    for (size_t j = 0; j < v.size(); ++j) {
      if (j) out += ',';
      escreve_num(out, v[j]);
    }
    out += ']';
  }
  out += '}';
  // borrar (docs/NUCLEO.md "Borrar"): de quem borrou, os vertices esticados e depois, por
  // vertice, quanto o alfa cai
  std::string bor;
  std::vector<float> esm;
  for (size_t k = 0; k < e.ordem().size(); ++k) {
    const int s = e.ordem()[k];
    if (!e.slots()[size_t(s)].efeitos.borrar()) continue;
    const size_t n = e.vertices(s, v);
    esm.assign(n / 2, 0.0f);
    if (!n || !e.borrar(s, v.data(), n, esm.data())) continue;
    if (!bor.empty()) bor += ',';
    escreve_texto(bor, m.slots[size_t(s)].nome);
    bor += ":[";
    for (size_t j = 0; j < n; ++j) {
      if (j) bor += ',';
      escreve_num(bor, v[j]);
    }
    for (float x : esm) bor += ',', escreve_num(bor, x);
    bor += ']';
  }
  if (!bor.empty()) out += ",\"borrados\":{" + bor + '}';
  // rastro (docs/NUCLEO.md "Rastro"): de quem tem copias, da mais antiga para a mais nova, cada
  // uma [alfa, x, y, ...]
  std::string ras;
  std::vector<CopiaRastro> cps;
  for (size_t k = 0; k < e.ordem().size(); ++k) {
    const int s = e.ordem()[k];
    if (!e.slots()[size_t(s)].efeitos.rastro()) continue;
    const size_t n = e.vertices(s, v);
    e.copias_rastro(s, n, cps);
    if (!n || cps.empty()) continue;
    if (!ras.empty()) ras += ',';
    escreve_texto(ras, m.slots[size_t(s)].nome);
    ras += ":[";
    for (size_t c = 0; c < cps.size(); ++c) {
      if (c) ras += ',';
      ras += '[';
      escreve_num(ras, cps[c].alfa);
      for (double x : *cps[c].xy) ras += ',', escreve_num(ras, x);
      ras += ']';
    }
    ras += ']';
  }
  if (!ras.empty()) out += ",\"rastros\":{" + ras + '}';
  // luzes (docs/NUCLEO.md "Luzes"): o grupo que o desenho monta (ambiente e os pontos em mundo:
  // x, y, altura, r, g, b, raio) e quantos lotes sairam iluminados
  if (!m.luzes.empty() || m.ambiente[0] != 1 || m.ambiente[1] != 1 || m.ambiente[2] != 1 || m.ambiente[3] != 1 || m.ambiente[4] != 1) {
    Desenho d;
    desenhar(e, d);
    out += ",\"luzes\":";
    if (d.grupos_luz.empty()) out += "null";
    else {
      const GrupoLuz& g = d.grupos_luz[0];
      out += "{\"ambiente\":[";
      for (int c = 0; c < 3; ++c) {
        if (c) out += ',';
        escreve_num(out, g.ambiente[c]);
      }
      out += "],\"pontos\":[";
      for (int i = 0; i < g.quantas; ++i) {
        if (i) out += ',';
        out += '[';
        for (int c = 0; c < FLOATS_LUZ; ++c) {
          if (c) out += ',';
          escreve_num(out, g.luzes[i][c]);
        }
        out += ']';
      }
      int lotes = 0;
      for (const Lote& l : d.lotes) lotes += l.luz >= 0;
      out += "],\"lotes\":" + std::to_string(lotes) + '}';
    }
  }
  // particulas vivas por emissor: [x, y, rot, idade, vida] (docs/NUCLEO.md "Particulas")
  if (!m.emissores.empty()) {
    out += ",\"particulas\":{";
    for (size_t i = 0; i < m.emissores.size(); ++i) {
      if (i) out += ',';
      escreve_texto(out, m.emissores[i].nome);
      out += ":[";
      const auto& vivas = e.emissores()[i].vivas;
      for (size_t k = 0; k < vivas.size(); ++k) {
        if (k) out += ',';
        const Particula& p = vivas[k];
        const double vals[5] = {p.x, p.y, p.rot, p.idade, p.vida};
        out += '[';
        for (int j = 0; j < 5; ++j) {
          if (j) out += ',';
          escreve_num(out, vals[j]);
        }
        out += ']';
      }
      out += ']';
    }
    out += '}';
    // orbitas: [x, y, z, escala, giro] por particula
    out += ",\"orbitas\":{";
    bool primeira_orbita = true;
    std::vector<double> orb;
    for (size_t i = 0; i < m.emissores.size(); ++i) {
      if (!m.emissores[i].orbita) continue;
      if (!primeira_orbita) out += ',';
      primeira_orbita = false;
      escreve_texto(out, m.emissores[i].nome);
      out += ":[";
      posicoes_orbita(e, int(i), orb);
      for (size_t j = 0; j < orb.size(); ++j) {
        if (j) out += ',';
        escreve_num(out, orb[j]);
      }
      out += ']';
    }
    out += '}';
    // linhas dos raios: [[x, y, x, y, ...], ...] (a principal e os ramos)
    out += ",\"raios\":{";
    bool primeiro_raio = true;
    std::vector<std::vector<double>> linhas;
    for (size_t i = 0; i < m.emissores.size(); ++i) {
      if (!m.emissores[i].raio) continue;
      if (!primeiro_raio) out += ',';
      primeiro_raio = false;
      escreve_texto(out, m.emissores[i].nome);
      out += ":[";
      linhas_raio(e, int(i), linhas);
      for (size_t k = 0; k < linhas.size(); ++k) {
        if (k) out += ',';
        out += '[';
        for (size_t j = 0; j < linhas[k].size(); ++j) {
          if (j) out += ',';
          escreve_num(out, linhas[k][j]);
        }
        out += ']';
      }
      out += ']';
    }
    out += '}';
  }
  // instancias (docs/NUCLEO.md "Instancias"): o relogio e, por instancia visivel, a animacao e o
  // tempo do filho e a pose dele (a mesma saida, recursiva)
  if (!m.instancias.empty()) {
    out += ",\"relogio\":";
    escreve_num(out, e.relogio());
    out += ",\"instancias\":{";
    bool primeira = true;
    for (size_t i = 0; i < m.instancias.size(); ++i) {
      const EstadoInstancia& in = e.instancias()[i];
      if (e.slots()[size_t(m.instancias[i].slot)].cor.a <= 0 || in.ultima_anim == -2) continue;
      if (!primeira) out += ',';
      primeira = false;
      escreve_texto(out, m.instancias[i].nome);
      out += ":{\"animacao\":";
      const Modelo& fm = in.e->modelo();
      if (in.ultima_anim >= 0) escreve_texto(out, fm.animacoes[size_t(in.ultima_anim)].nome);
      else out += "null";
      out += ",\"tempo\":";
      escreve_num(out, in.ultimo_t);
      if (in.ultimo_alfa < 1) out += ",\"mistura\":", escreve_num(out, in.ultimo_alfa);
      out += ',';
      std::vector<double> vf;
      escreve_pose(out, *in.e, vf);
      out += '}';
    }
    out += '}';
  }
}

}  // namespace mamulengo
