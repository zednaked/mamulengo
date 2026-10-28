// Registro das classes do .boneco no Godot (modulo e GDExtension).
#pragma once

#ifdef GDEXTENSION
#include <godot_cpp/core/class_db.hpp>
using namespace godot;
#else
#include "core/object/class_db.h"
#include "modules/register_module_types.h"
#endif

void initialize_boneco_module(ModuleInitializationLevel p_level);
void uninitialize_boneco_module(ModuleInitializationLevel p_level);
