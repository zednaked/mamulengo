extends SceneTree
# Teste do BonecoSprite (GDExtension) no Godot oficial, headless, com o pessoa (CC0):
# entradas vivas (de tras para frente, mix e atraso, relogio, escala), sinais na hora, o no
# escondido (so o relogio anda), o caminho do .boneco na cena, a previa so no editor e o
# relogio em float32 e o .boneco binario. Montado e rodado por tools/boneco-godot-teste.ts.
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

	# o .boneco binario (docs/FORMATO.md "Binario"): o mesmo personagem, tocado igual, da os
	# mesmos ossos no mundo
	var tx := _novo()
	var bn := _novo("res://pessoa/pessoa-binario.boneco")
	_confere(bn.data != null and bn.data.get_error() == "", "o .boneco binario carrega")
	for s in [tx, bn]:
		s.set_animation("idle", true, 0)
		s.add_animation("acenar", 0.3, false, 0)
		for k in 90:
			s.update_skeleton(1.0 / 60.0)
	var wt: Dictionary = tx.get_bones_world()
	var wb: Dictionary = bn.get_bones_world()
	var dbin := 0.0
	for nome in wt:
		for i in 6:
			dbin = maxf(dbin, absf(wt[nome][i] - wb[nome][i]))
	_confere(wt.size() == wb.size() and dbin == 0.0, "binario e texto: os mesmos ossos depois de 1,5 s com fila e mix (dif %s)" % str(dbin))

	_palco()
	_tela()
	_textos()
	_fatias()
	_papeis()
	print("\n%d ok, FAILURES: %d" % [oks, falhas])
	quit(1 if falhas else 0)


# o palco (docs/PALCO.md): a rota que vence a fase de exemplos/palco da o mesmo jogo que o nucleo
# web (tools/palco.ts): o coelho em 1021, 564 (y para baixo no no), duas moedas, venceu, tick 222
func _palco() -> void:
	var s := _novo("res://palco/palco.boneco")
	_confere(s.stage_start(), "stage_start com o palco do .boneco")
	var antes := 0
	for t in [[6, 50], [4, 2], [2, 20], [0, 40], [2, 30], [6, 50], [2, 30]]:
		var bits: int = t[0]
		s.stage_step(bits & ~4 if (bits & antes & 4) else bits, 1)
		s.stage_step(bits, t[1] - 1)
		antes = bits
	var e: Dictionary = s.get_stage_state()
	var c: Dictionary = e["actors"][0]
	_confere(e["won"] and not e["died"] and e["points"] == 2 and e["tick"] == 222 and is_equal_approx(c["position"].x, 1021.0) and is_equal_approx(c["position"].y, -564.0), "palco: a rota vence igual ao nucleo web (%s)" % [str(c["position"])])
	var p := _novo()
	_confere(not p.stage_start(), "stage_start sem palco devolve false")


# a tela (docs/NUCLEO.md "Tela"): tests/nucleo/tela (arte 700 x 1370, caber). Numa janela 16:9 de
# 1920 x 1080 a vista tem 2435,56 de largura; o "fechar" (canto de cima e da direita) vai a
# 1197,78 e a barra estica 3,479 vezes, como no nucleo nativo (tools/nucleo-tela.ts). Com
# fit_window, a janela e a viewport e o no fica com a escala da vista e o canto dela em (0, 0)
func _tela() -> void:
	var s := _novo("res://tela/tela.boneco")
	s.window = Vector2(1920, 1080)
	s.update_skeleton(0.0)
	var f := _osso(s, "fechar")
	var b := _osso(s, "barra")
	var v: Rect2 = s.get_view()
	_confere(absf(f[0] - 1197.7778) < 0.01 and absf(f[1] + 1340.0) < 0.01 and absf(b[2] - 3.4794) < 0.001, "tela: o osso ancorado e o que estica na janela 16:9 (fechar %s, barra %s)" % [str(f[0]), str(b[2])])
	_confere(absf(s.get_view_scale() - 0.788321) < 1e-5 and absf(v.size.x - 2435.5556) < 0.01 and absf(v.position.y + 1370.0) < 0.01, "tela: a vista (%s, escala %s)" % [str(v), str(s.get_view_scale())])
	s.window = Vector2(0, 0)
	s.update_skeleton(0.0)
	_confere(absf(_osso(s, "fechar")[0] - 330.0) < 0.01, "tela: sem janela, a arte base")
	s.fit_window = true
	s.update_skeleton(0.0)
	var t: Vector2 = s.get_viewport_rect().size
	var e: float = s.get_view_scale()
	_confere(s.window == t and absf(s.scale.x - e) < 1e-6 and absf(s.position.x + s.get_view().position.x * e) < 0.01 and absf(s.position.y + s.get_view().position.y * e) < 0.01, "tela: fit_window segue a viewport %s (escala %s, posicao %s)" % [str(t), str(e), str(s.position)])


# os textos (docs/NUCLEO.md "Texto"): tests/nucleo/texto com a tabela pt, en, ar. O idioma acha a
# traducao da chave (pt_BR acha pt), set_text troca pelo texto livre, os parametros "{nome}"
# trocam, e o quadro desenha as letras pelo TextServer sem erro
func _textos() -> void:
	var s := _novo("res://texto/texto.boneco")
	_confere(Array(s.get_languages()) == ["pt", "en", "ar"], "textos: os idiomas da tabela %s" % [str(s.get_languages())])
	s.language = "en"
	_confere(s.get_text_shown("jogar") == "PLAY", "textos: en (%s)" % s.get_text_shown("jogar"))
	s.language = "ar"
	_confere(s.get_text_shown("jogar") == "العب", "textos: ar (%s)" % s.get_text_shown("jogar"))
	s.language = "pt_BR"
	_confere(s.get_text_shown("jogar") == "JOGAR", "textos: pt_BR acha pt (%s)" % s.get_text_shown("jogar"))
	s.update_skeleton(0.016)
	s.set_text("pontos", "Saldo {valor}")
	s.set_text_params("pontos", {"valor": "R$ 100,00"})
	_confere(s.get_text_shown("pontos") == "Saldo {valor}", "textos: set_text e livre (os parametros so na chave e no arquivo): %s" % s.get_text_shown("pontos"))
	s.clear_text("pontos")
	s.set_text_params("pontos", {"x": 1})
	_confere(s.get_text_shown("pontos") == "linha 1\nlinha \"2\"", "textos: clear_text volta ao do arquivo (%s)" % s.get_text_shown("pontos"))
	s.set_text("jogar", "um texto bem comprido que nao cabe de jeito nenhum na caixa do botao")
	s.update_skeleton(0.016)
	var est: Array = s.get_text_overflows()
	_confere(est.has("jogar"), "textos: o estouro do texto comprido (%s)" % str(est))
	s.set_text("jogar", "OK")
	_confere(not s.get_text_overflows().has("jogar"), "textos: curto nao estoura")


# as nove-fatias (docs/NUCLEO.md "Nove-fatias"): tests/nucleo/fatias. Na janela 16:9 (1920 x 1080) o
# painel estica 2,963 vezes em x e os cantos ficam com 40 de largura (como no nucleo nativo,
# tools/nucleo-fatias.ts); o fundo do botao acompanha o texto do TextServer: o curto deixa o tamanho
# caixa (240) na largura, o comprido a alarga (a medida vezes 1,25 mais 2 x 20 de respiro); a altura e a
# da linha vezes 1,25 mais 2 x 8 nos dois (a mesma linha)
func _fatias() -> void:
	var s := _novo("res://fatias/fatias.boneco")
	s.window = Vector2(1920, 1080)
	s.update_skeleton(0.0)
	var p: Dictionary = s.get_slice_info("painel")
	var c: PackedVector2Array = p.get("corners", PackedVector2Array())
	_confere(p.has("size") and absf(p["stretch"].x - 2.962963) < 1e-5 and absf(p["stretch"].y - 1.0) < 1e-5 and p["grid"] == Vector2i(4, 4) and c.size() == 4 and absf((c[2].x - c[1].x) - 592.5926) < 0.01, "fatias: o painel esticando na janela 16:9 (%s)" % str(p))
	_confere(s.get_slice_info("rotulo").is_empty() and s.get_slice_info("nada").is_empty(), "fatias: slot sem regiao fatiada")
	s.set_text("rotulo", "OK")
	s.update_skeleton(0.016)
	var curto: Dictionary = s.get_slice_info("fundo_botao")
	s.set_text("rotulo", "SPIELEN SPIELEN")
	s.update_skeleton(0.016)
	var longo: Dictionary = s.get_slice_info("fundo_botao")
	_confere(absf(curto["size"].x - 240.0) < 1e-3 and longo["size"].x > 300.0 and longo["size"].y >= 80.0 and absf(longo["size"].y - curto["size"].y) < 1e-3, "fatias: o botao acompanha o texto (curto %s, comprido %s)" % [str(curto["size"]), str(longo["size"])])


# os papeis (docs/NUCLEO.md "Papeis"): tests/nucleo/papeis. O no le os papeis, comeca cada botao no
# estado inicial (a pausa desligada), acha o papel no ponto como o nucleo nativo (tools/nucleo-papeis.ts:
# a tampa desenhada por cima ganha do botao), troca os estados pelo ponteiro e emite role_touched
var tocados: Array = []
func _tocou(nome: String) -> void:
	tocados.append(nome)


func _papeis() -> void:
	var s := _novo("res://papeis/papeis.boneco")
	s.update_skeleton(0.0)
	s.role_touched.connect(_tocou)
	var r: Array = s.get_roles()
	_confere(r.size() == 8 and r[0]["name"] == "jogar" and r[0]["type"] == "botao" and r[0]["track"] == 10 and r[0]["states"].get("em_cima", "") == "jogar/em_cima" and r[2]["disabled"] == true and r[7]["type"] == "texto", "papeis: get_roles (%d)" % r.size())
	_confere(s.get_role_state("jogar") == "normal" and s.get_role_state("pausa") == "desligado" and s.get_current(10).get_animation_name() == "jogar/normal", "papeis: o estado inicial")
	# no espaco do no o y e para baixo: o ponto (-60, 150) do mundo e (-60, -150)
	var sobre := Vector2(-60, -150)
	_confere(s.get_role_at(sobre) == "jogar" and s.get_role_at(Vector2(110, -150)) == "tampa" and s.get_role_at(Vector2(276, -930)) == "so_icone" and s.get_role_at(Vector2(200, -500)) == "", "papeis: o papel no ponto (a ordem de desenho, o invisivel)")
	_confere(s.role_pointer(0, sobre) == "jogar" and s.get_role_state("jogar") == "em_cima" and s.get_current(10).get_animation_name() == "jogar/em_cima", "papeis: em cima")
	s.role_pointer(1, sobre)
	_confere(s.get_role_state("jogar") == "apertado", "papeis: apertado")
	s.role_pointer(2, sobre)
	_confere(tocados == ["jogar"] and s.get_role_state("jogar") == "em_cima", "papeis: soltou no botao, role_touched (%s)" % str(tocados))
	s.set_role_disabled("jogar", true)
	s.role_pointer(1, sobre)
	s.role_pointer(3, sobre)
	_confere(tocados.size() == 1 and s.get_role_state("jogar") == "desligado" and s.is_role_disabled("jogar") and s.get_current(10).get_animation_name() == "jogar/desligado", "papeis: desligado nao toca")
	s.set_role_disabled("jogar", false)
	var a: PackedVector2Array = s.get_role_area("jogar")
	_confere(a.size() == 6 and s.get_role_area("pontos").is_empty(), "papeis: a area em triangulos (%d pontos)" % a.size())
	# o botao acompanha o texto do TextServer: a area cresce com ele
	# os pontos: (baixo-esq, cima-esq, cima-dir) e (cima-dir, baixo-dir, baixo-esq): a largura e de 1 a 2
	var x0 := (a[2] - a[1]).length()
	s.set_text("rotulo", "SPIELEN SPIELEN SPIELEN")
	s.update_skeleton(0.016)
	var b: PackedVector2Array = s.get_role_area("jogar")
	_confere(b.size() == 6 and absf(x0 - 240.0) < 1.0 and (b[2] - b[1]).length() > x0 + 100.0, "papeis: a area cresce com o texto (%.1f -> %.1f)" % [x0, (b[2] - b[1]).length()])
