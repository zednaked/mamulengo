// O nucleo do Mamulengo dentro do Godot: BonecoData (o personagem lido de um .boneco, com as
// paginas) e BonecoSprite (Node2D que toca e desenha). O mesmo codigo compila como modulo do
// motor (template web, custom_modules) e como GDExtension (godot-cpp: editor e CI com o
// Godot oficial). As diferencas entre os dois ficam neste cabecalho.
//
// Os metodos e sinais tem os nomes dos do no C++ antigo (MamulengoNativeSprite), para o
// SpineRuntime dos jogos tratar os dois do mesmo jeito.
#pragma once

#ifdef GDEXTENSION
#include <godot_cpp/classes/node2d.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/classes/resource.hpp>
#include <godot_cpp/classes/font.hpp>
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/classes/text_line.hpp>
#include <godot_cpp/classes/texture2d.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/templates/vector.hpp>
using namespace godot;
#define BONECO_RS RenderingServer
#else
#include "core/io/resource.h"
#include "core/object/ref_counted.h"
#include "scene/2d/node_2d.h"
#include "core/input/input_event.h"
#include "scene/resources/font.h"
#include "scene/resources/text_line.h"
#include "scene/resources/texture.h"
#include "servers/rendering/rendering_server.h"
#define BONECO_RS RSE
#endif

#include <memory>
#include <unordered_map>
#include <vector>

#include "mamulengo/desenho.h"
#include "mamulengo/estado.h"
#include "mamulengo/modelo.h"
#include "mamulengo/palco.h"
#include "mamulengo/papeis.h"
#include "mamulengo/pose.h"

void boneco_liberar_materiais();

class BonecoData : public Resource {
  GDCLASS(BonecoData, Resource);

 public:
  std::shared_ptr<const mamulengo::Modelo> modelo;
  Vector<Ref<Texture2D>> paginas;
  Vector<Ref<Texture2D>> relevos;  // por pagina, o relevo (nulo: sem relevo)
  Vector<RID> paginas_rid;  // o RID de cada pagina (o desenho nao copia a Ref a cada item)
  // os textos (docs/NUCLEO.md "Texto"): por fonte do .boneco, uma FontVariation com as outras de
  // reserva (as letras que faltam numa caem na seguinte); vazio: a fonte padrao do tema
  Vector<Ref<Font>> fontes;
  Rect2 caixa;  // esqueleto x, y, largura, altura (unidades do arquivo, y para cima)
  String caminho, erro;

  ~BonecoData();
  // le o .boneco (texto) e as paginas ao lado dele; com erro, get_error diz o motivo. O mesmo
  // caminho devolve o mesmo BonecoData enquanto ele estiver vivo (copias de um molde de cena
  // nao releem o arquivo)
  static Ref<BonecoData> carregar(const String &p_caminho);
  PackedStringArray get_animation_names() const;
  float get_animation_duration(const String &p_nome) const;
  // caixa do cabecalho do esqueleto, y para cima (como o MamulengoNativeData)
  Rect2 get_skeleton_rect() const { return caixa; }
  String get_error() const { return erro; }
  String get_boneco_path() const { return caminho; }

 protected:
  static void _bind_methods();
};

// a entrada de uma trilha, como o set_animation, o add_animation, o get_current e os sinais
// entregam. Enquanto a entrada vale (ate o fim dela), os set_* mudam a entrada do Estado: de tras
// para frente, mix, atraso, relogio, escala de tempo e alfa (os nomes do no C++ antigo). Depois
// do fim os set_* nao fazem nada e is_valid devolve false.
class BonecoEntrada : public RefCounted {
  GDCLASS(BonecoEntrada, RefCounted);

 public:
  String animacao;
  int trilha = 0;
  bool loop = false;
  mamulengo::Entrada *en = nullptr;  // nulo depois do fim
  mamulengo::Estado *estado = nullptr;

  String get_animation_name() const { return animacao; }
  int get_track_index() const { return trilha; }
  bool get_loop() const { return loop; }
  bool is_valid() const { return en != nullptr; }
  void set_reverse(bool p) { if (en) en->reverso = p; }
  bool get_reverse() const { return en && en->reverso; }
  void set_mix_duration(float p) { if (en) en->mix_duracao = p; }
  float get_mix_duration() const { return en ? float(en->mix_duracao) : 0.0f; }
  // o mix e o atraso refeito como no add_animation (atraso <= 0: do fim da anterior menos o mix)
  void set_mix_duration_and_delay(float p_mix, float p_atraso) { if (en && estado) estado->mudar_mix(en, p_mix, p_atraso); }
  void set_delay(float p) { if (en) en->atraso = p; }
  float get_delay() const { return en ? float(en->atraso) : 0.0f; }
  void set_track_time(float p) { if (en) en->tempo = p; }
  float get_track_time() const { return en ? float(en->tempo) : 0.0f; }
  float get_animation_time() const { return en ? float(en->tempo_aplicado(en->tempo_animacao())) : 0.0f; }
  void set_time_scale(float p) { if (en) en->escala_tempo = p; }
  float get_time_scale() const { return en ? float(en->escala_tempo) : 1.0f; }
  void set_alpha(float p) { if (en) en->alfa = p; }
  float get_alpha() const { return en ? float(en->alfa) : 0.0f; }
  bool is_complete() const { return en && en->tempo >= en->fim - en->inicio; }

 protected:
  static void _bind_methods();
};

class BonecoSprite : public Node2D {
  GDCLASS(BonecoSprite, Node2D);

 public:
  BonecoSprite();
  ~BonecoSprite();

  void set_data(const Ref<BonecoData> &p_data);
  Ref<BonecoData> get_data() const { return data; }
  // o .boneco do no (guardado na cena): carrega o data pelo caminho
  void set_boneco(const String &p_caminho);
  String get_boneco() const { return boneco; }
  // so no editor: a animacao mostrada em laco (no jogo o no nasce na pose de setup)
  void set_preview(const String &p_animacao);
  String get_preview() const { return preview; }
  // escondido (fora de is_visible_in_tree), como o spine-godot: so o relogio das trilhas anda
  // (com os avisos de inicio, troca e fim), sem aplicar, sem fisica e sem desenho. true: pousa
  // e desenha mesmo escondido
  void set_pose_when_hidden(bool p) { pose_when_hidden = p; }
  bool get_pose_when_hidden() const { return pose_when_hidden; }
  // relogios em float32 (trilhas, esqueleto e passos da fisica), como o spine-godot: a fisica
  // da o passo no mesmo quadro que ele. false: em double, como o oraculo
  void set_float_clock(bool p);
  bool get_float_clock() const { return float_clock; }
  // regra de mistura do binario do spine-godot dos jogos (docs/NUCLEO.md, "Regra de mistura do
  // spine-godot"): a propriedade que a animacao que sai anima fica com o valor dela ate a primeira
  // chave da que entra. false (padrao): o spine 4.3 atual. Vale a partir da proxima troca
  void set_spine_godot_mix(bool p);
  bool get_spine_godot_mix() const { return spine_godot_mix; }
  void set_time_scale(float p) { time_scale = p; }
  float get_time_scale() const { return time_scale; }
  void set_playing(bool p);
  bool get_playing() const { return playing; }
  // manual: o no nao anda sozinho; quem usa chama update_skeleton
  void set_manual(bool p) { manual = p; }
  bool get_manual() const { return manual; }
  // medir: guarda o tempo de pose e de desenho (get_last_update_usec, get_last_draw_usec)
  void set_medir(bool p) { medir = p; }
  bool get_medir() const { return medir; }

  // toca agora (corta a atual) ou enfileira depois da ultima da fila; devolvem a entrada
  Ref<BonecoEntrada> set_animation(const String &p_nome, bool p_loop, int p_trilha);
  Ref<BonecoEntrada> add_animation(const String &p_nome, float p_atraso, bool p_loop, int p_trilha);
  // a animacao vazia: as timelines saem em `mix` segundos de volta ao setup
  Ref<BonecoEntrada> set_empty_animation(int p_trilha, float p_mix);
  void clear_tracks();
  void clear_track(int p_trilha);
  Ref<BonecoEntrada> get_current(int p_trilha) const;
  // mix (segundos de emenda entre animacoes): o padrao e os pares de-para valem sobre o `mix`
  // do .boneco e continuam valendo depois de um set_data
  void set_default_mix(float p_tempo);
  float get_default_mix() const;
  void set_mix(const String &p_de, const String &p_para, float p_tempo);
  PackedStringArray get_animation_names() const;
  void set_to_setup_pose();
  // anda `p_dt` segundos e redesenha (o processo do no chama com o delta do quadro)
  void update_skeleton(float p_dt);

  bool has_bone(const String &p_osso) const;
  bool has_slot(const String &p_slot) const;
  // [x, y, a, b, c, d] no espaco do no (y para baixo)
  PackedFloat64Array get_bone_world(const String &p_osso) const;
  // todos os ossos: nome -> [x, y, a, b, c, d] como o spine-godot da (world_x, world_y e a
  // matriz do esqueleto com y para baixo); para comparar com o jogo de antes
  Dictionary get_bones_world() const;
  // [x, y, rotacao, escala_x, escala_y, cisalha_x, cisalha_y] da pose local
  PackedFloat64Array get_bone_local(const String &p_osso) const;
  Color get_slot_color(const String &p_slot) const;
  void set_slot_color(const String &p_slot, const Color &p_cor);
  // "" esconde; senao a parte da skin com esse nome
  void set_slot_attachment(const String &p_slot, const String &p_parte);
  String get_slot_setup_attachment(const String &p_slot) const;
  // caixa do que esta desenhado agora, no espaco do no
  Rect2 get_skeleton_bounds() const;
  // o palco (docs/PALCO.md): o jogo no lugar das animacoes. stage_start comeca (false se o
  // .boneco nao tem palco); com ele ligado, o update_skeleton anda em passos de 1/60 s com a
  // entrada de set_stage_input (bits: 1 esquerda, 2 direita, 4 pulo); stage_step anda n passos
  // na mao; get_stage_state: tick, won, died, points e os atores (posicao no espaco do no, y para
  // baixo)
  // tela (docs/NUCLEO.md "Tela"): a janela em pixels; fit_window usa a da viewport a cada quadro e
  // poe o no para a vista cobrir a viewport inteira
  void set_window(const Vector2 &p_tamanho);
  Vector2 get_window() const { return janela; }
  void set_fit_window(bool p);
  bool get_fit_window() const { return fit_window; }
  Rect2 get_view() const;
  float get_view_scale() const;
  // textos (docs/NUCLEO.md "Texto"): as letras pelo TextServer do Godot (o shaping do arabe e do
  // devanagari), na caixa que o nucleo poe no osso. language: o idioma da tabela do .boneco
  // ("" = o do TranslationServer; "pt_BR" acha "pt"). set_text: texto livre pelo nome da parte
  // (ou do slot), no lugar da chave; set_text_params: os "{nome}" da chave ou do texto;
  // clear_text volta ao do arquivo. get_text_overflows: os textos que estouram a caixa no idioma
  void set_language(const String &p_idioma);
  String get_language() const { return idioma; }
  PackedStringArray get_languages() const;
  void set_text(const String &p_nome, const String &p_valor);
  void set_text_params(const String &p_nome, const Dictionary &p_params);
  void clear_text(const String &p_nome);
  String get_text_shown(const String &p_nome) const;
  Array get_text_overflows() const;
  // nove-fatias (docs/NUCLEO.md "Nove-fatias"): a regiao fatiada mostrada no slot (pelo nome do slot):
  // {size: o tamanho L x A da grade (o do texto acompanhado inclusive), stretch: o esticar da janela,
  // grid: os pontos por eixo, corners: os 4 cantos de fora no espaco do no (y para baixo)}; vazio
  // se o slot nao mostra regiao fatiada
  Dictionary get_slice_info(const String &p_slot) const;
  // papeis (docs/NUCLEO.md "Papeis"): o codigo acha cada elemento pelo nome. O no le o mouse e o
  // dedo (roles_input, padrao ligado) e emite role_touched(nome) quando apertam e soltam num botao
  // ligado ou numa area de toque; os estados dos botoes (normal, em_cima, apertado, desligado) tocam
  // a animacao de cada um. Posicoes no espaco do no (y para baixo)
  void set_roles_input(bool p);
  bool get_roles_input() const { return roles_input; }
  Array get_roles() const;
  // ponteiro a mao (o jogo com entrada propria, os testes): 0 anda, 1 aperta, 2 solta (mouse),
  // 3 solta (dedo), 4 sai; devolve o papel sob o ponteiro ("" nenhum)
  String role_pointer(int p_tipo, const Vector2 &p_pos);
  String get_role_at(const Vector2 &p_pos) const;
  void set_role_disabled(const String &p_nome, bool p_desligado);
  bool is_role_disabled(const String &p_nome) const;
  String get_role_state(const String &p_nome) const;
  void show_role_state(const String &p_nome, const String &p_estado);
  // a area: triangulos (3 pontos cada) no espaco do no
  PackedVector2Array get_role_area(const String &p_nome) const;
  // o mouse e o dedo (roles_input)
#ifdef GDEXTENSION
  void _input(const Ref<InputEvent> &p_evento) override;
#else
  void input(const Ref<InputEvent> &p_evento) override;
#endif
  bool stage_start();
  void stage_stop();
  void set_stage_input(int p_bits) { palco_teclas = p_bits; }
  int get_stage_input() const { return palco_teclas; }
  void stage_step(int p_bits, int p_n);
  Dictionary get_stage_state() const;
  int64_t get_last_update_usec() const { return last_update_usec; }
  int64_t get_last_draw_usec() const { return last_draw_usec; }

 protected:
  static void _bind_methods();
  void _notification(int p_what);

 private:
  Ref<BonecoData> data;
  std::unique_ptr<mamulengo::Esqueleto> esq;
  std::unique_ptr<mamulengo::Palco> palco;
  int palco_teclas = 0;
  double palco_sobra = 0;
  mamulengo::Desenho desenho;
  float time_scale = 1;
  bool playing = true;
  bool manual = false;
  bool medir = false;
  bool pose_when_hidden = false;
  bool float_clock = false;
  bool spine_godot_mix = false;
  bool fit_window = false;
  bool roles_input = true;
  std::unique_ptr<mamulengo::Interface> ui;
  int _papel(const String &p_nome) const;
  void _entrada_papeis(const Ref<InputEvent> &p_evento);
  Vector2 janela;
  void _encaixar_janela();
  bool avisando = false;  // dentro do _avisar (um sinal que toca outra animacao nao reentra)
  String boneco, preview;

  // as entradas que o GDScript recebeu, por Entrada::id: as vivas e as que acabaram neste
  // quadro (para o sinal de fim ainda achar a mesma)
  std::unordered_map<uint64_t, Ref<BonecoEntrada>> entradas, mortas;
  static void _ao_descartar(void *dono, const mamulengo::Entrada *en);
  Ref<BonecoEntrada> _embrulho(mamulengo::Entrada *en);
  void _esquecer_entradas();
  void _avisar();
  void _emitir(const std::vector<mamulengo::Evento> &lidos);

  // trilhas, fila, mix e eventos (o Estado do nucleo; docs/NUCLEO.md "Estado")
  std::unique_ptr<mamulengo::Estado> estado;
  std::vector<mamulengo::Evento> eventos;
  // o mix que o jogo pediu (-1: o do .boneco) e os pares, reaplicados a cada _montar
  float mix_jogo = -1;
  struct ParMix {
    String de, para;
    float tempo;
  };
  std::vector<ParMix> pares_mix;

  // itens de desenho: um por lote (dois no tela), cada um com uma malha que fica
  Vector<RID> itens, malhas;
  Vector<RID> material_item;
  // material proprio de cada item que ja desenhou um slot com efeitos (os valores sao do slot)
  Vector<RID> material_efeito;
  // o shader posto em cada um: passo x 4 + efeitos + 2 x luz (PASSOS x 4: ajuste; -1: nenhum)
  Vector<int> passo_efeito;
  Vector<bool> copia_item;  // o item copia o backbuffer antes (camada de ajuste)
  Vector<Vector<int>> indices_item;
  Vector<int> vertices_item;
  // por item: os indices do lote como o nucleo deu (sem renumerar) e o primeiro vertice; os
  // mesmos indices crus que no quadro anterior dao a mesma malha sem renumerar nada
  std::vector<std::vector<uint32_t>> cru_ind_item;
  std::vector<uint32_t> vmin_item;
  // por item: os vertices crus (x, y, u, v, cor) do ultimo envio (o que a malha tem agora);
  // so reenvia o que mudou (peca parada nao custa)
  std::vector<std::vector<float>> cru_item;
  // por item: a textura do comando de malha posto (o item fica com ele de um quadro para o
  // outro; so e refeito quando a textura ou a malha mudam). posto: 0 limpo, 1 comando de
  // malha comum, 2 o de ajuste ou o que le a tela (refeitos a cada quadro)
  std::vector<RID> textura_item;
  std::vector<uint8_t> posto_item;
  // os itens deste quadro e os indices renumerados (reusados de um quadro para o outro)
  struct ItemLista {
    int lote;
    RID material;
    int passo;
    bool pma;
    bool ajuste;
    int modo;  // blend que le a tela (o numero do enum Blend; 0: nao)
    bool texto = false;  // lote na pagina dos textos: as letras pelo TextServer, sem malha
  };
  std::vector<ItemLista> lista;
  Vector<int> indices_buf;
  PackedByteArray bytes_v, bytes_a;
  int64_t last_update_usec = 0, last_draw_usec = 0;

  // textos: o que o jogo pos por texto (livre e parametros) e a diagramacao guardada (refeita
  // quando o texto, o idioma ou as fontes mudam)
  String idioma;
  struct LinhaTexto {
    Ref<TextLine> linha;
    float x = 0, base = 0;
  };
  struct EstadoTexto {
    bool livre = false;
    String valor;
    Dictionary params;
    String assinatura;
    std::vector<LinhaTexto> linhas;
    bool estoura = false;
    float usado_w = 0, usado_h = 0;  // o que o texto ocupa (as nove-fatias que o acompanham)
  };
  std::vector<EstadoTexto> textos;
  String _idioma_efetivo() const;
  int _texto(const String &p_nome) const;
  String _mostrado(int k) const;
  void _diagramar(int k);
  void _textos_imagem();
  void _textos_medida();
  void _desenhar_textos(const RID &it, const mamulengo::Lote &lt);
  Ref<BonecoEntrada> _entrada(int trilha, int animacao, bool loop) const;
  void _previa();
  void _montar();
  void _aplicar_mix();
  void _liberar_itens();
  void _desenhar();
  void _passo(double dt);
  double _dt(float p_dt) const;
};
