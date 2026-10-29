// Saida JSON das ferramentas de teste (o contrato do docs/NUCLEO.md): numeros, textos e a pose
// de um esqueleto (ossos, slots na ordem de desenho, vertices).
#pragma once

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "mamulengo/desenho.h"
#include "mamulengo/pose.h"

namespace mamulengo {

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
    // os efeitos (os 22 canais, docs/NUCLEO.md "Efeitos"), so de quem tem algum ligado
    if (st.efeitos.algum()) {
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
}

}  // namespace mamulengo
