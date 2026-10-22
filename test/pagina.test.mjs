// Testes da página (docs/): pegam erros de "esqueci de criar o elemento" e de versão desencontrada,
// que só apareceriam no navegador de quem usa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const ler = (arq) => readFileSync(join(DOCS, arq), "utf8");
const html = ler("index.html");
const app = ler("app.js");
const cv = ler("cv.js");

const idsUsados = (js) => [...new Set([...js.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]))];

test("todo id que app.js, suporte.js e email.js procuram existe no index.html", () => {
  const ids = ["app.js", "suporte.js", "email.js"].flatMap((arq) => idsUsados(ler(arq)));
  const faltando = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(faltando, []);
});

test("todo id que o admin.js procura existe no admin.html", () => {
  const admin = ler("admin.html");
  const faltando = idsUsados(ler("admin.js")).filter((id) => !admin.includes(`id="${id}"`));
  assert.deepEqual(faltando, []);
});

test("todas as páginas usam a mesma versão dos arquivos", () => {
  const versoes = new Set(["index.html", "login.html", "admin.html"].flatMap((p) => [...ler(p).matchAll(/\?v=(\d+)/g)].map((m) => m[1])));
  assert.equal(versoes.size, 1, `versões misturadas: ${[...versoes].join(", ")}`);
});

test("ids fixos que o cv.js usa existem no index.html", () => {
  for (const id of ["cv", "cv-corpo", "cv-vaga", "cv-empresa", "cv-fechar", "impressao"]) {
    assert.ok(html.includes(`id="${id}"`), `falta #${id}`);
  }
});

test("app.js e cv.js usam a mesma chave para perfil e histórico de CVs", () => {
  assert.ok(app.includes('"radar-vagas:perfil"') && cv.includes('"radar-vagas:perfil"'));
  assert.ok(app.includes('"radar-vagas:cvs-gerados"') && cv.includes('"radar-vagas:cvs-gerados"'));
});

test("versão dos arquivos é a mesma no index.html e no service worker", () => {
  const sw = ler("sw.js");
  const versoesHtml = new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
  assert.equal(versoesHtml.size, 1, "index.html mistura versões");
  const v = [...versoesHtml][0];
  assert.match(sw, new RegExp(`VERSAO = "radar-v${v}"`));
  for (const arq of ["style.css", "app.js", "cv.js"]) assert.ok(sw.includes(`${arq}?v=${v}`), `sw.js não guarda ${arq}?v=${v}`);
});

test("arquivos guardados pelo service worker e ícones do manifesto existem", () => {
  const sw = ler("sw.js");
  const lista = JSON.parse(sw.match(/const ARQUIVOS = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
  for (const arq of lista) {
    if (arq === "./") continue;
    assert.ok(existsSync(join(DOCS, arq.split("?")[0])), `falta ${arq}`);
  }
  const manifesto = JSON.parse(ler("manifest.webmanifest"));
  for (const icone of manifesto.icons) assert.ok(existsSync(join(DOCS, icone.src)), `falta ${icone.src}`);
  assert.ok(existsSync(join(DOCS, "og.png")), "falta a imagem de compartilhamento");
});
