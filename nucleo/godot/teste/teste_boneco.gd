extends SceneTree
# Teste do BonecoSprite (GDExtension) no Godot oficial, headless, com o pessoa (CC0):
# entradas vivas (de tras para frente, mix e atraso, relogio, escala), sinais na hora, o no
# escondido (so o relogio anda), o caminho do .boneco na cena, a previa so no editor e o
# relogio em float32. Montado e rodado por tools/boneco-godot-teste.ts.
#   godot --headless --path <projeto> -s res://teste_boneco.gd

var falhas := 0
var oks := 0


func _confere(cond: bool, texto: String) -> void:
	if cond:
		oks += 1
		print("  ok   ", texto)
	else:
		falhas += 1
		print("  FALHA ", texto)


func _novo(caminho := "res://pessoa/pessoa.boneco") -> Node2D:
	var s: Node2D = ClassDB.instantiate("BonecoSprite")
	s.manual = true
	s.boneco = caminho
	root.add_child(s)
	return s


func _osso(s: Node2D, nome: String) -> PackedFloat64Array:
	return s.get_bone_world(nome)


func _initialize() -> void:
	_rodar.call_deferred()


func _rodar() -> void:
	print("BonecoSprite:")
	# o caminho na cena e o cache por caminho
	var a := _novo()
	var b := _novo()
	_confere(a.data != null and a.data.get_error() == "", "boneco carrega pelo caminho")
	_confere(a.data == b.data, "o mesmo caminho devolve o mesmo BonecoData")
	_confere(a.data.get_animation_names().has("acenar"), "animacoes do .boneco")

	# entradas: o mesmo objeto no retorno, no get_current e nos sinais
	var vistos := []
	a.animation_started.connect(func(e): vistos.append(["inicio", e]))
	a.animation_ended.connect(func(e): vistos.append(["fim", e]))
	var e1: Object = a.set_animation("acenar", false, 0)
	_confere(vistos.size() == 1 and vistos[0][0] == "inicio" and vistos[0][1] == e1, "animation_started sai dentro do set_animation, com a mesma entrada")
	_confere(a.get_current(0) == e1, "get_current devolve a mesma entrada")
	_confere(e1.is_valid() and e1.get_animation_name() == "acenar", "a entrada vale e tem o nome")

	# de tras para frente: no instante t a pose e a da animacao no fim - t
	e1.set_reverse(true)
	a.update_skeleton(0.5)
	var rev := _osso(a, "cotovelo_d")
	var c := _novo()
	c.set_animation("acenar", false, 0)
	c.update_skeleton(1.8 - 0.5)
	var fre := _osso(c, "cotovelo_d")
	var d := 0.0
	for i in 6:
		d = maxf(d, absf(rev[i] - fre[i]))
	_confere(e1.get_reverse() and d < 1e-4, "de tras para frente: aos 0,5 s e a pose de 1,3 s (dif %s)" % str(d))

	# o relogio da entrada
	e1.set_track_time(0.25)
	_confere(absf(e1.get_track_time() - 0.25) < 1e-6, "set_track_time")
	e1.set_time_scale(2.0)
	a.update_skeleton(0.1)
	_confere(absf(e1.get_track_time() - 0.45) < 1e-5, "escala de tempo da entrada (0,25 + 0,1 x 2)")

	# mix e atraso refeitos: emendar na volta do loop
	var l := _novo()
	l.set_animation("idle", true, 0)
	l.update_skeleton(1.0)
	var e2: Object = l.add_animation("acenar", 0.0, false, 0)
	e2.set_mix_duration_and_delay(0.0, 0.0)
	_confere(absf(e2.get_delay() - 2.4) < 1e-4 and e2.get_mix_duration() == 0.0, "set_mix_duration_and_delay(0, 0): entra no fim da volta (atraso %.3f)" % e2.get_delay())
	e2.set_mix_duration(0.3)
	_confere(absf(e2.get_mix_duration() - 0.3) < 1e-6, "set_mix_duration")

	# o fim invalida a entrada, e o sinal de fim leva a mesma
	vistos.clear()
	var e3: Object = a.set_animation("idle", true, 0)
	a.update_skeleton(0.0)
	a.update_skeleton(1.0 / 60.0)
	var fim_e1 := false
	for v in vistos:
		if v[0] == "fim" and v[1] == e1:
			fim_e1 = true
	_confere(fim_e1 and not e1.is_valid(), "a entrada que acabou: sinal de fim com ela, e is_valid falso")
	e1.set_reverse(true)
	_confere(not e1.get_reverse() and e3.is_valid(), "set_* numa entrada que acabou nao faz nada")

	# escondido: so o relogio anda, a pose fica
	var h := _novo()
	h.set_animation("acenar", true, 0)
	h.update_skeleton(0.2)
	var antes := _osso(h, "cotovelo_d")
	h.visible = false
	h.update_skeleton(0.5)
	var escondido := _osso(h, "cotovelo_d")
	var parado := true
	for i in 6:
		parado = parado and absf(antes[i] - escondido[i]) < 1e-9
	var eh: Object = h.get_current(0)
	_confere(parado and absf(eh.get_track_time() - 0.7) < 1e-5, "escondido: a pose nao muda e o relogio anda (%.3f s)" % eh.get_track_time())
	h.visible = true
	h.update_skeleton(0.0)
	var ref := _novo()
	ref.set_animation("acenar", true, 0)
	ref.update_skeleton(0.7)
	var volta := _osso(h, "cotovelo_d")
	var r := _osso(ref, "cotovelo_d")
	d = 0.0
	for i in 6:
		d = maxf(d, absf(volta[i] - r[i]))
	_confere(d < 1e-4, "ao reaparecer, a pose do relogio (dif %s)" % str(d))
	h.pose_when_hidden = true
	h.visible = false
	h.update_skeleton(0.3)
	var pousou := _osso(h, "cotovelo_d")
	var mudou := false
	for i in 6:
		mudou = mudou or absf(pousou[i] - volta[i]) > 1e-6
	_confere(mudou, "pose_when_hidden: pousa mesmo escondido")

	# previa: so no editor
	var p := _novo()
	p.preview = "acenar"
	_confere(p.get_current(0) == null, "preview nao toca fora do editor")

	# relogio em float32
	var f := _novo()
	f.float_clock = true
	var ef: Object = f.set_animation("idle", true, 0)
	for i in 600:
		f.update_skeleton(1.0 / 60.0)
	var g := _novo()
	var eg: Object = g.set_animation("idle", true, 0)
	for i in 600:
		g.update_skeleton(1.0 / 60.0)
	# a mesma soma em float32 (PackedFloat32Array arredonda)
	var soma := PackedFloat32Array([0.0, 1.0 / 60.0])
	for i in 600:
		soma[0] = soma[0] + soma[1]
	var tf: float = ef.get_track_time()
	_confere(tf == soma[0] and tf != eg.get_track_time() and absf(eg.get_track_time() - 10.0) < 1e-5, "float_clock: 600 quadros dao %.7f (a soma em float32) e %.9f sem ele" % [tf, eg.get_track_time()])

	# todos os ossos, y para baixo
	var bw: Dictionary = a.get_bones_world()
	var w := _osso(a, "cotovelo_d")
	var x: PackedFloat64Array = bw["cotovelo_d"]
	_confere(bw.size() > 5 and absf(x[0] - w[0]) < 1e-9 and absf(x[1] - w[1]) < 1e-9 and absf(x[2] - w[2]) < 1e-9, "get_bones_world")

	print("\n%d ok, FAILURES: %d" % [oks, falhas])
	quit(1 if falhas else 0)
