// Modelo: o personagem lido do .boneco, so dados, imutavel depois de lido. Varias
// instancias (mamulengo/pose.h) podem usar o mesmo modelo ao mesmo tempo.
//
// Unidades do .boneco: pixels, y para cima, graus anti-horarios, segundos.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace mamulengo {

// O oraculo converte graus em radianos com pi = 3.1415927 (descoberto pelos numeros: a matriz
// de um osso a 90 graus sai com b = -2.32e-8 e nao 6e-17). Usamos o mesmo valor para que
// cadeias longas e a fisica deem os mesmos numeros.
constexpr double PI = 3.1415927;
constexpr double GRAU = PI / 180.0;
constexpr double RAD = 180.0 / PI;

// ---- curvas e timelines

enum class Curva : uint8_t { Linear, Degrau, Bezier };

// Timeline generica de 1 a 4 canais. A curva de cada chave vale do tempo dela ate a proxima.
struct Timeline {
  int canais = 1;
  std::vector<double> tempos;
  std::vector<double> valores;  // tempos.size() * canais
  std::vector<uint8_t> curvas;  // Curva, uma por chave
  std::vector<double> bezier;   // 4 por canal por chave: cx1, cy1, cx2, cy2 (absolutos)
  // a bezier e avaliada como o oraculo: 9 pontos internos (parametro 0,1 ... 0,9) e retas
  // entre eles (docs/NUCLEO.md "Descobertas"); 18 numeros (tempo, valor) por canal por chave
  std::vector<double> amostras;

  size_t chaves() const { return tempos.size(); }
  double fim() const { return tempos.empty() ? 0 : tempos.back(); }
  // indice da ultima chave com tempo <= t; -1 antes da primeira
  int chave(double t) const;
  // valor do canal c em t, sabendo que a chave em vigor e k (k >= 0)
  double valor(int k, int c, double t) const;
  // fracao 0..1 entre a chave k e a seguinte, pela curva do canal 0 (o deformar guarda a
  // curva com valores de 0 a 1)
  double fracao(int k, double t) const;
  // calcula as amostras das beziers (depois de ler todas as chaves); `fracao`: o canal 0 vai
  // de 0 a 1 em cada chave (deformar)
  void preparar(bool fracao = false);
};

// o oraculo guarda tempos e valores das chaves em float32
inline double f32(double v) { return double(float(v)); }

// ---- esqueleto

enum class Heranca : uint8_t { Normal, SoTranslacao, SemRotacaoOuReflexo, SemEscala, SemEscalaOuReflexo };

struct DadosOsso {
  std::string nome;
  int pai = -1;
  double comprimento = 0;
  double x = 0, y = 0, rotacao = 0, escala_x = 1, escala_y = 1, cisalha_x = 0, cisalha_y = 0;
  Heranca heranca = Heranca::Normal;
};

enum class Blend : uint8_t { Normal, Aditivo, Multiplica, MultiplicaMotor, Tela };

struct Cor {
  float r = 1, g = 1, b = 1, a = 1;
};

// ---- efeitos (docs/NUCLEO.md "Efeitos"): os valores de todos num vetor so, por efeito um
// trecho de canais na ordem das timelines
enum class TipoEfeito : uint8_t { Linha, Brilho, Dissolver, Tingir };
constexpr int NUM_EFEITOS = 4;
constexpr int EFEITO_INICIO[NUM_EFEITOS] = {0, 5, 11, 17};
constexpr int EFEITO_CANAIS[NUM_EFEITOS] = {5, 6, 6, 5};
constexpr int CANAIS_EFEITOS = 22;
// indices no vetor
enum : int {
  LINHA_R = 0, LINHA_A = 3, LINHA_LARGURA = 4,
  BRILHO_R = 5, BRILHO_A = 8, BRILHO_FORCA = 9, BRILHO_RAIO = 10,
  DISSOLVER_VALOR = 11, DISSOLVER_R = 12, DISSOLVER_A = 15, DISSOLVER_BORDA = 16,
  TINGIR_R = 17, TINGIR_A = 20, TINGIR_FORCA = 21,
};
struct Efeitos {
  float v[CANAIS_EFEITOS] = {1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 8, 0, 1, 0.5f, 0, 1, 0.05f, 1, 1, 1, 1, 0};
  bool linha() const { return v[LINHA_LARGURA] > 0 && v[LINHA_A] > 0; }
  bool brilho() const { return v[BRILHO_FORCA] > 0 && v[BRILHO_A] > 0; }
  bool dissolver() const { return v[DISSOLVER_VALOR] > 0; }
  bool tingir() const { return v[TINGIR_FORCA] > 0 && v[TINGIR_A] > 0; }
  bool algum() const { return linha() || brilho() || dissolver() || tingir(); }
  // quanto a regiao cresce para fora, em pixels da textura
  float margem() const;
  // limita cada canal a faixa dele (cores e valor/borda de 0 a 1; largura, raio, forca >= 0)
  void limitar();
};

struct DadosSlot {
  std::string nome;
  int osso = 0;
  int parte_setup = -1;  // id do nome da parte (Modelo::nomes_partes), -1 sem parte
  Cor cor;
  Blend blend = Blend::Normal;
  Efeitos efeitos;
};

enum class TipoParte : uint8_t { Regiao, Malha, MalhaLigada, Recorte, Caminho, Ponto, Caixa };

struct Parte {
  TipoParte tipo = TipoParte::Regiao;
  std::string nome;
  int slot = -1;

  // regiao: os 4 cantos em coordenadas do osso do slot (ja com corte, escala, rotacao e
  // posicao da parte), na ordem do oraculo: baixo-esquerda, cima-esquerda, cima-direita,
  // baixo-direita
  double cantos[8] = {0};

  // geometria (malha, caminho, recorte, caixa). Sem pesos: `vertices`, 2 por vertice, em
  // coordenadas do osso do slot. Com pesos: para o vertice v, as entradas de
  // pesos_inicio[v] a pesos_inicio[v+1]-1, cada uma com osso e (x, y, peso).
  int num_vertices = 0;
  std::vector<double> vertices;
  std::vector<int> pesos_inicio;
  std::vector<int> pesos_osso;
  std::vector<double> pesos_xyp;
  bool pesada() const { return !pesos_inicio.empty(); }
  // quantos numeros um deformar desta parte tem (2 por vertice, ou 2 por entrada de peso)
  int tamanho_deform() const { return pesada() ? int(pesos_osso.size()) * 2 : num_vertices * 2; }

  // malha ligada: a parte de onde vem a geometria; deform_de: a parte cujas timelines de
  // deformar valem para esta (ela mesma, ou a fonte se a ligada herda as timelines)
  int fonte = -1;
  int deform_de = -1;

  // caminho
  bool fechado = false;
  bool velocidade_constante = true;
  std::vector<double> comprimentos;

  // ponto
  double px = 0, py = 0, prot = 0;
  // desenho (regiao e malha): pagina do atlas, uvs na pagina (0 a 1, 2 por vertice; na regiao
  // os 4 cantos na ordem de `cantos`), triangulos e a cor da parte
  int pagina = -1;
  std::vector<float> uvs;
  std::vector<uint16_t> triangulos;
  // malha: quantos vertices (os primeiros) formam o contorno; so o editor usa
  int contorno = 0;
  Cor cor;
  // recorte: o slot em que o recorte acaba (-1: vale ate o fim do desenho)
  int fim = -1;
};

// skin: para cada slot, os pares (id do nome, indice em Modelo::partes)
struct Skin {
  std::string nome;
  std::vector<std::vector<std::pair<int, int>>> por_slot;
  std::vector<int> ossos;       // ossos so desta skin (fora do v0, guardado)
  std::vector<int> restricoes;  // restricoes so desta skin
};

// ---- restricoes

enum class TipoRestricao : uint8_t { IK, Transformacao, Caminho, Fisica };

struct DadosIK {
  std::vector<int> ossos;
  int alvo = -1;
  double mix = 1, suavidade = 0;
  int dobra = 1;  // +1 ou -1
  bool comprime = false, estica = false, uniforme = false;
};

// transformacao no formato 4.3: cada propriedade da fonte vai para uma ou mais do alvo
enum class PropTransf : uint8_t { Girar, X, Y, EscalaX, EscalaY, CisalhaY };
struct DadosTransfPara {
  PropTransf prop;
  double deslocamento = 0, maximo = 0, escala = 1;
};
struct DadosTransfDe {
  PropTransf prop;
  double deslocamento = 0;
  std::vector<DadosTransfPara> para;
};
struct DadosTransformacao {
  std::vector<int> ossos;
  int fonte = -1;
  bool fonte_local = false, alvo_local = false, somar = false, limitar = false;
  double mix_girar = 1, mix_x = 1, mix_y = 1, mix_escala_x = 1, mix_escala_y = 1, mix_cisalha_y = 1;
  // deslocamentos da restricao (os campos do topo), somados ao valor da fonte; em mundo, x e y
  // sao um ponto no espaco da fonte (docs/NUCLEO.md "Restricoes")
  double desl_girar = 0, desl_x = 0, desl_y = 0, desl_escala_x = 0, desl_escala_y = 0, desl_cisalha_y = 0;
  std::vector<DadosTransfDe> de;
};

enum class ModoPosicao : uint8_t { Fixo, Percentual };
enum class ModoEspacamento : uint8_t { Comprimento, Fixo, Percentual, Proporcional };
enum class ModoGirar : uint8_t { Tangente, Cadeia, CadeiaEscala };

struct DadosCaminho {
  std::vector<int> ossos;
  int slot = -1;
  ModoPosicao modo_posicao = ModoPosicao::Percentual;
  ModoEspacamento modo_espacamento = ModoEspacamento::Comprimento;
  ModoGirar modo_girar = ModoGirar::Tangente;
  double rotacao = 0, posicao = 0, espacamento = 0;
  double mix_girar = 1, mix_x = 1, mix_y = 1;
};

struct DadosFisica {
  int osso = -1;
  double x = 0, y = 0, girar = 0, escala_x = 0, cisalha_x = 0;  // quanto de cada grau de liberdade
  double limite = 5000, passo = 1.0 / 60;
  double inercia = 0.5, forca = 100, amortecimento = 0.85, massa_inv = 1, vento = 0, gravidade = 0, mix = 1;
};

struct DadosRestricao {
  TipoRestricao tipo;
  std::string nome;
  int ordem = 0;
  bool so_skin = false;
  DadosIK ik;
  DadosTransformacao transf;
  DadosCaminho caminho;
  DadosFisica fisica;
};

// ---- animacoes

enum class PropOsso : uint8_t { Girar, Mover, MoverX, MoverY, Escalar, EscalarX, EscalarY, Cisalhar, CisalharX, CisalharY };
struct TimelineOsso {
  int osso;
  PropOsso prop;
  Timeline tl;
};

enum class PropCor : uint8_t { Rgba, Rgb, Alfa };
struct TimelineCor {
  int slot;
  PropCor prop;
  Timeline tl;
};

struct TimelineEfeito {
  int slot;
  TipoEfeito tipo;
  Timeline tl;  // EFEITO_CANAIS[tipo] canais
};

// ---- particulas (docs/NUCLEO.md "Particulas")

struct DadosEmissor {
  std::string nome;
  int slot = -1, osso = -1;
  double x = 0, y = 0;                 // ponto no osso
  int pagina = -1;                     // da imagem (-1: sem imagem, nao desenha)
  float uvs[8] = {0};                  // cantos da imagem: baixo-esquerda, cima-esquerda, cima-direita, baixo-direita
  double meia_largura = 0, meia_altura = 0;  // metade do retangulo com pixels
  double taxa = 10;
  double vida[2] = {1, 1}, velocidade[2] = {100, 100}, escala[2] = {1, 1}, giro[2] = {0, 0};
  double angulo = 90, abertura = 30, gravidade = 0, arrasto = 0;
  std::vector<Cor> cores = {Cor{1, 1, 1, 1}, Cor{1, 1, 1, 0}};  // tons espalhados pela vida
  int blend = -1;                      // Blend do emissor; -1: o do slot
  double onda[2] = {0, 0};             // balanco lateral: amplitude (px) e frequencia (Hz)
  int maximo = 200;
  uint32_t semente = 0;
  // raio (tipo "raio"): linha quebrada refeita a cada `troca` segundos; a taxa e a intensidade
  bool raio = false;
  int ate = -1;                        // osso do fim (-1: comprimento na direcao do angulo)
  double ate_x = 0, ate_y = 0, comprimento = 100, desvio = 0.15, largura = 6, troca = 0.06;
  int segmentos = 10, ramos = 2;
};

struct TimelineTaxa {
  int emissor;
  Timeline tl;  // 1 canal
};

struct TimelineRajada {
  int emissor;
  std::vector<double> tempos;
  std::vector<int> quantidades;
};

struct TimelineParte {
  int slot;
  std::vector<double> tempos;
  std::vector<int> nomes;  // id do nome, -1 esconde
};

struct TimelineDeformar {
  int slot;
  int parte;  // a parte (da skin) a que a timeline pertence
  Timeline tl;  // so tempos e curvas (fracao)
  std::vector<std::vector<double>> chaves;  // por chave, os deslocamentos completos
};

struct TimelineOrdem {
  std::vector<double> tempos;
  std::vector<std::vector<int>> ordens;  // vazia: a ordem do setup
};

// propriedades de restricao animaveis
enum class PropRestricao : uint8_t {
  IkMix,  // canais: mix, suavidade; e os logicos dobra/comprime/estica em `logicos`
  TransfMix,  // 6 canais
  CaminhoPosicao, CaminhoEspacamento, CaminhoMix,  // mix: 3 canais
  FisicaInercia, FisicaForca, FisicaAmortecimento, FisicaMassa, FisicaVento, FisicaGravidade, FisicaMix,
  FisicaReiniciar,
};
struct TimelineRestricao {
  int restricao;  // -1: todas as fisicas (timelines globais)
  PropRestricao prop;
  Timeline tl;
  std::vector<int8_t> dobra;  // IK: por chave
  std::vector<uint8_t> comprime, estica;
};

// ---- eventos

// definicao de um evento (`eventos` do .boneco): os valores que a chave herda se nao trouxer
struct DadosEvento {
  std::string nome;
  int inteiro = 0;
  double decimal = 0;
  std::string texto;
  std::string audio;
  double volume = 1, balanco = 0;
};

// chave da timeline `eventos` de uma animacao, ja com os valores herdados da definicao
struct ChaveEvento {
  double tempo = 0;  // float32, como as outras chaves
  int evento = 0;    // indice em Modelo::eventos
  int inteiro = 0;
  double decimal = 0;
  std::string texto;
  double volume = 1, balanco = 0;
};

struct Animacao {
  std::string nome;
  double duracao = 0;
  std::vector<TimelineOsso> ossos;
  std::vector<TimelineCor> cores;
  std::vector<TimelineEfeito> efeitos;
  std::vector<TimelineTaxa> taxas;
  std::vector<TimelineRajada> rajadas;
  std::vector<TimelineParte> partes;
  std::vector<TimelineDeformar> deformar;
  std::vector<TimelineOrdem> ordem;  // 0 ou 1
  std::vector<TimelineRestricao> restricoes;
  std::vector<ChaveEvento> eventos;  // em ordem de tempo
};

// mix do .boneco: o tempo de emenda de uma animacao para outra (`pares`), ou o padrao
struct ParMix {
  int de = -1, para = -1;
  double tempo = 0;
};

// ---- o modelo

// pagina do atlas (a imagem fica fora do .boneco, ao lado dele)
struct Pagina {
  std::string arquivo;
  int largura = 0, altura = 0;
  bool pma = false;  // cores ja multiplicadas pelo alfa
};

struct Modelo {
  std::string nome;
  std::vector<Pagina> paginas;
  double escala_ref = 100;  // esqueleto.escala_ref: a fisica mede o comprimento dos ossos nela
  std::vector<DadosOsso> ossos;
  std::vector<DadosSlot> slots;
  std::vector<Parte> partes;
  std::vector<Skin> skins;  // a 0 e a "default" (criada vazia se o arquivo nao tem)
  std::vector<DadosRestricao> restricoes;
  std::vector<DadosEmissor> emissores;
  std::vector<std::vector<int>> emissores_do_slot;  // por slot, os emissores que desenham nele
  std::vector<Animacao> animacoes;
  std::vector<std::string> nomes_partes;  // id -> nome
  std::vector<DadosEvento> eventos;
  double mix_padrao = 0;
  std::vector<ParMix> mix_pares;

  int osso(std::string_view nome) const;
  int slot(std::string_view nome) const;
  int animacao(std::string_view nome) const;
  int id_parte(std::string_view nome) const;
  int evento(std::string_view nome) const;
  // mix de `de` para `para` (indices de animacao; -1 e a vazia): o par, ou o padrao
  double mix(int de, int para) const;
  // parte (indice em `partes`) do slot com o nome dado, procurando na skin e na default
  int parte_de(int skin, int slot, int id_nome) const;
};

// Le um .boneco ja carregado em memoria. Em erro devolve nullptr e preenche `erro`.
std::shared_ptr<const Modelo> ler_boneco(std::string_view texto, std::string* erro);

// Le uma animacao (o objeto dela em `animacoes` do .boneco) e troca a de mesmo nome do modelo,
// ou acrescenta no fim. Em erro devolve false, preenche `erro` e nao muda o modelo. Quem usa o
// modelo com um Estado precisa criar outro (o Estado prepara as timelines de cada animacao).
bool ler_animacao(Modelo& m, std::string_view nome, std::string_view texto, std::string* erro);

}  // namespace mamulengo
