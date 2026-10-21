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
const RE_NAO_DEV = /\b(qa|quality|tester|devops|sre|dados|data engineer|data scientist|cientista|analista de dados|designer|product manager|product owner|scrum|suporte|mobile|android|ios|flutter|react native|salesforce|sap|infra|seguran[cç]a|security|recrutador|vendas|sales)\b/;

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

/* ---------- Filtro e prioridade ---------- */

export function aceitaVaga(v, filtros) {
  if (!v.area || !filtros.areas.includes(v.area)) return false;
  if (!filtros.aceitarEstagio && v.nivel === "Estágio") return false;
  if (v.modelo === "Remoto") return true;
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
    link: job.jobUrl || job.careerPageUrl,
    fonte: "Gupy",
    publicadaEm: String(job.publishedDate || "").slice(0, 10),
    prazo: job.applicationDeadline ? String(job.applicationDeadline).slice(0, 10) : "",
    textoLocal: [job.city, job.state].filter(Boolean).join(" "),
  };
}

/* ---------- Junção com a rodada anterior ---------- */

function chaveDuplicata(v) {
  return slug(v.empresa) + "|" + slug(v.titulo.replace(/\b(na|no|em|at|@)\b.*$/i, ""));
}

export function juntar({ encontradas, anteriores = [], hoje, config }) {
  const { filtros, prioridade, maxDiasPublicacao, diasParaApagarEncerradas, limiteVagas } = config;

  // 1. limpa, filtra e remove duplicadas da rodada atual
  const vistas = new Map();
  for (const v of encontradas) {
    if (!v) continue;
    if (v.publicadaEm && diasEntre(v.publicadaEm, hoje) > maxDiasPublicacao) continue;
    if (v.prazo && v.prazo < hoje) continue;
    if (!aceitaVaga(v, filtros)) continue;
    const k = chaveDuplicata(v);
    if (!vistas.has(k) || (vistas.get(k).fonte !== "Gupy" && v.fonte === "Gupy")) vistas.set(k, v);
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
    if (ant.status === "aberta") {
      encerradasHoje++;
      resultado.push({ ...ant, status: "encerrada", encerradaEm: hoje });
    } else if (diasEntre(ant.encerradaEm || ant.verificadaEm, hoje) <= diasParaApagarEncerradas) {
      resultado.push(ant);
    }
  }

  return { vagas: resultado, novas, encerradas: encerradasHoje };
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
