// Leitor do formato texto de atlas do Spine (4.x e o antigo com campos indentados).
// Puro: usado no servidor e no editor.

export interface AtlasRegion {
  name: string;
  page: string;
  x: number;
  y: number;
  // tamanho da regiao (nao rotacionado; com degrees 90 ocupa height x width na pagina)
  width: number;
  height: number;
  offsetX: number;
  // a partir de baixo, como no libgdx
  offsetY: number;
  originalWidth: number;
  originalHeight: number;
  degrees: number;
  index: number;
  extra: string[];
}

export interface AtlasPage {
  name: string;
  width: number;
  height: number;
  pma: boolean;
  filter: string;
  scale?: number;
  extra: string[];
}

export function parseAtlas(text: string): { pages: AtlasPage[]; regions: AtlasRegion[] } {
  const pages: AtlasPage[] = [];
  const regions: AtlasRegion[] = [];
  const lines = text.split(/\r?\n/);
  let page: AtlasPage | null = null;
  let region: AtlasRegion | null = null;
  const nums = (v: string) => v.split(",").map((s) => parseInt(s.trim()));
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      page = null;
      region = null;
      continue;
    }
    const kv = /^([^:]+):(.*)$/.exec(line);
    if (!page) {
      page = { name: line, width: 0, height: 0, pma: false, filter: "Linear,Linear", extra: [] };
      pages.push(page);
      continue;
    }
    if (kv && !region) {
      const [k, v] = [kv[1].trim(), kv[2].trim()];
      if (k === "size") [page.width, page.height] = nums(v);
      else if (k === "pma") page.pma = v === "true";
      else if (k === "filter") page.filter = v;
      else if (k === "scale") page.scale = parseFloat(v);
      else page.extra.push(line);
      continue;
    }
    if (kv && region) {
      const [k, v] = [kv[1].trim(), kv[2].trim()];
      const n = nums(v);
      if (k === "bounds") [region.x, region.y, region.width, region.height] = n;
      else if (k === "xy") [region.x, region.y] = n;
      else if (k === "size") [region.width, region.height] = n;
      else if (k === "offsets") [region.offsetX, region.offsetY, region.originalWidth, region.originalHeight] = n;
      else if (k === "offset") [region.offsetX, region.offsetY] = n;
      else if (k === "orig") [region.originalWidth, region.originalHeight] = n;
      else if (k === "rotate") region.degrees = v === "true" ? 90 : v === "false" ? 0 : parseInt(v);
      else if (k === "index") region.index = parseInt(v);
      else region.extra.push(line);
      continue;
    }
    region = { name: line, page: page.name, x: 0, y: 0, width: 0, height: 0, offsetX: 0, offsetY: 0, originalWidth: 0, originalHeight: 0, degrees: 0, index: -1, extra: [] };
    regions.push(region);
  }
  for (const r of regions) {
    if (!r.originalWidth && !r.originalHeight) {
      r.originalWidth = r.width;
      r.originalHeight = r.height;
    }
  }
  return { pages, regions };
}

