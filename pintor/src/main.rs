//! O pintor do Mamulengo: uma sessao do ProCraft sem janela, comandada pela entrada padrao.
//!
//! Mensagens nos dois sentidos: [u32 tamanho do JSON][u32 tamanho do binario][JSON][binario],
//! em little-endian. O JSON do pedido tem `op` e `id`; a resposta repete o `id`. O binario e
//! sempre RGBA8 reto (nao premultiplicado), linhas de cima para baixo.
//!
//! A tela da sessao e a propria imagem (1 pixel da janela = 1 pixel da imagem), com uma camada so
//! e o fundo escondido: o que se le e a camada, com o traco em andamento por cima.

use procraft_core::{CanvasSession, PenSample, PointerKind, SelectionJoin, ThumbnailImage, ToolKind};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

struct Pintor {
    s: Arc<CanvasSession>,
    w: u32,
    h: u32,
    // o que o editor ja tem (premultiplicado, como a sessao devolve)
    visto: Vec<u8>,
    // os ajustes pedidos (tamanho, opacidade, cor, ferramenta), para a folha seguinte
    ajuste: Option<Value>,
}

fn reto(premul: &[u8]) -> Vec<u8> {
    let mut out = premul.to_vec();
    for p in out.chunks_exact_mut(4) {
        let a = u32::from(p[3]);
        if a != 0 && a != 255 {
            for c in &mut p[..3] {
                *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    out
}

impl Pintor {
    // a biblioteca de pinceis do arquivo (so leitura; o ProCraft guarda a ultima lida no processo,
    // entao so a primeira folha paga a leitura)
    fn abrir(w: u32, h: u32, biblioteca: Option<&str>, inicial: &[u8]) -> Result<Pintor, String> {
        let s = CanvasSession::new(w, h);
        if !s.prepare_offscreen() {
            return Err("sem placa de video para o pintor (Vulkan ou OpenGL)".into());
        }
        s.resize_window(w, h);
        s.fit_view();
        s.settle_to_actual_size();
        s.set_background_visible(false);
        // a selecao nao aparece na imagem que volta ao editor
        s.set_selection_visibility(0.0);
        if let Some(p) = biblioteca {
            if !s.load_brush_library_file(p.to_owned()) {
                return Err(format!("{p}: a biblioteca de pinceis nao abriu"));
            }
        }
        if inicial.len() == (w as usize) * (h as usize) * 4 && inicial.iter().any(|&b| b != 0) {
            let antes: Vec<u64> = s.layers().iter().map(|l| l.id).collect();
            let nova = s.insert_image(ThumbnailImage { width: w, height: h, rgba: inicial.to_vec() }, false);
            if nova.is_some() {
                for id in antes {
                    s.delete_layer(id);
                }
            }
        }
        s.set_tool(ToolKind::Paint);
        let mut p = Pintor { s, w, h, visto: vec![0; (w as usize) * (h as usize) * 4], ajuste: None };
        // o editor ja tem a imagem inicial: o primeiro retangulo e so o que mudar depois
        if let Some(agora) = p.agora() {
            p.visto = agora;
        }
        Ok(p)
    }

    // a imagem como esta (premultiplicada), com o traco em andamento
    fn agora(&self) -> Option<Vec<u8>> {
        let t = self.s.canvas_thumbnail(self.w.max(self.h))?;
        (t.width == self.w && t.height == self.h).then_some(t.rgba)
    }

    // o retangulo que mudou desde a ultima resposta, e os pixels dele (retos)
    fn mudou(&mut self) -> (Value, Vec<u8>) {
        let Some(agora) = self.agora() else { return (Value::Null, Vec::new()) };
        let (w, h) = (self.w as usize, self.h as usize);
        let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0usize, 0usize);
        for y in 0..h {
            let (a, b) = (&agora[y * w * 4..(y + 1) * w * 4], &self.visto[y * w * 4..(y + 1) * w * 4]);
            if a == b {
                continue;
            }
            y0 = y0.min(y);
            y1 = y1.max(y + 1);
            let primeiro = a.chunks_exact(4).zip(b.chunks_exact(4)).position(|(p, q)| p != q).unwrap_or(0);
            let ultimo = a.chunks_exact(4).zip(b.chunks_exact(4)).rposition(|(p, q)| p != q).unwrap_or(w - 1);
            x0 = x0.min(primeiro);
            x1 = x1.max(ultimo + 1);
        }
        if x1 <= x0 || y1 <= y0 {
            self.visto = agora;
            return (Value::Null, Vec::new());
        }
        let mut parte = Vec::with_capacity((x1 - x0) * (y1 - y0) * 4);
        for y in y0..y1 {
            parte.extend_from_slice(&agora[(y * w + x0) * 4..(y * w + x1) * 4]);
        }
        self.visto = agora;
        (json!([x0, y0, x1 - x0, y1 - y0]), reto(&parte))
    }

    fn amostras(v: &Value) -> Vec<PenSample> {
        v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|p| {
                        let n = |i: usize, padrao: f64| p.get(i).and_then(Value::as_f64).unwrap_or(padrao);
                        p.get(1)?;
                        Some(PenSample {
                            x: n(0, 0.0) as f32,
                            y: n(1, 0.0) as f32,
                            pressure: (n(2, 0.5) as f32).clamp(0.0, 1.0),
                            time_ms: n(3, 0.0),
                            tilt: n(4, 0.0) as f32,
                            orientation: n(5, 0.0) as f32,
                            roll: 0.0,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn pedido(&mut self, m: &Value) -> Result<(Value, Vec<u8>), String> {
        let f = |k: &str| m.get(k).and_then(Value::as_f64);
        let u = |k: &str| f(k).unwrap_or(0.0) as u32;
        let s = self.s.clone();
        match m.get("op").and_then(Value::as_str).unwrap_or("") {
            "pinceis" => {
                let sets: Vec<Value> = s
                    .brush_library()
                    .iter()
                    .map(|c| json!({ "nome": c.name, "pinceis": c.brushes.iter().map(|b| b.name.clone()).collect::<Vec<_>>() }))
                    .collect();
                let atual = s.current_brush();
                Ok((json!({ "conjuntos": sets, "atual": [atual.set, atual.index] }), Vec::new()))
            }
            "previa" => {
                let t = s.brush_preview(u("set"), u("i"), u("w").max(8), u("h").max(8)).ok_or("pincel nao existe")?;
                Ok((json!({ "w": t.width, "h": t.height }), reto(&t.rgba)))
            }
            "pincel" => {
                if !s.select_brush(u("set"), u("i")) {
                    return Err("pincel nao existe".into());
                }
                Ok((json!({ "nome": s.current_brush().name }), Vec::new()))
            }
            "ajuste" => {
                // junta com os de antes: a folha seguinte recebe todos
                let mut junto = self.ajuste.take().unwrap_or_else(|| json!({ "op": "ajuste" }));
                for k in ["tamanho", "opacidade", "cor", "ferramenta"] {
                    if let Some(v) = m.get(k) {
                        junto[k] = v.clone();
                    }
                }
                self.ajuste = Some(junto);
                if let Some(v) = f("tamanho") {
                    s.set_brush_size(v as f32);
                }
                if let Some(v) = f("opacidade") {
                    s.set_brush_opacity(v as f32);
                }
                if let Some(c) = m.get("cor").and_then(Value::as_array) {
                    let n = |i: usize| c.get(i).and_then(Value::as_f64).unwrap_or(0.0) as f32;
                    s.set_color(n(0), n(1), n(2));
                }
                match m.get("ferramenta").and_then(Value::as_str) {
                    Some("pintar") => s.set_tool(ToolKind::Paint),
                    Some("apagar") => s.set_tool(ToolKind::Erase),
                    Some("borrar") => s.set_tool(ToolKind::Smudge),
                    _ => {}
                }
                Ok((json!({}), Vec::new()))
            }
            // a pintura so entra dentro do poligono (pontos [[x, y], ...] em pixels da folha); sem
            // pontos, em toda a folha
            "selecao" => {
                s.select_none();
                let pts: Vec<f32> = m
                    .get("pontos")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|p| Some([p.get(0)?.as_f64()? as f32, p.get(1)?.as_f64()? as f32])).flatten().collect())
                    .unwrap_or_default();
                if pts.len() >= 6 {
                    s.select_polygon(pts, SelectionJoin::Add);
                }
                let (r, b) = self.mudou();
                Ok((json!({ "ret": r, "tem": s.has_selection() }), b))
            }
            "comeca" => {
                let p = match m.get("ponteiro").and_then(Value::as_str) {
                    Some("caneta") => PointerKind::Stylus,
                    Some("borracha") => PointerKind::StylusEraser,
                    Some("dedo") => PointerKind::Finger,
                    _ => PointerKind::Mouse,
                };
                s.stroke_begin(p, Self::amostras(&m["amostras"]));
                let (r, b) = self.mudou();
                Ok((json!({ "ret": r }), b))
            }
            "segue" => {
                s.stroke_add(Self::amostras(&m["amostras"]));
                let (r, b) = self.mudou();
                Ok((json!({ "ret": r }), b))
            }
            "termina" => {
                s.stroke_end(Self::amostras(&m["amostras"]));
                let (r, b) = self.mudou();
                Ok((json!({ "ret": r }), b))
            }
            "cancela" => {
                s.stroke_cancel();
                let (r, b) = self.mudou();
                Ok((json!({ "ret": r }), b))
            }
            "desfazer" | "refazer" | "limpar" => {
                let nome = match m["op"].as_str() {
                    Some("desfazer") => s.undo(),
                    Some("refazer") => s.redo(),
                    _ => {
                        s.clear_layer();
                        None
                    }
                };
                let (r, b) = self.mudou();
                Ok((json!({ "ret": r, "passo": nome }), b))
            }
            // a imagem inteira, com o traco terminado (para gravar)
            "ler" => {
                let agora = self.agora().ok_or("sem imagem")?;
                Ok((json!({ "w": self.w, "h": self.h }), reto(&agora)))
            }
            outro => Err(format!("pedido desconhecido: {outro}")),
        }
    }
}

fn ler(entrada: &mut impl Read) -> Option<(Value, Vec<u8>)> {
    let mut cab = [0u8; 8];
    entrada.read_exact(&mut cab).ok()?;
    let nj = u32::from_le_bytes([cab[0], cab[1], cab[2], cab[3]]) as usize;
    let nb = u32::from_le_bytes([cab[4], cab[5], cab[6], cab[7]]) as usize;
    if nj > 64 << 20 || nb > 1 << 30 {
        return None;
    }
    let mut j = vec![0u8; nj];
    entrada.read_exact(&mut j).ok()?;
    let mut b = vec![0u8; nb];
    entrada.read_exact(&mut b).ok()?;
    Some((serde_json::from_slice(&j).ok()?, b))
}

fn escrever(saida: &mut impl Write, j: &Value, b: &[u8]) -> std::io::Result<()> {
    let texto = j.to_string();
    saida.write_all(&(texto.len() as u32).to_le_bytes())?;
    saida.write_all(&(b.len() as u32).to_le_bytes())?;
    saida.write_all(texto.as_bytes())?;
    saida.write_all(b)?;
    saida.flush()
}

fn main() {
    let mut entrada = std::io::stdin().lock();
    let mut saida = std::io::stdout().lock();
    // uma folha por quem pinta (a aba do editor); poucas, cada uma tem o seu dispositivo da placa
    let mut folhas: HashMap<String, Pintor> = HashMap::new();
    while let Some((m, bin)) = ler(&mut entrada) {
        let id = m.get("id").cloned().unwrap_or(Value::Null);
        let folha = m.get("folha").and_then(Value::as_str).unwrap_or("").to_owned();
        let feito = match m.get("op").and_then(Value::as_str) {
            Some("abrir") => {
                let n = |k: &str| m.get(k).and_then(Value::as_u64).unwrap_or(0) as u32;
                let (w, h) = (n("w").clamp(1, 8192), n("h").clamp(1, 8192));
                // a folha de antes solta a placa primeiro
                let velha = folhas.remove(&folha);
                let (pincel, ajuste) = velha.as_ref().map_or((None, None), |p| (Some(p.s.current_brush()), p.ajuste.clone()));
                drop(velha);
                Pintor::abrir(w, h, m.get("biblioteca").and_then(Value::as_str), &bin).map(|mut p| {
                    // o pincel e os ajustes continuam de uma folha para a outra
                    if let Some(b) = pincel {
                        p.s.select_brush(b.set, b.index);
                    }
                    if let Some(a) = ajuste {
                        let _ = p.pedido(&a);
                    }
                    let atual = p.s.current_brush();
                    folhas.insert(folha, p);
                    (json!({ "w": w, "h": h, "pincel": [atual.set, atual.index, atual.name] }), Vec::new())
                })
            }
            Some("fechar") => {
                folhas.remove(&folha);
                Ok((json!({}), Vec::new()))
            }
            _ => match folhas.get_mut(&folha) {
                Some(p) => p.pedido(&m),
                None => Err("folha fechada: abrir primeiro".into()),
            },
        };
        let (mut j, b) = match feito {
            Ok((j, b)) => (j, b),
            Err(e) => (json!({ "erro": e }), Vec::new()),
        };
        j["id"] = id;
        if escrever(&mut saida, &j, &b).is_err() {
            break;
        }
    }
}
