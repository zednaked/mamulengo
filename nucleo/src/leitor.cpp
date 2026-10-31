// Leitura do .boneco (docs/FORMATO.md) para o Modelo: a pose e o que o desenho precisa (pagina,
// uvs na pagina, triangulos, cor da parte e o fim dos recortes).
#include <algorithm>
#include <cmath>
#include <cstdio>

#include "mamulengo/json.h"
#include "mamulengo/modelo.h"

namespace mamulengo {

namespace {

struct Erro {
  std::string msg;
};

[[noreturn]] void falha(const std::string& msg) { throw Erro{msg}; }

int hexdig(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

// "rrggbbaa" (ou "rrggbb") -> canais 0..1
Cor cor_hex(const std::string& s) {
  Cor c;
  auto canal = [&](size_t i) { return float(hexdig(s[i]) * 16 + hexdig(s[i + 1])) / 255.0f; };
  if (s.size() >= 6) {
    c.r = canal(0);
    c.g = canal(2);
    c.b = canal(4);
  }
  if (s.size() >= 8) c.a = canal(6);
  return c;
}

// guarda a curva da chave `k` (as `canais` curvas) a partir do campo "curva"
void ler_curva(Timeline& tl, const Json& chave) {
  const Json& cv = chave["curva"];
  const size_t base = tl.curvas.size();
  if (cv.texto() && cv.str() == "degrau") {
    tl.curvas.push_back(uint8_t(Curva::Degrau));
  } else if (cv.lista()) {
    tl.curvas.push_back(uint8_t(Curva::Bezier));
  } else {
    tl.curvas.push_back(uint8_t(Curva::Linear));
  }
  tl.bezier.resize((base + 1) * size_t(tl.canais) * 4, 0.0);
  if (cv.lista()) {
    for (int c = 0; c < tl.canais; ++c)
      for (int i = 0; i < 4; ++i) tl.bezier[(base * tl.canais + c) * 4 + i] = f32(cv[size_t(c * 4 + i)].num(0));
  }
}


// timeline de chaves com campos numericos (nomes dos canais e padroes)
Timeline ler_timeline(const Json& chaves, std::initializer_list<std::pair<const char*, double>> canais) {
  Timeline tl;
  tl.canais = int(canais.size());
  for (const Json& k : chaves.itens()) {
    tl.tempos.push_back(f32(k.num("tempo", 0)));
    for (const auto& [nome, padrao] : canais) tl.valores.push_back(f32(k.num(nome, padrao)));
    ler_curva(tl, k);
  }
  tl.preparar();
  return tl;
}

// timeline de cor: "cor" em hex; rgba 4 canais, rgb 3
Timeline ler_timeline_cor(const Json& chaves, int canais) {
  Timeline tl;
  tl.canais = canais;
  for (const Json& k : chaves.itens()) {
    tl.tempos.push_back(f32(k.num("tempo", 0)));
    Cor c = cor_hex(k.str("cor", "ffffffff"));
    tl.valores.push_back(c.r);
    tl.valores.push_back(c.g);
    tl.valores.push_back(c.b);
    if (canais == 4) tl.valores.push_back(c.a);
    ler_curva(tl, k);
  }
  tl.preparar();
  return tl;
}

// ---- efeitos: os campos de cada um, na ordem dos canais (a cor ocupa 4)
struct CampoEfeito {
  const char* nome;
  bool cor;
};
const std::vector<CampoEfeito> CAMPOS_EFEITO[NUM_EFEITOS] = {
    {{"cor", true}, {"largura", false}},
    {{"cor", true}, {"forca", false}, {"raio", false}},
    {{"valor", false}, {"cor", true}, {"borda", false}, {"grao", false}},
    {{"cor", true}, {"forca", false}},
    {{"forca", false}, {"limite", false}, {"esmaecer", false}},
    {{"copias", false}, {"intervalo", false}, {"alfa", false}},
};
const char* NOMES_EFEITO[NUM_EFEITOS] = {"linha", "brilho", "dissolver", "tingir", "borrar", "rastro"};

int tipo_efeito(std::string_view nome) {
  for (int i = 0; i < NUM_EFEITOS; ++i)
    if (nome == NOMES_EFEITO[i]) return i;
  return -1;
}

// luzes (docs/NUCLEO.md "Luzes"): os campos na ordem dos canais
const std::vector<CampoEfeito> CAMPOS_LUZ = {{"cor", true}, {"forca", false}, {"raio", false}, {"altura", false}, {"profundidade", false}};
const std::vector<CampoEfeito> CAMPOS_AMBIENTE = {{"cor", true}, {"forca", false}};

// os canais dos `campos` lidos de `j` para `v` (o que falta fica como esta em `v`)
void ler_campos(const std::vector<CampoEfeito>& campos, const Json& j, float* v) {
  int c = 0;
  for (const CampoEfeito& ce : campos) {
    if (ce.cor) {
      if (const Json* x = j.acha(ce.nome); x && x->texto()) {
        const Cor k = cor_hex(x->str());
        v[c] = k.r, v[c + 1] = k.g, v[c + 2] = k.b, v[c + 3] = k.a;
      }
      c += 4;
    } else {
      v[c] = float(j.num(ce.nome, v[c]));
      c += 1;
    }
  }
}

void ler_campos_efeito(int t, const Json& j, float* v) { ler_campos(CAMPOS_EFEITO[t], j, v); }

// timeline de campos (efeito, luz, ambiente); o campo que falta na chave vale o da chave
// anterior (na primeira, o do setup)
Timeline ler_timeline_campos(const Json& chaves, const std::vector<CampoEfeito>& campos, const float* setup, int canais) {
  Timeline tl;
  tl.canais = canais;
  float v[8];
  std::copy(setup, setup + canais, v);
  for (const Json& k : chaves.itens()) {
    tl.tempos.push_back(f32(k.num("tempo", 0)));
    ler_campos(campos, k, v);
    for (int c = 0; c < tl.canais; ++c) tl.valores.push_back(v[c]);
    ler_curva(tl, k);
  }
  tl.preparar();
  return tl;
}

Timeline ler_timeline_efeito(const Json& chaves, int t, const Efeitos& setup) {
  return ler_timeline_campos(chaves, CAMPOS_EFEITO[t], setup.v + EFEITO_INICIO[t], EFEITO_CANAIS[t]);
}

Blend ler_blend(const std::string& s) {
  if (s == "aditivo") return Blend::Aditivo;
  if (s == "multiplica") return Blend::Multiplica;
  if (s == "multiplica_motor") return Blend::MultiplicaMotor;
  if (s == "tela") return Blend::Tela;
  return Blend::Normal;
}

TipoParte ler_tipo_parte(const std::string& s) {
  if (s == "malha") return TipoParte::Malha;
  if (s == "malha_ligada") return TipoParte::MalhaLigada;
  if (s == "recorte") return TipoParte::Recorte;
  if (s == "caminho") return TipoParte::Caminho;
  if (s == "ponto") return TipoParte::Ponto;
  if (s == "caixa") return TipoParte::Caixa;
  if (s == "regiao" || s.empty()) return TipoParte::Regiao;
  falha("tipo de parte desconhecido: " + s);
}

struct Imagem {
  int pagina = 0;
  double x = 0, y = 0;                      // canto de cima e da esquerda na pagina
  double rw = 0, rh = 0;                    // tamanho com pixels (antes de girar no atlas)
  int girada = 0;                           // graus em que a imagem foi girada no atlas
  bool cortada = false;
  double ox = 0, oy = 0, ow = 0, oh = 0;    // corte: deslocamento e tamanho original
};

// uma leitura com instancias: quem abre os arquivos, o que ja foi lido (cada arquivo uma vez) e
// os arquivos sendo lidos agora (um filho que volta a um deles e um ciclo)
struct Carga {
  const AbrirArquivo* abrir = nullptr;
  std::unordered_map<std::string, std::shared_ptr<const Modelo>> lidos;
  std::vector<std::string> pilha;
};

class Leitor {
 public:
  Modelo& m;
  std::unordered_map<std::string, Imagem> imagens;
  std::unordered_map<std::string, int> ids_partes;
  Carga* carga = nullptr;
  std::string caminho;  // deste arquivo (os filhos sao relativos ao diretorio dele)
  std::vector<std::string> prefixo_filho;  // por filho: o diretorio dele relativo a este

  explicit Leitor(Modelo& mm) : m(mm) {}

  int id_nome(const std::string& s) {
    auto it = ids_partes.find(s);
    if (it != ids_partes.end()) return it->second;
    int id = int(m.nomes_partes.size());
    m.nomes_partes.push_back(s);
    ids_partes.emplace(s, id);
    return id;
  }

  int osso(const Json& j, const char* onde) {
    if (!j.texto()) falha(std::string(onde) + ": osso ausente");
    int i = m.osso(j.str());
    if (i < 0) falha(std::string(onde) + ": osso desconhecido " + j.str());
    return i;
  }

  int slot(const Json& j, const char* onde) {
    int i = j.texto() ? m.slot(j.str()) : -1;
    if (i < 0) falha(std::string(onde) + ": slot desconhecido " + j.str());
    return i;
  }

  void ler(const Json& r) {
    if (!r.objeto()) falha("o .boneco nao e um objeto JSON");
    if (r.num("boneco", -1) != 0) falha("versao do .boneco nao suportada (este leitor e da 0)");
    m.nome = r.str("nome", "");
    m.escala_ref = r["esqueleto"].num("escala_ref", 100);

    for (const Json& pg : r["paginas"].itens()) {
      Pagina p;
      p.arquivo = pg.str("arquivo", "");
      p.largura = int(pg["tamanho"][0].num(0));
      p.altura = int(pg["tamanho"][1].num(0));
      p.pma = pg.sim("pma", false);
      p.relevo = pg.str("relevo", "");
      m.paginas.push_back(std::move(p));
    }
    for (const Json& im : r["imagens"].itens()) {
      Imagem g;
      g.pagina = int(im.num("pagina", 0));
      g.x = im["ret"][0].num(0);
      g.y = im["ret"][1].num(0);
      g.girada = int(im.num("girada", 0));
      g.rw = im["ret"][2].num(0);
      g.rh = im["ret"][3].num(0);
      if (im["corte"].lista()) {
        g.cortada = true;
        g.ox = im["corte"][0].num(0);
        g.oy = im["corte"][1].num(0);
        g.ow = im["corte"][2].num(0);
        g.oh = im["corte"][3].num(0);
      }
      imagens[im.str("nome", "")] = g;
    }

    ler_ossos(r["ossos"]);
    ler_slots(r["slots"]);
    ler_skins(r["skins"]);
    ler_restricoes(r["restricoes"]);
    ler_particulas(r["particulas"]);
    ler_luzes(r["luzes"], r["ambiente"]);
    ler_instancias(r["instancias"]);
    for (const auto& [nome, d] : r["eventos"].campos()) {
      DadosEvento e;
      e.nome = nome;
      e.inteiro = int(d.num("inteiro", 0));
      e.decimal = d.num("decimal", 0);
      e.texto = d.str("texto", "");
      e.audio = d.str("audio", "");
      e.volume = e.audio.empty() ? 0 : d.num("volume", 1);
      e.balanco = e.audio.empty() ? 0 : d.num("balanco", 0);
      m.eventos.push_back(std::move(e));
    }
    for (const auto& [nome, a] : r["animacoes"].campos()) ler_animacao(nome, a);
    // mix: o padrao e os pares de -> para (nomes de animacao)
    m.mix_padrao = r["mix"].num("padrao", 0);
    for (const Json& p : r["mix"]["pares"].itens()) {
      ParMix pm;
      pm.de = m.animacao(p.str("de", ""));
      pm.para = m.animacao(p.str("para", ""));
      pm.tempo = p.num("tempo", 0);
      if (pm.de < 0 || pm.para < 0) continue;  // par de animacao que nao existe mais: ignorado
      m.mix_pares.push_back(pm);
    }
    preparar_desenho();
    paginas_do_desenho();
    // a pose so depende da animacao e do tempo? (docs/NUCLEO.md "Instancias")
    bool memoria = !m.emissores.empty() || !m.instancias.empty();
    for (const DadosRestricao& d : m.restricoes) memoria = memoria || d.tipo == TipoRestricao::Fisica;
    for (const DadosSlot& d : m.slots) memoria = memoria || d.efeitos.borrar() || d.efeitos.rastro();
    for (const Animacao& an : m.animacoes)
      for (const TimelineEfeito& te : an.efeitos) memoria = memoria || te.tipo == TipoEfeito::Borrar || te.tipo == TipoEfeito::Rastro;
    m.sem_memoria = !memoria;
  }

  // ---- instancias (docs/NUCLEO.md "Instancias")

  std::shared_ptr<const Modelo> abrir_filho(const std::string& completo) {
    if (auto it = carga->lidos.find(completo); it != carga->lidos.end()) return it->second;
    if (std::find(carga->pilha.begin(), carga->pilha.end(), completo) != carga->pilha.end())
      falha("instancias: ciclo (" + completo + " inclui a si mesmo)");
    std::string texto;
    if (!(*carga->abrir)(completo, texto)) falha("instancias: nao abriu " + completo);
    std::string e;
    Json r = Json::ler(texto, &e);
    if (r.nulo()) falha(completo + ": JSON invalido: " + e);
    auto filho = std::make_shared<Modelo>();
    carga->pilha.push_back(completo);
    try {
      Leitor l(*filho);
      l.carga = carga;
      l.caminho = completo;
      l.ler(r);
    } catch (const Erro& x) {
      falha(x.msg.rfind(completo, 0) == 0 ? x.msg : completo + ": " + x.msg);
    }
    carga->pilha.pop_back();
    carga->lidos[completo] = filho;
    return filho;
  }

  void ler_instancias(const Json& lista) {
    m.instancias_do_slot.assign(m.slots.size(), {});
    for (const Json& j : lista.itens()) {
      DadosInstancia d;
      d.nome = j.str("nome", "");
      if (m.instancia(d.nome) >= 0) falha("instancias: instancia repetida " + d.nome);
      d.slot = slot(j["slot"], "instancias");
      d.osso = j.acha("osso") ? osso(j["osso"], "instancias") : m.slots[size_t(d.slot)].osso;
      d.x = j.num("x", 0);
      d.y = j.num("y", 0);
      d.rotacao = j.num("rotacao", 0);
      d.escala_x = j.num("escala_x", 1);
      d.escala_y = j.num("escala_y", 1);
      const std::string rel = j.str("boneco", "");
      if (rel.empty()) falha("instancias: " + d.nome + " sem boneco");
      if (!carga) falha("instancias: " + d.nome + ": este leitor nao abre outros arquivos");
      const std::string completo = normalizar_caminho(diretorio(caminho) + rel);
      auto filho = abrir_filho(completo);
      auto it = std::find(m.filhos.begin(), m.filhos.end(), filho);
      d.filho = int(it - m.filhos.begin());
      if (it == m.filhos.end()) {
        m.filhos.push_back(filho);
        prefixo_filho.push_back(diretorio(normalizar_caminho(rel)));
      }
      d.animacao = animacao_filho(*filho, j.str("animacao", ""), "instancias: " + d.nome);
      if (const std::string sk = j.str("skin", ""); !sk.empty()) {
        d.skin = -1;
        for (size_t k = 0; k < filho->skins.size(); ++k)
          if (filho->skins[k].nome == sk) d.skin = int(k);
        if (d.skin < 0) falha("instancias: " + d.nome + ": skin desconhecida " + sk);
      }
      d.inicio = j.num("inicio", 0);
      d.velocidade = j.num("velocidade", 1);
      d.laco = j.sim("repetir", true);
      d.mix = std::max(0.0, j.num("mix", 0));
      m.instancias_do_slot[size_t(d.slot)].push_back(int(m.instancias.size()));
      m.instancias.push_back(std::move(d));
    }
  }

  static int animacao_filho(const Modelo& f, const std::string& nome, const std::string& onde) {
    if (nome.empty()) return -1;
    const int a = f.animacao(nome);
    if (a < 0) falha(onde + ": animacao desconhecida no filho " + nome);
    return a;
  }

  // as paginas deste modelo e as dos filhos, com o caminho relativo a este arquivo
  void paginas_do_desenho() {
    m.paginas_desenho = m.paginas;
    m.filho_pagina_base.clear();
    for (size_t f = 0; f < m.filhos.size(); ++f) {
      m.filho_pagina_base.push_back(int(m.paginas_desenho.size()));
      for (Pagina pg : m.filhos[f]->paginas_desenho) {
        pg.arquivo = normalizar_caminho(prefixo_filho[f] + pg.arquivo);
        if (!pg.relevo.empty()) pg.relevo = normalizar_caminho(prefixo_filho[f] + pg.relevo);
        m.paginas_desenho.push_back(std::move(pg));
      }
    }
  }

  // ---- particulas (docs/NUCLEO.md "Particulas")

  int emissor(const std::string& nome) const {
    for (size_t i = 0; i < m.emissores.size(); ++i)
      if (m.emissores[i].nome == nome) return int(i);
    return -1;
  }

  // luzes (docs/NUCLEO.md "Luzes"): presas a um osso (root se nao diz), e a ambiente
  void ler_luzes(const Json& lista, const Json& ambiente) {
    for (const Json& j : lista.itens()) {
      DadosLuz d;
      d.nome = j.str("nome", "");
      if (luz(d.nome) >= 0) falha("luzes: luz repetida " + d.nome);
      d.osso = j.acha("osso") ? osso(j["osso"], "luzes") : 0;
      d.x = j.num("x", 0);
      d.y = j.num("y", 0);
      ler_campos(CAMPOS_LUZ, j, d.v);
      limitar_luz(d.v, CANAIS_LUZ);
      m.luzes.push_back(std::move(d));
    }
    if (ambiente.objeto()) {
      ler_campos(CAMPOS_AMBIENTE, ambiente, m.ambiente);
      limitar_luz(m.ambiente, CANAIS_AMBIENTE);
    }
  }
  int luz(const std::string& nome) const {
    for (size_t i = 0; i < m.luzes.size(); ++i)
      if (m.luzes[i].nome == nome) return int(i);
    return -1;
  }

  void ler_particulas(const Json& lista) {
    m.emissores_do_slot.assign(m.slots.size(), {});
    m.orbitas_atras.assign(m.slots.size(), {});
    for (const Json& j : lista.itens()) {
      DadosEmissor d;
      d.nome = j.str("nome", "");
      if (emissor(d.nome) >= 0) falha("particulas: emissor repetido " + d.nome);
      d.slot = slot(j["slot"], "particulas");
      d.osso = j.acha("osso") ? osso(j["osso"], "particulas") : m.slots[size_t(d.slot)].osso;
      d.x = j.num("x", 0);
      d.y = j.num("y", 0);
      auto par = [&](const char* campo, double* v) {
        if (const Json* x = j.acha(campo); x && x->lista()) v[0] = (*x)[0].num(v[0]), v[1] = (*x)[1].num(v[1]);
        else if (x) v[0] = v[1] = x->num(v[0]);
      };
      d.taxa = std::max(j.num("taxa", d.taxa), 0.0);
      par("vida", d.vida);
      par("velocidade", d.velocidade);
      par("escala", d.escala);
      par("giro", d.giro);
      d.raio = j.str("tipo", "") == "raio";
      d.orbita = j.str("tipo", "") == "orbita";
      if (d.raio || d.orbita) d.angulo = 0, d.cores = {Cor{1, 1, 1, 1}};
      d.angulo = j.num("angulo", d.angulo);
      d.abertura = j.num("abertura", d.abertura);
      d.gravidade = j.num("gravidade", d.gravidade);
      d.arrasto = j.num("arrasto", d.arrasto);
      if (const Json* c = j.acha("cor"); c && c->lista() && !c->itens().empty()) {
        d.cores.clear();
        for (const Json& x : c->itens()) d.cores.push_back(x.texto() ? cor_hex(x.str()) : Cor{});
        if (d.cores.size() == 1 && !d.raio && !d.orbita) d.cores.push_back(d.cores[0]);
      }
      if (const Json* b = j.acha("blend"); b && b->texto()) d.blend = int(ler_blend(b->str()));
      par("onda", d.onda);
      if (d.raio) {
        if (const Json* a = j.acha("ate"); a && a->texto()) d.ate = osso(*a, "particulas");
        d.ate_x = j.num("ate_x", 0);
        d.ate_y = j.num("ate_y", 0);
        d.comprimento = j.num("comprimento", d.comprimento);
        d.segmentos = std::max(2, int(j.num("segmentos", d.segmentos)));
        d.desvio = j.num("desvio", d.desvio);
        d.largura = j.num("largura", d.largura);
        d.troca = std::max(0.001, j.num("troca", d.troca));
        d.ramos = std::max(0, int(j.num("ramos", d.ramos)));
      }
      d.maximo = int(j.num("maximo", d.maximo));
      d.semente = uint32_t(j.num("semente", 0));
      auto it = imagens.find(j.str("imagem", ""));
      if (it != imagens.end()) {
        const Imagem& g = it->second;
        d.pagina = g.pagina;
        d.meia_largura = g.rw / 2;
        d.meia_altura = g.rh / 2;
        const double cx[4] = {0, 0, g.rw, g.rw}, cy[4] = {g.rh, 0, 0, g.rh};
        for (int i = 0; i < 4; ++i) uv_pagina(g, cx[i], cy[i], &d.uvs[i * 2]);
      }
      if (d.orbita) {
        d.atras = slot(j["atras"], "particulas (orbita: atras)");
        par("raios", d.raios);
        d.volta = j.num("volta", d.volta);
        if (d.volta == 0) d.volta = 1;
        d.quantidade = std::max(0, int(j.num("quantidade", d.quantidade)));
        d.faixa = j.num("faixa", d.faixa);
        d.inclinacao = j.num("inclinacao", d.inclinacao);
        d.profundidade = j.num("profundidade", d.profundidade);
        m.orbitas_atras[size_t(d.atras)].push_back(int(m.emissores.size()));
      }
      m.emissores_do_slot[size_t(d.slot)].push_back(int(m.emissores.size()));
      m.emissores.push_back(std::move(d));
    }
  }

  // ---- desenho

  // ponto (px, py) da imagem em pixels, a partir do canto de cima e da esquerda do retangulo
  // com pixels, na orientacao original; sai em uv da pagina, com a imagem girada no atlas
  void uv_pagina(const Imagem& g, double px, double py, float* out) const {
    double u, v;
    switch (g.girada) {
      case 90: u = g.x + py, v = g.y + g.rw - px; break;
      case 180: u = g.x + g.rw - px, v = g.y + g.rh - py; break;
      case 270: u = g.x + g.rh - py, v = g.y + px; break;
      default: u = g.x + px, v = g.y + py;
    }
    const Pagina* pg = g.pagina >= 0 && g.pagina < int(m.paginas.size()) ? &m.paginas[size_t(g.pagina)] : nullptr;
    out[0] = float(pg && pg->largura ? u / pg->largura : 0);
    out[1] = float(pg && pg->altura ? v / pg->altura : 0);
  }

  // por parte: a imagem (pelo caminho ou pelo nome) e as uvs da malha no espaco da imagem
  std::unordered_map<int, std::string> caminho_parte;
  std::unordered_map<int, std::vector<double>> uvs_imagem;

  void ler_desenho(int idx, const Json& j) {
    Parte& p = m.partes[size_t(idx)];
    if (const Json* c = j.acha("cor"); c && c->texto()) p.cor = cor_hex(c->str());
    if (p.tipo == TipoParte::Recorte) {
      if (const Json* f = j.acha("fim"); f && f->texto()) p.fim = m.slot(f->str());
      return;
    }
    if (p.tipo != TipoParte::Regiao && p.tipo != TipoParte::Malha && p.tipo != TipoParte::MalhaLigada) return;
    caminho_parte[idx] = j.str("caminho", p.nome);
    if (p.tipo == TipoParte::Malha) {
      std::vector<double> uv;
      for (const Json& x : j["uvs"].itens()) uv.push_back(x.num(0));
      uvs_imagem[idx] = std::move(uv);
      for (const Json& t : j["triangulos"].itens()) p.triangulos.push_back(uint16_t(t.num(0)));
    }
  }

  void preparar_desenho() {
    for (const auto& [idx, cam] : caminho_parte) {
      Parte& p = m.partes[size_t(idx)];
      auto it = imagens.find(cam);
      if (it == imagens.end()) continue;  // sem imagem no atlas: nao desenha
      const Imagem& g = it->second;
      p.pagina = g.pagina;
      if (p.tipo == TipoParte::Regiao) {
        // os cantos sao o retangulo com pixels: baixo-esquerda, cima-esquerda, cima-direita,
        // baixo-direita
        const double cx[4] = {0, 0, g.rw, g.rw}, cy[4] = {g.rh, 0, 0, g.rh};
        p.uvs.resize(8);
        for (int i = 0; i < 4; ++i) uv_pagina(g, cx[i], cy[i], &p.uvs[size_t(i) * 2]);
        continue;
      }
      // malha: uvs de 0 a 1 sobre a imagem original (antes do corte), v para baixo
      const int fonte = p.tipo == TipoParte::MalhaLigada ? p.fonte : idx;
      if (fonte < 0) continue;
      if (p.tipo == TipoParte::MalhaLigada) p.triangulos = m.partes[size_t(fonte)].triangulos;
      const std::vector<double>& uv = uvs_imagem[fonte];
      const double W = g.cortada ? g.ow : g.rw, H = g.cortada ? g.oh : g.rh;
      const double ox = g.cortada ? g.ox : 0, topo = g.cortada ? H - g.oy - g.rh : 0;
      p.uvs.resize(uv.size());
      for (size_t i = 0; i + 1 < uv.size(); i += 2) uv_pagina(g, uv[i] * W - ox, uv[i + 1] * H - topo, &p.uvs[i]);
    }
  }

  void ler_ossos(const Json& lista) {
    for (const Json& o : lista.itens()) {
      DadosOsso d;
      d.nome = o.str("nome", "");
      if (const Json* p = o.acha("pai"); p && p->texto()) {
        d.pai = m.osso(p->str());
        if (d.pai < 0) falha("osso " + d.nome + ": pai desconhecido (o pai vem antes do filho)");
      }
      d.comprimento = o.num("comprimento", 0);
      d.x = o.num("x", 0);
      d.y = o.num("y", 0);
      d.rotacao = o.num("rotacao", 0);
      d.escala_x = o.num("escala_x", 1);
      d.escala_y = o.num("escala_y", 1);
      d.cisalha_x = o.num("cisalha_x", 0);
      d.cisalha_y = o.num("cisalha_y", 0);
      std::string h = o.str("heranca", "normal");
      if (h == "onlyTranslation") d.heranca = Heranca::SoTranslacao;
      else if (h == "noRotationOrReflection") d.heranca = Heranca::SemRotacaoOuReflexo;
      else if (h == "noScale") d.heranca = Heranca::SemEscala;
      else if (h == "noScaleOrReflection") d.heranca = Heranca::SemEscalaOuReflexo;
      m.ossos.push_back(std::move(d));
    }
    if (m.ossos.empty()) falha("esqueleto sem ossos");
  }

  void ler_slots(const Json& lista) {
    for (const Json& s : lista.itens()) {
      DadosSlot d;
      d.nome = s.str("nome", "");
      d.osso = osso(s["osso"], "slot");
      if (const Json* p = s.acha("parte"); p && p->texto()) d.parte_setup = id_nome(p->str());
      if (const Json* c = s.acha("cor"); c && c->texto()) d.cor = cor_hex(c->str());
      d.blend = ler_blend(s.str("blend", "normal"));
      d.profundidade = s.num("profundidade", 0);
      for (const auto& [nome_ef, j] : s["efeitos"].campos()) {
        const int t = tipo_efeito(nome_ef);
        if (t < 0) falha("slot " + d.nome + ": efeito desconhecido " + nome_ef);
        ler_campos_efeito(t, j, d.efeitos.v + EFEITO_INICIO[t]);
      }
      d.efeitos.limitar();
      m.slots.push_back(std::move(d));
    }
  }

  // le vertices (sem pesos) ou pesos de uma parte com geometria
  void ler_geometria(Parte& p, const Json& j, int n) {
    p.num_vertices = n;
    if (const Json* pw = j.acha("pesos"); pw && pw->lista()) {
      if (int(pw->tamanho()) != n) falha("parte " + p.nome + ": pesos com numero de vertices errado");
      p.pesos_inicio.reserve(size_t(n) + 1);
      for (const Json& v : pw->itens()) {
        p.pesos_inicio.push_back(int(p.pesos_osso.size()));
        for (const Json& e : v.itens()) {
          p.pesos_osso.push_back(osso(e[size_t(0)], "peso"));
          p.pesos_xyp.push_back(e[1].num(0));
          p.pesos_xyp.push_back(e[2].num(0));
          p.pesos_xyp.push_back(e[3].num(0));
        }
      }
      p.pesos_inicio.push_back(int(p.pesos_osso.size()));
    } else {
      const Json& v = j["vertices"];
      if (int(v.tamanho()) != n * 2) falha("parte " + p.nome + ": vertices com tamanho errado");
      p.vertices.reserve(size_t(n) * 2);
      for (const Json& x : v.itens()) p.vertices.push_back(x.num(0));
    }
  }

  void cantos_regiao(Parte& p, const Json& j) {
    const double w = j.num("largura", 32), h = j.num("altura", 32);
    double l = -w / 2, b = -h / 2, r = w / 2, t = h / 2;
    auto it = imagens.find(j.str("caminho", p.nome));
    if (it != imagens.end() && it->second.cortada && it->second.ow > 0 && it->second.oh > 0) {
      // a imagem foi cortada no atlas: o retangulo e so a parte com pixels, na posicao dela
      // dentro do original (corte medido a partir do canto de baixo e da esquerda)
      const Imagem& g = it->second;
      const double fx = w / g.ow, fy = h / g.oh;
      l = -w / 2 + g.ox * fx;
      b = -h / 2 + g.oy * fy;
      r = l + g.rw * fx;
      t = b + g.rh * fy;
    }
    const double sx = j.num("escala_x", 1), sy = j.num("escala_y", 1);
    l *= sx;
    r *= sx;
    b *= sy;
    t *= sy;
    const double rot = j.num("rotacao", 0) * GRAU;
    const double cs = std::cos(rot), sn = std::sin(rot);
    const double x = j.num("x", 0), y = j.num("y", 0);
    const double px[4] = {l, l, r, r}, py[4] = {b, t, t, b};
    for (int i = 0; i < 4; ++i) {
      p.cantos[i * 2] = x + px[i] * cs - py[i] * sn;
      p.cantos[i * 2 + 1] = y + px[i] * sn + py[i] * cs;
    }
  }

  struct Ligacao {
    int parte, skin_fonte_nome, slot;
    std::string skin_fonte, fonte;
    bool herda;
  };
  std::vector<Ligacao> ligacoes;

  void ler_skins(const Json& lista) {
    // a skin 0 e sempre a default
    m.skins.emplace_back();
    m.skins[0].nome = "default";
    m.skins[0].por_slot.resize(m.slots.size());
    for (const Json& sk : lista.itens()) {
      std::string nome = sk.str("nome", "default");
      Skin* s;
      if (nome == "default") {
        s = &m.skins[0];
      } else {
        m.skins.emplace_back();
        s = &m.skins.back();
        s->nome = nome;
        s->por_slot.resize(m.slots.size());
      }
      for (const Json& o : sk["ossos"].itens()) s->ossos.push_back(osso(o, "skin"));
      const int sk_idx = int(s - m.skins.data());
      for (const auto& [nome_slot, partes] : sk["partes"].campos()) {
        int si = m.slot(nome_slot);
        if (si < 0) falha("skin " + nome + ": slot desconhecido " + nome_slot);
        for (const auto& [nome_parte, j] : partes.campos()) {
          Parte p;
          p.nome = nome_parte;
          p.slot = si;
          p.tipo = ler_tipo_parte(j.str("tipo", "regiao"));
          switch (p.tipo) {
            case TipoParte::Regiao: cantos_regiao(p, j); break;
            case TipoParte::Malha:
              ler_geometria(p, j, int(j["uvs"].tamanho() / 2));
              p.contorno = int(j.num("contorno", 0));
              break;
            case TipoParte::MalhaLigada: {
              Ligacao lg;
              lg.parte = int(m.partes.size());
              lg.slot = si;
              lg.skin_fonte = j.str("skin", "default");
              lg.fonte = j.str("fonte", j.str("pai", ""));
              lg.herda = j.sim("timelines", true);
              lg.skin_fonte_nome = 0;
              ligacoes.push_back(lg);
              break;
            }
            case TipoParte::Caminho:
              ler_geometria(p, j, int(j.num("num_vertices", 0)));
              p.fechado = j.sim("fechado", false);
              p.velocidade_constante = j.sim("velocidade_constante", true);
              for (const Json& c : j["comprimentos"].itens()) p.comprimentos.push_back(c.num(0));
              break;
            case TipoParte::Recorte:
            case TipoParte::Caixa: ler_geometria(p, j, int(j.num("num_vertices", 0))); break;
            case TipoParte::Ponto:
              p.px = j.num("x", 0);
              p.py = j.num("y", 0);
              p.prot = j.num("rotacao", 0);
              break;
          }
          const int idx = int(m.partes.size());
          m.partes.push_back(std::move(p));
          m.partes[size_t(idx)].deform_de = idx;
          ler_desenho(idx, j);
          (void)sk_idx;
          s->por_slot[size_t(si)].emplace_back(id_nome(nome_parte), idx);
        }
      }
    }
    // malhas ligadas: copiam a geometria da fonte (mesmo slot, skin indicada)
    for (const Ligacao& lg : ligacoes) {
      int sk = 0;
      for (size_t i = 0; i < m.skins.size(); ++i)
        if (m.skins[i].nome == lg.skin_fonte) sk = int(i);
      int f = -1;
      auto ia = ids_partes.find(lg.fonte);
      if (ia != ids_partes.end())
        for (const auto& [id, pi] : m.skins[size_t(sk)].por_slot[size_t(lg.slot)])
          if (id == ia->second) f = pi;
      if (f < 0 || m.partes[size_t(f)].tipo != TipoParte::Malha)
        falha("malha ligada " + m.partes[size_t(lg.parte)].nome + ": fonte nao encontrada " + lg.fonte);
      Parte& p = m.partes[size_t(lg.parte)];
      const Parte& src = m.partes[size_t(f)];
      p.fonte = f;
      p.num_vertices = src.num_vertices;
      p.vertices = src.vertices;
      p.pesos_inicio = src.pesos_inicio;
      p.pesos_osso = src.pesos_osso;
      p.pesos_xyp = src.pesos_xyp;
      p.contorno = src.contorno;
      if (p.triangulos.empty()) p.triangulos = src.triangulos;
      p.deform_de = lg.herda ? f : lg.parte;
    }
  }

  void ler_restricoes(const Json& lista) {
    int seq = 0;
    for (const Json& j : lista.itens()) {
      DadosRestricao r;
      r.nome = j.str("nome", "");
      r.ordem = int(j.num("ordem", seq));
      r.so_skin = j.sim("skin", false);
      ++seq;
      std::string tipo = j.str("tipo", "");
      if (tipo == "ik") {
        r.tipo = TipoRestricao::IK;
        DadosIK& k = r.ik;
        for (const Json& o : j["ossos"].itens()) k.ossos.push_back(osso(o, "ik"));
        k.alvo = osso(j["alvo"], "ik");
        k.mix = j.num("mix", 1);
        k.suavidade = j.num("suavidade", 0);
        k.dobra = j.sim("dobra_positiva", true) ? 1 : -1;
        k.comprime = j.sim("comprime", false);
        k.estica = j.sim("estica", false);
        k.uniforme = j.sim("uniforme", false);
        if (k.ossos.empty() || k.ossos.size() > 2) falha("ik " + r.nome + ": 1 ou 2 ossos");
      } else if (tipo == "caminho") {
        r.tipo = TipoRestricao::Caminho;
        DadosCaminho& c = r.caminho;
        for (const Json& o : j["ossos"].itens()) c.ossos.push_back(osso(o, "caminho"));
        c.slot = slot(j["slot"], "caminho");
        std::string mp = j.str("modo_posicao", "percent");
        c.modo_posicao = mp == "fixed" ? ModoPosicao::Fixo : ModoPosicao::Percentual;
        std::string me = j.str("modo_espacamento", "length");
        c.modo_espacamento = me == "fixed" ? ModoEspacamento::Fixo
                             : me == "percent" ? ModoEspacamento::Percentual
                             : me == "proportional" ? ModoEspacamento::Proporcional
                                                    : ModoEspacamento::Comprimento;
        std::string mg = j.str("modo_girar", "tangent");
        c.modo_girar = mg == "chain" ? ModoGirar::Cadeia : mg == "chainScale" ? ModoGirar::CadeiaEscala : ModoGirar::Tangente;
        c.rotacao = j.num("rotacao", 0);
        c.posicao = j.num("posicao", 0);
        c.espacamento = j.num("espacamento", 0);
        c.mix_girar = j.num("mix_girar", 1);
        c.mix_x = j.num("mix_x", 1);
        c.mix_y = j.num("mix_y", c.mix_x);
      } else if (tipo == "fisica") {
        r.tipo = TipoRestricao::Fisica;
        DadosFisica& f = r.fisica;
        f.osso = osso(j["osso"], "fisica");
        f.x = j.num("x", 0);
        f.y = j.num("y", 0);
        f.girar = j.num("girar", 0);
        f.escala_x = j.num("escala_x", 0);
        f.cisalha_x = j.num("cisalha_x", 0);
        f.limite = j.num("limite", 5000);
        f.passo = 1.0 / j.num("passo", j.num("fps", 60));
        f.inercia = j.num("inercia", 0.5);  // padrao medido no oraculo
        f.forca = j.num("forca", 100);
        f.amortecimento = j.num("amortecimento", 0.85);  // padrao medido no oraculo
        const double massa = j.num("massa", 1);
        f.massa_inv = massa != 0 ? 1.0 / massa : 0;
        f.vento = j.num("vento", 0);
        f.gravidade = j.num("gravidade", 0);
        f.mix = j.num("mix", 1);
      } else if (tipo == "transformacao") {
        r.tipo = TipoRestricao::Transformacao;
        ler_transformacao(r.transf, j);
      } else {
        falha("restricao " + r.nome + ": tipo nao suportado " + tipo);
      }
      m.restricoes.push_back(std::move(r));
    }
    std::stable_sort(m.restricoes.begin(), m.restricoes.end(),
                     [](const DadosRestricao& a, const DadosRestricao& b) { return a.ordem < b.ordem; });
  }

  static bool prop_transf(const std::string& s, PropTransf& p) {
    // nomes do .boneco (traduzidos pelo dicionario) ou os do Spine
    if (s == "girar" || s == "rotate") p = PropTransf::Girar;
    else if (s == "x") p = PropTransf::X;
    else if (s == "y") p = PropTransf::Y;
    else if (s == "escala_x" || s == "scaleX") p = PropTransf::EscalaX;
    else if (s == "escala_y" || s == "scaleY") p = PropTransf::EscalaY;
    else if (s == "cisalha_y" || s == "shearY") p = PropTransf::CisalhaY;
    else return false;
    return true;
  }

  // transformacao 4.3: "propriedades": { <prop da fonte>: { "deslocamento", "para": {
  // <prop do alvo>: { "deslocamento", "max", "escala" } } } }
  void ler_transformacao(DadosTransformacao& t, const Json& j) {
    for (const Json& o : j["ossos"].itens()) t.ossos.push_back(osso(o, "transformacao"));
    t.fonte = osso(j["fonte"], "transformacao");
    t.fonte_local = j.sim("fonte_local", false);
    t.alvo_local = j.sim("alvo_local", false);
    t.somar = j.sim("somar", false);
    t.limitar = j.sim("limitar", false);
    t.desl_girar = j.num("rotacao", 0);
    t.desl_x = j.num("x", 0);
    t.desl_y = j.num("y", 0);
    t.desl_escala_x = j.num("escala_x", 0);
    t.desl_escala_y = j.num("escala_y", 0);
    t.desl_cisalha_y = j.num("cisalha_y", 0);
    bool para_x = false, para_escala_x = false;
    for (const auto& [nome, pj] : j["propriedades"].campos()) {
      DadosTransfDe d;
      if (!prop_transf(nome, d.prop)) falha("transformacao: propriedade desconhecida " + nome);
      d.deslocamento = pj.num("deslocamento", pj.num("offset", 0));
      for (const auto& [np, pp] : pj["para"].campos()) {
        DadosTransfPara para;
        if (!prop_transf(np, para.prop)) falha("transformacao: propriedade desconhecida " + np);
        para.deslocamento = pp.num("deslocamento", pp.num("offset", 0));
        para.maximo = pp.num("max", 1);  // padrao medido no oraculo
        para.escala = pp.num("escalar", pp.num("scale", 1));
        para_x |= para.prop == PropTransf::X;
        para_escala_x |= para.prop == PropTransf::EscalaX;
        d.para.push_back(para);
      }
      t.de.push_back(std::move(d));
    }
    // medido: sem mix_y o oraculo usa mix_x so se alguma propriedade vai para x (senao 0);
    // o mesmo para mix_escala_y e escala_x
    t.mix_girar = j.num("mix_girar", 1);
    t.mix_x = j.num("mix_x", 1);
    t.mix_y = j.num("mix_y", para_x ? t.mix_x : 0);
    t.mix_escala_x = j.num("mix_escala_x", 1);
    t.mix_escala_y = j.num("mix_escala_y", para_escala_x ? t.mix_escala_x : 0);
    t.mix_cisalha_y = j.num("mix_cisalha_y", 1);
  }

  int restricao(const std::string& nome, TipoRestricao tipo) {
    for (size_t i = 0; i < m.restricoes.size(); ++i)
      if (m.restricoes[i].nome == nome && m.restricoes[i].tipo == tipo) return int(i);
    falha("animacao: restricao desconhecida " + nome);
  }

  void ler_animacao(const std::string& nome, const Json& a) {
    Animacao an;
    an.nome = nome;
    double dur = 0;
    auto conta = [&](double t) { dur = std::max(dur, t); };

    for (const auto& [nome_osso, tls] : a["ossos"].campos()) {
      int oi = m.osso(nome_osso);
      if (oi < 0) falha("animacao " + nome + ": osso desconhecido " + nome_osso);
      for (const auto& [tipo, chaves] : tls.campos()) {
        TimelineOsso t;
        t.osso = oi;
        if (tipo == "girar") t.prop = PropOsso::Girar, t.tl = ler_timeline(chaves, {{"valor", 0}});
        else if (tipo == "mover") t.prop = PropOsso::Mover, t.tl = ler_timeline(chaves, {{"x", 0}, {"y", 0}});
        else if (tipo == "mover_x") t.prop = PropOsso::MoverX, t.tl = ler_timeline(chaves, {{"valor", 0}});
        else if (tipo == "mover_y") t.prop = PropOsso::MoverY, t.tl = ler_timeline(chaves, {{"valor", 0}});
        else if (tipo == "escalar") t.prop = PropOsso::Escalar, t.tl = ler_timeline(chaves, {{"x", 1}, {"y", 1}});
        else if (tipo == "escalar_x") t.prop = PropOsso::EscalarX, t.tl = ler_timeline(chaves, {{"valor", 1}});
        else if (tipo == "escalar_y") t.prop = PropOsso::EscalarY, t.tl = ler_timeline(chaves, {{"valor", 1}});
        else if (tipo == "cisalhar") t.prop = PropOsso::Cisalhar, t.tl = ler_timeline(chaves, {{"x", 0}, {"y", 0}});
        else if (tipo == "cisalhar_x") t.prop = PropOsso::CisalharX, t.tl = ler_timeline(chaves, {{"valor", 0}});
        else if (tipo == "cisalhar_y") t.prop = PropOsso::CisalharY, t.tl = ler_timeline(chaves, {{"valor", 0}});
        else if (tipo == "heranca") {
          for (const Json& k : chaves.itens()) conta(k.num("tempo", 0));
          continue;  // fora do v0
        } else falha("animacao " + nome + ": timeline de osso desconhecida " + tipo);
        conta(t.tl.fim());
        an.ossos.push_back(std::move(t));
      }
    }

    for (const auto& [nome_slot, tls] : a["slots"].campos()) {
      int si = m.slot(nome_slot);
      if (si < 0) falha("animacao " + nome + ": slot desconhecido " + nome_slot);
      for (const auto& [tipo, chaves] : tls.campos()) {
        if (tipo == "parte") {
          TimelineParte t;
          t.slot = si;
          for (const Json& k : chaves.itens()) {
            t.tempos.push_back(f32(k.num("tempo", 0)));
            const Json& n = k["nome"];
            t.nomes.push_back(n.texto() ? id_nome(n.str()) : -1);
          }
          if (!t.tempos.empty()) conta(t.tempos.back());
          an.partes.push_back(std::move(t));
          continue;
        }
        TimelineCor t;
        t.slot = si;
        if (tipo == "rgba") t.prop = PropCor::Rgba, t.tl = ler_timeline_cor(chaves, 4);
        else if (tipo == "rgb") t.prop = PropCor::Rgb, t.tl = ler_timeline_cor(chaves, 3);
        else if (tipo == "alfa") t.prop = PropCor::Alfa, t.tl = ler_timeline(chaves, {{"valor", 1}});
        else falha("animacao " + nome + ": timeline de slot nao suportada " + tipo);
        conta(t.tl.fim());
        an.cores.push_back(std::move(t));
      }
    }

    // efeitos: efeitos -> slot -> efeito -> [chaves]
    for (const auto& [nome_slot, efs] : a["efeitos"].campos()) {
      int si = m.slot(nome_slot);
      if (si < 0) falha("animacao " + nome + ": slot desconhecido " + nome_slot);
      for (const auto& [nome_ef, chaves] : efs.campos()) {
        const int t = tipo_efeito(nome_ef);
        if (t < 0) falha("animacao " + nome + ": efeito desconhecido " + nome_ef);
        TimelineEfeito te;
        te.slot = si;
        te.tipo = TipoEfeito(t);
        te.tl = ler_timeline_efeito(chaves, t, m.slots[size_t(si)].efeitos);
        conta(te.tl.fim());
        an.efeitos.push_back(std::move(te));
      }
    }

    // luzes: nome -> [chaves]; ambiente: [chaves]
    for (const auto& [nome_luz, chaves] : a["luzes"].campos()) {
      const int il = luz(nome_luz);
      if (il < 0) falha("animacao " + nome + ": luz desconhecida " + nome_luz);
      TimelineLuz tl;
      tl.luz = il;
      tl.tl = ler_timeline_campos(chaves, CAMPOS_LUZ, m.luzes[size_t(il)].v, CANAIS_LUZ);
      conta(tl.tl.fim());
      an.luzes.push_back(std::move(tl));
    }
    if (a["ambiente"].lista()) {
      TimelineLuz tl;
      tl.luz = -1;
      tl.tl = ler_timeline_campos(a["ambiente"], CAMPOS_AMBIENTE, m.ambiente, CANAIS_AMBIENTE);
      conta(tl.tl.fim());
      an.luzes.push_back(std::move(tl));
    }

    // instancias: nome -> chaves em degrau (animacao, inicio, velocidade, repetir, mix); o campo que falta
    // vale o da chave anterior (na primeira, o da instancia)
    for (const auto& [nome_in, chaves] : a["instancias"].campos()) {
      const int ii = m.instancia(nome_in);
      if (ii < 0) falha("animacao " + nome + ": instancia desconhecida " + nome_in);
      const DadosInstancia& di = m.instancias[size_t(ii)];
      const Modelo& f = *m.filhos[size_t(di.filho)];
      TimelineInstancia ti;
      ti.instancia = ii;
      int an_f = di.animacao;
      double ini = di.inicio, vel = di.velocidade, mix = di.mix;
      bool laco = di.laco;
      for (const Json& k : chaves.itens()) {
        if (const Json* x = k.acha("animacao"); x && x->texto()) an_f = animacao_filho(f, x->str(), "animacao " + nome + ": instancia " + nome_in);
        ini = k.num("inicio", ini);
        vel = k.num("velocidade", vel);
        laco = k.sim("repetir", laco);
        mix = std::max(0.0, k.num("mix", mix));
        ti.tempos.push_back(f32(k.num("tempo", 0)));
        ti.animacoes.push_back(an_f);
        ti.inicios.push_back(ini);
        ti.velocidades.push_back(vel);
        ti.lacos.push_back(laco ? 1 : 0);
        ti.mixes.push_back(mix);
      }
      if (!ti.tempos.empty()) conta(ti.tempos.back());
      an.instancias.push_back(std::move(ti));
    }

    // particulas: emissor -> { taxa: [...], rajada: [...] }
    for (const auto& [nome_em, tls] : a["particulas"].campos()) {
      const int ie = emissor(nome_em);
      if (ie < 0) falha("animacao " + nome + ": emissor desconhecido " + nome_em);
      for (const auto& [tipo, chaves] : tls.campos()) {
        if (tipo == "taxa") {
          TimelineTaxa tt;
          tt.emissor = ie;
          tt.tl = ler_timeline(chaves, {{"valor", m.emissores[size_t(ie)].taxa}});
          conta(tt.tl.fim());
          an.taxas.push_back(std::move(tt));
        } else if (tipo == "rajada") {
          TimelineRajada tr;
          tr.emissor = ie;
          for (const Json& k : chaves.itens()) {
            tr.tempos.push_back(f32(k.num("tempo", 0)));
            tr.quantidades.push_back(int(k.num("quantidade", 1)));
          }
          if (!tr.tempos.empty()) conta(tr.tempos.back());
          an.rajadas.push_back(std::move(tr));
        } else {
          falha("animacao " + nome + ": timeline de particulas desconhecida " + tipo);
        }
      }
    }

    // deformar: partes -> skin -> slot -> parte -> { deformar: [...] }
    for (const auto& [nome_skin, slots] : a["partes"].campos()) {
      int sk = -1;
      for (size_t i = 0; i < m.skins.size(); ++i)
        if (m.skins[i].nome == nome_skin) sk = int(i);
      if (sk < 0) falha("animacao " + nome + ": skin desconhecida " + nome_skin);
      for (const auto& [nome_slot, partes] : slots.campos()) {
        int si = m.slot(nome_slot);
        if (si < 0) falha("animacao " + nome + ": slot desconhecido " + nome_slot);
        for (const auto& [nome_parte, tls] : partes.campos()) {
          int pi = m.parte_de(sk, si, m.id_parte(nome_parte));
          if (pi < 0) falha("animacao " + nome + ": parte desconhecida " + nome_parte);
          for (const auto& [tipo, chaves] : tls.campos()) {
            if (tipo != "deformar") {
              for (const Json& k : chaves.itens()) conta(k.num("tempo", 0));
              continue;  // sequencia: fora do v0
            }
            TimelineDeformar t;
            t.slot = si;
            t.parte = pi;
            t.tl.canais = 1;
            const Parte& p = m.partes[size_t(pi)];
            const size_t n = size_t(p.tamanho_deform());
            for (const Json& k : chaves.itens()) {
              t.tl.tempos.push_back(f32(k.num("tempo", 0)));
              t.tl.valores.push_back(0);
              ler_curva(t.tl, k);
              std::vector<double> v(n, 0.0);
              size_t ini = size_t(k.num("deslocamento", 0));
              const Json& vs = k["vertices"];
              for (size_t i = 0; i < vs.tamanho() && ini + i < n; ++i) v[ini + i] = f32(vs[i].num(0));
              t.chaves.push_back(std::move(v));
            }
            t.tl.preparar(true);
            conta(t.tl.fim());
            an.deformar.push_back(std::move(t));
          }
        }
      }
    }

    if (const Json* od = a.acha("ordem_desenho"); od && od->lista()) {
      TimelineOrdem t;
      const int n = int(m.slots.size());
      for (const Json& k : od->itens()) {
        t.tempos.push_back(f32(k.num("tempo", 0)));
        const Json& ds = k["deslocamentos"];
        if (!ds.lista() || ds.tamanho() == 0) {
          t.ordens.emplace_back();
          continue;
        }
        // cada slot listado vai para (indice no setup + deslocamento); os outros preenchem
        // os lugares que sobram, na ordem do setup
        std::vector<int> ordem(size_t(n), -1), sobra;
        int atual = 0;
        for (const Json& d : ds.itens()) {
          int si = slot(d["slot"], "ordem_desenho");
          while (atual != si) sobra.push_back(atual++);
          int destino = atual + int(d.num("deslocamento", 0));
          if (destino < 0 || destino >= n) falha("ordem_desenho: deslocamento fora");
          ordem[size_t(destino)] = atual++;
        }
        while (atual < n) sobra.push_back(atual++);
        // preenche de tras para frente, como uma pilha
        for (int i = n - 1; i >= 0; --i)
          if (ordem[size_t(i)] == -1) {
            ordem[size_t(i)] = sobra.back();
            sobra.pop_back();
          }
        t.ordens.push_back(std::move(ordem));
      }
      if (!t.tempos.empty()) conta(t.tempos.back());
      an.ordem.push_back(std::move(t));
    }

    // eventos: cada chave herda da definicao os valores que nao traz (o volume e o balanco
    // so valem com audio; sem audio sao 0, como no oraculo)
    if (const Json* ev = a.acha("eventos"); ev && ev->lista()) {
      for (const Json& k : ev->itens()) {
        ChaveEvento c;
        c.tempo = f32(k.num("tempo", 0));
        const std::string nome_ev = k.str("nome", "");
        c.evento = m.evento(nome_ev);
        if (c.evento < 0) falha("animacao " + nome + ": evento desconhecido " + nome_ev);
        const DadosEvento& d = m.eventos[size_t(c.evento)];
        c.inteiro = int(k.num("inteiro", d.inteiro));
        c.decimal = k.num("decimal", d.decimal);
        c.texto = k["texto"].texto() ? k["texto"].str() : d.texto;
        // medido: no oraculo o balanco que a chave nao traz vem do VOLUME da definicao (e nao
        // do balanco); seguimos o oraculo (docs/NUCLEO.md "Estado", eventos)
        c.volume = d.audio.empty() ? 0 : k.num("volume", d.volume);
        c.balanco = d.audio.empty() ? 0 : k.num("balanco", d.volume);
        conta(c.tempo);
        an.eventos.push_back(std::move(c));
      }
      std::stable_sort(an.eventos.begin(), an.eventos.end(), [](const ChaveEvento& x, const ChaveEvento& y) { return x.tempo < y.tempo; });
    }

    // restricoes
    for (const auto& [nome_r, chaves] : a["ik"].campos()) {
      TimelineRestricao t;
      t.restricao = restricao(nome_r, TipoRestricao::IK);
      t.prop = PropRestricao::IkMix;
      t.tl = ler_timeline(chaves, {{"mix", 1}, {"suavidade", 0}});
      for (const Json& k : chaves.itens()) {
        t.dobra.push_back(k.sim("dobra_positiva", true) ? 1 : -1);
        t.comprime.push_back(k.sim("comprime", false));
        t.estica.push_back(k.sim("estica", false));
      }
      conta(t.tl.fim());
      an.restricoes.push_back(std::move(t));
    }
    for (const char* chave : {"transform", "transformacao"})
      for (const auto& [nome_r, chaves] : a[chave].campos()) {
        TimelineRestricao t;
        t.restricao = restricao(nome_r, TipoRestricao::Transformacao);
        t.prop = PropRestricao::TransfMix;
        Timeline tl;
        tl.canais = 6;
        for (const Json& k : chaves.itens()) {
          tl.tempos.push_back(f32(k.num("tempo", 0)));
          double mr = k.num("mix_girar", 1), mx = k.num("mix_x", 1), my = k.num("mix_y", mx);
          double ms = k.num("mix_escala_x", 1), msy = k.num("mix_escala_y", ms), mh = k.num("mix_cisalha_y", 1);
          for (double v : {mr, mx, my, ms, msy, mh}) tl.valores.push_back(f32(v));
          ler_curva(tl, k);
        }
        tl.preparar();
        t.tl = std::move(tl);
        conta(t.tl.fim());
        an.restricoes.push_back(std::move(t));
      }
    for (const auto& [nome_r, tls] : a["caminho"].campos()) {
      int ri = restricao(nome_r, TipoRestricao::Caminho);
      for (const auto& [tipo, chaves] : tls.campos()) {
        TimelineRestricao t;
        t.restricao = ri;
        if (tipo == "posicao") t.prop = PropRestricao::CaminhoPosicao, t.tl = ler_timeline(chaves, {{"valor", 0}});
        else if (tipo == "espacamento") t.prop = PropRestricao::CaminhoEspacamento, t.tl = ler_timeline(chaves, {{"valor", 0}});
        else if (tipo == "mix") {
          t.prop = PropRestricao::CaminhoMix;
          Timeline tl;
          tl.canais = 3;
          for (const Json& k : chaves.itens()) {
            tl.tempos.push_back(f32(k.num("tempo", 0)));
            double mr = k.num("mix_girar", 1), mx = k.num("mix_x", 1), my = k.num("mix_y", mx);
            for (double v : {mr, mx, my}) tl.valores.push_back(f32(v));
            ler_curva(tl, k);
          }
          tl.preparar();
          t.tl = std::move(tl);
        } else falha("animacao " + nome + ": timeline de caminho desconhecida " + tipo);
        conta(t.tl.fim());
        an.restricoes.push_back(std::move(t));
      }
    }
    for (const char* chave : {"physics", "fisica"})
      for (const auto& [nome_r, tls] : a[chave].campos()) {
        int ri = nome_r.empty() ? -1 : restricao(nome_r, TipoRestricao::Fisica);
        for (const auto& [tipo, chaves] : tls.campos()) {
          TimelineRestricao t;
          t.restricao = ri;
          if (tipo == "inercia") t.prop = PropRestricao::FisicaInercia;
          else if (tipo == "forca") t.prop = PropRestricao::FisicaForca;
          else if (tipo == "amortecimento") t.prop = PropRestricao::FisicaAmortecimento;
          else if (tipo == "massa") t.prop = PropRestricao::FisicaMassa;
          else if (tipo == "vento") t.prop = PropRestricao::FisicaVento;
          else if (tipo == "gravidade") t.prop = PropRestricao::FisicaGravidade;
          else if (tipo == "mix") t.prop = PropRestricao::FisicaMix;
          else if (tipo == "reiniciar") t.prop = PropRestricao::FisicaReiniciar;
          else falha("animacao " + nome + ": timeline de fisica desconhecida " + tipo);
          t.tl = ler_timeline(chaves, {{"valor", 0}});
          conta(t.tl.fim());
          an.restricoes.push_back(std::move(t));
        }
      }

    an.duracao = dur;
    m.animacoes.push_back(std::move(an));
  }
};

}  // namespace

int Modelo::osso(std::string_view n) const {
  for (size_t i = 0; i < ossos.size(); ++i)
    if (ossos[i].nome == n) return int(i);
  return -1;
}

int Modelo::slot(std::string_view n) const {
  for (size_t i = 0; i < slots.size(); ++i)
    if (slots[i].nome == n) return int(i);
  return -1;
}

int Modelo::animacao(std::string_view n) const {
  for (size_t i = 0; i < animacoes.size(); ++i)
    if (animacoes[i].nome == n) return int(i);
  return -1;
}

int Modelo::instancia(std::string_view n) const {
  for (size_t i = 0; i < instancias.size(); ++i)
    if (instancias[i].nome == n) return int(i);
  return -1;
}

int Modelo::evento(std::string_view n) const {
  for (size_t i = 0; i < eventos.size(); ++i)
    if (eventos[i].nome == n) return int(i);
  return -1;
}

double Modelo::mix(int de, int para) const {
  for (const ParMix& p : mix_pares)
    if (p.de == de && p.para == para) return p.tempo;
  return mix_padrao;
}

int Modelo::id_parte(std::string_view n) const {
  for (size_t i = 0; i < nomes_partes.size(); ++i)
    if (nomes_partes[i] == n) return int(i);
  return -1;
}

int Modelo::parte_de(int skin, int slot, int id) const {
  if (id < 0 || slot < 0) return -1;
  for (int s : {skin, 0}) {
    if (s < 0 || s >= int(skins.size())) continue;
    for (const auto& [i, p] : skins[size_t(s)].por_slot[size_t(slot)])
      if (i == id) return p;
  }
  return -1;
}

std::shared_ptr<const Modelo> ler_boneco(std::string_view texto, std::string* erro) { return ler_boneco(texto, "", AbrirArquivo(), erro); }

std::shared_ptr<const Modelo> ler_boneco(std::string_view texto, std::string_view caminho, const AbrirArquivo& abrir, std::string* erro) {
  std::string e;
  Json r = Json::ler(texto, &e);
  if (r.nulo()) {
    if (erro) *erro = "JSON invalido: " + e;
    return nullptr;
  }
  auto m = std::make_shared<Modelo>();
  try {
    Carga carga;
    carga.abrir = &abrir;
    const std::string c = normalizar_caminho(caminho);
    carga.pilha.push_back(c);
    Leitor l(*m);
    if (abrir) l.carga = &carga;
    l.caminho = c;
    l.ler(r);
  } catch (const Erro& x) {
    if (erro) *erro = x.msg;
    return nullptr;
  }
  return m;
}

std::string normalizar_caminho(std::string_view c) {
  std::vector<std::string> partes;
  size_t i = 0;
  const bool absoluto = !c.empty() && c[0] == '/';
  while (i <= c.size()) {
    size_t j = c.find('/', i);
    if (j == std::string_view::npos) j = c.size();
    const std::string_view p = c.substr(i, j - i);
    if (p == "..") {
      if (!partes.empty() && partes.back() != "..") partes.pop_back();
      else if (!absoluto) partes.emplace_back("..");
    } else if (!p.empty() && p != ".") {
      partes.emplace_back(p);
    }
    i = j + 1;
  }
  std::string out = absoluto ? "/" : "";
  for (size_t k = 0; k < partes.size(); ++k) out += (k ? "/" : "") + partes[k];
  // um diretorio continua terminando em '/'
  if (!c.empty() && c.back() == '/' && !partes.empty()) out += '/';
  return out;
}

std::string diretorio(std::string_view c) {
  const size_t k = c.rfind('/');
  return k == std::string_view::npos ? "" : std::string(c.substr(0, k + 1));
}

bool ler_animacao(Modelo& m, std::string_view nome, std::string_view texto, std::string* erro) {
  std::string e;
  Json r = Json::ler(texto, &e);
  if (!r.objeto()) {
    if (erro) *erro = "JSON invalido: " + e;
    return false;
  }
  const size_t nomes = m.nomes_partes.size();
  try {
    Leitor l(m);
    for (size_t i = 0; i < m.nomes_partes.size(); ++i) l.ids_partes.emplace(m.nomes_partes[i], int(i));
    l.ler_animacao(std::string(nome), r);
  } catch (const Erro& x) {
    if (erro) *erro = x.msg;
    m.nomes_partes.resize(nomes);
    return false;
  }
  const int velha = m.animacao(nome);
  if (velha >= 0 && velha != int(m.animacoes.size()) - 1) {
    m.animacoes[size_t(velha)] = std::move(m.animacoes.back());
    m.animacoes.pop_back();
  }
  return true;
}

}  // namespace mamulengo
