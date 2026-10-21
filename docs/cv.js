// Adaptador de CV com a API do Gemini, direto do navegador.
// 1) o Gemini lê a vaga e devolve requisitos + perguntas que faltam responder;
// 2) a pessoa confere os dados (salvos no navegador) e o Gemini monta o CV para a vaga;
// 3) o CV vira PDF pela impressão do navegador.
// A chave do Gemini fica só no localStorage de quem usa; nunca vai para o repositório.

const GEMINI_MODELO = "gemini-flash-latest"; // apelido que o Google aponta sempre para o Flash mais novo
const GEMINI_URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const CHAVE_GEMINI = "radar-vagas:gemini-chave";
const CHAVE_PERFIL = "radar-vagas:perfil";
const MAX_PDF = 8 * 1024 * 1024;

const CAMPOS = [
  ["nome", "Nome completo", "text", "name"],
  ["email", "E-mail", "email", "email"],
  ["telefone", "Telefone / WhatsApp", "tel", "tel"],
  ["cidade", "Cidade", "text", "address-level2"],
  ["linkedin", "LinkedIn", "url", "url"],
  ["github", "GitHub ou portfólio", "url", "url"],
];

const analises = new Map(); // id da vaga -> resposta da etapa 1 (evita pagar duas vezes)
let cvVaga = null;
let cvAnalise = null;
let cvGerado = null;

// Guarda também em memória: se o navegador bloquear o localStorage, a chave vale pelo menos até fechar a aba.
let chaveMemoria = "";
function chaveGemini() { try { return localStorage.getItem(CHAVE_GEMINI) || chaveMemoria; } catch { return chaveMemoria; } }
// Mostra só o começo e o tamanho, para conferir se a chave certa foi colada sem expor ela
const mascarar = (k) => (k ? `${k.slice(0, 4)}… (${k.length} caracteres)` : "nenhuma");
function guardarChave(k) {
  chaveMemoria = k;
  try { localStorage.setItem(CHAVE_GEMINI, k); return localStorage.getItem(CHAVE_GEMINI) === k; } catch { return false; }
}
function perfil() { return ler(CHAVE_PERFIL, {}); }

// ---------- Gemini ----------

async function gemini(partes, { json = false, lerLinks = false } = {}) {
  const corpo = {
    contents: [{ role: "user", parts: partes }],
    generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: "application/json" } : {}) },
  };
  if (lerLinks) corpo.tools = [{ url_context: {} }];
  const r = await fetch(GEMINI_URL(GEMINI_MODELO), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": chaveGemini() },
    body: JSON.stringify(corpo),
  });
  const resp = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = resp.error?.message || `HTTP ${r.status}`;
    if ((r.status === 400 && /api key/i.test(msg)) || r.status === 401 || r.status === 403) {
      const motivo = (resp.error?.details || []).map((d) => d.reason).find(Boolean) || "";
      const e = new Error(motivo === "ACCESS_TOKEN_TYPE_UNSUPPORTED"
        ? "O Google ainda não aceita esta chave (erro ACCESS_TOKEN_TYPE_UNSUPPORTED). É um problema conhecido das chaves novas \"AQ.\" em algumas contas: crie uma chave nova no Google AI Studio, de preferência num projeto novo, e cole aqui."
        : `O Google recusou a chave do Gemini (${msg}${motivo ? `, código ${motivo}` : ""}). Confira se ela foi criada no Google AI Studio e está liberada para a Gemini API.`);
      e.message += ` Chave salva: ${mascarar(chaveGemini())}.`;
      e.chave = true;
      throw e;
    }
    if (r.status === 429) throw new Error("Limite gratuito do Gemini atingido. Espere um minuto e tente de novo.");
    throw new Error(`O Gemini respondeu com erro: ${msg}`);
  }
  const texto = (resp.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (!texto) throw new Error("O Gemini não devolveu resposta. Tente de novo.");
  return texto;
}

function lerJson(texto) {
  const limpo = texto.replace(/```(?:json)?/g, "");
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini < 0 || fim < ini) throw new Error("A resposta do Gemini veio fora do formato. Tente de novo.");
  return JSON.parse(limpo.slice(ini, fim + 1));
}

// Issues do GitHub dá para ler direto pela API; outros sites o Gemini lê pelo link (url_context).
async function textoDaVaga(v) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(v.link || "");
  if (!m) return "";
  try {
    const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/issues/${m[3]}`);
    if (!r.ok) return "";
    return String((await r.json()).body || "").slice(0, 12000);
  } catch { return ""; }
}

function partesDoCv(p) {
  const partes = [];
  if (p.cvPdf?.base64) partes.push({ inline_data: { mime_type: "application/pdf", data: p.cvPdf.base64 } });
  if (p.cvTexto?.trim()) partes.push({ text: `CV / experiência escrita pela pessoa:\n${p.cvTexto.trim()}` });
  return partes;
}

async function analisarVaga(v) {
  if (analises.has(v.id)) return analises.get(v.id);
  const descricao = await textoDaVaga(v);
  const p = perfil();
  const temCv = Boolean(p.cvPdf?.base64 || p.cvTexto?.trim());
  const pedido = `Você ajuda uma pessoa a adaptar o currículo para uma vaga de tecnologia no Brasil.
${descricao ? "A descrição completa da vaga está abaixo." : `Leia a vaga neste link: ${v.link}`}

Dados que já temos da vaga:
${textoParaAdaptador(v)}
${descricao ? `\nDescrição da vaga:\n${descricao}\n` : ""}
${temCv ? "O CV atual da pessoa vem em anexo. Use-o para NÃO perguntar o que já está nele." : "A pessoa ainda não mandou o CV."}

Responda só com JSON, em português, neste formato:
{
  "resumo": "1 ou 2 frases sobre a vaga",
  "obrigatorios": ["requisitos obrigatórios, curtos"],
  "desejaveis": ["diferenciais / desejáveis, curtos"],
  "palavrasChave": ["tecnologias e termos que um filtro de RH buscaria"],
  "perguntas": [{ "id": "p1", "pergunta": "pergunta curta e direta", "tipo": "texto" | "sim_nao" | "numero", "dica": "exemplo de resposta" }]
}
Regras para "perguntas": no máximo 5, só sobre o que essa vaga exige e que ${temCv ? "não aparece no CV" : "um CV precisaria mostrar"} (ex.: anos com uma tecnologia, um projeto com X, disponibilidade para o modelo de trabalho). Não pergunte nome, e-mail, telefone, cidade, LinkedIn nem GitHub.`;
  const partes = [{ text: pedido }, ...partesDoCv(p)];
  const json = lerJson(await gemini(partes, { lerLinks: !descricao }));
  const a = {
    resumo: String(json.resumo || ""),
    obrigatorios: lista(json.obrigatorios),
    desejaveis: lista(json.desejaveis),
    palavrasChave: lista(json.palavrasChave),
    perguntas: (Array.isArray(json.perguntas) ? json.perguntas : []).slice(0, 5)
      .filter((q) => q && q.pergunta)
      .map((q, i) => ({ id: String(q.id || `p${i + 1}`), pergunta: String(q.pergunta), tipo: String(q.tipo || "texto"), dica: String(q.dica || "") })),
  };
  analises.set(v.id, a);
  return a;
}

const lista = (x) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);

async function gerarCv(v, a, p, respostas) {
  const pedido = `Monte um currículo adaptado para esta vaga, em português do Brasil.

Vaga: ${v.titulo}${v.empresa ? ` na ${v.empresa}` : ""}
Resumo da vaga: ${a.resumo}
Obrigatórios: ${a.obrigatorios.join("; ")}
Desejáveis: ${a.desejaveis.join("; ")}
Palavras-chave: ${a.palavrasChave.join(", ")}

Pessoa: ${p.nome}${p.cidade ? `, ${p.cidade}` : ""}
Respostas da pessoa sobre a vaga:
${respostas.length ? respostas.map((r) => `- ${r.pergunta} → ${r.resposta}`).join("\n") : "(nenhuma)"}

O CV atual vem em anexo.

Regras:
- NUNCA invente empresas, cargos, datas, cursos, certificados, números ou tecnologias que a pessoa não citou no CV ou nas respostas.
- Pode reescrever, reordenar e cortar para destacar o que combina com a vaga, usando as palavras-chave da vaga quando forem verdade para a pessoa.
- Frases curtas, verbos de ação, cabe em uma página.
- Em "lacunas", liste requisitos obrigatórios que a pessoa não comprovou, para ela saber.

Responda só com JSON neste formato:
{
  "titulo": "título profissional alinhado à vaga",
  "resumo": "3 a 4 linhas",
  "habilidades": ["..."],
  "experiencias": [{ "cargo": "", "empresa": "", "periodo": "", "local": "", "itens": ["..."] }],
  "projetos": [{ "nome": "", "descricao": "", "itens": ["..."] }],
  "formacao": [{ "curso": "", "instituicao": "", "periodo": "" }],
  "certificacoes": ["..."],
  "idiomas": ["..."],
  "mudancas": [{ "secao": "Resumo | Habilidades | Experiência | Projetos | Formação | Outros", "tipo": "reescrito" | "adicionado" | "removido" | "reordenado", "antes": "trecho como estava no CV original (vazio se foi adicionado)", "depois": "trecho como ficou (vazio se foi removido)", "motivo": "por que mudou, ligado à vaga" }],
  "conferir": ["frases do CV novo que a pessoa precisa confirmar que são verdade (números, tempo de experiência, tecnologias que vieram das respostas)"],
  "lacunas": ["..."]
}
Em "mudancas", liste TODAS as alterações relevantes em relação ao CV original, uma por item, citando os trechos de verdade.`;
  return lerJson(await gemini([{ text: pedido }, ...partesDoCv(p)], { json: true }));
}

// ---------- Tela ----------

function abrirAdaptador(v) {
  cvVaga = v;
  cvAnalise = null;
  cvGerado = null;
  $("cv-vaga").textContent = v.titulo;
  $("cv-empresa").textContent = [v.empresa, v.local].filter(Boolean).join(" · ");
  const d = $("cv");
  if (!d.open) d.showModal();
  if (!chaveGemini()) telaChave();
  else etapaVaga();
}

function corpoCv() {
  const c = $("cv-corpo");
  c.textContent = "";
  c.scrollTop = 0;
  return c;
}

function botao(texto, cls, acao) {
  const b = el("button", cls, texto);
  b.type = "button";
  b.addEventListener("click", acao);
  return b;
}

function carregando(texto) {
  const c = corpoCv();
  const p = el("p", "cv-carregando");
  p.append(el("span", "cv-spin"), document.createTextNode(texto));
  c.append(p);
}

function falha(e, repetir) {
  const c = corpoCv();
  const box = el("div", "cv-erro");
  box.append(el("strong", null, "Não deu certo"), el("p", null, e.message || String(e)));
  const acoes = el("div", "grupo");
  acoes.append(botao("Tentar de novo", "btn primario", repetir));
  if (e.chave) acoes.append(botao("Trocar chave", "btn", telaChave)); // só oferece trocar quando o problema é a chave
  box.append(acoes);
  c.append(box);
}

function telaChave() {
  const c = corpoCv();
  const s = el("section", "cv-secao");
  s.append(el("h3", null, "Conectar ao Gemini"));
  const p = el("p", "cv-nota");
  p.append("O adaptador usa a API do Gemini com a sua chave. Ela é gratuita: entre no ",
    Object.assign(el("a", null, "Google AI Studio"), { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }),
    ", clique em \"Create API key\" e cole aqui. A chave fica salva só neste navegador.");
  s.append(p);
  const campo = el("label", "campo");
  const inp = el("input");
  inp.type = "password";
  inp.autocomplete = "off";
  inp.placeholder = "Cole aqui a chave criada no Google AI Studio";
  inp.value = chaveGemini();
  campo.append(el("span", null, "Chave da API do Gemini"), inp);
  s.append(campo);
  const acoes = el("div", "grupo");
  acoes.append(botao("Salvar e continuar", "btn primario", () => {
    const k = inp.value.trim().replace(/^["']|["']$/g, "");
    if (!k) { inp.focus(); return; }
    if (!guardarChave(k)) avisar("O navegador não deixou salvar a chave: ela vale só até fechar esta aba.");
    analises.clear();
    etapaVaga();
  }));
  if (chaveGemini()) acoes.append(botao("Apagar chave", "btn", () => {
    chaveMemoria = "";
    try { localStorage.removeItem(CHAVE_GEMINI); } catch {}
    inp.value = "";
    avisar("Chave apagada deste navegador.");
  }));
  s.append(acoes);
  c.append(s);
  inp.focus();
}

async function etapaVaga() {
  carregando("O Gemini está lendo a vaga…");
  try {
    cvAnalise = await analisarVaga(cvVaga);
  } catch (e) {
    falha(e, etapaVaga);
    return;
  }
  telaDados();
}

function listaReq(titulo, itens) {
  if (!itens.length) return null;
  const w = el("div");
  w.append(el("h4", null, titulo));
  const ul = el("ul");
  itens.forEach((t) => ul.append(el("li", null, t)));
  w.append(ul);
  return w;
}

function campoTexto(id, rotulo, tipo, auto, valor) {
  const l = el("label", "campo");
  const i = el("input");
  i.id = `cv-${id}`;
  i.type = tipo;
  i.autocomplete = auto;
  i.value = valor || "";
  l.append(el("span", null, rotulo), i);
  return l;
}

function telaDados() {
  const a = cvAnalise;
  const p = perfil();
  const c = corpoCv();

  // O que a vaga pede
  const sv = el("section", "cv-secao");
  sv.append(el("h3", null, "O que a vaga pede"));
  if (a.resumo) sv.append(el("p", "cv-nota", a.resumo));
  const cols = el("div", "cv-req");
  [listaReq("Obrigatório", a.obrigatorios), listaReq("Desejável", a.desejaveis)].forEach((n) => n && cols.append(n));
  sv.append(cols);
  if (a.palavrasChave.length) {
    const sk = el("div", "stack");
    a.palavrasChave.forEach((t) => sk.append(el("span", null, t)));
    sv.append(sk);
  }
  c.append(sv);

  // Dados pessoais
  const sd = el("section", "cv-secao");
  sd.append(el("h3", null, "Seus dados"));
  if (p.nome) sd.append(el("p", "cv-nota", "Preenchido com o que você usou da última vez. Confira e mude o que quiser."));
  const grade = el("div", "campos");
  for (const [id, rotulo, tipo, auto] of CAMPOS) {
    const campo = campoTexto(id, rotulo, tipo, auto, p[id]);
    if (id === "cidade") {
      const linha = el("div", "campo-linha");
      linha.append(campo.querySelector("input"), botao("Usar minha localização", "btn", usarLocalizacao));
      campo.append(linha);
    }
    grade.append(campo);
  }
  sd.append(grade);
  c.append(sd);

  // CV atual
  const sc = el("section", "cv-secao");
  sc.append(el("h3", null, "Seu CV atual"));
  sc.append(el("p", "cv-nota", "Envie o PDF ou cole o texto (pode ser só uma lista do que você já fez). Fica salvo para as próximas vagas."));
  const arq = el("div", "campo-linha");
  const inpPdf = el("input");
  inpPdf.type = "file";
  inpPdf.accept = "application/pdf";
  inpPdf.id = "cv-pdf";
  const nomePdf = el("span", "cv-nota", p.cvPdf?.nome ? `PDF salvo: ${p.cvPdf.nome}` : "Nenhum PDF");
  nomePdf.id = "cv-pdf-nome";
  arq.append(inpPdf, nomePdf);
  if (p.cvPdf?.nome) arq.append(botao("Remover PDF", "toggle", () => {
    salvar(CHAVE_PERFIL, { ...perfil(), cvPdf: null });
    nomePdf.textContent = "Nenhum PDF";
  }));
  sc.append(arq);
  const lt = el("label", "campo");
  const ta = el("textarea");
  ta.id = "cv-texto";
  ta.rows = 6;
  ta.value = p.cvTexto || "";
  ta.placeholder = "Ex.: Dev front-end na Empresa X (2023–hoje): React, TypeScript, testes com Jest…";
  lt.append(el("span", null, "Texto do CV ou experiência"), ta);
  sc.append(lt);
  c.append(sc);

  // Perguntas da vaga
  if (a.perguntas.length) {
    const sq = el("section", "cv-secao");
    sq.append(el("h3", null, "Perguntas sobre esta vaga"));
    sq.append(el("p", "cv-nota", "O Gemini pergunta só o que a vaga pede e o seu CV não mostra. Deixe em branco o que não se aplica."));
    a.perguntas.forEach((q) => {
      const l = el("label", "campo");
      l.append(el("span", null, q.pergunta));
      let inp;
      if (q.tipo === "sim_nao") {
        inp = el("select");
        ["", "Sim", "Não"].forEach((o) => inp.append(Object.assign(el("option", null, o || "—"), { value: o })));
      } else {
        inp = el("input");
        inp.type = q.tipo === "numero" ? "number" : "text";
        inp.placeholder = q.dica;
      }
      inp.dataset.pergunta = q.pergunta;
      inp.className = "cv-resposta";
      l.append(inp);
      sq.append(l);
    });
    c.append(sq);
  }

  const acoes = el("div", "cv-acoes");
  acoes.append(botao("Gerar CV para esta vaga", "btn primario", gerar), botao("Trocar chave do Gemini", "toggle", telaChave));
  c.append(acoes);
}

async function usarLocalizacao(ev) {
  const b = ev.currentTarget;
  if (!navigator.geolocation) { avisar("Este navegador não informa a localização."); return; }
  b.disabled = true;
  b.textContent = "Localizando…";
  try {
    const pos = await new Promise((ok, nao) => navigator.geolocation.getCurrentPosition(ok, nao, { timeout: 15000, maximumAge: 600000 }));
    const { latitude, longitude } = pos.coords;
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=pt-BR&lat=${latitude}&lon=${longitude}`);
    const end = (await r.json()).address || {};
    const cidade = end.city || end.town || end.village || end.municipality || "";
    const uf = String(end["ISO3166-2-lvl4"] || "").replace(/^BR-/, "") || end.state || "";
    if (!cidade) throw new Error("sem cidade");
    $("cv-cidade").value = [cidade, uf].filter(Boolean).join(" - ");
    avisar("Cidade preenchida. Pode editar se quiser.");
  } catch (e) {
    avisar(e?.code === 1 ? "Você não liberou a localização. Digite a cidade." : "Não consegui achar sua cidade. Digite manualmente.");
  } finally {
    b.disabled = false;
    b.textContent = "Usar minha localização";
  }
}

function lerArquivo(arquivo) {
  return new Promise((ok, nao) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1]);
    fr.onerror = () => nao(fr.error);
    fr.readAsDataURL(arquivo);
  });
}

async function gerar() {
  const p = { ...perfil() };
  for (const [id] of CAMPOS) p[id] = $(`cv-${id}`).value.trim();
  p.cvTexto = $("cv-texto").value;
  const arquivo = $("cv-pdf").files[0];
  if (arquivo) {
    if (arquivo.size > MAX_PDF) { avisar("PDF grande demais (máx. 8 MB)."); return; }
    p.cvPdf = { nome: arquivo.name, base64: await lerArquivo(arquivo) };
  }
  if (!p.nome) { avisar("Preencha seu nome."); $("cv-nome").focus(); return; }
  if (!p.cvPdf?.base64 && !p.cvTexto.trim()) { avisar("Envie seu CV em PDF ou escreva sua experiência."); $("cv-texto").focus(); return; }

  salvar(CHAVE_PERFIL, p);
  if (p.cvPdf && !perfil().cvPdf) {
    // PDF não coube no localStorage: guarda o resto e usa o PDF só agora
    salvar(CHAVE_PERFIL, { ...p, cvPdf: null });
    avisar("O PDF é grande para ficar salvo; nas próximas vagas envie de novo.");
  }
  const respostas = [...document.querySelectorAll(".cv-resposta")]
    .map((i) => ({ pergunta: i.dataset.pergunta, resposta: i.value.trim() }))
    .filter((r) => r.resposta);

  const rascunho = { respostas: respostas.map((r) => r.resposta) };
  carregando("O Gemini está montando o seu CV…");
  try {
    cvGerado = await gerarCv(cvVaga, cvAnalise, p, respostas);
  } catch (e) {
    falha(e, () => { telaDados(); restaurar(rascunho); });
    return;
  }
  telaResultado(p, rascunho);
}

function restaurar(rascunho) {
  document.querySelectorAll(".cv-resposta").forEach((i, n) => { if (rascunho.respostas[n]) i.value = rascunho.respostas[n]; });
}

function folhaCv(p, g) {
  const f = el("article", "folha");
  f.append(el("h1", null, p.nome));
  if (g.titulo) f.append(el("div", "folha-titulo", g.titulo));
  const contato = [p.cidade, p.email, p.telefone, p.linkedin, p.github].filter(Boolean);
  if (contato.length) f.append(el("div", "folha-contato", contato.join("  ·  ")));

  const secao = (titulo) => { const s = el("section"); s.append(el("h2", null, titulo)); f.append(s); return s; };
  const itens = (pai, arr) => { const l = lista(arr); if (!l.length) return; const ul = el("ul"); l.forEach((t) => ul.append(el("li", null, t))); pai.append(ul); };

  if (g.resumo) secao("Resumo").append(el("p", null, g.resumo));
  if (lista(g.habilidades).length) secao("Habilidades").append(el("p", null, lista(g.habilidades).join(" · ")));
  const exps = Array.isArray(g.experiencias) ? g.experiencias.filter((x) => x && (x.cargo || x.empresa)) : [];
  if (exps.length) {
    const s = secao("Experiência");
    exps.forEach((x) => {
      const cab = el("div", "folha-item");
      cab.append(el("strong", null, [x.cargo, x.empresa].filter(Boolean).join(" — ")), el("span", null, [x.periodo, x.local].filter(Boolean).join(" · ")));
      s.append(cab);
      itens(s, x.itens);
    });
  }
  const projs = Array.isArray(g.projetos) ? g.projetos.filter((x) => x && x.nome) : [];
  if (projs.length) {
    const s = secao("Projetos");
    projs.forEach((x) => {
      const cab = el("div", "folha-item");
      cab.append(el("strong", null, x.nome));
      s.append(cab);
      if (x.descricao) s.append(el("p", null, x.descricao));
      itens(s, x.itens);
    });
  }
  const form = Array.isArray(g.formacao) ? g.formacao.filter((x) => x && (x.curso || x.instituicao)) : [];
  if (form.length) {
    const s = secao("Formação");
    form.forEach((x) => {
      const cab = el("div", "folha-item");
      cab.append(el("strong", null, [x.curso, x.instituicao].filter(Boolean).join(" — ")), el("span", null, x.periodo || ""));
      s.append(cab);
    });
  }
  if (lista(g.certificacoes).length) itens(secao("Certificações"), g.certificacoes);
  if (lista(g.idiomas).length) secao("Idiomas").append(el("p", null, lista(g.idiomas).join(" · ")));
  return f;
}

function telaResultado(p, rascunho) {
  const g = cvGerado;
  const c = corpoCv();

  // Duas abas: primeiro o que a IA mudou, depois o CV final (editável) para baixar.
  const abas = el("div", "cv-abas");
  abas.setAttribute("role", "tablist");
  const abaRevisao = el("div", "cv-painel");
  const abaCv = el("div", "cv-painel");
  const botoesAba = [["1. O que a IA fez", abaRevisao], ["2. CV final", abaCv]].map(([texto, painel]) => {
    const b = botao(texto, "chip", () => mostrar(painel));
    b.setAttribute("role", "tab");
    abas.append(b);
    return [b, painel];
  });
  function mostrar(painel) {
    botoesAba.forEach(([b, p]) => { b.setAttribute("aria-pressed", String(p === painel)); b.setAttribute("aria-selected", String(p === painel)); p.hidden = p !== painel; });
    c.scrollTop = 0;
    $("cv").querySelector(".cv-interno").scrollIntoView({ block: "start" });
  }
  c.append(abas, abaRevisao, abaCv);

  // Aba 1: revisão
  const mudancas = (Array.isArray(g.mudancas) ? g.mudancas : []).filter((m) => m && (m.antes || m.depois));
  const resumo = el("p", "cv-nota");
  resumo.textContent = mudancas.length
    ? `A IA fez ${mudancas.length} ${mudancas.length === 1 ? "mudança" : "mudanças"} no seu CV para esta vaga. Confira cada uma antes de enviar.`
    : "A IA não detalhou as mudanças. Compare o CV final com o seu original antes de enviar.";
  abaRevisao.append(resumo);

  const conferir = lista(g.conferir);
  if (conferir.length) {
    const box = el("div", "cv-alerta");
    box.append(el("strong", null, "Confirme se isto é verdade"));
    const ul = el("ul");
    conferir.forEach((t) => ul.append(el("li", null, t)));
    box.append(ul);
    abaRevisao.append(box);
  }

  if (mudancas.length) {
    const ul = el("ul", "cv-mudancas");
    const rotuloTipo = { reescrito: "Reescrito", adicionado: "Adicionado", removido: "Removido", reordenado: "Reordenado" };
    mudancas.forEach((m) => {
      const li = el("li", "cv-mudanca");
      const cab = el("div", "cv-mudanca-cab");
      cab.append(el("span", `selo tipo-${m.tipo}`, rotuloTipo[m.tipo] || "Mudado"), el("span", "cv-secao-nome", m.secao || ""));
      li.append(cab);
      if (m.antes) { const d = el("div", "cv-antes"); d.append(el("b", null, "Antes"), el("span", null, m.antes)); li.append(d); }
      if (m.depois) { const d = el("div", "cv-depois"); d.append(el("b", null, "Depois"), el("span", null, m.depois)); li.append(d); }
      if (m.motivo) li.append(el("p", "cv-motivo", `Por quê: ${m.motivo}`));
      ul.append(li);
    });
    abaRevisao.append(ul);
  } else if (lista(g.ajustes).length) {
    abaRevisao.append(listaReq("O que foi ajustado", lista(g.ajustes)));
  }

  const la = listaReq("Requisitos que o CV não mostra", lista(g.lacunas));
  if (la) { la.classList.add("cv-lacunas"); abaRevisao.append(la); }

  const acoesRev = el("div", "cv-acoes");
  acoesRev.append(
    botao("Está certo, ver o CV final", "btn primario", () => mostrar(abaCv)),
    botao("Voltar e editar meus dados", "btn", () => { telaDados(); restaurar(rascunho); }),
  );
  abaRevisao.append(acoesRev);

  // Aba 2: CV final, editável
  abaCv.append(el("p", "cv-nota", "Clique em qualquer texto do CV para corrigir. O PDF sai do jeito que estiver aqui."));
  const folha = folhaCv(p, g);
  folha.id = "cv-folha";
  folha.contentEditable = "true";
  folha.spellcheck = true;
  const acoes = el("div", "cv-acoes");
  acoes.append(
    botao("Baixar PDF", "btn primario", () => imprimir(p)),
    botao("Copiar texto", "btn", async () => {
      try { await navigator.clipboard.writeText(folha.innerText); avisar("Texto do CV copiado."); }
      catch { avisar("Não consegui copiar."); }
    }),
    botao("Rever mudanças", "btn", () => mostrar(abaRevisao)),
  );
  abaCv.append(acoes, folha);

  mostrar(abaRevisao);
}

function imprimir(p) {
  const alvo = $("impressao");
  alvo.textContent = "";
  const copia = $("cv-folha").cloneNode(true);
  copia.removeAttribute("id");
  copia.removeAttribute("contenteditable");
  alvo.append(copia);
  const tituloAntes = document.title;
  document.title = ["CV", p.nome, cvVaga.empresa].filter(Boolean).join(" - "); // vira o nome do arquivo PDF
  document.body.classList.add("imprimindo");
  const fim = () => { document.body.classList.remove("imprimindo"); document.title = tituloAntes; alvo.textContent = ""; };
  window.addEventListener("afterprint", fim, { once: true });
  window.print();
}

$("cv-fechar").addEventListener("click", () => $("cv").close());
$("cv").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
