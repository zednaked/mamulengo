// O palco (docs/PALCO.md): a simulacao do jogo, em passos fixos.
#include "mamulengo/palco.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace mamulengo {

namespace {
constexpr double FOLGA = 1e-6;

bool sobrepoe(const DadosAtor& a, const EstadoAtor& s, const DadosAtor& b, const EstadoAtor& t) {
  return std::abs(s.x - t.x) < (a.largura + b.largura) / 2 && s.y < t.y + b.altura && t.y < s.y + a.altura;
}

const char* nome_estado(EstadoAtorTipo e) {
  switch (e) {
    case EstadoAtorTipo::Andando: return "andando";
    case EstadoAtorTipo::Pulo: return "pulo";
    case EstadoAtorTipo::Morto: return "morto";
    default: return "parado";
  }
}

std::string num(double x) {
  char b[32];
  std::snprintf(b, sizeof b, "%.4f", x);
  std::string s = b;
  while (!s.empty() && s.back() == '0') s.pop_back();
  if (!s.empty() && s.back() == '.') s.pop_back();
  return s == "-0" ? "0" : s;
}
}  // namespace

bool Palco::solido_celula(int c, int r) const {
  const DadosPalco& p = m_.palco;
  if (p.mosaico < 0) return false;
  const DadosMosaico& mo = m_.mosaicos[size_t(p.mosaico)];
  if (c < 0 || r < 0 || c >= mo.colunas || r >= mo.linhas) return false;
  const int img = mo.celulas[size_t(r * mo.colunas + c)];
  if (img < 0) return false;
  return p.solido.empty() || (size_t(img) < p.solido.size() && p.solido[size_t(img)]);
}

bool Palco::solido(double x, double y) const {
  return solido_celula(int(std::floor((x - ox_) / cw_)), int(std::floor((oy_ - y) / ch_)));
}

bool Palco::mover_x(const DadosAtor& d, EstadoAtor& s, double dx) const {
  if (dx == 0) return false;
  s.x += dx;
  const double borda = dx > 0 ? s.x + d.largura / 2 : s.x - d.largura / 2;
  const int c = int(std::floor((borda - ox_) / cw_));
  const int r0 = int(std::floor((oy_ - (s.y + d.altura - FOLGA)) / ch_)), r1 = int(std::floor((oy_ - (s.y + FOLGA)) / ch_));
  for (int r = r0; r <= r1; ++r)
    if (solido_celula(c, r)) {
      const double parede = ox_ + (dx > 0 ? c : c + 1) * cw_;
      s.x = dx > 0 ? parede - d.largura / 2 - FOLGA : parede + d.largura / 2 + FOLGA;
      return true;
    }
  return false;
}

bool Palco::mover_y(const DadosAtor& d, EstadoAtor& s, double dy) const {
  if (dy == 0) return false;
  s.y += dy;
  const double borda = dy < 0 ? s.y : s.y + d.altura;
  const int r = int(std::floor((oy_ - borda) / ch_));
  const int c0 = int(std::floor((s.x - d.largura / 2 + FOLGA - ox_) / cw_)), c1 = int(std::floor((s.x + d.largura / 2 - FOLGA - ox_) / cw_));
  for (int c = c0; c <= c1; ++c)
    if (solido_celula(c, r)) {
      // caindo: em cima do ladrilho; subindo: embaixo dele
      s.y = dy < 0 ? oy_ - r * ch_ : oy_ - (r + 1) * ch_ - d.altura - FOLGA;
      return true;
    }
  return false;
}

void Palco::reiniciar(Esqueleto& e) {
  e.setup();
  e.atualizar_mundo();
  tick = 0, pontos = 0, venceu = false, morreu = false, pulo_antes_ = false;
  const DadosPalco& p = m_.palco;
  if (p.mosaico >= 0) {
    const DadosMosaico& mo = m_.mosaicos[size_t(p.mosaico)];
    const Matriz& w = e.mundo()[size_t(mo.osso)];
    ox_ = w.x + mo.x, oy_ = w.y + mo.y, cw_ = mo.cw, ch_ = mo.ch;
  }
  a_.assign(p.atores.size(), {});
  for (size_t i = 0; i < p.atores.size(); ++i) {
    const DadosAtor& d = p.atores[i];
    const Matriz& w = e.mundo()[size_t(m_.instancias[size_t(d.instancia)].osso)];
    a_[i].x = w.x, a_[i].y = w.y, a_[i].lado = d.lado;
    // ja no chao (um pulo no primeiro passo vale)
    a_[i].chao = solido(w.x - d.largura / 2 + FOLGA, w.y - FOLGA) || solido(w.x + d.largura / 2 - FOLGA, w.y - FOLGA);
  }
  escrever(e);
}

void Palco::passo(Esqueleto& e, uint32_t entrada, double dt) {
  const DadosPalco& p = m_.palco;
  const bool pulo = entrada & ENTRADA_PULO;
  const bool pulou = pulo && !pulo_antes_;
  pulo_antes_ = pulo;
  int jogador = -1;
  for (size_t i = 0; i < a_.size(); ++i) {
    const DadosAtor& d = p.atores[i];
    EstadoAtor& s = a_[i];
    if (!s.vivo) continue;
    if (d.tipo == TipoAtor::Jogador) {
      jogador = int(i);
      if (morreu || venceu) {
        s.vx = 0;
      } else {
        const int dir = ((entrada & ENTRADA_DIREITA) ? 1 : 0) - ((entrada & ENTRADA_ESQUERDA) ? 1 : 0);
        s.vx = dir * d.velocidade;
        if (dir) s.lado = dir;
        if (pulou && s.chao) s.vy = d.pulo;
      }
    } else if (d.tipo == TipoAtor::Patrulha) {
      // vira na parede ou na beira (sem chao logo a frente)
      s.vx = s.lado * d.velocidade;
      if (s.chao && !solido(s.x + s.lado * (d.largura / 2 + 1), s.y - 1)) s.lado = -s.lado, s.vx = s.lado * d.velocidade;
    } else {
      continue;  // coletavel, porta e enfeite ficam parados
    }
    s.vy -= p.gravidade * dt;
    if (mover_x(d, s, s.vx * dt) && d.tipo == TipoAtor::Patrulha) s.lado = -s.lado;
    const bool caindo = s.vy < 0;
    s.chao = false;
    if (mover_y(d, s, s.vy * dt)) {
      if (caindo) s.chao = true;
      s.vy = 0;
    }
    // caiu do mapa
    if (s.y < oy_ - (p.mosaico >= 0 ? m_.mosaicos[size_t(p.mosaico)].linhas : 64) * ch_ - 64) {
      s.vivo = false;
      if (d.tipo == TipoAtor::Jogador) morreu = true;
    }
  }
  // as regras: o jogador com os outros
  if (jogador >= 0 && !morreu && !venceu) {
    const DadosAtor& dj = p.atores[size_t(jogador)];
    EstadoAtor& j = a_[size_t(jogador)];
    for (size_t i = 0; i < a_.size(); ++i) {
      const DadosAtor& d = p.atores[i];
      EstadoAtor& s = a_[i];
      if (int(i) == jogador || !s.vivo || !sobrepoe(dj, j, d, s)) continue;
      if (d.tipo == TipoAtor::Coletavel) {
        s.vivo = false;
        ++pontos;
      } else if (d.tipo == TipoAtor::Porta) {
        venceu = true;
      } else if (d.tipo == TipoAtor::Patrulha) {
        // o pisao: caindo e com os pes na metade de cima do inimigo
        if (j.vy < 0 && j.y > s.y + d.altura / 2) {
          s.vivo = false;
          j.vy = dj.pulo * 0.6;
        } else {
          morreu = true;
          j.estado = EstadoAtorTipo::Morto;
        }
      }
    }
  }
  for (size_t i = 0; i < a_.size(); ++i) {
    EstadoAtor& s = a_[i];
    if (int(i) == jogador && morreu) s.estado = EstadoAtorTipo::Morto;
    else if (!s.chao && (p.atores[i].tipo == TipoAtor::Jogador || p.atores[i].tipo == TipoAtor::Patrulha)) s.estado = EstadoAtorTipo::Pulo;
    else s.estado = std::abs(s.vx) > 0 ? EstadoAtorTipo::Andando : EstadoAtorTipo::Parado;
  }
  ++tick;
  escrever(e);
  e.avancar(dt);
  e.atualizar_mundo();
}

void Palco::escrever(Esqueleto& e) {
  const DadosPalco& p = m_.palco;
  for (size_t i = 0; i < a_.size(); ++i) {
    const DadosAtor& d = p.atores[i];
    const EstadoAtor& s = a_[i];
    const DadosInstancia& di = m_.instancias[size_t(d.instancia)];
    const int osso = di.osso;
    const DadosOsso& dosso = m_.ossos[size_t(osso)];
    // o osso no espaco do pai (o palco assume o pai sem giro nem escala)
    double px = 0, py = 0;
    if (dosso.pai >= 0) px = e.mundo()[size_t(dosso.pai)].x, py = e.mundo()[size_t(dosso.pai)].y;
    double x = s.x - px, y = s.y - py;
    if (p.pixel) x = std::round(x), y = std::round(y);
    Local& l = e.local[size_t(osso)];
    l.x = x, l.y = y;
    l.escala_x = std::abs(dosso.escala_x) * s.lado;
    // quem saiu de cena some (a camada da instancia)
    e.slot(di.slot).cor.a = s.vivo ? m_.slots[size_t(di.slot)].cor.a : 0;
    // a animacao pelo estado
    const int anim = s.estado == EstadoAtorTipo::Andando ? d.anim_andando : s.estado == EstadoAtorTipo::Pulo ? d.anim_pulo : s.estado == EstadoAtorTipo::Morto ? d.anim_morto : d.anim_parado;
    EstadoInstancia& in = e.instancias()[size_t(d.instancia)];
    const int quer = anim >= 0 ? anim : (s.estado == EstadoAtorTipo::Pulo && d.anim_parado >= 0 ? d.anim_parado : -2);
    if (quer != -2 && in.animacao != quer) {
      in.animacao = quer;
      in.inicio = -in.velocidade * e.relogio();
      in.laco = s.estado != EstadoAtorTipo::Morto;
      in.por_timeline = false;
      in.mix_animacao = -1;
    }
  }
}

std::string Palco::json() const {
  std::string o = "{\"tick\":" + std::to_string(tick) + ",\"venceu\":" + (venceu ? "true" : "false") + ",\"morreu\":" + (morreu ? "true" : "false") +
                  ",\"pontos\":" + std::to_string(pontos) + ",\"atores\":[";
  for (size_t i = 0; i < a_.size(); ++i) {
    const EstadoAtor& s = a_[i];
    if (i) o += ",";
    o += "{\"nome\":\"" + m_.palco.atores[i].nome + "\",\"x\":" + num(s.x) + ",\"y\":" + num(s.y) + ",\"vx\":" + num(s.vx) + ",\"vy\":" + num(s.vy) +
         ",\"lado\":" + std::to_string(s.lado) + ",\"chao\":" + (s.chao ? "true" : "false") + ",\"vivo\":" + (s.vivo ? "true" : "false") + ",\"estado\":\"" +
         nome_estado(s.estado) + "\"}";
  }
  return o + "]}";
}

}  // namespace mamulengo
