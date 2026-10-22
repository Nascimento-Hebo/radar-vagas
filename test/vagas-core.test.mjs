import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classificarArea, classificarNivel, classificarRegime, classificarModelo, extrairEmpresa,
  extrairRequisitos, deIssueGithub, deVagaGupy, deVagaGreenhouse, juntar, aceitaVaga, extrairSalario, chaveDuplicata, soNoExterior, combinaComAlerta, ufsDoLocal, deVagaRemotar, fotoDoMercado, salarioMensalReais,
} from "../scripts/vagas-core.mjs";

const config = {
  maxDiasPublicacao: 45, diasParaApagarEncerradas: 14, limiteVagas: 120,
  filtros: { areas: ["Front-end", "Full-stack", "Back-end"], aceitarEstagio: false, estadoPresencial: "PR", cidadesPresencial: ["Curitiba", "Ponta Grossa"] },
  prioridade: { "Júnior": 3, PJ: 2, Remoto: 2, "Paraná": 2, "Sênior": -1 },
};

test("classifica a área pelo título", () => {
  assert.equal(classificarArea("[Remoto] Software Developer Front-end Pleno na Coodesh"), "Front-end");
  assert.equal(classificarArea("[Remoto] Full Stack Developer Júnior na Rotha IA"), "Full-stack");
  assert.equal(classificarArea("[Remoto] Back-end Engineer. Net (USD)"), "Back-end");
  assert.equal(classificarArea("Desenvolvedor Java Pleno"), "Back-end");
  assert.equal(classificarArea("Analista QA Pleno"), null);
  assert.equal(classificarArea("Product Designer Pleno"), null);
});

test("título genérico decide pelo texto", () => {
  assert.equal(classificarArea("Desenvolvedor Pleno", "Experiência com React, Next.js e TypeScript. Angular é diferencial."), "Front-end");
});

test("nível, regime e modelo", () => {
  assert.equal(classificarNivel("Full Stack Developer Júnior", ["PJ"]), "Júnior");
  assert.equal(classificarNivel("Software Developer Front-end", ["Pleno", "Sênior"]), "Pleno/Sênior");
  assert.equal(classificarRegime("x", ["PJ", "Remoto"]), "PJ");
  assert.equal(classificarRegime("x", [], "Regime de contratação CLT ou PJ"), "CLT ou PJ");
  assert.equal(classificarRegime("x", [], "", "vacancy_legal_entity"), "PJ");
  assert.equal(classificarModelo("[Remoto] Dev", []), "Remoto");
  assert.equal(classificarModelo("[Híbrido/Curitiba] Front-end Developer", []), "Híbrido");
  assert.equal(classificarModelo("Dev", [], "", { isRemoteWork: true }), "Remoto");
});

test("extrai o nome da empresa", () => {
  assert.equal(extrairEmpresa("[Remoto] Front-end Developer na Yampi"), "Yampi");
  assert.equal(extrairEmpresa("[Remoto] React Frontend Developer Sênior @ Sylision"), "Sylision");
  assert.equal(extrairEmpresa("[Remoto] Full-stack Engineer React.js • UX Design • Node.js(Strider)"), "Strider");
  assert.equal(extrairEmpresa("[Remoto] Full Stack Developer Pleno - Rotha IA"), "Rotha IA");
  assert.equal(extrairEmpresa("[Remoto] Front-End Developer Pleno na [B2W Digital]"), "B2W Digital");
});

test("extrai requisitos do texto do anúncio", () => {
  const corpo = "## Descrição\nTexto.\n## Requisitos:\n- Dominar VueJS;\n- Ensino Médio Completo.\n## Diferenciais:\n- Conhecimentos em UX.\n## Benefícios\n- Vale alimentação";
  assert.deepEqual(extrairRequisitos(corpo), ["Dominar VueJS;", "Ensino Médio Completo.", "Conhecimentos em UX."]);
});

test("normaliza issue do GitHub e ignora fechadas e avisos", () => {
  const issue = {
    number: 8569, state: "open", title: "[Remoto] Full Stack Developer Júnior na Rotha IA",
    html_url: "https://github.com/frontendbr/vagas/issues/8569", created_at: "2026-10-17T18:46:04Z",
    labels: [{ name: "Júnior" }, { name: "PJ" }, { name: "Remoto" }], body: "Stack: React, TypeScript e Supabase.",
  };
  const v = deIssueGithub(issue, "frontendbr/vagas");
  assert.equal(v.area, "Full-stack");
  assert.equal(v.nivel, "Júnior");
  assert.equal(v.regime, "PJ");
  assert.equal(v.modelo, "Remoto");
  assert.equal(v.empresa, "Rotha IA");
  assert.ok(v.stack.includes("React") && v.stack.includes("TypeScript"));
  assert.equal(deIssueGithub({ ...issue, state: "closed" }, "frontendbr/vagas"), null);
  assert.equal(deIssueGithub({ ...issue, title: "ATENÇÃO: Leia nossas regras" }, "frontendbr/vagas"), null);
  assert.equal(deIssueGithub({ ...issue, pull_request: {} }, "frontendbr/vagas"), null);
});

test("normaliza vaga da Gupy e ignora banco de talentos", () => {
  const job = { id: 1, name: "Desenvolvedor Front-end Júnior", careerPageName: "Empresa X", jobUrl: "https://x.gupy.io/job/1", isRemoteWork: true, type: "vacancy_type_effective", publishedDate: "2026-10-10T00:00:00Z", description: "<p>Requisitos</p><ul><li>React</li><li>Git</li></ul>" };
  const v = deVagaGupy(job);
  assert.equal(v.area, "Front-end");
  assert.equal(v.modelo, "Remoto");
  assert.equal(v.regime, "CLT");
  assert.equal(deVagaGupy({ ...job, type: "vacancy_type_talent_pool" }), null);
});

test("presencial fora do Paraná é descartado; remoto e Curitiba passam", () => {
  const base = { area: "Front-end", nivel: "Júnior", regime: "PJ", titulo: "Dev", local: "" };
  assert.equal(aceitaVaga({ ...base, modelo: "Remoto" }, config.filtros), true);
  assert.equal(aceitaVaga({ ...base, modelo: "Híbrido", local: "Curitiba" }, config.filtros), true);
  assert.equal(aceitaVaga({ ...base, modelo: "Presencial", local: "São Paulo - SP" }, config.filtros), false);
  assert.equal(aceitaVaga({ ...base, modelo: "Remoto", nivel: "Estágio" }, config.filtros), false);
});

test("junta com a rodada anterior: novas, mantidas e encerradas", () => {
  const hoje = "2026-10-22";
  const anteriores = [
    { id: "a", titulo: "A", empresa: "X", area: "Front-end", nivel: "Júnior", regime: "PJ", modelo: "Remoto", local: "Brasil", status: "aberta", encontradaEm: "2026-10-21", verificadaEm: "2026-10-21" },
    { id: "b", titulo: "B", empresa: "Y", area: "Back-end", nivel: "Pleno", regime: "CLT", modelo: "Remoto", local: "Brasil", status: "aberta", encontradaEm: "2026-10-20", verificadaEm: "2026-10-21" },
    { id: "velha", titulo: "V", empresa: "Z", area: "Back-end", nivel: "Pleno", regime: "CLT", modelo: "Remoto", local: "Brasil", status: "encerrada", encerradaEm: "2026-09-01", verificadaEm: "2026-09-01" },
  ];
  const encontradas = [
    { id: "a", titulo: "A", empresa: "X", area: "Front-end", nivel: "Júnior", regime: "PJ", modelo: "Remoto", local: "Brasil", publicadaEm: "2026-10-21" },
    { id: "c", titulo: "C", empresa: "W", area: "Full-stack", nivel: "Júnior", regime: "PJ", modelo: "Remoto", local: "Brasil", publicadaEm: "2026-10-22" },
    { id: "d", titulo: "D antiga", empresa: "Q", area: "Front-end", nivel: "Júnior", regime: "PJ", modelo: "Remoto", local: "Brasil", publicadaEm: "2026-07-01" },
  ];
  const r = juntar({ encontradas, anteriores, hoje, config });
  const porId = Object.fromEntries(r.vagas.map((v) => [v.id, v]));
  assert.equal(r.novas, 1);
  assert.equal(r.encerradas, 1);
  assert.equal(porId.a.encontradaEm, "2026-10-21");
  assert.equal(porId.a.verificadaEm, hoje);
  assert.equal(porId.b.status, "encerrada");
  assert.equal(porId.c.status, "aberta");
  assert.equal(porId.d, undefined, "vaga publicada há mais de 45 dias fica de fora");
  assert.equal(porId.velha, undefined, "encerrada há mais de 14 dias é apagada");
});

test("extrai a faixa salarial e ignora valor de benefício", () => {
  assert.equal(extrairSalario("Faixa salarial: R$ 5.000 a R$ 7.000"), "R$ 5.000 a 7.000");
  assert.equal(extrairSalario("Salário: R$ 4.500,00"), "R$ 4.500");
  assert.equal(extrairSalario("Remuneração: 8k a 10k (PJ)"), "R$ 8.000 a 10.000");
  assert.equal(extrairSalario("Salary: USD 3,000 - 4,500 per month"), "US$ 3.000 a 4.500");
  assert.equal(extrairSalario("R$ 1.500 de vale alimentação"), "");
  assert.equal(extrairSalario("Salário: a combinar"), "");
});

test("junta a mesma vaga escrita de jeitos diferentes, mas separa níveis", () => {
  const k = (titulo) => chaveDuplicata({ empresa: "Rotha IA", titulo });
  assert.equal(k("Full Stack Developer Pleno na Rotha IA"), k("Full Stack Developer Pleno - Rotha IA"));
  assert.equal(k("Full Stack Developer Pleno na Rotha IA"), k("Full Stack Developer (React) Pleno na Rotha IA"));
  assert.notEqual(k("Full Stack Developer Pleno na Rotha IA"), k("Full Stack Developer Júnior na Rotha IA"));
});

test("vaga juntada com uma repetida não conta como encerrada", () => {
  const hoje = "2026-10-22";
  const base = { empresa: "Rotha IA", area: "Full-stack", nivel: "Pleno", regime: "PJ", modelo: "Remoto", local: "Brasil", publicadaEm: "2026-10-20" };
  const anteriores = [
    { ...base, id: "a", titulo: "Full Stack Developer Pleno na Rotha IA", status: "aberta", encontradaEm: "2026-10-21", verificadaEm: "2026-10-21" },
    { ...base, id: "b", titulo: "Full Stack Developer Pleno - Rotha IA", status: "aberta", encontradaEm: "2026-10-21", verificadaEm: "2026-10-21" },
  ];
  const encontradas = [{ ...base, id: "a", titulo: anteriores[0].titulo }, { ...base, id: "b", titulo: anteriores[1].titulo }];
  const r = juntar({ encontradas, anteriores, hoje, config });
  assert.equal(r.vagas.length, 1);
  assert.equal(r.encerradas, 0);
  assert.equal(r.vagas[0].repeticoes, 2);
});

test("Greenhouse: só vagas de dev no Brasil", () => {
  const job = { id: 9, title: "Software Engineer Pleno (Backend Java)", absolute_url: "https://x/jobs/9", company_name: "Inter Carreiras", location: { name: "Remote - Brazil" }, first_published: "2026-10-20T10:00:00-03:00", content: "&lt;p&gt;Requisitos&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Java e Spring&lt;/li&gt;&lt;/ul&gt;" };
  const v = deVagaGreenhouse(job);
  assert.equal(v.area, "Back-end");
  assert.equal(v.modelo, "Remoto");
  assert.equal(v.empresa, "Inter");
  assert.equal(deVagaGreenhouse({ ...job, location: { name: "Barcelona" } }), null);
  assert.equal(deVagaGreenhouse({ ...job, title: "Executivo(a) Comercial Externo | Goiânia/GO" }), null);
});

test("vaga só para quem mora fora do Brasil fica de fora; com todo local aceito, presencial em SP passa", () => {
  assert.equal(soNoExterior({ local: "Cidade do México, México" }), true);
  assert.equal(soNoExterior({ local: "somente EUA/Canadá" }), true);
  assert.equal(soNoExterior({ local: "São Paulo ou Remoto, Brasil" }), false);
  const base = { area: "Back-end", nivel: "Pleno", regime: "CLT", titulo: "Dev" };
  const todos = { ...config.filtros, aceitarQualquerLocal: true };
  assert.equal(aceitaVaga({ ...base, modelo: "Presencial", local: "São Paulo - São Paulo" }, todos), true);
  assert.equal(aceitaVaga({ ...base, modelo: "Remoto", local: "Cidade do México, México" }, todos), false);
});

test("alerta: área, nível, local e tecnologias", () => {
  const v = { status: "aberta", titulo: "Dev Front-end Júnior", area: "Front-end", nivel: "Júnior", regime: "PJ", modelo: "Híbrido", local: "Curitiba - Paraná", stack: ["React", "TypeScript"] };
  assert.deepEqual([...ufsDoLocal("Belo Horizonte, MG, Curitiba, PR")].sort(), ["MG", "PR"]);
  assert.equal(combinaComAlerta(v, { area: "Front-end", nivel: "Júnior", local: "uf:PR", tecnologias: ["react"] }), true);
  assert.equal(combinaComAlerta(v, { local: "remoto" }), false, "híbrido não entra em só remoto");
  assert.equal(combinaComAlerta(v, { local: "uf:SP" }), false);
  assert.equal(combinaComAlerta({ ...v, modelo: "Remoto", local: "Brasil" }, { local: "uf:SP" }), true, "remota vale para qualquer estado");
  assert.equal(combinaComAlerta(v, { tecnologias: ["java"] }), false);
  assert.equal(combinaComAlerta({ ...v, status: "encerrada" }, {}), false);
});

test("Remotar: só programação, título sem o sufixo de remoto e salário em centavos", () => {
  const job = {
    id: 1, title: "Backend Engineer Consultant - (remote - Brazil)", subtitle: "PJ, USD", active: true, expired: false,
    description: "<p>Node.js, TypeScript e APIs REST</p>", createdAt: "2026-10-22T16:20:39.968-03:00",
    company: { name: "Inflect" }, jobSalary: { from: 500000, to: 650000, currency: "USD", type: "monthly" },
    jobCategories: [{ category: { name: "Programação" } }], jobTags: [{ tag: { name: "💬 Inglês" } }],
  };
  const v = deVagaRemotar(job);
  assert.equal(v.titulo, "Backend Engineer Consultant");
  assert.equal(v.area, "Back-end");
  assert.equal(v.modelo, "Remoto");
  assert.equal(v.salario, "US$ 5.000 a 6.500");
  assert.equal(v.link, "https://remotar.com.br/job/1");
  assert.equal(deVagaRemotar({ ...job, jobCategories: [{ category: { name: "Marketing" } }] }), null);
  assert.equal(deVagaRemotar({ ...job, title: "Senior Site Reliability Engineer" }), null, "SRE não é vaga de dev");
});

test("retrato do mercado: contagens e mediana de salário em reais", () => {
  assert.equal(salarioMensalReais("R$ 5.000 a 7.000"), 6000);
  assert.equal(salarioMensalReais("US$ 5.000"), 0);
  const vagas = [
    { area: "Back-end", nivel: "Júnior", regime: "PJ", modelo: "Remoto", fonte: "Remotar", stack: ["Node.js"], salario: "R$ 4.000" },
    { area: "Back-end", nivel: "Júnior", regime: "PJ", modelo: "Remoto", fonte: "GitHub · frontendbr/vagas", stack: ["Node.js", "SQL"], salario: "R$ 6.000 a 8.000" },
    { area: "Front-end", nivel: "Pleno", regime: "CLT", modelo: "Híbrido", fonte: "Gupy", stack: ["React"], salario: "" },
  ];
  const f = fotoDoMercado(vagas, "2026-10-22", 2);
  assert.equal(f.abertas, 3);
  assert.equal(f.remotas, 2);
  assert.deepEqual(f.porArea, { "Back-end": 2, "Front-end": 1 });
  assert.deepEqual(f.porFonte, { Remotar: 1, GitHub: 1, Gupy: 1 });
  assert.equal(f.tecnologias["Node.js"], 2);
  assert.deepEqual(f.salarios["Júnior|PJ"], { n: 2, mediana: 5500, min: 4000, max: 7000 });
});
