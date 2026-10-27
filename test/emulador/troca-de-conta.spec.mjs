// Troca de conta no mesmo navegador, com o Firebase de verdade (emuladores de Auth e Firestore) e as regras do banco.
// É o caso do vazamento antigo: a conta B entrava depois da A e via (e herdava na nuvem) os dados da A.
// Rodar: npm run test:emulador
import { test, expect } from "@playwright/test";

const PROJETO = "demo-radar";
const AUTH = "http://127.0.0.1:9099";
const BANCO = `http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents`;
const DONO = { Authorization: "Bearer owner" }; // nos emuladores, passa por cima das regras (só para preparar e conferir)
const hoje = new Date().toISOString().slice(0, 10);
const VAGAS = {
  atualizadoEm: new Date().toISOString(), dataRodada: hoje,
  vagas: [{ id: "v1", titulo: "Desenvolvedor Front-end Júnior", empresa: "Alfa", area: "Front-end", nivel: "Júnior", regime: "CLT", modelo: "Remoto", local: "Brasil", stack: ["React"], requisitos: [], salario: "", link: "https://exemplo.com/v1", fonte: "Gupy", publicadaEm: hoje, encontradaEm: hoje, status: "aberta", prioridade: 3 }],
};

async function criarConta(email, nome) {
  const r = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=teste`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "senha123", displayName: nome, returnSecureToken: true }),
  })).json();
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJETO}/accounts:update`, {
    method: "POST", headers: { "Content-Type": "application/json", ...DONO }, body: JSON.stringify({ localId: r.localId, emailVerified: true }),
  });
  // Ficha com o primeiro acesso feito, para a tela de boas-vindas não abrir
  await fetch(`${BANCO}/users/${r.localId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", ...DONO },
    body: JSON.stringify({ fields: { nome: { stringValue: nome }, email: { stringValue: email }, papel: { stringValue: "usuario" }, bloqueado: { booleanValue: false }, onboardingFeito: { booleanValue: true } } }),
  });
  return r.localId;
}
const existeNoBanco = async (caminho) => (await fetch(`${BANCO}/${caminho}`, { headers: DONO })).status === 200;
const chavesPessoais = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("radar-vagas:") && k !== "radar-vagas:tema" && k !== "radar-vagas:dono"));

test.beforeEach(async ({ page }) => {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJETO}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
  await page.addInitScript((cfg) => { window.__radarEmulador = cfg; }, { projeto: PROJETO, auth: AUTH, firestore: 8080 });
  await page.route(/\/vagas\.json(\?|$)/, (r) => r.fulfill({ json: VAGAS }));
  await page.route(/\/historico\.json(\?|$)/, (r) => r.fulfill({ json: { dias: [] } }));
});

async function entrar(page, email) {
  await page.goto("/login.html");
  await page.locator("#email").fill(email);
  await page.locator("#senha").fill("senha123");
  await page.locator("#enviar").click();
  await page.waitForURL(/index\.html/);
  await expect(page.locator("#carregando-conta")).toBeHidden({ timeout: 20000 });
}
async function sair(page) {
  await page.locator(".conta-btn").click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await page.waitForURL(/login\.html/);
}

test("conta B entrando depois que a A saiu: não vê nada da A, nem no navegador nem na nuvem", async ({ page }) => {
  const ana = await criarConta("ana@exemplo.com", "Ana");
  const bia = await criarConta("bia@exemplo.com", "Bia");

  await entrar(page, "ana@exemplo.com");
  await page.locator("#lista .vaga").first().getByRole("button", { name: "Já me candidatei" }).click();
  await expect.poll(() => existeNoBanco(`users/${ana}/dados/candidaturas`), { timeout: 10000 }).toBe(true); // salvou na nuvem da Ana

  await sair(page);
  expect(await chavesPessoais(page)).toEqual([]); // sair limpou o navegador

  await entrar(page, "bia@exemplo.com");
  await page.locator("#abrir-painel").click();
  await expect(page.getByText("Você ainda não marcou nenhuma candidatura")).toBeVisible();
  await page.waitForTimeout(1500); // tempo de sobra para um envio à nuvem (o site espera 0,8 s)
  expect(await existeNoBanco(`users/${bia}/dados/candidaturas`)).toBe(false);
});

test("dados deixados por uma versão antiga do site (sem dono) não passam para a conta que entra", async ({ page }) => {
  const bia = await criarConta("bia@exemplo.com", "Bia");
  await page.goto("/login.html");
  // Como ficava o navegador antes da correção: dados da Ana, sem marcar de quem são
  await page.evaluate(() => {
    localStorage.setItem("radar-vagas:candidaturas", JSON.stringify({ v1: { data: "2026-10-20", etapa: "entrevista", titulo: "Vaga da Ana", empresa: "Alfa" } }));
    localStorage.setItem("radar-vagas:suporte", JSON.stringify([{ de: "eu", texto: "conversa da Ana com a IA" }]));
  });
  await page.locator("#email").fill("bia@exemplo.com");
  await page.locator("#senha").fill("senha123");
  await page.locator("#enviar").click();
  await page.waitForURL(/index\.html/);
  await expect(page.locator("#carregando-conta")).toBeHidden({ timeout: 20000 });

  expect(await chavesPessoais(page)).not.toContain("radar-vagas:suporte");
  await page.locator("#abrir-painel").click();
  await expect(page.getByText("Você ainda não marcou nenhuma candidatura")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await existeNoBanco(`users/${bia}/dados/candidaturas`)).toBe(false);
  expect(await existeNoBanco(`users/${bia}/dados/suporte`)).toBe(false);
});
