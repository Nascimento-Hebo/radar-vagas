// Busca vagas nas APIs, junta com a rodada anterior e grava docs/vagas.json.
// Uso: npm run buscar   (opcional: GITHUB_TOKEN=... para mais limite na API do GitHub)

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deIssueGithub, deVagaGupy, deVagaGreenhouse, hojeISO, juntar, resumoMarkdown } from "./vagas-core.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARQ_VAGAS = join(RAIZ, "docs", "vagas.json");
const ARQ_RESUMO = join(RAIZ, "docs", "novas.md");
const config = JSON.parse(await readFile(join(RAIZ, "config.json"), "utf8"));

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const falhasGerais = []; // fontes que não responderam: viram alerta no GitHub Actions

async function pegarJson(url, headers = {}, tentativas = 2) {
  for (let i = 0; i <= tentativas; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "radar-vagas", Accept: "application/json", ...headers }, signal: AbortSignal.timeout(20000) });
      if (res.status === 403 || res.status === 429) throw new Error(`limite de requisições (${res.status})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tentativas) throw e;
      await esperar(1500 * (i + 1));
    }
  }
}

async function buscarGithub() {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const vagas = [];
  for (const repo of config.github.repositorios) {
    let total = 0;
    try {
      for (let pagina = 1; pagina <= config.github.paginasPorRepositorio; pagina++) {
        const url = `https://api.github.com/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=100&page=${pagina}`;
        const issues = await pegarJson(url, headers);
        if (!Array.isArray(issues) || !issues.length) break;
        for (const issue of issues) { const v = deIssueGithub(issue, repo); if (v) { vagas.push(v); total++; } }
        if (issues.length < 100) break;
      }
      console.log(`  GitHub ${repo}: ${total} vagas de dev`);
    } catch (e) {
      console.warn(`  ! GitHub ${repo} falhou: ${e.message}`);
      falhasGerais.push(`GitHub ${repo}: ${e.message}`);
    }
  }
  return vagas;
}

async function buscarGupy() {
  if (!config.gupy.ativo) return [];
  const vagas = [];
  let falhas = 0;
  for (const termo of config.gupy.termos) {
    try {
      const url = `https://portal.gupy.io/api/job-search/jobs?jobName=${encodeURIComponent(termo)}&offset=0&limit=${config.gupy.limitePorTermo}`;
      const json = await pegarJson(url);
      const lista = Array.isArray(json?.data) ? json.data : [];
      let n = 0;
      for (const job of lista) { const v = deVagaGupy(job); if (v) { vagas.push(v); n++; } }
      console.log(`  Gupy "${termo}": ${n} vagas de dev`);
      await esperar(400);
    } catch (e) {
      falhas++;
      console.warn(`  ! Gupy "${termo}" falhou: ${e.message}`);
    }
  }
  if (falhas === config.gupy.termos.length) {
    console.warn("  ! A API da Gupy não respondeu. Ela não é oficial e pode ter mudado.");
    falhasGerais.push("Gupy: nenhuma busca respondeu (a API pode ter mudado)");
  }
  return vagas;
}

async function buscarGreenhouse() {
  if (!config.greenhouse?.ativo) return [];
  const vagas = [];
  for (const empresa of config.greenhouse.empresas) {
    try {
      const json = await pegarJson(`https://boards-api.greenhouse.io/v1/boards/${empresa}/jobs?content=true`);
      let n = 0;
      for (const job of json?.jobs || []) { const v = deVagaGreenhouse(job, empresa); if (v) { vagas.push(v); n++; } }
      console.log(`  Greenhouse ${empresa}: ${n} vagas de dev no Brasil`);
    } catch (e) {
      console.warn(`  ! Greenhouse ${empresa} falhou: ${e.message}`);
      falhasGerais.push(`Greenhouse ${empresa}: ${e.message}`);
    }
  }
  return vagas;
}

async function lerAnteriores() {
  try {
    const json = JSON.parse(await readFile(ARQ_VAGAS, "utf8"));
    return Array.isArray(json.vagas) ? json.vagas : [];
  } catch { return []; }
}

const hoje = hojeISO();
console.log(`Radar de vagas · ${hoje}`);
console.log("Buscando no GitHub…");
const github = await buscarGithub();
console.log("Buscando na Gupy…");
const gupy = await buscarGupy();
console.log("Buscando no Greenhouse…");
const greenhouse = await buscarGreenhouse();

const encontradas = [...github, ...gupy, ...greenhouse];
const anteriores = await lerAnteriores();

if (!encontradas.length && anteriores.length) {
  // Nenhuma fonte respondeu: não marca tudo como encerrado por engano
  console.error("Nenhuma fonte respondeu. Mantive o arquivo anterior sem mudanças.");
  process.exit(1);
}

const { vagas, novas, encerradas } = juntar({ encontradas, anteriores, hoje, config });
const abertas = vagas.filter((v) => v.status === "aberta");
const saida = {
  atualizadoEm: new Date().toISOString(),
  dataRodada: hoje,
  totais: {
    abertas: abertas.length,
    novas,
    encerradas,
    porArea: Object.fromEntries(config.filtros.areas.map((a) => [a, abertas.filter((v) => v.area === a).length])),
  },
  vagas,
};

await writeFile(ARQ_VAGAS, JSON.stringify(saida, null, 2) + "\n");
await writeFile(ARQ_RESUMO, resumoMarkdown({ vagas, novas, encerradas, hoje }) + "\n");

console.log(`\nPronto: ${abertas.length} abertas · ${novas} novas · ${encerradas} encerradas`);
console.log("Arquivos atualizados: docs/vagas.json e docs/novas.md");

// Informa ao GitHub Actions quantas vagas novas saíram (usado para decidir se manda e-mail)
if (process.env.GITHUB_OUTPUT) {
  const alerta = falhasGerais.join(" · ").replace(/[\r\n]/g, " ");
  await appendFile(process.env.GITHUB_OUTPUT, `novas=${novas}\nalerta=${alerta}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const resumo = [`### Radar de vagas · ${hoje}`, "", `${abertas.length} abertas · ${novas} novas · ${encerradas} encerradas`, ""];
  if (falhasGerais.length) resumo.push("**Fontes com problema:**", ...falhasGerais.map((f) => `- ${f}`));
  else resumo.push("Todas as fontes responderam.");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, resumo.join("\n") + "\n");
}
