// Estado de animacao: trilhas, fila, mix e eventos (docs/NUCLEO.md "Estado").
#include "mamulengo/estado.h"

#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace mamulengo {

namespace {

// como uma timeline mistura (docs/NUCLEO.md "Estado", modos), em bits como o oraculo guarda:
// PRIMEIRA ou SEGUINTE, mais SEGURA
enum Modo : uint8_t {
  PRIMEIRA = 1,  // a primeira entrada (da mais antiga para a mais nova) a animar a propriedade:
                 // mistura a partir do setup
  SEGUINTE = 2,  // uma mais antiga ja anima a propriedade: mistura com o que ela deixou
  SEGURA = 4,    // a entrada que entra tambem anima a propriedade: a que sai fica com o peso
                 // cheio (ou some enquanto uma ainda mais nova, que nao anima, entra: modo_mix)
};

enum class TipoTl : uint8_t { Parte, Cor, Osso, Restricao, Deformar, Ordem, Evento };

// propriedades (para saber quem anima o que): categoria e indices
enum Prop : uint8_t {
  P_GIRAR = 1, P_X, P_Y, P_EX, P_EY, P_CX, P_CY, P_PARTE, P_RGB, P_ALFA, P_DEFORM, P_ORDEM, P_EVENTO, P_RESTRICAO,
};

inline uint64_t id(Prop p, int a, int b = 0) {
  return (uint64_t(p) << 56) | (uint64_t(uint32_t(a)) << 24) | uint64_t(uint32_t(b) & 0xFFFFFFu);
}

inline double sinal(double v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

const int SETUP = 1, ATUAL = 2;

}  // namespace

struct Estado::Tl {
  TipoTl tipo;
  int indice;  // na lista do tipo dentro da Animacao
  uint64_t ids[2];
  int nids;
};

// ---- entrada

double Entrada::tempo_animacao() const {
  if (loop) {
    const double d = fim - inicio;
    if (d == 0) return inicio;
    return std::fmod(tempo, d) + inicio;
  }
  return std::min(tempo + inicio, fim);
}

double Entrada::tempo_completa() const {
  const double d = fim - inicio;
  if (d != 0) {
    if (loop) return d * (1 + std::floor(tempo / d));
    if (tempo < d) return d;
  }
  return tempo;
}

// ---- estado

Estado::Estado(std::shared_ptr<const Modelo> modelo) : m_(std::move(modelo)) {
  const Modelo& m = *m_;
  mix_padrao = m.mix_padrao;
  for (const ::mamulengo::ParMix& p : m.mix_pares) pares_.push_back({p.de, p.para, p.tempo});
  tls_.resize(m.animacoes.size());
  ids_.resize(m.animacoes.size());
  for (size_t a = 0; a < m.animacoes.size(); ++a) {
    const Animacao& an = m.animacoes[a];
    std::vector<Tl>& v = tls_[a];
    auto poe = [&](TipoTl t, size_t i, uint64_t i0, uint64_t i1 = 0) { v.push_back(Tl{t, int(i), {i0, i1}, i1 ? 2 : 1}); };
    for (size_t i = 0; i < an.partes.size(); ++i) poe(TipoTl::Parte, i, id(P_PARTE, an.partes[i].slot));
    for (size_t i = 0; i < an.cores.size(); ++i) {
      const TimelineCor& c = an.cores[i];
      if (c.prop == PropCor::Rgba) poe(TipoTl::Cor, i, id(P_RGB, c.slot), id(P_ALFA, c.slot));
      else poe(TipoTl::Cor, i, id(c.prop == PropCor::Rgb ? P_RGB : P_ALFA, c.slot));
    }
    for (size_t i = 0; i < an.ossos.size(); ++i) {
      const TimelineOsso& o = an.ossos[i];
      switch (o.prop) {
        case PropOsso::Girar: poe(TipoTl::Osso, i, id(P_GIRAR, o.osso)); break;
        case PropOsso::Mover: poe(TipoTl::Osso, i, id(P_X, o.osso), id(P_Y, o.osso)); break;
        case PropOsso::MoverX: poe(TipoTl::Osso, i, id(P_X, o.osso)); break;
        case PropOsso::MoverY: poe(TipoTl::Osso, i, id(P_Y, o.osso)); break;
        case PropOsso::Escalar: poe(TipoTl::Osso, i, id(P_EX, o.osso), id(P_EY, o.osso)); break;
        case PropOsso::EscalarX: poe(TipoTl::Osso, i, id(P_EX, o.osso)); break;
        case PropOsso::EscalarY: poe(TipoTl::Osso, i, id(P_EY, o.osso)); break;
        case PropOsso::Cisalhar: poe(TipoTl::Osso, i, id(P_CX, o.osso), id(P_CY, o.osso)); break;
        case PropOsso::CisalharX: poe(TipoTl::Osso, i, id(P_CX, o.osso)); break;
        case PropOsso::CisalharY: poe(TipoTl::Osso, i, id(P_CY, o.osso)); break;
      }
    }
    for (size_t i = 0; i < an.restricoes.size(); ++i) {
      const TimelineRestricao& r = an.restricoes[i];
      poe(TipoTl::Restricao, i, id(P_RESTRICAO, r.restricao, int(r.prop)));
    }
    for (size_t i = 0; i < an.deformar.size(); ++i) poe(TipoTl::Deformar, i, id(P_DEFORM, an.deformar[i].slot, an.deformar[i].parte));
    for (size_t i = 0; i < an.ordem.size(); ++i) poe(TipoTl::Ordem, i, id(P_ORDEM, 0));
    if (!an.eventos.empty()) poe(TipoTl::Evento, 0, id(P_EVENTO, 0));
    for (const Tl& t : v)
      for (int k = 0; k < t.nids; ++k) ids_[a].insert(t.ids[k]);
  }
}

Estado::~Estado() = default;

void Estado::copiar_de(const Estado& o) {
  if (this == &o) return;
  m_ = o.m_;
  mix_padrao = o.mix_padrao;
  escala_tempo = o.escala_tempo;
  relogio_float = o.relogio_float;
  tls_ = o.tls_;
  ids_ = o.ids_;
  usados_ = o.usados_;
  disparados_ = o.disparados_;
  eventos_ = o.eventos_;
  pares_ = o.pares_;
  sem_chave_ = o.sem_chave_;
  mudou_ = o.mudou_;
  proximo_id_ = o.proximo_id_;
  // entradas novas com os mesmos campos; depois os ponteiros apontam para as novas
  std::unordered_map<const Entrada*, Entrada*> novo;
  vivas_.clear();
  vivas_.reserve(o.vivas_.size());
  for (const auto& e : o.vivas_) {
    vivas_.push_back(std::make_unique<Entrada>(*e));
    novo[e.get()] = vivas_.back().get();
  }
  auto ponte = [&](Entrada* p) -> Entrada* {
    if (!p) return nullptr;
    auto it = novo.find(p);
    return it == novo.end() ? nullptr : it->second;
  };
  for (auto& e : vivas_) {
    e->anterior = ponte(e->anterior);
    e->proxima = ponte(e->proxima);
    e->de = ponte(e->de);
    e->para = ponte(e->para);
    for (Entrada*& p : e->modo_mix) p = ponte(p);
  }
  trilhas_.resize(o.trilhas_.size());
  for (size_t i = 0; i < trilhas_.size(); ++i) trilhas_[i] = ponte(o.trilhas_[i]);
}

void Estado::definir_mix(int de, int para, double tempo) {
  for (ParMix& p : pares_)
    if (p.de == de && p.para == para) {
      p.tempo = tempo;
      return;
    }
  pares_.push_back({de, para, tempo});
}

double Estado::mix(int de, int para) const {
  for (const ParMix& p : pares_)
    if (p.de == de && p.para == para) return p.tempo;
  return mix_padrao;
}

int Estado::atual(int trilha) const {
  const Entrada* e = entrada(trilha);
  return e ? e->animacao : -1;
}

Entrada* Estado::entrada(int trilha) const {
  if (trilha < 0 || trilha >= int(trilhas_.size())) return nullptr;
  return trilhas_[size_t(trilha)];
}

void Estado::ler_eventos(std::vector<Evento>& saida) {
  saida.clear();
  saida.swap(eventos_);
}

void Estado::emitir(TipoEvento tipo, const Entrada* en) {
  Evento ev;
  ev.tipo = tipo;
  ev.entrada = en->id;
  ev.trilha = en->trilha;
  ev.animacao = en->animacao;
  eventos_.push_back(std::move(ev));
  if (tipo == TipoEvento::Inicio || tipo == TipoEvento::Fim) mudou_ = true;
}

void Estado::descartar(Entrada* en) {
  if (!en->descartada && ao_descartar) ao_descartar(dono, en);
  en->descartada = true;
}

void Estado::recolher() {
  vivas_.erase(std::remove_if(vivas_.begin(), vivas_.end(), [](const std::unique_ptr<Entrada>& e) { return e->descartada; }), vivas_.end());
}

Entrada* Estado::nova(int trilha, int animacao, bool loop, Entrada* ultima) {
  vivas_.push_back(std::make_unique<Entrada>());
  Entrada* e = vivas_.back().get();
  e->id = proximo_id_++;
  e->trilha = trilha;
  e->animacao = animacao;
  e->loop = loop;
  e->fim = animacao >= 0 ? m_->animacoes[size_t(animacao)].duracao : 0;
  e->mix_duracao = ultima ? mix(ultima->animacao, animacao) : 0;
  return e;
}

Entrada* Estado::expandir(int trilha) {
  if (trilha >= int(trilhas_.size())) trilhas_.resize(size_t(trilha) + 1, nullptr);
  return trilhas_[size_t(trilha)];
}

void Estado::por_atual(int trilha, Entrada* atual, bool interromper) {
  Entrada* de = expandir(trilha);
  trilhas_[size_t(trilha)] = atual;
  atual->anterior = nullptr;
  if (de) {
    if (interromper) emitir(TipoEvento::Interrompida, de);
    atual->de = de;
    de->para = atual;
    atual->mix_tempo = 0;
    de->rotacoes.clear();  // a que sai recomeca a contar as voltas da rotacao
  }
  emitir(TipoEvento::Inicio, atual);
}

void Estado::limpar_fila(Entrada* e) {
  for (Entrada* p = e->proxima; p; p = p->proxima) descartar(p);
  e->proxima = nullptr;
}

Entrada* Estado::tocar(int trilha, int animacao, bool loop) {
  // medido: a entrada que nunca foi aplicada (tocada no mesmo quadro, ou ainda no atraso) so
  // e trocada sem mix quando e a mesma animacao; com outra, e interrompida e mistura a partir dela
  bool interromper = true;
  Entrada* cur = expandir(trilha);
  if (cur) {
    if (cur->prox_tempo_ant == -1 && cur->animacao == animacao) {
      trilhas_[size_t(trilha)] = cur->de;
      emitir(TipoEvento::Interrompida, cur);
      emitir(TipoEvento::Fim, cur);
      limpar_fila(cur);
      descartar(cur);
      cur = cur->de;
      interromper = false;
    } else {
      limpar_fila(cur);
    }
  }
  Entrada* en = nova(trilha, animacao, loop, cur);
  por_atual(trilha, en, interromper);
  recolher();
  return en;
}

Entrada* Estado::enfileirar(int trilha, int animacao, bool loop, double atraso) {
  Entrada* ultima = expandir(trilha);
  if (ultima)
    while (ultima->proxima) ultima = ultima->proxima;
  Entrada* en = nova(trilha, animacao, loop, ultima);
  if (!ultima) {
    por_atual(trilha, en, true);
    if (atraso < 0) atraso = 0;
  } else {
    ultima->proxima = en;
    en->anterior = ultima;
    if (atraso <= 0) atraso = std::max(atraso + ultima->tempo_completa() - en->mix_duracao, 0.0);
  }
  en->atraso = atraso;
  recolher();
  return en;
}

void Estado::mudar_mix(Entrada* en, double mix, double atraso) {
  en->mix_duracao = mix;
  if (atraso <= 0) {
    if (en->anterior) atraso = std::max(atraso + en->anterior->tempo_completa() - mix, 0.0);
    else atraso = 0;
  }
  en->atraso = atraso;
}

Entrada* Estado::vazio(int trilha, double mix) {
  Entrada* en = tocar(trilha, -1, false);
  en->mix_duracao = mix;
  en->tempo_fim = mix;
  return en;
}

Entrada* Estado::enfileirar_vazio(int trilha, double mix, double atraso) {
  Entrada* en = enfileirar(trilha, -1, false, atraso);
  if (atraso <= 0) en->atraso = std::max(en->atraso + en->mix_duracao - mix, 0.0);
  en->mix_duracao = mix;
  en->tempo_fim = mix;
  return en;
}

void Estado::limpar_trilha(int trilha) {
  if (trilha < 0 || trilha >= int(trilhas_.size())) return;
  Entrada* cur = trilhas_[size_t(trilha)];
  if (!cur) return;
  emitir(TipoEvento::Fim, cur);
  limpar_fila(cur);
  descartar(cur);
  for (Entrada* en = cur;;) {
    Entrada* de = en->de;
    if (!de) break;
    emitir(TipoEvento::Fim, de);
    descartar(de);
    en->de = nullptr;
    en->para = nullptr;
    en = de;
  }
  trilhas_[size_t(trilha)] = nullptr;
  recolher();
}

void Estado::limpar() {
  for (size_t i = 0; i < trilhas_.size(); ++i) limpar_trilha(int(i));
  trilhas_.clear();
}

// ---- relogios

void Estado::avancar(double dt) {
  dt = f32(dt * escala_tempo);
  for (size_t i = 0; i < trilhas_.size(); ++i) {
    Entrada* cur = trilhas_[i];
    if (!cur) continue;
    cur->ultimo = cur->prox_ultimo;
    cur->tempo_ant = cur->prox_tempo_ant;
    double d = f32(dt * cur->escala_tempo);
    if (cur->atraso > 0) {
      cur->atraso = f32(cur->atraso - d);
      if (cur->atraso > 0) continue;
      d = -cur->atraso;
      cur->atraso = 0;
    }
    Entrada* prox = cur->proxima;
    if (prox) {
      // a proxima entra quando o relogio da atual (no aplicar anterior) passa do atraso dela,
      // com o tempo que sobrou
      const double sobra = f32(cur->tempo_ant - prox->atraso);
      if (sobra >= 0) {
        prox->atraso = 0;
        prox->tempo = f32(prox->tempo + (cur->escala_tempo == 0 ? 0 : f32(f32(f32(sobra / cur->escala_tempo) + dt) * prox->escala_tempo)));
        cur->tempo = f32(cur->tempo + d);
        por_atual(int(i), prox, true);
        for (Entrada* e = prox; e->de; e = e->de) e->mix_tempo = f32(e->mix_tempo + dt);
        continue;
      }
    } else if (cur->tempo_ant >= cur->tempo_fim && !cur->de) {
      trilhas_[i] = nullptr;
      emitir(TipoEvento::Fim, cur);
      limpar_fila(cur);
      descartar(cur);
      continue;
    }
    if (cur->de && avancar_de(cur, dt)) {
      // acabaram os mixes de todas as que saem
      Entrada* de = cur->de;
      cur->de = nullptr;
      if (de) de->para = nullptr;
      for (; de; de = de->de) {
        emitir(TipoEvento::Fim, de);
        descartar(de);
      }
    }
    cur->tempo = f32(cur->tempo + d);
  }
  recolher();
}

bool Estado::avancar_de(Entrada* para, double dt) {
  Entrada* de = para->de;
  if (!de) return true;
  const bool acabou = avancar_de(de, dt);
  de->ultimo = de->prox_ultimo;
  de->tempo_ant = de->prox_tempo_ant;
  // a que sai ja foi aplicada pelo menos uma vez e o mix acabou
  if (para->prox_tempo_ant != -1 && para->mix_tempo >= para->mix_duracao) {
    if (de->alfa_total == 0 || para->mix_duracao == 0) {
      para->de = de->de;
      // medido: a que perdeu a de baixo, e as acima dela, passam a manter o que seguram,
      // menos a que esta entrando por ultimo (a do topo da cadeia)
      for (Entrada* x = para; x->para; x = x->para) x->manter_segura = true;
      if (de->de) de->de->para = para;
      emitir(TipoEvento::Fim, de);
      descartar(de);
    }
    return acabou;
  }
  de->tempo = f32(de->tempo + f32(dt * de->escala_tempo));
  para->mix_tempo = f32(para->mix_tempo + dt);
  return false;
}

// ---- aplicar

void Estado::disparar(const Animacao& an, double ultimo, double t) {
  const std::vector<ChaveEvento>& ev = an.eventos;
  const size_t n = ev.size();
  if (n == 0) return;
  if (ultimo > t) {
    // deu a volta no loop: do ultimo ate o fim, depois do comeco
    disparar(an, ultimo, DBL_MAX);
    ultimo = -1;
  } else if (ultimo >= ev[n - 1].tempo) {
    return;
  }
  if (t < ev[0].tempo) return;
  size_t i = 0;
  if (ultimo >= ev[0].tempo) {
    // a primeira chave depois de `ultimo`
    while (i < n && ev[i].tempo <= ultimo) ++i;
  }
  for (; i < n && t >= ev[i].tempo; ++i) disparados_.push_back(int(i));
}

// de tras para frente: a chave k vale no tempo espelhado fim - (tempo_k - ini), e as chaves vao
// da ultima para a primeira; o intervalo (ultimo, t] e o do relogio da animacao, como na frente
void Estado::disparar_reverso(const Animacao& an, double ini, double fim, double ultimo, double t) {
  const std::vector<ChaveEvento>& ev = an.eventos;
  if (ev.empty()) return;
  if (ultimo > t) {
    disparar_reverso(an, ini, fim, ultimo, DBL_MAX);
    ultimo = -1;
  }
  // medido: chaves no mesmo tempo saem na ordem do arquivo
  for (size_t k = ev.size(); k > 0;) {
    size_t j = k - 1;
    while (j > 0 && ev[j - 1].tempo == ev[k - 1].tempo) --j;
    const double m = fim - (ev[j].tempo - ini);
    if (m > ultimo && m <= t)
      for (size_t q = j; q < k; ++q) disparados_.push_back(int(q));
    k = j;
  }
}

void Estado::enfileirar_eventos(Entrada* en, double t_anim) {
  const double ini = en->inicio, fim = en->fim, dur = fim - ini;
  const double volta = std::fmod(en->tempo_ant, dur);  // NaN com duracao 0
  const Animacao* an = en->animacao >= 0 ? &m_->animacoes[size_t(en->animacao)] : nullptr;
  auto usuario = [&](int k) {
    const ChaveEvento& c = an->eventos[size_t(k)];
    Evento ev;
    ev.tipo = TipoEvento::Usuario;
    ev.entrada = en->id;
    ev.trilha = en->trilha;
    ev.animacao = en->animacao;
    ev.evento = c.evento;
    ev.tempo = c.tempo;
    ev.inteiro = c.inteiro;
    ev.decimal = c.decimal;
    ev.texto = c.texto;
    ev.volume = c.volume;
    ev.balanco = c.balanco;
    eventos_.push_back(std::move(ev));
  };
  // eventos antes da volta completa
  size_t i = 0;
  const size_t n = disparados_.size();
  for (; i < n; ++i) {
    const double te = tempo_chave(*en, an->eventos[size_t(disparados_[i])].tempo);
    if (te < volta) break;
    if (te > fim) continue;
    usuario(disparados_[i]);
  }
  bool completa;
  if (en->loop) {
    if (dur == 0) {
      completa = true;
    } else {
      const double voltas = std::floor(en->tempo / dur);
      completa = voltas > 0 && voltas > std::floor(en->tempo_ant / dur);
    }
  } else {
    completa = t_anim >= fim && en->ultimo < fim;
  }
  if (completa) emitir(TipoEvento::Completa, en);
  // eventos depois da volta
  for (; i < n; ++i) {
    if (tempo_chave(*en, an->eventos[size_t(disparados_[i])].tempo) < ini) continue;
    usuario(disparados_[i]);
  }
}

void Estado::parte(Esqueleto& e, const TimelineParte& tp, double t, Mistura mist, bool partes) {
  bool antes = false;
  const int p = e.parte_no_tempo(tp, t, &antes);
  EstadoSlot& s = e.slot(tp.slot);
  if (!antes || mist == Mistura::Setup || mist == Mistura::Primeira) {
    if (partes) {
      e.mudar_parte(tp.slot, p);
      s.marca = sem_chave_ + ATUAL;
    } else if (s.marca != sem_chave_ + ATUAL) {
      // medido: sem `partes` (saindo de um mix) a timeline so troca a parte se ninguem com
      // `partes` a pos neste aplicar (o deformar dela vale para essa parte ate o fim)
      e.mudar_parte(tp.slot, p);
    }
  }
  // se a parte nao foi posta (antes da primeira chave ou sem `partes`), volta a do setup no fim
  if (s.marca <= sem_chave_) s.marca = sem_chave_ + SETUP;
}

void Estado::girar(Esqueleto& e, const TimelineOsso& to, double t, double alfa, Mistura mist, Entrada& en, size_t i, bool primeiro) {
  double* rot = &en.rotacoes[i * 2];
  if (primeiro) rot[0] = 0;
  if (alfa == 1) {
    e.aplicar_osso(to, t, 1, mist, false);
    return;
  }
  Local& l = e.local[size_t(to.osso)];
  const double setup = m_->ossos[size_t(to.osso)].rotacao;
  const int k = to.tl.chave(t);
  double r1, r2;
  if (k < 0) {
    if (mist == Mistura::Setup) l.rotacao = setup;
    if (mist != Mistura::Primeira) return;
    r1 = l.rotacao;
    r2 = setup;
  } else {
    r1 = mist == Mistura::Setup ? setup : l.rotacao;
    r2 = setup + to.tl.valor(k, 0, t);
  }
  // mistura pelo caminho mais curto no primeiro quadro e, depois, sem trocar de lado quando a
  // diferenca cruza 180 graus
  double total, dif = r2 - r1;
  dif -= std::ceil(dif / 360 - 0.5) * 360;
  if (dif == 0) {
    total = rot[0];
  } else {
    double total_ant = 0, dif_ant = dif;
    if (!primeiro) total_ant = rot[0], dif_ant = rot[1];
    const double voltas = total_ant - std::fmod(total_ant, 360.0);
    total = dif + voltas;
    const bool agora = dif >= 0;
    bool lado = total_ant >= 0;
    if (std::abs(dif_ant) <= 90 && sinal(dif_ant) != sinal(dif)) {
      if (std::abs(total_ant - voltas) > 180) {
        total += 360 * sinal(total_ant);
        lado = agora;
      } else if (voltas != 0) {
        total -= 360 * sinal(total_ant);
      } else {
        lado = agora;
      }
    }
    if (lado != agora) total += 360 * sinal(total_ant);
    rot[0] = total;
  }
  rot[1] = dif;
  l.rotacao = r1 + total * alfa;
}

void Estado::aplicar_timeline(Esqueleto& e, const Entrada& en, const Tl& tl, double ultimo, double t, double alfa, Mistura mist, bool sai,
                              bool coletar) {
  const Animacao& an = m_->animacoes[size_t(en.animacao)];
  const size_t i = size_t(tl.indice);
  switch (tl.tipo) {
    case TipoTl::Parte: break;  // parte(): precisa saber se marca
    case TipoTl::Cor: e.aplicar_cor(an.cores[i], t, alfa, mist); break;
    case TipoTl::Osso: e.aplicar_osso(an.ossos[i], t, alfa, mist, sai); break;
    case TipoTl::Restricao: e.aplicar_restricao(an.restricoes[i], t, alfa, mist, sai); break;
    case TipoTl::Deformar: e.aplicar_deformar(an.deformar[i], t, alfa, mist); break;
    case TipoTl::Ordem: e.aplicar_ordem(an.ordem[i], t, mist, sai); break;
    case TipoTl::Evento:
      // t ja vem espelhado no reverso; os eventos contam no relogio da animacao
      if (coletar && en.reverso) disparar_reverso(an, en.inicio, en.fim, ultimo, en.tempo_aplicado(t));
      else if (coletar) disparar(an, ultimo, t);
      break;
  }
}

double Estado::aplicar_de(Entrada* para, Esqueleto& e, Mistura mist) {
  Entrada* de = para->de;
  // a que sai pesa o quanto ela mesma ja tinha entrado (se ainda estava entrando num mix):
  // medido no oraculo, que nao congela esse peso no corte
  double peso_de = de->alfa;
  if (de->de) peso_de *= aplicar_de(de, e, mist);
  double mix;
  if (para->mix_duracao == 0) {
    // mix instantaneo: um quadro so, que desfaz o que a que sai deixou
    mix = 1;
    // (sem trocar a mistura para Setup: medido, a SEGUINTE com alfa 0 nao volta ao setup)
  } else {
    mix = para->mix_tempo / para->mix_duracao;
    if (mix > 1) mix = 1;
    if (mist != Mistura::Primeira) mist = de->somar ? Mistura::Soma : Mistura::Substitui;
  }
  const bool partes = mix < de->limiar_partes, ordem = mix < de->limiar_ordem;
  const double alfa_segura = peso_de, alfa_mix = alfa_segura * (1 - mix);
  const double ultimo = de->ultimo, t = de->tempo_animacao(), ta = de->tempo_aplicado(t);
  const bool coletar = mix < de->limiar_eventos;
  disparados_.clear();
  if (de->animacao >= 0) {
    const Animacao& an = m_->animacoes[size_t(de->animacao)];
    const std::vector<Tl>& tls = tls_[size_t(de->animacao)];
    if (mist == Mistura::Soma) {
      for (const Tl& tl : tls) {
        if (tl.tipo == TipoTl::Parte) continue;
        aplicar_timeline(e, *de, tl, ultimo, ta, alfa_mix, mist, true, coletar);
      }
    } else {
      const bool primeiro = de->rotacoes.size() != tls.size() * 2;
      if (primeiro) de->rotacoes.assign(tls.size() * 2, 0.0);
      de->alfa_total = 0;
      for (size_t i = 0; i < tls.size(); ++i) {
        const Tl& tl = tls[i];
        bool sai = true;
        Mistura tm;
        double alfa;
        const uint8_t modo = de->modo[i];
        if (modo == SEGUINTE && !ordem && tl.tipo == TipoTl::Ordem) continue;
        tm = (modo & PRIMEIRA) ? Mistura::Setup : mist;
        if (!(modo & SEGURA)) {
          alfa = alfa_mix;
        } else if (const Entrada* manda = de->modo_mix[i]) {
          alfa = alfa_segura * std::max(0.0, 1 - manda->mix_tempo / manda->mix_duracao);
        } else {
          alfa = alfa_segura;
        }
        de->alfa_total += alfa;
        if (tl.tipo == TipoTl::Osso && an.ossos[size_t(tl.indice)].prop == PropOsso::Girar) {
          girar(e, an.ossos[size_t(tl.indice)], ta, alfa, tm, *de, i, primeiro);
        } else if (tl.tipo == TipoTl::Parte) {
          parte(e, an.partes[size_t(tl.indice)], ta, tm, partes && alfa >= de->limiar_alfa_partes);
        } else {
          if (ordem && tl.tipo == TipoTl::Ordem && tm == Mistura::Setup) sai = false;
          aplicar_timeline(e, *de, tl, ultimo, ta, alfa, tm, sai, coletar);
        }
      }
    }
  }
  if (para->mix_duracao > 0) enfileirar_eventos(de, t);
  disparados_.clear();
  de->prox_ultimo = t;
  de->prox_tempo_ant = de->tempo;
  return mix;
}

bool Estado::aplicar(Esqueleto& e) {
  if (mudou_) recalcular_modos();
  bool aplicou = false;
  for (size_t ti = 0; ti < trilhas_.size(); ++ti) {
    Entrada* cur = trilhas_[ti];
    if (!cur || cur->atraso > 0) continue;
    aplicou = true;
    const Mistura mist = ti == 0 ? Mistura::Primeira : (cur->somar ? Mistura::Soma : Mistura::Substitui);
    double alfa = cur->alfa;
    if (cur->de) alfa *= aplicar_de(cur, e, mist);
    else if (cur->tempo >= cur->tempo_fim && !cur->proxima) alfa = 0;
    bool partes = alfa >= cur->limiar_alfa_partes;
    const double ultimo = cur->ultimo, t = cur->tempo_animacao(), ta = cur->tempo_aplicado(t);
    disparados_.clear();
    if (cur->animacao >= 0) {
      const Animacao& an = m_->animacoes[size_t(cur->animacao)];
      const std::vector<Tl>& tls = tls_[size_t(cur->animacao)];
      if ((ti == 0 && alfa == 1) || mist == Mistura::Soma) {
        if (ti == 0) partes = true;
        for (const Tl& tl : tls) {
          if (tl.tipo == TipoTl::Parte) parte(e, an.partes[size_t(tl.indice)], ta, mist, partes);
          else aplicar_timeline(e, *cur, tl, ultimo, ta, alfa, mist, false, true);
        }
      } else {
        const bool primeiro = cur->rotacoes.size() != tls.size() * 2;
        if (primeiro) cur->rotacoes.assign(tls.size() * 2, 0.0);
        for (size_t i = 0; i < tls.size(); ++i) {
          const Tl& tl = tls[i];
          const Mistura tm = (cur->modo[i] & PRIMEIRA) ? Mistura::Setup : mist;
          if (tl.tipo == TipoTl::Osso && an.ossos[size_t(tl.indice)].prop == PropOsso::Girar)
            girar(e, an.ossos[size_t(tl.indice)], ta, alfa, tm, *cur, i, primeiro);
          else if (tl.tipo == TipoTl::Parte)
            parte(e, an.partes[size_t(tl.indice)], ta, mist, partes);
          else
            aplicar_timeline(e, *cur, tl, ultimo, ta, alfa, tm, false, true);
        }
      }
    }
    enfileirar_eventos(cur, t);
    disparados_.clear();
    cur->prox_ultimo = t;
    cur->prox_tempo_ant = cur->tempo;
  }
  // slots cuja parte so foi mexida por quem nao manda (saindo de um mix, ou antes da primeira
  // chave): voltam a parte do setup
  const int marca_setup = sem_chave_ + SETUP;
  for (size_t s = 0; s < m_->slots.size(); ++s)
    if (e.slot(int(s)).marca == marca_setup) e.mudar_parte(int(s), e.parte_setup(int(s)));
  sem_chave_ += 2;
  recolher();
  return aplicou;
}

// ---- modos de mistura

void Estado::recalcular_modos() {
  mudou_ = false;
  usados_.clear();
  for (Entrada* en : trilhas_) {
    if (!en) continue;
    while (en->de) en = en->de;
    do {
      if (!en->para || !en->somar) calcular_modos(en);
      en = en->para;
    } while (en);
  }
}

void Estado::calcular_modos(Entrada* en) {
  const Entrada* para = en->para;
  if (en->animacao < 0) {
    en->modo.clear();
    en->modo_mix.clear();
    return;
  }
  const std::vector<Tl>& tls = tls_[size_t(en->animacao)];
  const size_t n = tls.size();
  // com manter_segura, o bit SEGURA de cada timeline fica o que era (0 na primeira conta)
  if (en->modo.size() != n) en->modo.assign(n, 0);
  en->modo_mix.assign(n, nullptr);
  auto novos = [&](const Tl& tl) {
    bool algum = false;
    for (int k = 0; k < tl.nids; ++k) algum |= usados_.insert(tl.ids[k]).second;
    return algum;
  };
  auto tem = [&](const Entrada* x, const Tl& tl) {
    if (x->animacao < 0) return false;
    const auto& ids = ids_[size_t(x->animacao)];
    for (int k = 0; k < tl.nids; ++k)
      if (ids.count(tl.ids[k])) return true;
    return false;
  };
  // medido no oraculo (4.3): ser a primeira e segurar sao independentes; uma propriedade que
  // uma entrada mais antiga ja anima tambem segura se a que entra a anima
  for (size_t i = 0; i < n; ++i) {
    const Tl& tl = tls[i];
    uint8_t modo = novos(tl) ? PRIMEIRA : SEGUINTE;
    if (para && tl.tipo != TipoTl::Parte && tl.tipo != TipoTl::Ordem && tl.tipo != TipoTl::Evento && tem(para, tl)) {
      modo |= SEGURA;
      for (Entrada* nx = para->para; nx; nx = nx->para) {
        if (tem(nx, tl)) continue;
        if (nx->mix_duracao > 0) en->modo_mix[i] = nx;
        break;
      }
    }
    if (en->manter_segura) modo = uint8_t((modo & ~SEGURA) | (en->modo[i] & SEGURA));
    en->modo[i] = modo;
  }
}

}  // namespace mamulengo
