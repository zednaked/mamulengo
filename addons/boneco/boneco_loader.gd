@tool
class_name BonecoFormatLoader
extends ResourceFormatLoader
# Lets load("res://x.boneco") return a BonecoData, so a .boneco can be dragged into the
# "data" property of a BonecoSprite in the editor. Godot registers it on its own (a global
# class that extends ResourceFormatLoader); no plugin to enable.


func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray(["boneco"])


func _handles_type(type: StringName) -> bool:
	return type == &"BonecoData" or type == &"Resource"


func _get_resource_type(path: String) -> String:
	return "BonecoData" if path.get_extension().to_lower() == "boneco" else ""


func _load(path: String, _original_path: String, _use_sub_threads: bool, _cache_mode: int) -> Variant:
	var data := BonecoData.carregar(path)
	if data.get_error() != "":
		return ERR_PARSE_ERROR
	return data
