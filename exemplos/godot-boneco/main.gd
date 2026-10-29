extends Node2D
# Tres personagens tocando o idle; um clique num deles toca a animacao de acao (com mix) e
# volta ao idle pela fila; os eventos do .boneco aparecem na tela.
# Na linha de comando (depois de `--`):
#   --teste        roda sozinho, confere animacao, mix e evento e sai (codigo 0 se deu certo)
#   --foto=<png>   como o --teste, e salva o viewport no meio da acao

const MIX := 0.25  # segundos de emenda entre uma animacao e outra
const ALTURA := 360.0  # altura de cada personagem na tela, em pixels
const CHAO := 580.0

@onready var bonecos: Array[BonecoSprite] = [$Aventureiro, $Monstro, $Pessoa]
@onready var eventos_label: Label = $Eventos

var linhas: PackedStringArray = []
var eventos_vistos := 0
var acoes := {}  # BonecoSprite -> nome da animacao de acao


func _ready() -> void:
	var largura := get_viewport_rect().size.x
	for i in bonecos.size():
		var b := bonecos[i]
		if b.data == null or b.data.get_error() != "":
			push_error("boneco: %s sem data" % b.name)
			continue
		b.set_default_mix(MIX)
		b.set_animation("idle", true, 0)
		# a acao e a outra animacao do personagem (cada um tem idle e mais uma)
		for nome in b.get_animation_names():
			if nome != "idle":
				acoes[b] = nome
		b.animation_event.connect(_on_animation_event.bind(b))
		# encaixa na tela pela caixa do esqueleto (unidades do arquivo)
		var caixa := b.get_skeleton_bounds()
		var escala := ALTURA / maxf(caixa.size.y, 1.0)
		b.scale = Vector2(escala, escala)
		b.position = Vector2(largura * (2 * i + 1) / 6.0 - caixa.get_center().x * escala, CHAO - caixa.end.y * escala)
	_mostrar("Click a character")
	var args := OS.get_cmdline_user_args()
	for a in args:
		if a == "--teste":
			_teste("")
		elif a.begins_with("--foto="):
			_teste(a.trim_prefix("--foto="))


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		# o ponto do clique no espaco de cada personagem, contra a caixa do que esta desenhado
		var ponto := to_global((make_input_local(event) as InputEventMouseButton).position)
		for b in bonecos:
			if b.get_skeleton_bounds().grow(10).has_point(b.to_local(ponto)):
				_acao(b)


# a acao uma vez, com mix a partir do que estiver tocando, e o idle de novo na fila
func _acao(b: BonecoSprite) -> void:
	if not acoes.has(b):
		return
	b.set_animation(acoes[b], false, 0)
	b.add_animation("idle", 0.0, true, 0)


func _on_animation_event(_entrada: BonecoEntrada, nome: String, _inteiro: int, _decimal: float, texto: String, b: BonecoSprite) -> void:
	eventos_vistos += 1
	_mostrar("%s: event \"%s\" %s" % [b.name, nome, texto])


func _mostrar(linha: String) -> void:
	linhas.append(linha)
	if linhas.size() > 4:
		linhas = linhas.slice(linhas.size() - 4)
	eventos_label.text = "\n".join(linhas)


# o roteiro do --teste e do --foto: idle, a acao nos tres, os eventos, o idle de volta
func _teste(foto: String) -> void:
	var falhas: PackedStringArray = []
	if acoes.size() != bonecos.size():
		falhas.append("personagens sem animacao de acao: %d de %d" % [acoes.size(), bonecos.size()])
	await get_tree().create_timer(0.5).timeout
	# um clique de mentira no meio de cada personagem, pelo mesmo caminho do mouse
	for b in bonecos:
		var clique := InputEventMouseButton.new()
		clique.button_index = MOUSE_BUTTON_LEFT
		clique.pressed = true
		clique.position = b.to_global(b.get_skeleton_bounds().get_center())
		get_viewport().push_input(clique, true)
		if b.get_current(0) == null or b.get_current(0).get_animation_name() != acoes.get(b, ""):
			falhas.append("%s nao trocou de animacao" % b.name)
		if absf(b.get_default_mix() - MIX) > 0.001:
			falhas.append("%s com mix %f" % [b.name, b.get_default_mix()])
	# os tres eventos caem antes de 0,5 s de acao; a foto sai logo depois do ultimo
	var limite := Time.get_ticks_msec() + 3000
	while eventos_vistos < bonecos.size() and Time.get_ticks_msec() < limite:
		await get_tree().process_frame
	await get_tree().create_timer(0.1).timeout
	if foto != "":
		await RenderingServer.frame_post_draw
		var img := get_viewport().get_texture().get_image()
		var err := img.save_png(foto)
		if err != OK:
			falhas.append("nao salvei %s (%d)" % [foto, err])
	await get_tree().create_timer(2.0).timeout
	if eventos_vistos < bonecos.size():
		falhas.append("eventos: %d de %d" % [eventos_vistos, bonecos.size()])
	for b in bonecos:
		if b.get_current(0) == null or b.get_current(0).get_animation_name() != "idle":
			falhas.append("%s nao voltou ao idle" % b.name)
	if falhas.is_empty():
		print("boneco exemplo: ok (", eventos_vistos, " eventos)")
		get_tree().quit(0)
	else:
		for f in falhas:
			printerr("boneco exemplo: ", f)
		get_tree().quit(1)
