// Lógica pura do radar: classificar, filtrar e juntar vagas.
// Não faz nenhuma chamada de rede, então dá para testar com dados de exemplo.

const SEM_ACENTO = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function hojeISO(data = new Date()) {
  return data.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

export function diasEntre(isoA, isoB) {
  const a = new Date(String(isoA).slice(0, 10) + "T00:00:00Z");
  const b = new Date(String(isoB).slice(0, 10) + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

export function slug(texto) {
  return SEM_ACENTO(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
}

export function limparHtml(html) {
  return String(html || "")
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/* ---------- Classificação ---------- */

const RE_DEV = /\b(desenvolvedor|desenvolvedora|developer|dev|engineer|engenheir[oa]|programador|programadora|software|front|back|full)/;
const RE_FULL = /full[\s-]?stack|fullstack|full[\s-]?cycle/;
const RE_FRONT = /front[\s-]?end|frontend|\breact\b|angular|\bvue|next\.?js|\bui\b|web designer|wordpress|shopify|vtex/;
const RE_BACK = /back[\s-]?end|backend|\bjava\b|python|\bphp\b|laravel|\.net|\bc#|golang|\bgo\b|node\.?js|nestjs|ruby|rails|elixir|kotlin|spring|django|\bapi\b/;
const RE_NAO_DEV = /\b(qa|quality|tester|devops|sre|dados|data engineer|data scientist|cientista|analista de dados|designer|product manager|product owner|scrum|suporte|mobile|android|ios|flutter|react native|salesforce|sap|infra|seguran[cç]a|security|recrutador|vendas|sales|site reliability|machine learning|ml engineer|ai engineer|engineering manager|forward deployed|solutions engineer|infrastructure|data warehouse)\b/;

export function classificarArea(titulo, texto = "") {
  const t = SEM_ACENTO(titulo);
  const tudo = t + " " + SEM_ACENTO(texto).slice(0, 4000);
  if (!RE_DEV.test(t) && !RE_FRONT.test(t) && !RE_BACK.test(t) && !RE_FULL.test(t)) return null;
  if (RE_NAO_DEV.test(t) && !RE_FULL.test(t) && !/front|back/.test(t)) return null;
  if (RE_FULL.test(t)) return "Full-stack";
  const front = RE_FRONT.test(t), back = RE_BACK.test(t);
  if (front && back) return "Full-stack";
  if (front) return "Front-end";
  if (back) return "Back-end";
  // título genérico ("Desenvolvedor Pleno"): decide pelo texto
  const f = (tudo.match(new RegExp(RE_FRONT.source, "g")) || []).length;
  const b = (tudo.match(new RegExp(RE_BACK.source, "g")) || []).length;
  if (RE_FULL.test(tudo) || (f >= 2 && b >= 2)) return "Full-stack";
  if (f > b) return "Front-end";
  if (b > f) return "Back-end";
  return null;
}

export function classificarNivel(titulo, labels = [], texto = "") {
  const fonte = SEM_ACENTO([titulo, ...labels].join(" "));
  const achados = [];
  if (/estagi|intern\b|internship|trainee/.test(fonte)) achados.push("Estágio");
  if (/junior|\bjr\b|\bjr\.|entry/.test(fonte)) achados.push("Júnior");
  if (/pleno|\bpl\b|mid[\s-]?level|\bmid\b/.test(fonte)) achados.push("Pleno");
  if (/senior|\bsr\b|\bsr\./.test(fonte)) achados.push("Sênior");
  if (/especialista|staff|principal|lead\b|tech lead|lider/.test(fonte)) achados.push("Especialista");
  if (achados.length) return [...new Set(achados)].join("/");
  const t = SEM_ACENTO(texto).slice(0, 3000);
  if (/junior|\bjr\b/.test(t)) return "Júnior";
  if (/pleno/.test(t)) return "Pleno";
  if (/senior/.test(t)) return "Sênior";
  return "Não informado";
}

export function classificarRegime(titulo, labels = [], texto = "", tipoGupy = "") {
  const fonte = SEM_ACENTO([titulo, ...labels, tipoGupy].join(" ") + " " + String(texto).slice(0, 3000));
  const r = [];
  if (/\bclt\b|vacancy_type_effective|efetiv/.test(fonte)) r.push("CLT");
  if (/\bpj\b|pessoa juridica|vacancy_legal_entity|legal_entity/.test(fonte)) r.push("PJ");
  if (/freela|freelancer|vacancy_type_freelancer/.test(fonte)) r.push("Freela");
  if (!r.length) return "Não informado";
  if (r.includes("CLT") && r.includes("PJ")) return "CLT ou PJ";
  return r.join(" ou ");
}

export function classificarModelo(titulo, labels = [], texto = "", gupy = {}) {
  const fonte = SEM_ACENTO([titulo, ...labels].join(" "));
  const wt = SEM_ACENTO(gupy.workplaceType || "");
  if (/hibrid|hybrid/.test(fonte) || wt === "hybrid") return "Híbrido";
  if (/remot|remote|home ?office|anywhere/.test(fonte) || gupy.isRemoteWork === true || wt === "remote") return "Remoto";
  if (/presencial|on[\s-]?site|alocado/.test(fonte) || wt === "on-site") return "Presencial";
  const t = SEM_ACENTO(texto).slice(0, 3000);
  if (/100% remot|totalmente remot|trabalho remoto|home office/.test(t)) return "Remoto";
  if (/hibrid/.test(t)) return "Híbrido";
  return "Não informado";
}

export function extrairLocal(titulo, gupy = {}) {
  if (gupy.city || gupy.state) return [gupy.city, gupy.state].filter(Boolean).join(" - ");
  const m = String(titulo).match(/^\s*\[([^\]]+)\]/);
  if (m) return m[1].replace(/^\s*(remoto|remote|h[ií]brido|hibrido|presencial)\s*[\/\-!|]?\s*/i, "").trim() || m[1].trim();
  return "";
}

const TECNOLOGIAS = [
  ["React", /\breact(\.js|js)?\b(?! native)/i], ["Next.js", /next\.?js/i], ["Angular", /angular/i], ["Vue", /\bvue(\.js)?\b|nuxt/i],
  ["TypeScript", /typescript|\bts\b/i], ["JavaScript", /javascript|\bjs\b|es6/i], ["HTML/CSS", /\bhtml5?\b|\bcss3?\b/i],
  ["Tailwind", /tailwind/i], ["Node.js", /node\.?js|\bnode\b/i], ["NestJS", /nestjs|nest\.js/i], ["Express", /express(\.js)?\b/i],
  ["Java", /\bjava\b(?!script)/i], ["Spring", /spring/i], ["Python", /python/i], ["Django", /django/i], ["FastAPI", /fastapi/i],
  ["PHP", /\bphp\b/i], ["Laravel", /laravel/i], [".NET", /\.net\b|dotnet/i], ["C#", /c#/i], ["Go", /golang|\bgo\b(?=[ ,\/)]|$)/i],
  ["Ruby", /\bruby\b|rails/i], ["SQL", /\bsql\b|postgres|mysql|sql server|oracle/i], ["MongoDB", /mongo/i],
  ["Docker", /docker/i], ["AWS", /\baws\b/i], ["Git", /\bgit\b/i], ["APIs REST", /\brest(ful)?\b/i], ["GraphQL", /graphql/i],
  ["Testes", /jest|vitest|cypress|playwright|testing library|testes? (unit|automat)/i],
];

export function extrairStack(texto, limite = 8) {
  const t = String(texto || "");
  return TECNOLOGIAS.filter(([, re]) => re.test(t)).map(([nome]) => nome).slice(0, limite);
}

const RE_SECAO_REQ = /^(#+\s*|\*\*)?\s*(requisitos|requirements|obrigat[oó]rio|pr[eé]-?requisitos|qualifica[cç][oõ]es|o que (voc[eê] precisa|esperamos|buscamos)|habilidades|skills|diferenciais|desej[aá]vel|nice to have|must have|conhecimentos)/i;
const RE_SECAO_FIM = /^(#+\s*|\*\*)\s*(benef[ií]cios|como se candidatar|sal[aá]rio|contrata[cç][aã]o|labels|local|sobre|nossa empresa|etapas|processo|regime|n[ií]vel|aloca[cç][aã]o)/i;

export function extrairRequisitos(texto, limite = 8) {
  const linhas = String(texto || "").replace(/\r/g, "").split("\n").map((l) => l.trim());
  const out = [];
  let dentro = false;
  for (const l of linhas) {
    if (!l) continue;
    if (RE_SECAO_REQ.test(l)) { dentro = true; continue; }
    if (dentro && RE_SECAO_FIM.test(l)) { dentro = false; continue; }
    if (dentro && /^([-*•✅🔹▪]|\d+[.)])\s+/.test(l)) {
      const limpo = l.replace(/^([-*•✅🔹▪]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
      if (limpo.length >= 4 && limpo.length <= 220 && !out.includes(limpo)) out.push(limpo);
      if (out.length >= limite) break;
    }
  }
  return out;
}

/* ---------- Salário ---------- */

const RE_VALOR = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|mil)?`;
const RE_SALARIO = new RegExp(String.raw`(R\$|US\$|USD|\$)\s*${RE_VALOR}(?:\s*(?:a|at[eé]|-|–|~|to)\s*(?:R\$|US\$|USD|\$)?\s*${RE_VALOR})?`, "i");

function numero(txt, sufixo) {
  let n = String(txt);
  if (/^\d{1,3}([.,]\d{3})+$/.test(n)) n = n.replace(/[.,]/g, "");
  else n = n.replace(",", ".");
  let v = parseFloat(n);
  if (sufixo) v *= 1000;
  return v;
}
const fmtNumero = (v) => Math.round(v).toLocaleString("pt-BR");

// Acha a faixa salarial no texto do anúncio. Devolve "" quando não há valor plausível.
export function extrairSalario(texto) {
  const t = String(texto || "").slice(0, 6000);
  const linhas = t.split("\n").filter((l) => /sal[aá]rio|remunera|faixa|pretens|r\$|usd|us\$|bolsa|compensation|salary/i.test(l));
  for (const l of linhas) {
    if (/\bvale\b|aux[ií]lio|b[oô]nus|benef[ií]cio|reembolso|\bplr\b|gympass|wellhub/i.test(l)) continue; // valor de benefício, não salário
    const k = l.match(/(\d+)\s*k\s*(?:a|at[eé]|-|–)\s*(\d+)\s*k/i); // "8k a 10k", sem moeda
    if (k && !RE_SALARIO.test(l)) return `R$ ${fmtNumero(k[1] * 1000)} a ${fmtNumero(k[2] * 1000)}`;
    const m = l.match(RE_SALARIO);
    if (!m) continue;
    const moeda = /us|\$/i.test(m[1]) && m[1] !== "R$" ? "US$" : "R$";
    const a = numero(m[2], m[3]);
    const b = m[4] ? numero(m[4], m[5] || m[3]) : 0;
    const min = moeda === "R$" ? 1000 : 500;
    if (!(a >= min) || a > 100000 || (b && (b < a || b > 150000))) continue;
    return b ? `${moeda} ${fmtNumero(a)} a ${fmtNumero(b)}` : `${moeda} ${fmtNumero(a)}`;
  }
  return "";
}

/* ---------- Filtro e prioridade ---------- */

const RE_EXTERIOR = /argentina|m[eé]xico|chile|col[oô]mbia|peru|uruguai|portugal|espanha|europa|europe|\beua\b|\busa\b|estados unidos|united states|canad[aá]|reino unido|\buk\b|alemanha|germany|india/i;
const RE_NO_BRASIL = /brasil|brazil|s[aã]o paulo|rio de janeiro|curitiba|belo horizonte|porto alegre|bras[ií]lia|recife|fortaleza|salvador|florian[oó]polis|campinas|goi[aâ]nia|\b(sp|rj|mg|pr|sc|rs|df|ba|pe|ce|go)\b/i;

// Vaga só para quem mora fora do Brasil (ex.: "Cidade do México", "somente EUA/Canadá")
export function soNoExterior(v) {
  const local = String(v.local || "");
  return RE_EXTERIOR.test(local) && !RE_NO_BRASIL.test(local);
}

export function aceitaVaga(v, filtros) {
  if (!v.area || !filtros.areas.includes(v.area)) return false;
  if (soNoExterior(v)) return false;
  if (!filtros.aceitarEstagio && v.nivel === "Estágio") return false;
  if (v.modelo === "Remoto") return true;
  if (filtros.aceitarQualquerLocal) return true; // a pessoa filtra o lugar na página
  // Híbrido, presencial ou não informado: só se for no estado escolhido
  const local = SEM_ACENTO([v.local, v.titulo, v.textoLocal].join(" "));
  const uf = SEM_ACENTO(filtros.estadoPresencial);
  const noEstado = new RegExp(`\\b${uf}\\b|parana`).test(local) || filtros.cidadesPresencial.some((c) => local.includes(SEM_ACENTO(c)));
  return noEstado;
}

export function pontuar(v, pesos) {
  let p = 0;
  for (const [chave, peso] of Object.entries(pesos)) {
    if (chave === "Remoto" ? v.modelo === "Remoto"
      : chave === "Paraná" ? /parana|curitiba|\bpr\b/.test(SEM_ACENTO(v.local + " " + v.titulo))
      : chave === "PJ" ? v.regime.includes("PJ")
      : v.nivel.includes(chave)) p += peso;
  }
  return p;
}

/* ---------- Normalização por fonte ---------- */

export function extrairEmpresa(titulo) {
  const t = String(titulo).replace(/^\s*\[[^\]]+\]\s*/, "").trim();
  const padroes = [
    /\(([^()]{2,40})\)\s*$/,                              // ... (Strider)
    /\s(?:na|no|em|at)\s+(?:\[)?([^\[\]]{2,45}?)\]?\s*$/i, // ... na Yampi / na [B2W Digital]
    /\s@\s*([^@]{2,45})$/,                                 // ... @ Sylision
    /\s[-–|]\s+([^-–|]{2,45})$/,                           // ... - Rotha IA
  ];
  for (const re of padroes) {
    const m = t.match(re);
    if (m) {
      const nome = m[1].trim();
      if (!/^(remoto|remote|h[ií]brido|presencial|clt|pj|j[uú]nior|pleno|s[eê]nior|usd|brasil)$/i.test(nome)) return nome;
    }
  }
  return "";
}

export function deIssueGithub(issue, repo) {
  if (!issue || issue.pull_request || issue.state !== "open") return null;
  const titulo = String(issue.title || "").trim();
  if (/leia|regras|aten[cç][aã]o|template|como postar/i.test(titulo)) return null;
  const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
  const corpo = String(issue.body || "");
  const area = classificarArea(titulo, corpo);
  if (!area) return null;
  const empresa = extrairEmpresa(titulo);
  return {
    id: `gh-${repo.replace("/", "-")}-${issue.number}`,
    titulo: titulo.replace(/^\s*\[[^\]]+\]\s*/, "").trim() || titulo,
    empresa: empresa.trim(),
    area,
    nivel: classificarNivel(titulo, labels, corpo),
    regime: classificarRegime(titulo, labels, corpo),
    modelo: classificarModelo(titulo, labels, corpo),
    local: extrairLocal(titulo) || "Brasil",
    stack: extrairStack(titulo + "\n" + corpo),
    requisitos: extrairRequisitos(corpo),
    salario: extrairSalario(titulo + "\n" + corpo),
    link: issue.html_url,
    fonte: `GitHub · ${repo}`,
    publicadaEm: String(issue.created_at || "").slice(0, 10),
    textoLocal: labels.join(" "),
  };
}

export function deVagaGupy(job) {
  if (!job || !job.name || !(job.jobUrl || job.careerPageUrl)) return null;
  const titulo = String(job.name).trim();
  const descricao = limparHtml(job.description || "");
  const area = classificarArea(titulo, descricao);
  if (!area) return null;
  const tipo = String(job.type || "");
  if (/talent_pool|banco de talentos/i.test(tipo + " " + titulo)) return null;
  return {
    id: `gupy-${job.id}`,
    titulo,
    empresa: String(job.careerPageName || job.companyName || "").trim(),
    area,
    nivel: classificarNivel(titulo + (/internship|apprentice/.test(tipo) ? " estágio" : ""), [], descricao),
    regime: classificarRegime(titulo, [], descricao, tipo),
    modelo: classificarModelo(titulo, [], descricao, job),
    local: extrairLocal(titulo, job) || "Brasil",
    stack: extrairStack(titulo + "\n" + descricao),
    requisitos: extrairRequisitos(descricao),
    salario: extrairSalario(descricao),
    link: job.jobUrl || job.careerPageUrl,
    fonte: "Gupy",
    publicadaEm: String(job.publishedDate || "").slice(0, 10),
    prazo: job.applicationDeadline ? String(job.applicationDeadline).slice(0, 10) : "",
    textoLocal: [job.city, job.state].filter(Boolean).join(" "),
  };
}

const desescapar = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const RE_BRASIL = /brasil|brazil|s[aã]o paulo|rio de janeiro|curitiba|belo horizonte|porto alegre|florian[oó]polis|recife|campinas|remote.*(latam|brazil)|latam/i;

// Vagas de empresas que usam o Greenhouse (QuintoAndar, Stone, Inter...). Só fica o que é no Brasil.
export function deVagaGreenhouse(job, empresaPadrao = "") {
  if (!job || !job.title || !job.absolute_url) return null;
  const local = String(job.location?.name || "");
  if (!RE_BRASIL.test(local)) return null;
  const titulo = String(job.title).trim();
  // quadros de empresa grande têm de tudo (vendas, RH...): exige palavra de desenvolvimento no título
  if (!/develop|desenvolv|engineer|engenheir|programador|software|front|back|full/i.test(titulo)) return null;
  const descricao = limparHtml(desescapar(job.content));
  const area = classificarArea(titulo, descricao);
  if (!area) return null;
  if (/banco de talentos|talent pool/i.test(titulo)) return null;
  const nivelMeta = (job.metadata || []).find((m) => /level|n[ií]vel|senioridade/i.test(m.name))?.value || "";
  const remoto = /remot/i.test(local) || /100% remot|fully remote|remote[- ]first/i.test(descricao.slice(0, 3000));
  return {
    id: `gh-board-${job.id}`,
    titulo,
    empresa: String(job.company_name || empresaPadrao).replace(/\s+carreiras$/i, "").trim(),
    area,
    nivel: classificarNivel(titulo + " " + nivelMeta.replace(/mid-level/i, "pleno").replace(/entry/i, "júnior"), [], descricao),
    regime: classificarRegime(titulo, [], descricao),
    modelo: remoto ? "Remoto" : classificarModelo(titulo, [local], descricao),
    local: local.replace(/;/g, ",") || "Brasil",
    stack: extrairStack(titulo + "\n" + descricao),
    requisitos: extrairRequisitos(descricao),
    salario: extrairSalario(descricao),
    link: job.absolute_url,
    fonte: "Greenhouse",
    publicadaEm: String(job.first_published || job.updated_at || "").slice(0, 10),
    textoLocal: local,
  };
}

// Remotar: vagas 100% remotas para quem mora no Brasil. Só a categoria "Programação" interessa.
const MOEDA_REMOTAR = { BRL: "R$", USD: "US$" };
function salarioRemotar(s) {
  if (!s || !MOEDA_REMOTAR[s.currency] || !s.from) return "";
  const div = s.type === "yearly" ? 1200 : s.type === "monthly" ? 100 : 0; // valores vêm em centavos
  if (!div) return "";
  const a = s.from / div, b = s.to ? s.to / div : 0;
  const moeda = MOEDA_REMOTAR[s.currency];
  return b && b > a ? `${moeda} ${fmtNumero(a)} a ${fmtNumero(b)}` : `${moeda} ${fmtNumero(a)}`;
}

export function deVagaRemotar(job) {
  if (!job || !job.id || !job.title || job.active === false || job.expired) return null;
  if (!(job.jobCategories || []).some((c) => /programa/i.test(c.category?.name || ""))) return null;
  const titulo = String(job.title).trim();
  const descricao = limparHtml(job.description || "");
  const area = classificarArea(titulo, descricao);
  if (!area) return null;
  const tags = (job.jobTags || []).map((t) => String(t.tag?.name || "").replace(/^\W+/u, "").trim()).filter(Boolean);
  return {
    id: `remotar-${job.id}`,
    titulo: titulo.replace(/[\s\-–(]*remote\s*-\s*brazil\s*\)?\s*$/i, "").replace(/[\s\-–]+$/, "").trim(),
    empresa: String(job.companyDisplayName || job.company?.name || "").trim(),
    area,
    nivel: classificarNivel(titulo, tags, descricao),
    regime: classificarRegime(titulo + " " + (job.subtitle || ""), tags, descricao),
    modelo: "Remoto",
    local: "Remoto (Brasil)",
    stack: extrairStack(titulo + "\n" + descricao),
    requisitos: extrairRequisitos(descricao),
    salario: salarioRemotar(job.jobSalary) || extrairSalario(descricao),
    link: `https://remotar.com.br/job/${job.id}`,
    fonte: "Remotar",
    publicadaEm: String(job.createdAt || "").slice(0, 10),
    textoLocal: tags.join(" "),
  };
}

/* ---------- Junção com a rodada anterior ---------- */

const NIVEIS = { jr: "junior", junior: "junior", pl: "pleno", pleno: "pleno", sr: "senior", senior: "senior", mid: "pleno" };
const PALAVRAS_VAZIAS = new Set(["na", "no", "em", "at", "de", "da", "do", "para", "the", "a", "o", "e", "remoto", "remote", "vaga", "hibrido", "presencial", "pj", "clt", "usd"]);

// Chave de duplicata: empresa + palavras do cargo, sem o nome da empresa, sem o que está entre parênteses
// e sem a ordem das palavras. "Full Stack Developer Pleno - Rotha IA" e "Full Stack Developer (React) Pleno na Rotha IA" viram a mesma vaga.
export function chaveDuplicata(v) {
  const empresa = slug(v.empresa);
  let titulo = SEM_ACENTO(v.titulo).replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  for (const parte of empresa.split("-").filter((p) => p.length > 1)) titulo = titulo.replace(new RegExp(`\\b${parte}\\b`, "g"), " ");
  const palavras = titulo.replace(/full[\s-]?stack/g, "fullstack").replace(/front[\s-]?end/g, "frontend").replace(/back[\s-]?end/g, "backend")
    .split(/[^a-z0-9#.+]+/).map((p) => NIVEIS[p] || p).filter((p) => p && !PALAVRAS_VAZIAS.has(p));
  return empresa + "|" + [...new Set(palavras)].sort().join("-");
}

export function juntar({ encontradas, anteriores = [], hoje, config }) {
  const { filtros, prioridade, maxDiasPublicacao, diasParaApagarEncerradas, limiteVagas } = config;

  // 1. limpa, filtra e remove duplicadas da rodada atual
  const vistas = new Map();
  const idsNaFonte = new Set(encontradas.filter(Boolean).map((v) => v.id));
  for (const v of encontradas) {
    if (!v) continue;
    if (v.publicadaEm && diasEntre(v.publicadaEm, hoje) > maxDiasPublicacao) continue;
    if (v.prazo && v.prazo < hoje) continue;
    if (!aceitaVaga(v, filtros)) continue;
    const k = chaveDuplicata(v);
    const ja = vistas.get(k);
    // fica a versão mais completa: Gupy/Greenhouse antes de issue; depois a mais recente
    const peso = (x) => (x.fonte === "Gupy" || x.fonte === "Greenhouse" ? 2 : 0) + (x.salario ? 1 : 0);
    if (!ja || peso(v) > peso(ja) || (peso(v) === peso(ja) && String(v.publicadaEm) > String(ja.publicadaEm))) {
      vistas.set(k, { ...v, repeticoes: (ja?.repeticoes || 1) + (ja ? 1 : 0) });
    } else {
      ja.repeticoes = (ja.repeticoes || 1) + 1;
    }
  }

  // 2. aplica o limite pela prioridade
  const atuais = [...vistas.values()]
    .map((v) => ({ ...v, prioridade: pontuar(v, prioridade) }))
    .sort((a, b) => b.prioridade - a.prioridade || String(b.publicadaEm).localeCompare(String(a.publicadaEm)))
    .slice(0, limiteVagas);

  const porId = new Map(anteriores.map((v) => [v.id, v]));
  const idsAtuais = new Set(atuais.map((v) => v.id));
  const resultado = [];
  let novas = 0, encerradasHoje = 0;

  for (const v of atuais) {
    const ant = porId.get(v.id);
    const { textoLocal, ...limpa } = v;
    if (!ant) novas++;
    resultado.push({ ...limpa, encontradaEm: ant ? ant.encontradaEm : hoje, verificadaEm: hoje, status: "aberta" });
  }

  // 3. o que sumiu da fonte foi encerrado
  for (const ant of anteriores) {
    if (idsAtuais.has(ant.id)) continue;
    if (idsNaFonte.has(ant.id) && ant.status === "aberta") continue; // ainda existe: foi juntada com uma repetida ou cortada pelo limite
    if (ant.status === "aberta") {
      encerradasHoje++;
      resultado.push({ ...ant, status: "encerrada", encerradaEm: hoje });
    } else if (diasEntre(ant.encerradaEm || ant.verificadaEm, hoje) <= diasParaApagarEncerradas) {
      resultado.push(ant);
    }
  }

  return { vagas: resultado, novas, encerradas: encerradasHoje };
}

/* ---------- Alertas: a vaga combina com o que a pessoa procura? ---------- */

const NOME_PARA_UF = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF", "espirito santo": "ES",
  goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA", paraiba: "PB",
  parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  rondonia: "RO", roraima: "RR", "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
  curitiba: "PR", "belo horizonte": "MG", "porto alegre": "RS", brasilia: "DF", recife: "PE", fortaleza: "CE", salvador: "BA", florianopolis: "SC", goiania: "GO", campinas: "SP",
};
const UFS = new Set(Object.values(NOME_PARA_UF));

// Estados (UF) citados no texto de local da vaga: "Curitiba - Paraná", "Belo Horizonte, MG", "São Paulo/SP"...
export function ufsDoLocal(local) {
  const texto = String(local || "");
  const achados = new Set();
  for (const m of texto.matchAll(/\b([A-Z]{2})\b/g)) if (UFS.has(m[1])) achados.add(m[1]);
  const t = SEM_ACENTO(texto);
  for (const [nome, uf] of Object.entries(NOME_PARA_UF)) if (new RegExp(`\\b${nome}\\b`).test(t)) achados.add(uf);
  return achados;
}

// alerta = { area, nivel, regime, local: "todos" | "remoto" | "uf:PR" (remoto ou no PR), tecnologias: [] }
export function combinaComAlerta(v, a = {}) {
  if (v.status && v.status !== "aberta") return false;
  if (a.area && a.area !== "todos" && v.area !== a.area) return false;
  if (a.nivel && a.nivel !== "todos" && !String(v.nivel || "").includes(a.nivel)) return false;
  if (a.regime && a.regime !== "todos" && !String(v.regime || "").includes(a.regime)) return false;
  const local = a.local || "todos";
  if (local === "remoto" && v.modelo !== "Remoto") return false;
  if (local.startsWith("uf:") && v.modelo !== "Remoto" && !ufsDoLocal(v.local).has(local.slice(3))) return false;
  const tecs = (a.tecnologias || []).map(SEM_ACENTO).filter(Boolean);
  if (tecs.length) {
    const alvo = [SEM_ACENTO(v.titulo), ...(v.stack || []).map(SEM_ACENTO)];
    if (!tecs.some((t) => alvo.some((x) => x.includes(t)))) return false;
  }
  return true;
}

export function resumoMarkdown({ vagas, novas, encerradas, hoje }) {
  const doDia = vagas.filter((v) => v.status === "aberta" && v.encontradaEm === hoje);
  const abertas = vagas.filter((v) => v.status === "aberta").length;
  const linhas = [`# Radar de vagas · ${hoje.split("-").reverse().join("/")}`, "", `${novas} vagas novas · ${encerradas} encerradas · ${abertas} abertas no total`, ""];
  for (const area of ["Front-end", "Full-stack", "Back-end"]) {
    const lista = doDia.filter((v) => v.area === area);
    if (!lista.length) continue;
    linhas.push(`## ${area}`, "");
    for (const v of lista) linhas.push(`- **${v.titulo}**${v.empresa ? ` · ${v.empresa}` : ""} · ${v.nivel} · ${v.regime} · ${v.modelo}  \n  ${v.link}`);
    linhas.push("");
  }
  if (!doDia.length) linhas.push("Nenhuma vaga nova hoje.");
  return linhas.join("\n");
}

/* ---------- Retrato do mercado (docs/historico.json) ---------- */

// Valor mensal em reais do texto de salário ("R$ 5.000 a 7.000" -> 6000). Dólar fica de fora da mediana.
export function salarioMensalReais(salario) {
  const m = String(salario || "").match(/^R\$\s*([\d.]+)(?:\s*a\s*([\d.]+))?/);
  if (!m) return 0;
  const a = Number(m[1].replace(/\./g, "")), b = m[2] ? Number(m[2].replace(/\./g, "")) : a;
  return (a + b) / 2;
}

const mediana = (ns) => {
  if (!ns.length) return 0;
  const o = [...ns].sort((a, b) => a - b), meio = Math.floor(o.length / 2);
  return Math.round(o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2);
};
const contar = (itens) => itens.reduce((acc, k) => { if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, {});

// Um dia do mercado: quantas vagas, de quê, onde e quanto pagam
export function fotoDoMercado(abertas, hoje, novas = 0) {
  const salarios = {};
  for (const nivel of ["Estágio", "Júnior", "Pleno", "Sênior"]) {
    for (const regime of ["CLT", "PJ"]) {
      const valores = abertas.filter((v) => String(v.nivel).includes(nivel) && String(v.regime).includes(regime)).map((v) => salarioMensalReais(v.salario)).filter(Boolean);
      if (valores.length) salarios[`${nivel}|${regime}`] = { n: valores.length, mediana: mediana(valores), min: Math.min(...valores), max: Math.max(...valores) };
    }
  }
  return {
    data: hoje,
    abertas: abertas.length,
    novas,
    remotas: abertas.filter((v) => v.modelo === "Remoto").length,
    porArea: contar(abertas.map((v) => v.area)),
    porNivel: contar(abertas.map((v) => v.nivel)),
    porRegime: contar(abertas.map((v) => v.regime)),
    porFonte: contar(abertas.map((v) => String(v.fonte).split(" · ")[0])),
    tecnologias: contar(abertas.flatMap((v) => v.stack || [])),
    salarios,
  };
}
