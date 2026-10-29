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
#include <godot_cpp/classes/texture2d.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/templates/vector.hpp>
using namespace godot;
#define BONECO_RS RenderingServer
#else
#include "core/io/resource.h"
#include "core/object/ref_counted.h"
#include "scene/2d/node_2d.h"
#include "scene/resources/texture.h"
#include "servers/rendering/rendering_server.h"
#define BONECO_RS RSE
#endif

#include <memory>
#include <vector>

#include "mamulengo/desenho.h"
#include "mamulengo/estado.h"
#include "mamulengo/modelo.h"
#include "mamulengo/pose.h"

void boneco_liberar_materiais();

class BonecoData : public Resource {
  GDCLASS(BonecoData, Resource);

 public:
  std::shared_ptr<const mamulengo::Modelo> modelo;
  Vector<Ref<Texture2D>> paginas;
  Rect2 caixa;  // esqueleto x, y, largura, altura (unidades do arquivo, y para cima)
  String caminho, erro;

  // le o .boneco (texto) e as paginas ao lado dele; com erro, get_error diz o motivo
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

// a entrada de uma trilha, como o sinal e o get_current entregam
class BonecoEntrada : public RefCounted {
  GDCLASS(BonecoEntrada, RefCounted);

 public:
  String animacao;
  int trilha = 0;
  bool loop = false;
  String get_animation_name() const { return animacao; }
  int get_track_index() const { return trilha; }
  bool get_loop() const { return loop; }

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

  // trilha 0: toca agora (corta a atual) ou enfileira depois da atual
  void set_animation(const String &p_nome, bool p_loop, int p_trilha);
  void add_animation(const String &p_nome, float p_atraso, bool p_loop, int p_trilha);
  Ref<BonecoEntrada> get_current(int p_trilha) const;
  PackedStringArray get_animation_names() const;
  void set_to_setup_pose();
  // anda `p_dt` segundos e redesenha (o processo do no chama com o delta do quadro)
  void update_skeleton(float p_dt);

  bool has_bone(const String &p_osso) const;
  bool has_slot(const String &p_slot) const;
  // [x, y, a, b, c, d] no espaco do no (y para baixo)
  PackedFloat64Array get_bone_world(const String &p_osso) const;
  // [x, y, rotacao, escala_x, escala_y, cisalha_x, cisalha_y] da pose local
  PackedFloat64Array get_bone_local(const String &p_osso) const;
  Color get_slot_color(const String &p_slot) const;
  void set_slot_color(const String &p_slot, const Color &p_cor);
  // "" esconde; senao a parte da skin com esse nome
  void set_slot_attachment(const String &p_slot, const String &p_parte);
  String get_slot_setup_attachment(const String &p_slot) const;
  // caixa do que esta desenhado agora, no espaco do no
  Rect2 get_skeleton_bounds() const;
  int64_t get_last_update_usec() const { return last_update_usec; }
  int64_t get_last_draw_usec() const { return last_draw_usec; }

 protected:
  static void _bind_methods();
  void _notification(int p_what);

 private:
  Ref<BonecoData> data;
  std::unique_ptr<mamulengo::Esqueleto> esq;
  mamulengo::Desenho desenho;
  float time_scale = 1;
  bool playing = true;
  bool manual = false;
  bool medir = false;

  // trilhas, fila, mix e eventos (o Estado do nucleo; docs/NUCLEO.md "Estado")
  std::unique_ptr<mamulengo::Estado> estado;
  std::vector<mamulengo::Evento> eventos;

  // itens de desenho: um por lote (dois no tela), cada um com uma malha que fica
  Vector<RID> itens, malhas;
  Vector<RID> material_item;
  Vector<Vector<int>> indices_item;
  Vector<int> vertices_item;
  // o que foi enviado por ultimo a cada malha: so reenvia o que mudou (peca parada nao custa)
  Vector<PackedByteArray> enviado_v, enviado_a;
  // por item: os vertices crus (x, y, u, v, cor) do ultimo envio e a caixa deles
  std::vector<std::vector<float>> cru_item;
  std::vector<Rect2> caixa_item;
  PackedByteArray bytes_v, bytes_a;
  int64_t last_update_usec = 0, last_draw_usec = 0;

  Ref<BonecoEntrada> _entrada(int trilha, int animacao, bool loop) const;
  void _montar();
  void _liberar_itens();
  void _desenhar();
  void _passo(double dt);
};
