// Fluxos principais do site num navegador de verdade. Firebase e vagas são simulados (nada vai para a nuvem).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const FIREBASE_FALSO = readFileSync(new URL("./firebase-falso.js", import.meta.url), "utf8");
const hoje = new Date().toISOString().slice(0, 10);
const vaga = (id, extra) => ({
  id, titulo: "Dev", empresa: "Empresa", area: "Back-end", nivel: "Júnior", regime: "CLT", modelo: "Remoto", local: "Brasil",
  stack: ["Node.js"], requisitos: [], salario: "", link: `https://exemplo.com/${id}`, fonte: "Gupy", publicadaEm: hoje,
  encontradaEm: hoje, status: "aberta", prioridade: 3, ...extra,
});
const VAGAS = {
  atualizadoEm: new Date().toISOString(), dataRodada: hoje,
  vagas: [
    vaga("v1", { titulo: "Desenvolvedor Front-end Júnior", empresa: "Alfa", area: "Front-end", stack: ["React", "TypeScript", "Docker"], salario: "R$ 4.000 a 5.000" }),
    vaga("v2", { titulo: "Desenvolvedor Back-end Pleno", empresa: "Beta", nivel: "Pleno", regime: "PJ", stack: ["Node.js", "Docker", "AWS"], salario: "R$ 9.000" }),
    vaga("v3", { titulo: "Full Stack Sênior", empresa: "Gama", area: "Full-stack", nivel: "Sênior", modelo: "Híbrido", local: "Curitiba - PR", stack: ["React", "Node.js", "Docker", "SQL"] }),
  ],
};
const HISTORICO = { dias: [{ data: "2026-10-20", abertas: 2, porArea: { "Back-end": 1 } }, { data: "2026-10-21", abertas: 3, porArea: { "Back-end": 1 } }, { data: hoje, abertas: 3, porArea: { "Back-end": 1 } }] };
const PERFIL = {
  nome: "Pessoa de Teste", email: "teste@exemplo.com", cidade: "Curitiba - PR",
  cvTexto: "Desenvolvedora com 3 anos de React, Node.js, JavaScript e Git. Criei APIs REST.",
  preferencias: { area: "todos", nivel: "todos", regime: "todos", local: "todos" },
};

test.beforeEach(async ({ page }) => {
  await page.route(/\/firebase\.js(\?|$)/, (r) => r.fulfill({ contentType: "text/javascript", body: FIREBASE_FALSO }));
  await page.route(/\/vagas\.json(\?|$)/, (r) => r.fulfill({ json: VAGAS }));
  await page.route(/\/historico\.json(\?|$)/, (r) => r.fulfill({ json: HISTORICO }));
  await page.addInitScript((perfil) => {
    if (!sessionStorage.getItem("e2e-pronto")) {
      localStorage.clear();
      localStorage.setItem("radar-vagas:perfil", JSON.stringify(perfil));
      sessionStorage.setItem("e2e-pronto", "1");
    }
  }, PERFIL);
});

test("lista as vagas, filtra por área e mostra a compatibilidade", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#lista .vaga")).toHaveCount(3);
  await page.getByRole("button", { name: "Front-end", exact: true }).first().click();
  await expect(page.locator("#lista .vaga")).toHaveCount(1);
  await expect(page.locator("#lista .vaga .compat")).toContainText("compatível");
});

test("painel do mercado mostra números, tecnologias e a linha do histórico", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#abrir-mercado").click();
  const m = page.locator("#mercado");
  await expect(m.locator(".mn-rotulo").first()).toHaveText("Vagas abertas");
  await expect(m.locator(".barra-linha").first()).toContainText("Docker");
  await expect(m.getByText("✓ no seu CV").first()).toBeVisible();
  await expect(m.locator(".linha-box svg")).toBeVisible();
  await expect(m.locator(".mercado-tabela").first()).toContainText("R$");
});

test("adapta o CV com um clique e baixa o PDF de verdade", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#lista .vaga").first().getByRole("button", { name: "Adaptar meu CV" }).click();
  const cv = page.locator("#cv");
  await expect(cv.locator("#cv-folha")).toBeVisible({ timeout: 20000 });
  await expect(cv.locator("#cv-folha")).toContainText("Pessoa de Teste");
  const download = page.waitForEvent("download", { timeout: 45000 });
  await cv.getByRole("button", { name: "Baixar PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await expect(cv.getByText(/CV baixado!/)).toBeVisible();
});

test("vaga de outro site pelo texto colado abre o adaptador com o título lido pela IA", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#externa-gatilho").click();
  await page.locator("#externa-descricao").fill("Desenvolvedor Full Stack Pleno na Empresa Externa\n\nRequisitos: React, Node.js e Docker. Trabalho remoto, contratação CLT, time de produto.");
  await page.locator("#externa-adaptar").click();
  await expect(page.locator("#cv-vaga")).toHaveText("Desenvolvedor Full Stack Pleno", { timeout: 20000 });
});

test("a extensão do navegador preenche a vaga pelo endereço (#vaga=) e só usa a IA depois do clique", async ({ page }) => {
  const texto = "Vaga: Desenvolvedor Back-end Node.js\nRequisitos: Node.js, APIs REST, SQL e Docker. Remoto, ação é já.";
  const b64 = Buffer.from(texto, "utf8").toString("base64");
  await page.goto(`/index.html#vaga=${encodeURIComponent(b64)}&link=${encodeURIComponent("https://exemplo.com/vaga")}&titulo=Back-end`);
  await expect(page.locator("#externa-descricao")).toHaveValue(texto);
  await expect(page).not.toHaveURL(/#vaga=/);
  await expect(page.locator("#cv")).toBeHidden();
  expect(await page.evaluate(() => window.__pedidosIA.length)).toBe(0);
  await page.locator("#externa-adaptar").click();
  await expect(page.locator("#cv-vaga")).toHaveText("Desenvolvedor Full Stack Pleno", { timeout: 20000 });
});

test("candidatura: marca, arrasta para Entrevista e oferece o convite da agenda", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#lista .vaga").first().getByRole("button", { name: "Já me candidatei" }).click();
  await page.locator("#abrir-painel").click();
  const col = (nome) => page.locator(".quadro-col").filter({ has: page.getByRole("heading", { name: new RegExp(`^${nome}`) }) });
  // pega o cartão pela borda: nos campos (etapa, anotações) o arrasto fica desligado de propósito
  await page.locator(".cand").first().dragTo(col("Entrevista"), { sourcePosition: { x: 6, y: 6 } });
  await expect(col("Entrevista").locator(".cand")).toHaveCount(1);
  await col("Entrevista").locator('input[type="datetime-local"]').fill("2030-05-10T14:30");
  await expect(page.getByRole("button", { name: "Baixar convite (.ics)" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar convite (.ics)" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ics$/);
});

test("Evoluir: mostra o que falta no CV e monta o plano de estudos", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#abrir-painel").click();
  await page.getByRole("tab", { name: "Evoluir" }).click();
  await expect(page.locator(".lacuna").first()).toContainText("Docker");
  await page.getByRole("button", { name: /montar meu plano/ }).click();
  await expect(page.locator(".plano-item")).toContainText("Suba sua API num container");
  await page.locator(".lacuna").first().getByRole("button", { name: "Já aprendi" }).click();
  await expect(page.locator(".aprendidas")).toContainText("Docker");
});

test("Preparar candidatura: pesquisa a empresa e o simulador faz pergunta de aprofundamento", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#lista .vaga").first().getByRole("button", { name: "Adaptar meu CV" }).click();
  const cv = page.locator("#cv");
  await expect(cv.locator("#cv-folha")).toBeVisible({ timeout: 20000 });
  await cv.getByRole("tab", { name: "Preparar candidatura" }).click();
  await cv.getByRole("button", { name: "Sobre a empresa" }).click();
  await cv.getByRole("button", { name: "Pesquisar a empresa" }).click();
  await expect(cv.getByText("Empresa de tecnologia.")).toBeVisible();

  await cv.getByRole("button", { name: "Simular entrevista" }).click();
  await cv.getByRole("button", { name: "Começar a simulação" }).click();
  await cv.locator(".sim-resposta").fill("Sou dev full stack há 3 anos.");
  await cv.getByRole("button", { name: /Responder e ir para a próxima/ }).click();
  await cv.locator(".sim-resposta").fill("Uso Express, separo rotas e serviços e valido a entrada com um schema.");
  await cv.getByRole("button", { name: /Responder e/ }).click();
  await expect(cv.getByText("Como você tratou os erros nessa API?")).toBeVisible();
  await expect(cv.locator(".sim-progresso")).toContainText("Pergunta 3 de 3");
});

test("abre leve: mostra 30 vagas por vez e não baixa o adaptador antes da hora", async ({ page }) => {
  const muitas = { ...VAGAS, vagas: Array.from({ length: 70 }, (_, i) => vaga(`m${i}`, { titulo: `Vaga ${i}` })) };
  await page.route(/\/vagas\.json(\?|$)/, (r) => r.fulfill({ json: muitas }));
  const html = await (await page.request.get("/index.html")).text();
  expect(html).not.toContain("cv.js");
  await page.goto("/index.html");
  await expect(page.locator("#lista .vaga")).toHaveCount(30);
  await page.locator(".mais-vagas").scrollIntoViewIfNeeded();
  await expect(page.locator("#lista .vaga")).toHaveCount(60);
  await page.locator(".mais-vagas").scrollIntoViewIfNeeded();
  await expect(page.locator("#lista .vaga")).toHaveCount(70);
  await expect(page.locator(".mais-vagas")).toHaveCount(0);
});

test("central de e-mail sem Gmail: cola o e-mail e a IA atualiza a candidatura", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#lista .vaga").first().getByRole("button", { name: "Já me candidatei" }).click();
  await page.locator("#abrir-painel").click();
  await page.getByRole("tab", { name: "E-mails das empresas" }).click();
  await page.getByLabel("E-mail recebido").fill("Olá! Gostaríamos de convidar você para uma entrevista no dia 10/05 às 14h30. Equipe Alfa.");
  await page.getByRole("button", { name: "IA: entender este e-mail" }).click();
  await page.getByRole("button", { name: "Mudar para Entrevista" }).click();
  await page.getByRole("tab", { name: /Candidaturas/ }).click();
  await expect(page.locator(".quadro-col.etapa-entrevista .cand")).toHaveCount(1);
  await expect(page.locator(".quadro-col.etapa-entrevista input[type='datetime-local']")).toHaveValue("2030-05-10T14:30");
});

test.describe("celular (360 px)", () => {
  test.use({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  const rolaParaOLado = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

  test("nada passa da largura da tela, o nome Radar de Vagas aparece e os filtros abrem", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#lista .vaga").first()).toBeVisible();
    await expect(page.locator(".marca-nome strong")).toHaveText("Radar de Vagas");
    expect(await rolaParaOLado(page)).toBe(false);
    await expect(page.locator("#f-nivel")).toBeHidden();
    await page.locator("#filtros-botao").click();
    await page.locator("#f-nivel").selectOption("Júnior");
    await expect(page.locator("#filtros-n")).toHaveText("1");
    await page.locator("#abrir-painel").click();
    expect(await rolaParaOLado(page)).toBe(false);
    await page.locator("#painel-fechar").click();
    await expect(page.locator("#painel")).toBeHidden();
    await page.locator(".conta-btn").click();
    await expect(page.getByRole("menuitem", { name: /Usar tema/ })).toBeVisible();
  });
});
