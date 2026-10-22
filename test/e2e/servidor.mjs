// Servidor estático simples da pasta docs, só para os testes de ponta a ponta
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".zip": "application/zip" };

createServer(async (req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const arquivo = normalize(join(DOCS, caminho.endsWith("/") ? `${caminho}index.html` : caminho));
  if (!arquivo.startsWith(normalize(DOCS))) { res.writeHead(403).end(); return; }
  try {
    const corpo = await readFile(arquivo);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arquivo)] || "application/octet-stream" }).end(corpo);
  } catch {
    res.writeHead(404).end();
  }
}).listen(8790);
