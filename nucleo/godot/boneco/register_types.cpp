#include "register_types.h"

#include "boneco_godot.h"

#ifdef GDEXTENSION
#include <gdextension_interface.h>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>
#endif

void initialize_boneco_module(ModuleInitializationLevel p_level) {
  if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) return;
  GDREGISTER_CLASS(BonecoData);
  GDREGISTER_CLASS(BonecoEntrada);
  GDREGISTER_CLASS(BonecoSprite);
}

void uninitialize_boneco_module(ModuleInitializationLevel p_level) {
  if (p_level == MODULE_INITIALIZATION_LEVEL_SCENE) boneco_liberar_materiais();
}

#ifdef GDEXTENSION
extern "C" {
GDExtensionBool GDE_EXPORT boneco_library_init(GDExtensionInterfaceGetProcAddress p_get_proc_address, const GDExtensionClassLibraryPtr p_library,
                                              GDExtensionInitialization *r_initialization) {
  godot::GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);
  init_obj.register_initializer(initialize_boneco_module);
  init_obj.register_terminator(uninitialize_boneco_module);
  init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
  return init_obj.init();
}
}
#endif
