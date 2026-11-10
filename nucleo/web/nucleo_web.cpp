// Ponte do nucleo para o navegador (wasm): modelos, instancias e o desenho num buffer que o
// JavaScript le direto da memoria do wasm. Ids sao indices; o modelo so e liberado por
// mm_liberar_modelo (o editor troca de modelo a cada edicao estrutural) e as instancias por
// mm_limpar_instancias (o palco troca o tempo todo).
//
// O editor (src/render/nucleo.ts) usa as instancias com Estado (trilhas, fila e mix):
// mm_reiniciar, mm_estado_tocar, mm_estado_enfileirar e mm_passo. A demo (src/demo/) usa o
// mesmo caminho e mm_posicao para arrastar o personagem. As edicoes rapidas mudam o
// setup do modelo direto (mm_osso_setup, mm_slot_setup, mm_trocar_animacao), sem reler o
// .boneco inteiro.
//
// O editor tambem le a pose daqui (clique, arrasto, gizmos, caixas), sem o spine-core:
// mm_pose_ossos, mm_setup_ossos, mm_pose_slots, mm_vertices_slot e mm_caixa escrevem em
// areas que o JavaScript le direto (HEAPF64). mm_guardar e mm_restaurar sao o checkpoint do
// poseAt (a pose num instante continua do ultimo passo inteiro, como o PoseSim) e
// mm_simular da a pose em varios instantes de uma vez.
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <unordered_map>
#include <string>
#include <vector>

#include "mamulengo/binario.h"
#include "mamulengo/desenho.h"
#include "mamulengo/estado.h"
#include "mamulengo/json.h"
#include "mamulengo/modelo.h"
#include "mamulengo/palco.h"
#include "mamulengo/papeis.h"
#include "mamulengo/pose.h"

using namespace mamulengo;

namespace {

struct Instancia {
  std::shared_ptr<const Modelo> modelo;
  // o que o jogo faz por cima da animacao, so no desenho: tinta por slot (multiplica a cor) e slot
  // escondido (o pintar e o esconder do jogo); vazio = nada
  std::vector<Cor> tinta;
  std::vector<uint8_t> com_tinta, escondido;
  Esqueleto e;
  std::unique_ptr<Estado> estado;  // so no uso com trilhas (mm_reiniciar)
  bool mix_spine_godot = false;    // regra de mistura do spine-godot (mm_estado_regra_mix)
  int anim = -1;
  bool loop = true;
  double tempo = 0;
  // deslocamento do personagem no mundo (mm_posicao), somado a posicao e a rotacao locais do
  // osso raiz depois de aplicar a animacao; `posto` e o que ja esta somado
  double px = 0, py = 0, pr = 0, posto_x = 0, posto_y = 0, posto_r = 0;
  void tirar_posicao() {
    Local& raiz = e.local[0];
    raiz.x -= posto_x;
    raiz.y -= posto_y;
    raiz.rotacao -= posto_r;
    posto_x = posto_y = posto_r = 0;
  }
  void por_posicao() {
    Local& raiz = e.local[0];
    raiz.x += px;
    raiz.y += py;
    raiz.rotacao += pr;
    posto_x = px;
    posto_y = py;
    posto_r = pr;
  }
  // papeis (docs/NUCLEO.md "Papeis"): os estados dos botoes pelo ponteiro (mm_papeis_iniciar) e os
  // eventos do ultimo mm_passo guardados para o jogo (mm_eventos_ligar)
  std::unique_ptr<Interface> ui;
  bool guardar_eventos = false;
  std::vector<double> eventos_guardados;
  // checkpoint (mm_guardar): o esqueleto, o Estado e o relogio de um quadro
  struct Guardado {
    Esqueleto e;
    std::unique_ptr<Estado> estado;
    double tempo = 0, posto_x = 0, posto_y = 0, posto_r = 0;
    explicit Guardado(const Esqueleto& x) : e(x) {}
  };
  // o checkpoint do quadro atual (mm_guardar) e os da grade do editor (mm_guardar_em, por vaga)
  std::unique_ptr<Guardado> guardado;
  std::vector<std::unique_ptr<Guardado>> vagas;
  // o palco (docs/PALCO.md): o jogo, quando o modelo tem um
  std::unique_ptr<Palco> palco;
  explicit Instancia(std::shared_ptr<const Modelo> m) : modelo(m), e(std::move(m)) {}
};

// os modelos sao criados por ler_boneco (nao sao const de verdade): a ponte muda o setup
// deles nas edicoes rapidas do editor
std::vector<std::shared_ptr<const Modelo>> modelos;
Modelo& mutavel(int modelo) { return const_cast<Modelo&>(*modelos[size_t(modelo)]); }
std::vector<Evento> lidos;
std::vector<std::unique_ptr<Instancia>> instancias;
Desenho desenho;
std::vector<int32_t> lotes;
std::vector<float> efeitos;
std::vector<float> grupos;
// leituras da pose (o JavaScript le os numeros direto da memoria)
std::vector<double> saida, saida_ossos, saida_setup, saida_slots;
std::string erro, info;
// os arquivos que as instancias pedem (mm_arquivo), por caminho normalizado
std::unordered_map<std::string, std::string> arquivos;
// as medidas (mm_medir_eventos) colhem os eventos de usuario que o mm_passo le: por evento,
// [evento, tempo da chave, instante em que saiu, animacao]
bool colher = false;
std::vector<double> colhidos;

// numero com todos os algarismos (o to_string corta em 6 casas: a duracao de uma animacao com a
// ultima chave em float32, 0.6000000238, sairia 0.6 e a fila entraria fora do lugar)
std::string numero(double x) {
  char b[32];
  std::snprintf(b, sizeof b, "%.17g", x);
  return b;
}

void texto_json(std::string& s, const std::string& t) {
  s += '"';
  for (char c : t) {
    if (c == '"' || c == '\\') s += '\\';
    if (uint8_t(c) < 0x20) {
      // os de controle (a quebra de linha de um texto) como \u00XX
      char b[8];
      std::snprintf(b, sizeof b, "\\u%04x", unsigned(uint8_t(c)));
      s += b;
      continue;
    }
    s += c;
  }
  s += '"';
}

}  // namespace

extern "C" {

// le um .boneco (texto UTF-8); devolve o id do modelo ou -1 (mm_erro diz o motivo)
EMSCRIPTEN_KEEPALIVE int mm_carregar(const char* texto) {
  auto m = ler_boneco(texto, &erro);
  if (!m) return -1;
  modelos.push_back(std::move(m));
  return int(modelos.size()) - 1;
}

// instancias (docs/NUCLEO.md "Instancias"): quem carrega poe antes o texto de cada arquivo que as
// instancias pedem (o caminho normalizado, como o leitor pede) e carrega com o caminho do pai
EMSCRIPTEN_KEEPALIVE void mm_arquivo(const char* caminho, const char* texto) { arquivos[normalizar_caminho(caminho)] = texto; }
EMSCRIPTEN_KEEPALIVE void mm_limpar_arquivos() { arquivos.clear(); }
EMSCRIPTEN_KEEPALIVE int mm_carregar_de(const char* texto, const char* caminho) {
  const AbrirArquivo abrir = [](const std::string& c, std::string& t) {
    auto it = arquivos.find(c);
    if (it == arquivos.end()) return false;
    t = it->second;
    return true;
  };
  auto m = ler_boneco(texto, caminho, abrir, &erro);
  if (!m) return -1;
  modelos.push_back(std::move(m));
  return int(modelos.size()) - 1;
}

EMSCRIPTEN_KEEPALIVE const char* mm_erro() { return erro.c_str(); }

// .boneco texto <-> binario no navegador (o editor sem servidor, src/navegador): o mesmo codigo
// do nucleo-binario. mm_boneco_texto le os bytes (texto ou binario) e devolve o JSON compacto;
// mm_boneco_binario codifica o texto e devolve o tamanho, com os bytes em mm_bytes. Em erro,
// nulo ou -1 (mm_erro diz o motivo).
std::string convertido;
EMSCRIPTEN_KEEPALIVE const char* mm_boneco_texto(const char* dados, int n) {
  erro.clear();
  const Json j = Json::ler(std::string_view(dados, size_t(n)), &erro);
  if (!erro.empty()) return nullptr;
  convertido = escrever_json(j);
  return convertido.c_str();
}
EMSCRIPTEN_KEEPALIVE int mm_boneco_binario(const char* texto) {
  erro.clear();
  const Json j = Json::ler(texto, &erro);
  if (!erro.empty()) return -1;
  convertido = codificar_binario(j);
  return int(convertido.size());
}
EMSCRIPTEN_KEEPALIVE const char* mm_bytes() { return convertido.data(); }

// solta o modelo (as instancias que ainda o usam continuam valendo); o id nao e reaproveitado
EMSCRIPTEN_KEEPALIVE void mm_liberar_modelo(int modelo) { modelos[size_t(modelo)].reset(); }

// indices por nome (-1 se nao ha)
EMSCRIPTEN_KEEPALIVE int mm_osso(int modelo, const char* nome) { return modelos[size_t(modelo)]->osso(nome); }
EMSCRIPTEN_KEEPALIVE int mm_slot(int modelo, const char* nome) { return modelos[size_t(modelo)]->slot(nome); }
EMSCRIPTEN_KEEPALIVE int mm_animacao(int modelo, const char* nome) { return modelos[size_t(modelo)]->animacao(nome); }

// setup de um osso (os valores do .boneco); vale para as instancias do modelo a partir do
// proximo setup (mm_reiniciar, mm_tocar)
EMSCRIPTEN_KEEPALIVE void mm_osso_setup(int modelo, int osso, double x, double y, double rotacao, double escala_x, double escala_y, double cisalha_x, double cisalha_y, double comprimento) {
  DadosOsso& d = mutavel(modelo).ossos[size_t(osso)];
  d.x = x;
  d.y = y;
  d.rotacao = rotacao;
  d.escala_x = escala_x;
  d.escala_y = escala_y;
  d.cisalha_x = cisalha_x;
  d.cisalha_y = cisalha_y;
  d.comprimento = comprimento;
  // a correcao das ancoras parte do setup (docs/NUCLEO.md "Tela")
  for (auto& in : instancias)
    if (in && in->modelo == modelos[size_t(modelo)]) in->e.tela_mudou();
}

// setup de um slot: cor e parte (nome vazio: sem parte). Devolve 0 sem mudar nada se o nome
// da parte nao existe no modelo (o editor rele o .boneco)
EMSCRIPTEN_KEEPALIVE int mm_slot_setup(int modelo, int slot, float r, float g, float b, float a, const char* parte) {
  Modelo& m = mutavel(modelo);
  int id = -1;
  if (parte && *parte) {
    id = m.id_parte(parte);
    if (id < 0) return 0;
  }
  DadosSlot& d = m.slots[size_t(slot)];
  d.cor = Cor{r, g, b, a};
  d.parte_setup = id;
  return 1;
}

// troca (ou acrescenta) uma animacao do modelo, lida do JSON dela no formato do .boneco.
// As instancias com Estado precisam de mm_reiniciar depois (o Estado prepara as timelines).
EMSCRIPTEN_KEEPALIVE int mm_trocar_animacao(int modelo, const char* nome, const char* json) {
  return ler_animacao(mutavel(modelo), nome, json, &erro) ? 1 : 0;
}

// so uma timeline de osso (o arrasto de uma chave): o instante a partir do qual a pose mudou
// (infinito: nada), ou -1: troque a animacao inteira
EMSCRIPTEN_KEEPALIVE double mm_trocar_timeline_osso(int modelo, const char* anim, const char* osso, const char* tipo, const char* json) {
  return trocar_timeline_osso(mutavel(modelo), anim, osso, tipo, json, &erro);
}

// JSON: { nome, paginas: [{arquivo, largura, altura, pma}], animacoes: [{nome, duracao}] }. As
// paginas sao as do desenho: as do modelo e depois as dos filhos das instancias (caminho relativo
// ao pai)
EMSCRIPTEN_KEEPALIVE const char* mm_info(int modelo) {
  const Modelo& m = *modelos[size_t(modelo)];
  info = "{\"nome\":";
  texto_json(info, m.nome);
  info += ",\"paginas\":[";
  for (size_t i = 0; i < m.paginas_desenho.size(); ++i) {
    const Pagina& p = m.paginas_desenho[i];
    info += i ? ",{\"arquivo\":" : "{\"arquivo\":";
    texto_json(info, p.arquivo);
    info += ",\"largura\":" + std::to_string(p.largura) + ",\"altura\":" + std::to_string(p.altura) + ",\"pma\":" + (p.pma ? "true" : "false");
    if (!p.relevo.empty()) {
      info += ",\"relevo\":";
      texto_json(info, p.relevo);
    }
    info += "}";
  }
  bool fisica = false;
  for (const DadosRestricao& r : m.restricoes) fisica = fisica || r.tipo == TipoRestricao::Fisica;
  // "fisica": a pose depende do caminho ate o instante (o editor simula em passos desde o 0); as
  // particulas tambem
  fisica = fisica || !m.emissores.empty();
  // borrar e rastro tambem lembram os quadros anteriores: num passo so ate o instante, o rastro
  // guardava so o quadro 0 (a peca parada ficava desenhada o tempo todo)
  for (const DadosSlot& d : m.slots) fisica = fisica || d.efeitos.borrar() || d.efeitos.rastro();
  for (const Animacao& an : m.animacoes)
    for (const TimelineEfeito& te : an.efeitos) fisica = fisica || te.tipo == TipoEfeito::Borrar || te.tipo == TipoEfeito::Rastro;
  // e as dos filhos das instancias (com memoria: fisica, particulas, borrar ou rastro)
  for (const auto& f : m.filhos) fisica = fisica || !f->sem_memoria;
  info += std::string("],\"fisica\":") + (fisica ? "true" : "false") + ",\"ossos\":[";
  for (size_t i = 0; i < m.ossos.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.ossos[i].nome);
    info += ",\"pai\":" + std::to_string(m.ossos[i].pai) + "}";
  }
  info += "],\"slots\":[";
  for (size_t i = 0; i < m.slots.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.slots[i].nome);
    info += ",\"osso\":" + std::to_string(m.slots[i].osso) + ",\"blend\":" + std::to_string(int(m.slots[i].blend)) + "}";
  }
  // partes: tipo na ordem de TipoParte (regiao, malha, malha ligada, recorte, caminho, ponto,
  // caixa), quantos vertices, o contorno, se tem pesos e (caminho) se e fechado
  info += "],\"partes\":[";
  for (size_t i = 0; i < m.partes.size(); ++i) {
    const Parte& p = m.partes[i];
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, p.nome);
    info += ",\"tipo\":" + std::to_string(int(p.tipo)) + ",\"slot\":" + std::to_string(p.slot) + ",\"vertices\":" + std::to_string(p.tipo == TipoParte::Regiao || p.tipo == TipoParte::Texto ? 4 : p.num_vertices) +
            ",\"contorno\":" + std::to_string(p.contorno) + ",\"pesada\":" + (p.pesada() ? "true" : "false") + ",\"fechado\":" + (p.fechado ? "true" : "false") + "}";
  }
  info += "],\"animacoes\":[";
  for (size_t i = 0; i < m.animacoes.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.animacoes[i].nome);
    info += ",\"duracao\":" + numero(m.animacoes[i].duracao) + "}";
  }
  // nomes dos eventos (o indice que o mm_medir_eventos devolve)
  info += "],\"eventos\":[";
  for (size_t i = 0; i < m.eventos.size(); ++i) {
    if (i) info += ",";
    texto_json(info, m.eventos[i].nome);
  }
  // os textos (docs/NUCLEO.md "Texto"): a parte e o slot de cada um (o resto em mm_textos)
  info += "],\"textos\":[";
  for (size_t i = 0; i < m.textos.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.textos[i].nome);
    info += ",\"parte\":" + std::to_string(m.textos[i].parte) + ",\"slot\":" + std::to_string(m.partes[size_t(m.textos[i].parte)].slot) + "}";
  }
  // os papeis (docs/NUCLEO.md "Papeis"): tipo, osso e slot pelo indice (-1: nenhum), os estados
  // (normal, em cima, apertado, desligado: indice da animacao, -1 nenhuma), a trilha, o mix e
  // se comeca desligado
  info += "],\"papeis\":[";
  for (size_t i = 0; i < m.papeis.size(); ++i) {
    static const char* const TIPO[] = {"botao", "toque", "texto"};
    const DadosPapel& d = m.papeis[i];
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, d.nome);
    info += std::string(",\"tipo\":\"") + TIPO[int(d.tipo)] + "\",\"osso\":" + std::to_string(d.osso) + ",\"slot\":" + std::to_string(d.slot) + ",\"texto\":" + std::to_string(d.texto) + ",\"estados\":[" +
            std::to_string(d.estados[0]) + "," + std::to_string(d.estados[1]) + "," + std::to_string(d.estados[2]) + "," + std::to_string(d.estados[3]) + "],\"trilha\":" + std::to_string(d.trilha) +
            ",\"mix\":" + numero(d.mix) + ",\"desligado\":" + (d.desligado ? "true" : "false") + "}";
  }
  // a tela (docs/NUCLEO.md "Tela"): a arte base, o encaixe e as ancoras (osso pelo indice)
  info += "]";
  if (m.tela.existe) {
    static const char* const ENC[] = {"caber", "cobrir", "largura", "altura"};
    const DadosTela& t = m.tela;
    info += ",\"tela\":{\"arte\":[" + numero(t.x) + "," + numero(t.y) + "," + numero(t.largura) + "," + numero(t.altura) + "],\"encaixe\":\"" + ENC[int(t.encaixe)] + "\",\"ancoras\":[";
    for (size_t i = 0; i < t.ancoras.size(); ++i) {
      const DadosAncora& a = t.ancoras[i];
      info += (i ? ",{\"osso\":" : "{\"osso\":") + std::to_string(a.osso) + ",\"ancora\":[" + numero(a.x) + "," + numero(a.y) + "],\"estica\":\"" + (a.estica_x ? "x" : "") + (a.estica_y ? "y" : "") + "\"" +
              (a.cobre ? ",\"cobre\":[" + numero(a.cobre_x) + "," + numero(a.cobre_y) + "," + numero(a.cobre_largura) + "," + numero(a.cobre_altura) + "]" : "") + "}";
    }
    info += "]}";
  }
  info += "}";
  return info.c_str();
}

// os textos (docs/NUCLEO.md "Texto"), para quem desenha as letras: { fontes: [{nome, arquivo}],
// idiomas: [...], traducoes: {chave: [um por idioma]}, textos: [{nome, parte, slot, texto, chave,
// familia, tamanho, minimo, cor, alinhar, alinhar_v, estouro, largura, altura, linha, cor_linha,
// sombra: [cor, x, y] ou null}] } (alinhar 0 a 2; estouro: 0 encolher, 1 quebrar, 2 cortar, 3 nada)
EMSCRIPTEN_KEEPALIVE const char* mm_textos(int modelo) {
  const Modelo& m = *modelos[size_t(modelo)];
  auto cor = [](const Cor& c) {
    char b[16];
    std::snprintf(b, sizeof b, "\"%02x%02x%02x%02x\"", int(std::lround(c.r * 255)), int(std::lround(c.g * 255)), int(std::lround(c.b * 255)), int(std::lround(c.a * 255)));
    return std::string(b);
  };
  info = "{\"fontes\":[";
  for (size_t i = 0; i < m.fontes.size(); ++i) {
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, m.fontes[i].nome);
    info += ",\"arquivo\":";
    texto_json(info, m.fontes[i].arquivo);
    info += "}";
  }
  info += "],\"idiomas\":[";
  for (size_t i = 0; i < m.traducoes.idiomas.size(); ++i) {
    if (i) info += ",";
    texto_json(info, m.traducoes.idiomas[i]);
  }
  info += "],\"traducoes\":{";
  for (size_t i = 0; i < m.traducoes.chaves.size(); ++i) {
    if (i) info += ",";
    texto_json(info, m.traducoes.chaves[i]);
    info += ":[";
    for (size_t k = 0; k < m.traducoes.textos[i].size(); ++k) {
      if (k) info += ",";
      texto_json(info, m.traducoes.textos[i][k]);
    }
    info += "]";
  }
  info += "},\"textos\":[";
  for (size_t i = 0; i < m.textos.size(); ++i) {
    const DadosTexto& t = m.textos[i];
    info += i ? ",{\"nome\":" : "{\"nome\":";
    texto_json(info, t.nome);
    info += ",\"parte\":" + std::to_string(t.parte) + ",\"slot\":" + std::to_string(m.partes[size_t(t.parte)].slot) + ",\"texto\":";
    texto_json(info, t.texto);
    info += ",\"chave\":";
    texto_json(info, t.chave);
    info += ",\"familia\":";
    texto_json(info, t.familia);
    info += ",\"tamanho\":" + numero(t.tamanho) + ",\"minimo\":" + numero(t.minimo) + ",\"cor\":" + cor(t.cor) + ",\"alinhar\":" + std::to_string(t.alinhar) +
            ",\"alinhar_v\":" + std::to_string(t.alinhar_v) + ",\"estouro\":" + std::to_string(int(t.estouro)) + ",\"largura\":" + numero(t.largura) +
            ",\"altura\":" + numero(t.altura) + ",\"linha\":" + numero(t.linha) + ",\"cor_linha\":" + cor(t.cor_linha) + ",\"sombra\":" +
            (t.sombra ? "[" + cor(t.cor_sombra) + "," + numero(t.sombra_x) + "," + numero(t.sombra_y) + "]" : std::string("null")) + "}";
  }
  info += "]}";
  return info.c_str();
}

// a imagem do texto k (docs/NUCLEO.md "Texto"): o retangulo dela na caixa (esquerda, baixo,
// direita, cima; o meio da caixa na origem, y para cima) e o uv na pagina dos textos (u0, v0 do
// canto de cima e da esquerda, u1, v1). Sem largura (l >= r): a parte deixa de desenhar
EMSCRIPTEN_KEEPALIVE void mm_texto_imagem(int inst, int k, double l, double b, double r, double t, float u0, float v0, float u1, float v1) {
  Esqueleto& e = instancias[size_t(inst)]->e;
  if (!(l < r)) return e.sem_imagem_texto(k);
  const double ret[4] = {l, b, r, t};
  const float uv[4] = {u0, v0, u1, v1};
  e.imagem_texto(k, ret, uv);
}
// quanto o texto k ocupa depois do estouro (largura e altura usadas, nas unidades da caixa): a
// regiao com nove-fatias que acompanha o slot dele cresce junto (docs/NUCLEO.md "Nove-fatias")
EMSCRIPTEN_KEEPALIVE void mm_texto_medida(int inst, int k, double largura, double altura) { instancias[size_t(inst)]->e.medida_texto(k, largura, altura); }
// as regioes com nove-fatias, por instancia: [parte, nx, ny, largura, altura, ex, ey] cada uma, em
// mm_saida (o tamanho em que a grade foi feita e o esticar da janela); devolve quantos numeros
EMSCRIPTEN_KEEPALIVE int mm_fatias(int inst) {
  const Instancia& i = *instancias[size_t(inst)];
  saida.clear();
  const auto& fs = i.e.fatiadas();
  for (size_t k = 0; k < fs.size(); ++k)
    saida.insert(saida.end(), {double(i.modelo->fatias[k].parte), double(fs[k].nx), double(fs[k].ny), fs[k].largura, fs[k].altura, fs[k].ex, fs[k].ey});
  return int(saida.size());
}
// o tamanho da pagina dos textos em pixels (a margem dos efeitos e medida nela)
EMSCRIPTEN_KEEPALIVE void mm_pagina_textos(int inst, int largura, int altura) { instancias[size_t(inst)]->e.pagina_textos(largura, altura); }

// a janela em pixels de quem mostra o boneco inteiro (docs/NUCLEO.md "Tela"): a vista sai na hora
// e os ossos ancorados se corrigem no proximo calculo do mundo; 0 x 0 volta a arte base. Os
// checkpoints guardados ficam com a janela velha: sao esquecidos
EMSCRIPTEN_KEEPALIVE void mm_janela(int inst, double largura, double altura) {
  Instancia& i = *instancias[size_t(inst)];
  if (largura == i.e.janela_largura() && altura == i.e.janela_altura()) return;
  i.e.janela(largura, altura);
  i.guardado.reset();
  i.vagas.clear();
}
// a vista em mm_saida: escala (pixels por unidade), x, y (canto de baixo e da esquerda), largura e
// altura no mundo
EMSCRIPTEN_KEEPALIVE const double* mm_vista(int inst) {
  const Esqueleto::Vista& v = instancias[size_t(inst)]->e.vista();
  saida.assign({v.escala, v.x, v.y, v.largura, v.altura});
  return saida.data();
}

// nova instancia do modelo (reaproveita o lugar de uma liberada)
EMSCRIPTEN_KEEPALIVE int mm_instancia(int modelo) {
  for (size_t k = 0; k < instancias.size(); ++k)
    if (!instancias[k]) {
      instancias[k] = std::make_unique<Instancia>(modelos[size_t(modelo)]);
      return int(k);
    }
  instancias.push_back(std::make_unique<Instancia>(modelos[size_t(modelo)]));
  return int(instancias.size()) - 1;
}

EMSCRIPTEN_KEEPALIVE void mm_limpar_instancias() { instancias.clear(); }

// a skin da instancia pelo nome (vale a partir do proximo setup: mm_reiniciar, mm_tocar);
// devolve o indice ou -1 se nao existe
EMSCRIPTEN_KEEPALIVE int mm_skin(int inst, const char* nome) {
  Instancia& in = *instancias[size_t(inst)];
  const auto& sk = in.modelo->skins;
  for (size_t i = 0; i < sk.size(); ++i)
    if (sk[i].nome == nome) {
      in.e.skin(int(i));
      return int(i);
    }
  return -1;
}

// ---- papeis (docs/NUCLEO.md "Papeis"): o teste de toque e os estados dos botoes. As coordenadas
// sao do mundo do boneco (y para cima); quem mostra converte da janela pela vista

// os estados dos botoes ligados nesta instancia (depois de mm_reiniciar): cada botao no estado
// inicial (normal ou desligado), sem mix
EMSCRIPTEN_KEEPALIVE void mm_papeis_iniciar(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  i.ui = std::make_unique<Interface>(i.modelo);
  i.ui->iniciar(*i.estado);
}
// o ponteiro: tipo 0 andou, 1 apertou, 2 soltou (mouse), 3 soltou (dedo), 4 saiu; devolve o papel
// sob o ponteiro (-1 nenhum)
EMSCRIPTEN_KEEPALIVE int mm_papeis_ponteiro(int inst, int tipo, double x, double y) {
  Instancia& i = *instancias[size_t(inst)];
  if (!i.ui) return -1;
  switch (tipo) {
    case 0: i.ui->mover(i.e, *i.estado, x, y); break;
    case 1: i.ui->apertar(i.e, *i.estado, x, y); break;
    case 2: i.ui->soltar(i.e, *i.estado, x, y, false); break;
    case 3: i.ui->soltar(i.e, *i.estado, x, y, true); break;
    default: i.ui->sair(*i.estado);
  }
  return i.ui->sobre();
}
// os papeis tocados desde a ultima leitura (em mm_saida, um indice cada); devolve quantos
EMSCRIPTEN_KEEPALIVE int mm_papeis_toques(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  saida.clear();
  if (i.ui) {
    for (int k : i.ui->toques) saida.push_back(double(k));
    i.ui->toques.clear();
  }
  return int(saida.size());
}
EMSCRIPTEN_KEEPALIVE void mm_papel_desligar(int inst, int k, int desligado) {
  Instancia& i = *instancias[size_t(inst)];
  if (i.ui) i.ui->desligar(*i.estado, k, desligado != 0);
}
// o estado mostrado do papel k (0 normal, 1 em cima, 2 apertado, 3 desligado; -1 sem iniciar)
EMSCRIPTEN_KEEPALIVE int mm_papel_estado(int inst, int k) {
  const Instancia& i = *instancias[size_t(inst)];
  return i.ui ? i.ui->estado(k) : -1;
}
EMSCRIPTEN_KEEPALIVE int mm_papel_desligado(int inst, int k) {
  const Instancia& i = *instancias[size_t(inst)];
  return i.ui ? int(i.ui->desligado(k)) : int(i.modelo->papeis[size_t(k)].desligado);
}
// forca o estado mostrado do papel k (o editor mostra cada estado; o jogo, um atalho de teclado)
EMSCRIPTEN_KEEPALIVE void mm_papel_mostrar(int inst, int k, int estado) {
  Instancia& i = *instancias[size_t(inst)];
  if (i.ui) i.ui->mostrar(*i.estado, k, estado);
}
// o papel no ponto do mundo (o de cima; -1 nenhum), sem mudar estado
EMSCRIPTEN_KEEPALIVE int mm_papel_no_ponto(int inst, double x, double y) { return papel_no_ponto(instancias[size_t(inst)]->e, x, y); }
// a area do papel k: os triangulos em mm_saida (6 numeros cada, no mundo); devolve quantos numeros
EMSCRIPTEN_KEEPALIVE int mm_papel_area(int inst, int k) {
  area_papel(instancias[size_t(inst)]->e, k, saida);
  return int(saida.size());
}
// guarda os eventos de cada mm_passo para o jogo ler (mm_eventos)
EMSCRIPTEN_KEEPALIVE void mm_eventos_ligar(int inst, int ligar) {
  Instancia& i = *instancias[size_t(inst)];
  i.guardar_eventos = ligar != 0;
  i.eventos_guardados.clear();
}
// os eventos guardados desde a ultima leitura, em mm_saida: [tipo, trilha, animacao, evento]
// cada (tipo 0 inicio, 1 interrompida, 2 fim, 3 completa, 4 usuario; evento: indice em `eventos`
// do mm_info, -1 se nao e de usuario); devolve quantos numeros
EMSCRIPTEN_KEEPALIVE int mm_eventos(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  saida.swap(i.eventos_guardados);
  i.eventos_guardados.clear();
  return int(saida.size());
}

// solta uma instancia so (as medidas abrem e fecham a delas sem mexer nas do editor)
EMSCRIPTEN_KEEPALIVE void mm_liberar_instancia(int inst) {
  if (inst >= 0 && size_t(inst) < instancias.size()) instancias[size_t(inst)].reset();
}

// comeca a animacao do zero (-1: pose de setup), como um personagem novo: setup, fisica
// reiniciada e o primeiro quadro no instante 0
EMSCRIPTEN_KEEPALIVE void mm_tocar(int inst, int anim, int loop) {
  Instancia& i = *instancias[size_t(inst)];
  i.anim = anim;
  i.loop = loop != 0;
  i.tempo = 0;
  i.e.setup();
  i.e.atualizar_mundo();
  if (anim >= 0) i.e.aplicar(anim, 0, i.loop);
  i.e.atualizar_mundo();
}

EMSCRIPTEN_KEEPALIVE void mm_avancar(int inst, double dt) {
  Instancia& i = *instancias[size_t(inst)];
  i.tempo += dt;
  if (i.anim >= 0) i.e.aplicar(i.anim, i.tempo, i.loop);
  i.e.avancar(dt);
  i.e.atualizar_mundo();
}

// ---- com trilhas (o editor): a mesma conta do PoseSim (src/core/sim.ts) sobre o Estado

// personagem novo: setup, fisica reiniciada (o mundo do setup) e nenhuma trilha
EMSCRIPTEN_KEEPALIVE void mm_reiniciar(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  i.anim = -1;
  i.tempo = 0;
  i.e.setup();
  i.posto_x = i.posto_y = i.posto_r = 0;
  i.por_posicao();
  i.e.atualizar_mundo();
  i.estado = std::make_unique<Estado>(i.modelo);
  i.estado->mix_spine_godot = i.mix_spine_godot;
  i.ui.reset();  // os botoes voltam a mm_papeis_iniciar
}

// regra de mistura do spine-godot (docs/NUCLEO.md "Estado"): 1 liga, 0 desliga; vale tambem
// depois de mm_reiniciar
EMSCRIPTEN_KEEPALIVE void mm_estado_regra_mix(int inst, int spine_godot) {
  Instancia& i = *instancias[size_t(inst)];
  i.mix_spine_godot = spine_godot != 0;
  if (i.estado) i.estado->mix_spine_godot = i.mix_spine_godot;
}

// set_animation com o mix dado (o PoseSim sempre diz o mix)
EMSCRIPTEN_KEEPALIVE void mm_estado_tocar(int inst, int trilha, int anim, int loop, double mix) {
  Entrada* e = instancias[size_t(inst)]->estado->tocar(trilha, anim, loop != 0);
  e->mix_duracao = mix;
}

// set_animation tocando ao contrario (do fim para o comeco), como o play_reverso do jogo
EMSCRIPTEN_KEEPALIVE void mm_estado_tocar_reverso(int inst, int trilha, int anim, double mix) {
  Entrada* e = instancias[size_t(inst)]->estado->tocar(trilha, anim, false);
  e->reverso = true;
  e->mix_duracao = mix;
}

// o que a trilha toca: a animacao (-1 nada ou a vazia), e em mm_saida [animacao, loop, mix, tempo]
EMSCRIPTEN_KEEPALIVE int mm_estado_atual(int inst, int trilha) {
  const Instancia& i = *instancias[size_t(inst)];
  saida.clear();
  const Entrada* en = i.estado ? i.estado->entrada(trilha) : nullptr;
  if (!en) return -1;
  saida.insert(saida.end(), {double(en->animacao), en->loop ? 1.0 : 0.0, en->mix_duracao, en->tempo});
  return en->animacao;
}

// o ritmo de uma trilha (docs/NUCLEO.md "Estado", escala_tempo da entrada): 0 pausa, 1 normal. Vale
// para a entrada atual, as que ela ainda mistura (saindo) e a fila; uma animacao tocada depois na
// trilha comeca no ritmo 1. Devolve 0 se a trilha esta vazia
EMSCRIPTEN_KEEPALIVE int mm_estado_ritmo(int inst, int trilha, double escala) {
  Entrada* en = instancias[size_t(inst)]->estado->entrada(trilha);
  if (!en) return 0;
  for (Entrada* e = en; e; e = e->de) e->escala_tempo = escala;
  for (Entrada* e = en->proxima; e; e = e->proxima) e->escala_tempo = escala;
  return 1;
}

// solta a trilha: a animacao vazia com o mix dado (set_empty_animation); o que ela animava volta
// ao que as trilhas de baixo (ou o setup) dizem
EMSCRIPTEN_KEEPALIVE void mm_estado_vazio(int inst, int trilha, double mix) {
  instancias[size_t(inst)]->estado->vazio(trilha, mix);
}

// add_animation com o atraso ja calculado e o mix dado
EMSCRIPTEN_KEEPALIVE void mm_estado_enfileirar(int inst, int trilha, int anim, int loop, double atraso, double mix) {
  Entrada* e = instancias[size_t(inst)]->estado->enfileirar(trilha, anim, loop != 0, atraso);
  e->mix_duracao = mix;
  e->atraso = atraso;
}

// posicao do personagem no mundo: soma (x, y) e a rotacao (graus) ao osso raiz a partir do
// proximo mm_passo, como o jogo move o no. A fisica ve o movimento (a antena e o cabelo reagem).
EMSCRIPTEN_KEEPALIVE void mm_posicao(int inst, double x, double y, double rotacao) {
  Instancia& i = *instancias[size_t(inst)];
  i.px = x;
  i.py = y;
  i.pr = rotacao;
}

// um quadro de dt segundos, na ordem do jogo; os eventos sao descartados
EMSCRIPTEN_KEEPALIVE void mm_passo(int inst, double dt) {
  Instancia& i = *instancias[size_t(inst)];
  i.tempo += dt;
  i.estado->avancar(dt);
  // o raiz sem o deslocamento antes de aplicar (a animacao pode nao mexer nele) e com o novo depois
  i.tirar_posicao();
  i.estado->aplicar(i.e);
  i.por_posicao();
  i.e.avancar(dt);
  i.e.atualizar_mundo();
  i.estado->ler_eventos(lidos);
  if (i.guardar_eventos) {
    // [tipo (0 inicio, 1 interrompida, 2 fim, 3 completa, 4 usuario), trilha, animacao, evento]
    if (i.eventos_guardados.size() > 4096) i.eventos_guardados.clear();
    for (const Evento& ev : lidos) i.eventos_guardados.insert(i.eventos_guardados.end(), {double(int(ev.tipo)), double(ev.trilha), double(ev.animacao), double(ev.evento)});
  }
  if (colher)
    for (const Evento& ev : lidos)
      if (ev.tipo == TipoEvento::Usuario) colhidos.insert(colhidos.end(), {double(ev.evento), ev.tempo, i.tempo, double(ev.animacao)});
  lidos.clear();
}

EMSCRIPTEN_KEEPALIVE double mm_tempo(int inst) { return instancias[size_t(inst)]->tempo; }

// desenho: mm_limpar_desenho, um mm_desenhar por instancia e os ponteiros abaixo
EMSCRIPTEN_KEEPALIVE void mm_limpar_desenho() { desenho.limpar(); }
EMSCRIPTEN_KEEPALIVE void mm_desenhar(int inst) {
  Instancia& in = *instancias[size_t(inst)];
  if (in.com_tinta.empty() && in.escondido.empty()) return desenhar(in.e, desenho);
  Esqueleto& e = in.e;
  std::vector<std::pair<int, Cor>> cores;
  std::vector<std::pair<int, int>> partes;
  for (int s = 0; s < int(e.slots().size()); ++s) {
    if (s < int(in.escondido.size()) && in.escondido[size_t(s)]) {
      partes.emplace_back(s, e.slot(s).parte);
      e.slot(s).parte = -1;
    }
    if (s < int(in.com_tinta.size()) && in.com_tinta[size_t(s)]) {
      Cor& c = e.slot(s).cor;
      cores.emplace_back(s, c);
      const Cor& t = in.tinta[size_t(s)];
      c = Cor{c.r * t.r, c.g * t.g, c.b * t.b, c.a * t.a};
    }
  }
  desenhar(e, desenho);
  for (auto [s, p] : partes) e.slot(s).parte = p;
  for (auto& [s, c] : cores) e.slot(s).cor = c;
}
// o jogo troca a parte de um slot (os algarismos de um placar de imagens): nome vazio tira; uma
// animacao que mexe na parte do slot manda por cima. Devolve 0 se o slot nao tem essa parte
EMSCRIPTEN_KEEPALIVE int mm_slot_parte(int inst, int slot, const char* nome) {
  Esqueleto& e = instancias[size_t(inst)]->e;
  if (slot < 0 || slot >= int(e.slots().size())) return 0;
  int p = -1;
  if (nome && *nome) {
    p = e.parte(slot, nome);
    if (p < 0) return 0;
  }
  e.mudar_parte(slot, p);
  return 1;
}
// o jogo poe um osso na pose local (x, y, rotacao, escalas) como uma chave de animacao poria: fica
// ate uma animacao mexer no osso (a correcao da tela soma por cima). O mundo, no proximo mm_passo
EMSCRIPTEN_KEEPALIVE void mm_osso_local(int inst, int osso, double x, double y, double rotacao, double escala_x, double escala_y) {
  Esqueleto& e = instancias[size_t(inst)]->e;
  if (osso < 0 || osso >= int(e.local.size())) return;
  Local& l = e.local[size_t(osso)];
  l.x = x, l.y = y, l.rotacao = rotacao, l.escala_x = escala_x, l.escala_y = escala_y;
}
// tinta de um slot no desenho (a < 0 tira); esconder um slot no desenho
EMSCRIPTEN_KEEPALIVE void mm_slot_tinta(int inst, int slot, float r, float g, float b, float a) {
  Instancia& in = *instancias[size_t(inst)];
  size_t n = in.modelo->slots.size();
  in.tinta.resize(n), in.com_tinta.resize(n);
  in.com_tinta[size_t(slot)] = a >= 0;
  in.tinta[size_t(slot)] = Cor{r, g, b, a};
}
EMSCRIPTEN_KEEPALIVE void mm_slot_esconder(int inst, int slot, int sim) {
  Instancia& in = *instancias[size_t(inst)];
  in.escondido.resize(in.modelo->slots.size());
  in.escondido[size_t(slot)] = sim != 0;
}
// desenha sem os slots marcados (um byte por slot, nao zero esconde): o olho do editor
EMSCRIPTEN_KEEPALIVE void mm_desenhar_escondendo(int inst, const uint8_t* esconder) {
  Esqueleto& e = instancias[size_t(inst)]->e;
  std::vector<std::pair<int, int>> guardadas;
  for (int s = 0; s < int(e.slots().size()); ++s)
    if (esconder[s]) {
      guardadas.emplace_back(s, e.slot(s).parte);
      e.slot(s).parte = -1;
    }
  desenhar(e, desenho);
  for (auto [s, p] : guardadas) e.slot(s).parte = p;
}
EMSCRIPTEN_KEEPALIVE const float* mm_vertices() { return desenho.vertices.data(); }
EMSCRIPTEN_KEEPALIVE int mm_num_vertices() { return int(desenho.vertices.size() / 8); }
EMSCRIPTEN_KEEPALIVE const uint32_t* mm_indices() { return desenho.indices.data(); }
EMSCRIPTEN_KEEPALIVE int mm_num_indices() { return int(desenho.indices.size()); }
// lotes em 7 inteiros: comando, pagina, blend, inicio, quantos, efeito (-1 sem efeitos), grupo de
// luz (-1 sem luz)
EMSCRIPTEN_KEEPALIVE const int32_t* mm_lotes() {
  lotes.clear();
  for (const Lote& l : desenho.lotes) lotes.insert(lotes.end(), {int32_t(l.comando), l.pagina, int32_t(l.blend), int32_t(l.inicio), int32_t(l.quantos), int32_t(l.efeito), int32_t(l.luz)});
  return lotes.data();
}
// grupos de luz (docs/NUCLEO.md "Luzes") em 68 floats: a ambiente (r, g, b), quantas luzes, e 8
// luzes de 8 (x, y, altura, r, g, b, raio, profundidade)
EMSCRIPTEN_KEEPALIVE const float* mm_grupos_luz() {
  grupos.clear();
  for (const GrupoLuz& g : desenho.grupos_luz) {
    grupos.insert(grupos.end(), g.ambiente, g.ambiente + 3);
    grupos.push_back(float(g.quantas));
    for (int i = 0; i < MAX_LUZES; ++i) grupos.insert(grupos.end(), g.luzes[i], g.luzes[i] + FLOATS_LUZ);
  }
  return grupos.data();
}
EMSCRIPTEN_KEEPALIVE int mm_num_grupos_luz() { return int(desenho.grupos_luz.size()); }
// a camada de cada lote (para a luz), um float por lote, na ordem de mm_lotes
std::vector<float> profundidades;
EMSCRIPTEN_KEEPALIVE const float* mm_lotes_profundidade() {
  profundidades.clear();
  for (const Lote& l : desenho.lotes) profundidades.push_back(l.profundidade);
  return profundidades.data();
}
// efeitos dos lotes em 29 floats: os 23 canais de shader (docs/NUCLEO.md "Efeitos"), a caixa da imagem
// na pagina (u0, v0, u1, v1) e o tamanho da pagina
EMSCRIPTEN_KEEPALIVE const float* mm_efeitos() {
  efeitos.clear();
  for (const EfeitosLote& e : desenho.efeitos) {
    efeitos.insert(efeitos.end(), e.valores.v, e.valores.v + CANAIS_SHADER);
    efeitos.insert(efeitos.end(), e.caixa, e.caixa + 4);
    efeitos.insert(efeitos.end(), e.pagina, e.pagina + 2);
  }
  return efeitos.data();
}
EMSCRIPTEN_KEEPALIVE int mm_num_efeitos() { return int(desenho.efeitos.size()); }
EMSCRIPTEN_KEEPALIVE int mm_num_lotes() { return int(desenho.lotes.size()); }
// as camadas de ajuste (docs/NUCLEO.md "Ajuste"), 5 floats cada: matiz, saturacao, luminosidade,
// contraste, desfoque; o lote com comando 3 aponta aqui pelo campo do efeito
EMSCRIPTEN_KEEPALIVE const float* mm_ajustes() { return desenho.ajustes.empty() ? nullptr : desenho.ajustes[0].v; }
EMSCRIPTEN_KEEPALIVE int mm_num_ajustes() { return int(desenho.ajustes.size()); }

// ---- leitura da pose (o editor sem o spine-core)

// numeros escritos pela ultima leitura que devolve uma contagem (mm_vertices_slot, mm_caixa,
// mm_parte_triangulos, mm_parte_pesos, mm_simular)
EMSCRIPTEN_KEEPALIVE const double* mm_saida() { return saida.data(); }

// por osso, 14 numeros: o mundo [a, b, c, d, x, y] (y para cima), o comprimento no mundo
// (comprimento do osso vezes o tamanho do eixo x do mundo) e a pose local atual
// [x, y, rotacao, escala_x, escala_y, cisalha_x, cisalha_y]
EMSCRIPTEN_KEEPALIVE const double* mm_pose_ossos(int inst) {
  const Instancia& i = *instancias[size_t(inst)];
  const Modelo& m = *i.modelo;
  const auto& w = i.e.mundo();
  saida_ossos.resize(m.ossos.size() * 14);
  double* o = saida_ossos.data();
  for (size_t k = 0; k < m.ossos.size(); ++k, o += 14) {
    const Matriz& x = w[k];
    const Local& l = i.e.local[k];
    o[0] = x.a, o[1] = x.b, o[2] = x.c, o[3] = x.d, o[4] = x.x, o[5] = x.y;
    o[6] = m.ossos[k].comprimento * std::hypot(x.a, x.c);
    o[7] = l.x, o[8] = l.y, o[9] = l.rotacao, o[10] = l.escala_x, o[11] = l.escala_y, o[12] = l.cisalha_x, o[13] = l.cisalha_y;
  }
  return saida_ossos.data();
}

// por osso, 8 numeros do setup (o do modelo agora, com os remendos): x, y, rotacao,
// escala_x, escala_y, cisalha_x, cisalha_y e comprimento
EMSCRIPTEN_KEEPALIVE const double* mm_setup_ossos(int modelo) {
  const Modelo& m = *modelos[size_t(modelo)];
  saida_setup.resize(m.ossos.size() * 8);
  double* o = saida_setup.data();
  for (const DadosOsso& d : m.ossos) {
    o[0] = d.x, o[1] = d.y, o[2] = d.rotacao, o[3] = d.escala_x, o[4] = d.escala_y, o[5] = d.cisalha_x, o[6] = d.cisalha_y, o[7] = d.comprimento;
    o += 8;
  }
  return saida_setup.data();
}

// por slot, 5 numeros: a parte atual (indice em `partes` do mm_info, -1 sem parte) e a cor
// [r, g, b, a]; depois, a ordem de desenho (um indice de slot por posicao, de tras para frente)
EMSCRIPTEN_KEEPALIVE const double* mm_pose_slots(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  const auto& ss = i.e.slots();
  const auto& ordem = i.e.ordem();
  saida_slots.resize(ss.size() * 5 + ordem.size());
  double* o = saida_slots.data();
  for (const EstadoSlot& s : ss) {
    o[0] = s.parte, o[1] = s.cor.r, o[2] = s.cor.g, o[3] = s.cor.b, o[4] = s.cor.a;
    o += 5;
  }
  for (int k : ordem) *o++ = k;
  return saida_slots.data();
}

// vertices em mundo da parte atual do slot (2 numeros por vertice, em mm_saida): regiao (4
// cantos), malha, e tambem caminho, recorte e caixa (o desenho de depuracao). Devolve quantos
// numeros (0: sem parte, ou ponto)
EMSCRIPTEN_KEEPALIVE int mm_vertices_slot(int inst, int slot) {
  const Instancia& i = *instancias[size_t(inst)];
  const EstadoSlot& s = i.e.slots()[size_t(slot)];
  saida.clear();
  if (s.parte < 0) return 0;
  const Parte& p = i.modelo->partes[size_t(s.parte)];
  // a regiao com nove-fatias: so os 4 cantos de fora da grade (a caixa da parte, para o clique);
  // a grade inteira vai pelo desenho e pelo mm_pose
  if (p.fatias >= 0) return int(i.e.cantos_fatias(slot, saida));
  switch (p.tipo) {
    case TipoParte::Regiao:
    case TipoParte::Malha:
    case TipoParte::MalhaLigada:
    case TipoParte::Texto: return int(i.e.vertices(slot, saida));
    case TipoParte::Recorte:
    case TipoParte::Caminho:
    case TipoParte::Caixa:
      saida.resize(size_t(p.num_vertices) * 2);
      i.e.vertices_geometria(slot, p, saida.data());
      return int(saida.size());
    case TipoParte::Ponto: return 0;
  }
  return 0;
}

// caixa do personagem [x0, y0, x1, y1] em mm_saida: regioes e malhas de todos os slots com
// parte (como o getBounds do spine-core, sem olhar o alfa). Devolve 0 se nao ha nada
EMSCRIPTEN_KEEPALIVE int mm_caixa(int inst) {
  const Instancia& i = *instancias[size_t(inst)];
  double x0 = 1e300, y0 = 1e300, x1 = -1e300, y1 = -1e300;
  std::vector<double> v;
  for (int s : i.e.ordem()) {
    const size_t n = i.e.vertices(s, v);
    for (size_t k = 0; k + 1 < n; k += 2) {
      x0 = std::min(x0, v[k]);
      x1 = std::max(x1, v[k]);
      y0 = std::min(y0, v[k + 1]);
      y1 = std::max(y1, v[k + 1]);
    }
  }
  // os mosaicos nao sao partes: entram pelo desenho deles (docs/NUCLEO.md "Mosaico")
  if (!i.modelo->mosaicos.empty()) {
    Desenho d;
    desenhar(i.e, d);
    for (size_t k = 0; k + 1 < d.vertices.size(); k += 8) {
      x0 = std::min(x0, double(d.vertices[k]));
      x1 = std::max(x1, double(d.vertices[k]));
      y0 = std::min(y0, double(d.vertices[k + 1]));
      y1 = std::max(y1, double(d.vertices[k + 1]));
    }
  }
  saida.assign({x0, y0, x1, y1});
  return x0 <= x1 ? 1 : 0;
}

// a caixa do que a instancia `i` desenha agora (o filho, no espaco do pai) em mm_saida: x0, y0,
// x1, y1; 0 se ela nao desenha nada. O palco usa para a caixa de um ator novo (docs/PALCO.md)
EMSCRIPTEN_KEEPALIVE int mm_caixa_instancia(int inst, int i) {
  Instancia& I = *instancias[size_t(inst)];
  auto& lista = I.e.instancias();
  if (i < 0 || size_t(i) >= lista.size() || !lista[size_t(i)].e) return 0;
  Desenho d;
  desenhar(*lista[size_t(i)].e, d);
  double x0 = 1e300, y0 = 1e300, x1 = -1e300, y1 = -1e300;
  for (size_t k = 0; k + 1 < d.vertices.size(); k += 8) {
    x0 = std::min(x0, double(d.vertices[k])), x1 = std::max(x1, double(d.vertices[k]));
    y0 = std::min(y0, double(d.vertices[k + 1])), y1 = std::max(y1, double(d.vertices[k + 1]));
  }
  saida.assign({x0, y0, x1, y1});
  return x0 <= x1 ? 1 : 0;
}

// triangulos de uma parte (regiao: os 2 do retangulo; malha: os do arquivo) em mm_saida
EMSCRIPTEN_KEEPALIVE int mm_parte_triangulos(int modelo, int parte) {
  const Parte& p = modelos[size_t(modelo)]->partes[size_t(parte)];
  saida.clear();
  if (p.tipo == TipoParte::Regiao || p.tipo == TipoParte::Texto) saida = {0, 1, 2, 2, 3, 0};
  else
    for (uint16_t t : p.triangulos) saida.push_back(t);
  return int(saida.size());
}

// pesos de uma malha em mm_saida: por vertice, quantos ossos e os pares (osso, peso). 0 sem pesos
EMSCRIPTEN_KEEPALIVE int mm_parte_pesos(int modelo, int parte) {
  const Parte& p = modelos[size_t(modelo)]->partes[size_t(parte)];
  saida.clear();
  if (!p.pesada()) return 0;
  for (int v = 0; v < p.num_vertices; ++v) {
    const int a = p.pesos_inicio[size_t(v)], b = p.pesos_inicio[size_t(v) + 1];
    saida.push_back(b - a);
    for (int e = a; e < b; ++e) {
      saida.push_back(p.pesos_osso[size_t(e)]);
      saida.push_back(p.pesos_xyp[size_t(e) * 3 + 2]);
    }
  }
  return int(saida.size());
}

// pose direta (a cebola): a animacao no tempo t sobre o setup, sem relogio nem fisica: o
// mundo e calculado uma vez so, com a fisica reiniciada ali mesmo (sem o quadro do setup antes,
// a inercia nao ve a diferenca entre o setup e a pose; como o Physics.pose do spine-core)
EMSCRIPTEN_KEEPALIVE void mm_pose_direta(int inst, int anim, double t, int loop) {
  Instancia& i = *instancias[size_t(inst)];
  i.e.setup();
  if (anim >= 0) i.e.aplicar(anim, t, loop != 0);
  i.e.atualizar_mundo();
}

// ---- checkpoint: guarda o quadro atual da instancia (esqueleto com a fisica, Estado, relogio)
// e volta a ele. O modelo nao pode mudar no meio (quem remenda esquece o checkpoint).

namespace {
void guardar(Instancia& i, std::unique_ptr<Instancia::Guardado>& slot) {
  if (!slot) slot = std::make_unique<Instancia::Guardado>(i.e);
  else slot->e = i.e;
  Instancia::Guardado& g = *slot;
  if (i.estado) {
    if (!g.estado) g.estado = std::make_unique<Estado>(i.modelo);
    g.estado->copiar_de(*i.estado);
  } else g.estado.reset();
  g.tempo = i.tempo;
  g.posto_x = i.posto_x, g.posto_y = i.posto_y, g.posto_r = i.posto_r;
}

int restaurar(Instancia& i, const std::unique_ptr<Instancia::Guardado>& slot) {
  if (!slot) return 0;
  const Instancia::Guardado& g = *slot;
  i.e = g.e;
  if (g.estado) {
    if (!i.estado) i.estado = std::make_unique<Estado>(i.modelo);
    i.estado->copiar_de(*g.estado);
  } else i.estado.reset();
  i.tempo = g.tempo;
  i.posto_x = g.posto_x, i.posto_y = g.posto_y, i.posto_r = g.posto_r;
  return 1;
}
}  // namespace

EMSCRIPTEN_KEEPALIVE void mm_guardar(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  guardar(i, i.guardado);
}

// devolve 0 se nao ha checkpoint
EMSCRIPTEN_KEEPALIVE int mm_restaurar(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  return restaurar(i, i.guardado);
}

// a grade de checkpoints do editor: depois de editar uma animacao, a pose antes do trecho mexido
// nao muda, e a fisica continua da vaga mais perto em vez de refazer desde 0
EMSCRIPTEN_KEEPALIVE void mm_guardar_em(int inst, int vaga) {
  Instancia& i = *instancias[size_t(inst)];
  if (vaga < 0) return;
  if (size_t(vaga) >= i.vagas.size()) i.vagas.resize(size_t(vaga) + 1);
  guardar(i, i.vagas[size_t(vaga)]);
}

EMSCRIPTEN_KEEPALIVE int mm_restaurar_de(int inst, int vaga) {
  Instancia& i = *instancias[size_t(inst)];
  if (vaga < 0 || size_t(vaga) >= i.vagas.size()) return 0;
  return restaurar(i, i.vagas[size_t(vaga)]);
}

// ---- palco (docs/PALCO.md): o jogo dentro do .boneco. mm_palco comeca (ou recomeca) e devolve 0
// se o modelo nao tem palco; mm_palco_passo anda n passos de dt com a entrada (bits: 1 esquerda,
// 2 direita, 4 pulo); mm_palco_estado o estado em JSON (tick, venceu, morreu, pontos, atores)

EMSCRIPTEN_KEEPALIVE int mm_palco(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  if (!i.modelo->palco.existe) return 0;
  i.estado.reset();
  i.palco = std::make_unique<Palco>(*i.modelo);
  i.palco->reiniciar(i.e);
  return 1;
}

EMSCRIPTEN_KEEPALIVE void mm_palco_passo(int inst, int entrada, int n, double dt) {
  Instancia& i = *instancias[size_t(inst)];
  if (!i.palco) return;
  for (int k = 0; k < n; ++k) i.palco->passo(i.e, uint32_t(entrada), dt);
}

EMSCRIPTEN_KEEPALIVE const char* mm_palco_estado(int inst) {
  Instancia& i = *instancias[size_t(inst)];
  info = i.palco ? i.palco->json() : "null";
  return info.c_str();
}

EMSCRIPTEN_KEEPALIVE void mm_esquecer(int inst) { instancias[size_t(inst)]->guardado.reset(); }

// ---- varios instantes de uma vez (as medidas): a pose de uma animacao (-1: setup) em cada
// instante com a conta do poseAt do editor (personagem novo, tocar com mix 0, um quadro em 0 e
// passos de 1/64; sem fisica, um passo so ate o instante). Instantes em ordem crescente. Escreve
// em mm_saida, por instante, o mundo de cada osso [a, b, c, d, x, y] e devolve quantos numeros.
// A instancia fica na pose do ultimo instante e o checkpoint dela e trocado.
EMSCRIPTEN_KEEPALIVE int mm_simular(int inst, int anim, int loop, const double* instantes, int n) {
  Instancia& i = *instancias[size_t(inst)];
  const Modelo& m = *i.modelo;
  bool fisica = false;
  for (const DadosRestricao& r : m.restricoes) fisica = fisica || r.tipo == TipoRestricao::Fisica;
  // "fisica": a pose depende do caminho ate o instante (o editor simula em passos desde o 0); as
  // particulas tambem
  fisica = fisica || !m.emissores.empty();
  const double PASSO = 1.0 / 64;
  std::vector<double> out;
  out.reserve(size_t(n) * m.ossos.size() * 6);
  auto comecar = [&]() {
    mm_reiniciar(inst);
    if (anim >= 0) {
      mm_estado_tocar(inst, 0, anim, loop, 0);
      mm_passo(inst, 0);
    }
  };
  auto escrever = [&]() {
    for (const Matriz& x : i.e.mundo()) out.insert(out.end(), {x.a, x.b, x.c, x.d, x.x, x.y});
  };
  double feito = 0;
  bool guardou = false;
  for (int k = 0; k < n; ++k) {
    const double t = instantes[k];
    if (!fisica || anim < 0) {
      comecar();
      if (anim >= 0 && t > 0) mm_passo(inst, t);
      escrever();
      continue;
    }
    if (guardou && t > feito) mm_restaurar(inst);
    else {
      comecar();
      feito = 0;
    }
    while (feito + PASSO <= t + 1e-9) {
      mm_passo(inst, PASSO);
      feito += PASSO;
    }
    mm_guardar(inst);
    guardou = true;
    if (t - feito > 0) mm_passo(inst, t - feito);
    escrever();
  }
  saida.swap(out);
  return int(saida.size());
}

}  // extern "C"

// ---- as medidas (src/core/instantes.ts): a conta do poseAt do editor (src/core/sim.ts), com e
// sem emenda, em varios instantes, com o checkpoint entre um instante e o seguinte

namespace {

struct Medida {
  int inst = -1, anim = -1;
  bool loop = true;
  // emenda: a animacao seguinte (-1: sem emenda), o mix, o corte (< 0: na fila) e o loop dela
  int prox = -1;
  double mix = 0, corte = -1;
  bool prox_loop = true;
  // com fisica (ou pedindo passos inteiros sempre): passos de 1/64 desde 0; sem, um passo so
  bool passos = false;
  double dur_a = 0;
  // checkpoint: o ultimo passo inteiro e se a emenda ja tinha cortado ali
  double feito = 0;
  bool cortou = false, guardou = false;
  static constexpr double PASSO = 1.0 / 64;

  void comecar() {
    mm_reiniciar(inst);
    if (anim >= 0) mm_estado_tocar(inst, 0, anim, loop ? 1 : 0, 0);
  }
  void avanca(double done, double t, bool cut) {
    while (done + PASSO <= t + 1e-9) {
      mm_passo(inst, PASSO);
      done += PASSO;
    }
    mm_guardar(inst);
    guardou = true;
    feito = done;
    cortou = cut;
    if (t - done > 0) mm_passo(inst, t - done);
  }
  // a instancia fica na pose do instante t (crescente continua do checkpoint; senao refaz)
  void pose(double t) {
    if (anim < 0) {
      mm_reiniciar(inst);
      return;
    }
    if (prox < 0) {
      if (!passos) {
        comecar();
        mm_passo(inst, 0);
        if (t > 0) mm_passo(inst, t);
        return;
      }
      double done = 0;
      if (guardou && t > feito) {
        mm_restaurar(inst);
        done = feito;
      } else {
        comecar();
        mm_passo(inst, 0);
      }
      avanca(done, t, false);
      return;
    }
    double done = 0;
    bool cut = false;
    if (guardou && t > feito) {
      mm_restaurar(inst);
      done = feito;
      cut = cortou;
    } else {
      comecar();
      if (corte < 0) mm_estado_enfileirar(inst, 0, prox, prox_loop ? 1 : 0, std::max(dur_a - mix, 0.0), mix);
      mm_passo(inst, 0);
      if (corte == 0) {
        mm_estado_tocar(inst, 0, prox, prox_loop ? 1 : 0, mix);
        cut = true;
      }
    }
    if (corte >= 0 && !cut) {
      if (t + 1e-9 < corte) return avanca(done, t, false);
      while (done + PASSO <= corte + 1e-9) {
        mm_passo(inst, PASSO);
        done += PASSO;
      }
      if (corte - done > 0) mm_passo(inst, corte - done);
      mm_estado_tocar(inst, 0, prox, prox_loop ? 1 : 0, mix);
      cut = true;
      // os passos recomecam do instante da troca
      done = corte;
    }
    avanca(done, t, cut);
  }
};

Medida medida(int inst, int anim, int loop, int prox, double mix, double corte, int prox_loop) {
  Medida md;
  md.inst = inst;
  md.anim = anim;
  md.loop = loop != 0;
  md.prox = prox;
  md.mix = std::max(0.0, mix);
  md.corte = corte;
  md.prox_loop = prox_loop != 0;
  const Modelo& m = *instancias[size_t(inst)]->modelo;
  for (const DadosRestricao& r : m.restricoes) md.passos = md.passos || r.tipo == TipoRestricao::Fisica;
  if (anim >= 0) md.dur_a = m.animacoes[size_t(anim)].duracao;
  return md;
}

}  // namespace

extern "C" {

// A pose em varios instantes (as medidas): a animacao `anim` (-1: setup) em loop ou nao, e com
// `prox` >= 0 a emenda com a animacao seguinte (mix; corte >= 0 interrompe nesse instante,
// corte < 0 enfileira quando faltar o mix para `anim` acabar). A mesma conta do poseAt do editor
// (NucleoCena e PoseSim). Escreve em mm_saida, por instante:
// - o mundo de cada osso [a, b, c, d, x, y] e a pose local [x, y, rotacao, escala_x, escala_y,
//   cisalha_x, cisalha_y] (13 numeros por osso);
// - com `pedidos & 1`: por slot a parte (-1 sem) e a cor [r, g, b, a], depois a ordem de desenho;
// - com `pedidos & 2`: por slot, quantos numeros e os vertices em mundo da parte (regiao e
//   malha; 0 nas outras).
// Devolve quantos numeros. A instancia fica na pose do ultimo instante.
EMSCRIPTEN_KEEPALIVE int mm_medir(int inst, int anim, int loop, int prox, double mix, double corte, int prox_loop, const double* instantes, int n, int pedidos) {
  Instancia& i = *instancias[size_t(inst)];
  Medida md = medida(inst, anim, loop, prox, mix, corte, prox_loop);
  std::vector<double> out, v;
  for (int k = 0; k < n; ++k) {
    md.pose(instantes[k]);
    const auto& w = i.e.mundo();
    for (size_t o = 0; o < w.size(); ++o) {
      const Matriz& x = w[o];
      const Local& l = i.e.local[o];
      out.insert(out.end(), {x.a, x.b, x.c, x.d, x.x, x.y, l.x, l.y, l.rotacao, l.escala_x, l.escala_y, l.cisalha_x, l.cisalha_y});
    }
    if (pedidos & 1) {
      for (const EstadoSlot& s : i.e.slots()) out.insert(out.end(), {double(s.parte), s.cor.r, s.cor.g, s.cor.b, s.cor.a});
      for (int s : i.e.ordem()) out.push_back(s);
    }
    if (pedidos & 2)
      for (int s = 0; s < int(i.e.slots().size()); ++s) {
        const size_t c = i.e.vertices(s, v);
        out.push_back(double(c));
        out.insert(out.end(), v.begin(), v.begin() + long(c));
      }
  }
  saida.swap(out);
  return int(saida.size());
}

// Os eventos de usuario da mesma conta ate o instante `ate`, sempre em passos de 1/64 desde 0
// (sem o checkpoint): em mm_saida, por evento, [evento (indice em `eventos` do mm_info), tempo
// da chave, instante em que saiu, animacao]. Devolve quantos numeros.
EMSCRIPTEN_KEEPALIVE int mm_medir_eventos(int inst, int anim, int loop, int prox, double mix, double corte, int prox_loop, double ate) {
  Medida md = medida(inst, anim, loop, prox, mix, corte, prox_loop);
  md.passos = true;
  colhidos.clear();
  colher = true;
  md.pose(ate);
  colher = false;
  saida.swap(colhidos);
  colhidos.clear();
  return int(saida.size());
}

// A pose atual com a pose local de alguns ossos trocada (pose.follow procura o giro de uma
// cadeia): o mundo recalculado numa copia do esqueleto, sem andar o relogio e sem a inercia da
// fisica (a fisica mostra o que ja tinha, como o Physics.pose do spine-core). `dados`: por osso,
// [osso, x, y, rotacao, escala_x, escala_y, cisalha_x, cisalha_y]. Escreve em mm_saida o mundo
// de cada osso [a, b, c, d, x, y]; a instancia nao muda.
EMSCRIPTEN_KEEPALIVE int mm_reposar(int inst, const double* dados, int n) {
  const Instancia& i = *instancias[size_t(inst)];
  Esqueleto e = i.e;
  for (EstadoRestricao& r : e.restricoes()) r.inercia = 0;
  for (int k = 0; k < n; ++k, dados += 8) {
    Local& l = e.local[size_t(dados[0])];
    l.x = dados[1], l.y = dados[2], l.rotacao = dados[3], l.escala_x = dados[4], l.escala_y = dados[5], l.cisalha_x = dados[6], l.cisalha_y = dados[7];
  }
  e.atualizar_mundo();
  saida.clear();
  for (const Matriz& x : e.mundo()) saida.insert(saida.end(), {x.a, x.b, x.c, x.d, x.x, x.y});
  return int(saida.size());
}

// pose direta (como a cebola, mm_pose_direta) e a caixa dela (como o mm_caixa): o
// skeleton.bounds. anim -1: o setup
EMSCRIPTEN_KEEPALIVE int mm_caixa_direta(int inst, int anim, double t, int loop) {
  if (anim < 0) mm_reiniciar(inst);
  else mm_pose_direta(inst, anim, t, loop);
  return mm_caixa(inst);
}

}  // extern "C"
