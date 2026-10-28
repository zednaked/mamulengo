# Renderiza frames de um asset Spine com o spine-godot de verdade, para comparar
# com o editor. Roda dentro do projeto do jogo, sem tocar em nada dele:
#   godot --path <projeto> -s <este arquivo> -- <spec.json>
# spec: {tres, rect:[x,y,w,h] (mundo Spine, y para cima), size:[W,H], background:[r,g,b],
#        out_dir, jobs:[{animation, times[], prefix, sequence?}]}
# sequence (previa de transicao, como o jogo): {next, mix, at, loop, nextLoop}
#   at null: enfileira (add_animation com delay 0, o queueAnim do jogo); senao interrompe
#   em "at" (set_animation, o playAnim do jogo). mix null: o mix do -data.tres (o que o
#   runtime decidir sozinho); com numero, sobrescreve. Mesma conta do PoseSim
#   (src/core/sim.ts): passos de 1/64 desde 0, cortados no instante da troca.
# Gera <out_dir>/<prefix>_<i>.png por instante e done.json no fim.
extends SceneTree

# 1/64 e exato em float e double (ver src/render/viewer.ts)
const STEP := 1.0 / 64.0

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var spec: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	var size := Vector2i(int(spec.size[0]), int(spec.size[1]))
	var s := float(size.x) / float(spec.rect[2])
	var vp := SubViewport.new()
	vp.size = size
	vp.transparent_bg = false
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(vp)
	var r: Array = spec.rect
	vp.canvas_transform = Transform2D(0.0, Vector2(s, s), 0.0, Vector2(-float(r[0]) * s, (float(r[1]) + float(r[3])) * s))
	# fundo cobre o retangulo do mundo (desenhado sob a mesma canvas_transform)
	var bg := ColorRect.new()
	bg.color = Color(spec.background[0], spec.background[1], spec.background[2])
	bg.position = Vector2(float(r[0]) - 10.0, -(float(r[1]) + float(r[3])) - 10.0)
	bg.size = Vector2(float(r[2]) + 20.0, float(r[3]) + 20.0)
	vp.add_child(bg)
	var data = load(spec.tres)
	var results := []
	for job in spec.jobs:
		for i in job.times.size():
			results.append(await _shot(vp, data, spec, job, i, s))
	FileAccess.open("%s/done.json" % spec.out_dir, FileAccess.WRITE).store_string(JSON.stringify(results))
	quit()

func _shot(vp: SubViewport, data, spec: Dictionary, job: Dictionary, i: int, s: float) -> String:
		var rect: Array = spec.rect
		var t := float(job.times[i])
		var sp = ClassDB.instantiate("SpineSprite")
		# update manual: so o que este script mandar avanca o tempo (o sprite nao
		# pode tocar sozinho entre os frames renderizados)
		sp.update_mode = ClassDB.class_get_integer_constant("SpineConstant", "UpdateMode_Manual")
		sp.skeleton_data_res = data
		# o enquadramento vai na canvas_transform do viewport, nao no no: o SpineSprite
		# repassa o movimento do proprio no para a fisica (physics_translate), e mover o
		# sprite faria as partes com fisica balancarem. Spine e y para cima; o
		# SpineSprite ja desenha com y para baixo.
		vp.add_child(sp)
		var sk = sp.get_skeleton()
		sk.set_to_setup_pose()
		var state = sp.get_animation_state()
		var seq = job.get("sequence")
		var at = -1.0
		if seq != null:
			at = float(seq.at) if seq.get("at") != null else -1.0
			var a = state.set_animation(job.animation, bool(seq.get("loop", false)), 0)
			a.set_mix_duration(0)
			if at < 0.0:
				var b = state.add_animation(seq.next, 0.0, bool(seq.get("nextLoop", true)), 0)
				if seq.get("mix") != null:
					b.set_mix_duration(float(seq.mix))
					b.set_delay(maxf(a.get_animation().get_duration() - float(seq.mix), 0.0))
		elif job.animation != null and job.animation != "":
			var e = state.set_animation(job.animation, true, 0)
			e.set_mix_duration(0)
		sk.update_world_transform(ClassDB.class_get_integer_constant("SpineConstant", "Physics_Reset"))
		# aplica a animacao em t=0 (sem isso o primeiro frame mostraria a setup pose)
		sp.update_skeleton(0.0)
		var done := 0.0
		if at >= 0.0 and t + 1e-9 >= at:
			# ate a troca: passos inteiros e o pedaco que falta ate "at"
			while done + STEP <= at + 1e-9:
				sp.update_skeleton(STEP)
				done += STEP
			if at - done > 0.0:
				sp.update_skeleton(at - done)
			var nb = state.set_animation(seq.next, bool(seq.get("nextLoop", true)), 0)
			if seq.get("mix") != null:
				nb.set_mix_duration(float(seq.mix))
			done = at
		while done + STEP <= t + 1e-9:
			sp.update_skeleton(STEP)
			done += STEP
		if t - done > 0.0:
			sp.update_skeleton(t - done)
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		var img := vp.get_texture().get_image()
		var out := "%s/%s_%03d.png" % [spec.out_dir, job.prefix, i]
		img.save_png(out)
		# numeros, para comparar com o spine-core sem depender de pixels
		var bones := {}
		for b in sk.get_bones():
			var p = b.get_applied_pose()
			bones[b.get_data().get_bone_name()] = [p.get_world_x(), p.get_world_y(), p.get_a(), p.get_b(), p.get_c(), p.get_d()]
		var slots := {}
		for sl in sk.get_slots():
			var a = sl.get_applied_pose().get_attachment()
			slots[sl.get_data().get_name()] = a.get_attachment_name() if a != null and a.has_method("get_attachment_name") else (a.get_name() if a != null else null)
		var cur = state.get_track(0)
		var dump := {"t": t, "trackTime": cur.get_track_time() if cur != null else -1.0, "bones": bones, "slots": slots}
		if cur != null:
			var from = cur.get_mixing_from()
			dump["track"] = {"animation": cur.get_animation().get_name(), "mixTime": cur.get_mix_time(), "mixDuration": cur.get_mix_duration(), "from": from.get_animation().get_name() if from != null and is_instance_valid(from.get_animation()) else null}
		FileAccess.open(out.replace(".png", ".json"), FileAccess.WRITE).store_string(JSON.stringify(dump))
		sp.queue_free()
		await process_frame
		return out
