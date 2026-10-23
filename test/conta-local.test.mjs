// Testes do docs/conta-local.js: o navegador só guarda dados de uma conta por vez.
// Garante que a conta B, entrando no mesmo navegador depois da A, não vê nem herda nada da A.
import { test } from "node:test";
import assert from "node:assert/strict";
import { limparDadosLocais, prepararParaConta, assinaturaPdf, partesDoPdf, CHAVE_DONO, PARTE_PDF } from "../docs/conta-local.js";

// localStorage/sessionStorage de mentira, com a mesma interface do navegador
function armazem(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    dados: m,
  };
}

const dadosDaAna = () => armazem({
  [CHAVE_DONO]: "ana",
  "radar-vagas:perfil": JSON.stringify({ nome: "Ana", cvTexto: "CV da Ana", cvPdf: { nome: "ana.pdf", base64: "JVBER" } }),
  "radar-vagas:candidaturas": JSON.stringify({ v1: { etapa: "entrevista" } }),
  "radar-vagas:suporte": JSON.stringify([{ de: "eu", texto: "conversa da Ana com a IA" }]),
  "radar-vagas:analises": "{}",
  "radar-vagas:tema": JSON.stringify("escuro"),
  "outro-site": "fica",
});

test("conta B entrando depois da A: nada da A fica no navegador", () => {
  const a = dadosDaAna();
  const sessao = armazem({ "radar-vagas:gmail-token": "token-da-ana" });
  const apagados = prepararParaConta("bia", {}, a, sessao);
  assert.equal(apagados, 4); // perfil, candidaturas, suporte, analises
  assert.deepEqual([...a.dados.keys()].sort(), [CHAVE_DONO, "outro-site", "radar-vagas:tema"].sort());
  assert.equal(a.getItem(CHAVE_DONO), "bia");
  assert.equal(sessao.length, 0); // token do Gmail da Ana some
});

test("a mesma conta entrando de novo: nada é apagado", () => {
  const a = dadosDaAna();
  assert.equal(prepararParaConta("ana", {}, a, armazem()), 0);
  assert.match(a.getItem("radar-vagas:perfil"), /CV da Ana/);
});

test("dados de antes de existir o dono são apagados (podem ser de outra pessoa)", () => {
  const a = dadosDaAna();
  a.removeItem(CHAVE_DONO);
  assert.equal(prepararParaConta("bia", {}, a, armazem()), 4);
  assert.equal(a.getItem("radar-vagas:perfil"), null);
});

test("PDF de antes do dono só fica se for o PDF que a própria conta registrou", () => {
  const a = dadosDaAna();
  a.removeItem(CHAVE_DONO);
  prepararParaConta("ana", { nomePdfDaConta: "ana.pdf" }, a, armazem());
  assert.deepEqual(JSON.parse(a.getItem("radar-vagas:perfil")), { cvPdf: { nome: "ana.pdf", base64: "JVBER" } });

  const b = dadosDaAna();
  prepararParaConta("bia", { nomePdfDaConta: "ana.pdf" }, b, armazem()); // dono era a Ana: nunca passa para a Bia
  assert.equal(b.getItem("radar-vagas:perfil"), null);
});

test("sair limpa tudo o que é pessoal e mantém só o tema", () => {
  const a = dadosDaAna();
  limparDadosLocais(a, armazem());
  assert.deepEqual([...a.dados.keys()].sort(), ["outro-site", "radar-vagas:tema"]);
});

test("PDF: assinatura muda com o conteúdo e as partes remontam o arquivo", () => {
  const pdf = { nome: "cv.pdf", base64: "A".repeat(PARTE_PDF * 2 + 10) };
  assert.equal(assinaturaPdf(pdf), assinaturaPdf({ ...pdf }));
  assert.notEqual(assinaturaPdf(pdf), assinaturaPdf({ ...pdf, base64: pdf.base64.slice(1) + "B" }));
  assert.equal(assinaturaPdf(null), "");
  const partes = partesDoPdf(pdf.base64);
  assert.equal(partes.length, 3);
  assert.equal(partes.join(""), pdf.base64);
});
