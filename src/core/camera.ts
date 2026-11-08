// A camera de um filme (docs/FILME.md): um osso do esqueleto marcado em `skeleton.camera`. O quadro
// filmado e o retangulo largura x altura do esqueleto (o tamanho do filme) centrado no osso, vezes
// a escala do mundo do osso (escala 0,5: o quadro tem metade do tamanho, aproxima duas vezes) e
// girado com ele. Assim o que esta preso a camera (cortina, flash, legenda) cobre o quadro em
// qualquer zoom. Quem desenha (tools/quadro.ts, a exportacao do editor) pede a vista a cada quadro.

export interface Vista {
  cx: number;
  cy: number;
  zoom: number; // >1 aproxima
  giro: number; // radianos (o quadro gira junto com o osso)
  rect: [number, number, number, number]; // sem giro: x, y (canto de baixo), largura, altura
}

// mundo do osso [a, b, c, d, x, y] (y para cima) e o tamanho do filme
export function vistaDaCamera(m: ArrayLike<number>, largura: number, altura: number): Vista {
  const [a, , c] = [m[0], m[1], m[2]];
  const tam = Math.hypot(a, c) || 1;
  const zoom = 1 / tam;
  const giro = Math.atan2(c, a);
  const w = largura * tam,
    h = altura * tam;
  return { cx: m[4], cy: m[5], zoom, giro, rect: [m[4] - w / 2, m[5] - h / 2, w, h] };
}

// a projecao (mat4 em colunas) do mundo para o recorte de um quadro de w x h pixels
export function projecaoDaVista(v: Vista, largura: number, w: number, h: number): Float32Array {
  const px = (w / largura) * v.zoom; // pixels por unidade do mundo
  const sx = (2 * px) / w,
    sy = (2 * px) / h;
  const co = Math.cos(v.giro),
    si = Math.sin(v.giro);
  const m00 = co * sx,
    m01 = si * sx,
    m10 = -si * sy,
    m11 = co * sy;
  return new Float32Array([m00, m10, 0, 0, m01, m11, 0, 0, 0, 0, 1, 0, -(v.cx * m00 + v.cy * m01), -(v.cx * m10 + v.cy * m11), 0, 1]);
}
