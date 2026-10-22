// Adaptador de CV com a API do Gemini, direto do navegador.
// 1) o Gemini lê a vaga e devolve requisitos + perguntas que faltam responder;
// 2) a pessoa confere os dados (salvos no navegador) e o Gemini monta o CV para a vaga;
// 3) o CV vira PDF pela impressão do navegador.
// A chave do Gemini fica só no localStorage de quem usa; nunca vai para o repositório.

// Tenta em ordem; se um modelo estiver sobrecarregado (503), sem cota (429) ou indisponível (404), passa para o próximo.
const GEMINI_MODELOS = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"];
let modeloBom = 0; // começa pelo último que funcionou
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
  let r, resp;
  for (let i = 0; i < GEMINI_MODELOS.length; i++) {
    const n = (modeloBom + i) % GEMINI_MODELOS.length;
    r = await fetch(GEMINI_URL(GEMINI_MODELOS[n]), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chaveGemini() },
      body: JSON.stringify(corpo),
    });
    resp = await r.json().catch(() => ({}));
    if (r.ok) { modeloBom = n; break; }
    if (![404, 429, 500, 503].includes(r.status)) break; // erro de chave ou de pedido: outro modelo não resolve
  }
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
    if (r.status === 429) throw new Error("Limite gratuito do Gemini atingido em todos os modelos. Espere um minuto e tente de novo.");
    if (r.status === 503) throw new Error("Todos os modelos do Gemini estão sobrecarregados agora. Espere um pouco e clique em \"Tentar de novo\".");
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
  if (v.descricao) return String(v.descricao).slice(0, 12000); // texto colado pela pessoa (vaga de outro site)
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
  "titulo": "título da vaga como está no anúncio",
  "empresa": "nome da empresa, se aparecer",
  "resumo": "1 ou 2 frases sobre a vaga",
  "obrigatorios": ["requisitos obrigatórios, curtos"],
  "desejaveis": ["diferenciais / desejáveis, curtos"],
  "palavrasChave": ["tecnologias e termos que um filtro de RH buscaria"],
  "perguntas": [{ "id": "p1", "pergunta": "pergunta curta e direta", "tipo": "texto" | "sim_nao" | "numero", "dica": "exemplo de resposta" }]
}
Regras para "perguntas": no máximo 5, só sobre o que essa vaga exige e que ${temCv ? "não aparece no CV" : "um CV precisaria mostrar"} (ex.: anos com uma tecnologia, um projeto com X, disponibilidade para o modelo de trabalho). Não pergunte nome, e-mail, telefone, cidade, LinkedIn nem GitHub.
Se você NÃO conseguir ler a vaga (página pede login, está vazia ou deu erro), NÃO invente: responda só {"erro": "nao_consegui_ler"}.`;
  const partes = [{ text: pedido }, ...partesDoCv(p)];
  const json = lerJson(await gemini(partes, { lerLinks: !descricao }));
  if (json.erro) {
    throw new Error("A IA não conseguiu ler essa página (alguns sites, como o LinkedIn, pedem login). Feche esta janela, abra \"A página pede login?\" abaixo da busca, cole o texto da vaga e tente de novo.");
  }
  const a = {
    titulo: String(json.titulo || ""),
    empresa: String(json.empresa || ""),
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
  "textoOriginal": "o texto completo do CV original, como está no anexo, em texto simples (para comparar antes e depois)",
  "modeloSugerido": "classico" | "moderno" | "executivo" | "compacto",
  "motivoModelo": "1 frase: por que esse visual combina com a vaga",
  "mudancas": [{ "secao": "Resumo | Habilidades | Experiência | Projetos | Formação | Outros", "tipo": "reescrito" | "adicionado" | "removido" | "reordenado", "antes": "trecho como estava no CV original (vazio se foi adicionado)", "depois": "trecho como ficou (vazio se foi removido)", "motivo": "por que mudou, ligado à vaga" }],
  "conferir": ["frases do CV novo que a pessoa precisa confirmar que são verdade (números, tempo de experiência, tecnologias que vieram das respostas)"],
  "lacunas": ["..."]
}
Em "mudancas", liste TODAS as alterações relevantes em relação ao CV original, uma por item, citando os trechos de verdade. O campo "depois" é OBRIGATÓRIO e deve trazer o texto novo exatamente como ficou no CV (só fica vazio quando o tipo é "removido").
Modelos: "classico" (uma coluna, tradicional), "moderno" (coluna lateral com contato e habilidades; bom para tech e startups), "executivo" (cabeçalho forte; bom para pleno/sênior e empresas grandes), "compacto" (denso, para muita experiência).`;
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
  // Campo de texto (não "password") para o navegador não preencher sozinho com uma senha salva
  inp.type = "text";
  inp.name = "gemini-api-key";
  inp.autocomplete = "off";
  inp.spellcheck = false;
  inp.setAttribute("data-1p-ignore", "");
  inp.setAttribute("data-lpignore", "true");
  inp.placeholder = "Cole aqui a chave criada no Google AI Studio";
  inp.value = "";
  campo.append(el("span", null, chaveGemini() ? `Chave da API do Gemini (salva agora: ${mascarar(chaveGemini())})` : "Chave da API do Gemini"), inp);
  s.append(campo);
  const acoes = el("div", "grupo");
  acoes.append(botao("Salvar e continuar", "btn primario", () => {
    const k = inp.value.trim().replace(/^["']|["']$/g, "");
    if (!k) { inp.focus(); return; }
    if (k.length < 30 || /\s/.test(k)) {
      avisar("Isso não parece uma chave do Gemini (ela tem uns 40 a 60 caracteres, sem espaços). Copie de novo no AI Studio.");
      inp.focus();
      return;
    }
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
  if (cvVaga.externa && cvAnalise.titulo) {
    cvVaga = { ...cvVaga, titulo: cvAnalise.titulo, empresa: cvAnalise.empresa };
    $("cv-vaga").textContent = cvVaga.titulo;
    $("cv-empresa").textContent = [cvVaga.empresa, cvVaga.local].filter(Boolean).join(" · ");
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

const MODELOS = [
  ["classico", "Clássico"],
  ["moderno", "Moderno"],
  ["executivo", "Executivo"],
  ["compacto", "Compacto"],
];

// Monta o CV em duas partes (lateral e principal). Cada modelo arruma essas partes de um jeito no CSS.
function folhaCv(p, g, modelo = "classico") {
  const f = el("article", `folha modelo-${modelo}`);
  const cab = el("header", "folha-cab");
  cab.append(el("h1", null, p.nome));
  if (g.titulo) cab.append(el("div", "folha-titulo", g.titulo));
  const contato = [p.cidade, p.email, p.telefone, p.linkedin, p.github].filter(Boolean);
  if (contato.length) {
    const ul = el("ul", "folha-contato");
    contato.forEach((c) => ul.append(el("li", null, c)));
    cab.append(ul);
  }
  f.append(cab);

  const corpo = el("div", "folha-corpo");
  const lateral = el("div", "folha-lateral");
  const principal = el("div", "folha-principal");
  corpo.append(lateral, principal);
  f.append(corpo);

  const secao = (pai, titulo, ordem) => { const s = el("section"); s.style.order = ordem; s.append(el("h2", null, titulo)); pai.append(s); return s; };
  const itens = (pai, arr) => { const l = lista(arr); if (!l.length) return; const ul = el("ul"); l.forEach((t) => ul.append(el("li", null, t))); pai.append(ul); };
  const tags = (pai, arr) => { const ul = el("ul", "folha-tags"); lista(arr).forEach((t) => ul.append(el("li", null, t))); pai.append(ul); };

  if (g.resumo) secao(principal, "Resumo", 1).append(el("p", null, g.resumo));
  if (lista(g.habilidades).length) tags(secao(lateral, "Habilidades", 2), g.habilidades);
  const exps = Array.isArray(g.experiencias) ? g.experiencias.filter((x) => x && (x.cargo || x.empresa)) : [];
  if (exps.length) {
    const s = secao(principal, "Experiência", 3);
    exps.forEach((x) => {
      const cab = el("div", "folha-item");
      cab.append(el("strong", null, [x.cargo, x.empresa].filter(Boolean).join(" — ")), el("span", null, [x.periodo, x.local].filter(Boolean).join(" · ")));
      s.append(cab);
      itens(s, x.itens);
    });
  }
  const projs = Array.isArray(g.projetos) ? g.projetos.filter((x) => x && x.nome) : [];
  if (projs.length) {
    const s = secao(principal, "Projetos", 4);
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
    const s = secao(principal, "Formação", 5);
    form.forEach((x) => {
      const cab = el("div", "folha-item");
      cab.append(el("strong", null, [x.curso, x.instituicao].filter(Boolean).join(" — ")), el("span", null, x.periodo || ""));
      s.append(cab);
    });
  }
  if (lista(g.certificacoes).length) itens(secao(lateral, "Certificações", 6), g.certificacoes);
  if (lista(g.idiomas).length) itens(secao(lateral, "Idiomas", 7), g.idiomas);
  return f;
}

// Palavras comuns não contam como novidade (senão quase toda frase fica verde).
const PALAVRAS_COMUNS = new Set("que por para com uma uns umas dos das nos nas pelo pela pelos pelas seu sua seus suas mais como entre sobre ate desde onde quando sem nao sim ser ter foi sao esta este esse essa isso aos ela ele tambem muito muitos muitas cada todo toda todos todas the and for with".split(" "));
const PALAVRA = /[\p{L}\p{N}+#]+(?:[.\-][\p{L}\p{N}+#]+)*/gu;

// Marca os trechos do CV novo com palavras que não existiam no CV original: é o que a IA colocou.
// Palavras novas vizinhas viram um destaque só, para a leitura ficar limpa.
function marcarNovidades(folha, original) {
  const conhecidas = new Set((semAcento(original).match(PALAVRA) || []));
  if (!conhecidas.size) return 0;
  const nova = (w) => {
    const n = semAcento(w);
    return n.length >= 3 && /\p{L}/u.test(n) && !PALAVRAS_COMUNS.has(n) && !conhecidas.has(n);
  };
  let marcadas = 0;
  const andar = document.createTreeWalker(folha.querySelector(".folha-corpo") || folha, NodeFilter.SHOW_TEXT);
  const nos = [];
  while (andar.nextNode()) nos.push(andar.currentNode);
  for (const no of nos) {
    if (no.parentElement.closest("h2")) continue;
    const texto = no.textContent;
    // trechos [início, fim) de palavras novas, unindo as que só têm espaço/pontuação/palavra comum entre si
    const trechos = [];
    for (const m of texto.matchAll(PALAVRA)) {
      if (!nova(m[0])) continue;
      const ini = m.index, fim = m.index + m[0].length;
      const ultimo = trechos[trechos.length - 1];
      const meio = ultimo ? texto.slice(ultimo[1], ini) : "";
      const soLigacao = ultimo && (meio.match(PALAVRA) || []).every((w) => PALAVRAS_COMUNS.has(semAcento(w)) || semAcento(w).length < 3);
      if (soLigacao && meio.length <= 12) ultimo[1] = fim;
      else trechos.push([ini, fim]);
    }
    if (!trechos.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [ini, fim] of trechos) {
      if (ini > pos) frag.append(texto.slice(pos, ini));
      frag.append(el("mark", "ia", texto.slice(ini, fim)));
      marcadas++;
      pos = fim;
    }
    if (pos < texto.length) frag.append(texto.slice(pos));
    no.replaceWith(frag);
  }
  return marcadas;
}

function telaResultado(p, rascunho) {
  const g = cvGerado;
  const c = corpoCv();
  const original = String(g.textoOriginal || p.cvTexto || "").trim();
  let modelo = MODELOS.some(([id]) => id === g.modeloSugerido) ? g.modeloSugerido : "classico";
  let destacar = true;

  // Três abas: o que mudou, antes e depois lado a lado, e o CV final (editável) para baixar.
  const abas = el("div", "cv-abas");
  abas.setAttribute("role", "tablist");
  const abaMudou = el("div", "cv-painel");
  const abaCompara = el("div", "cv-painel");
  const abaCv = el("div", "cv-painel");
  const botoesAba = [["1. O que a IA mudou", abaMudou], ["2. Antes e depois", abaCompara], ["3. CV final", abaCv]].map(([texto, painel]) => {
    const b = botao(texto, "chip", () => mostrar(painel));
    b.setAttribute("role", "tab");
    abas.append(b);
    return [b, painel];
  });
  function mostrar(painel) {
    botoesAba.forEach(([b, pn]) => { b.setAttribute("aria-pressed", String(pn === painel)); b.setAttribute("aria-selected", String(pn === painel)); pn.hidden = pn !== painel; });
    if (painel === abaCompara) montarComparacao();
    $("cv").querySelector(".cv-interno").scrollIntoView({ block: "start" });
  }
  c.append(abas, abaMudou, abaCompara, abaCv);

  // ---- Aba 1: o que mudou ----
  const mudancas = (Array.isArray(g.mudancas) ? g.mudancas : []).filter((m) => m && (m.antes || m.depois));
  abaMudou.append(el("p", "cv-nota", mudancas.length
    ? `A IA fez ${mudancas.length} ${mudancas.length === 1 ? "mudança" : "mudanças"} no seu CV para esta vaga. Em verde está o que ela colocou.`
    : "A IA não detalhou as mudanças. Veja a aba \"Antes e depois\" para comparar."));

  const conferir = lista(g.conferir);
  if (conferir.length) {
    const box = el("div", "cv-alerta");
    box.append(el("strong", null, "Confirme se isto é verdade"));
    const ul = el("ul");
    conferir.forEach((t) => ul.append(el("li", null, t)));
    box.append(ul);
    abaMudou.append(box);
  }

  if (mudancas.length) {
    const ul = el("ul", "cv-mudancas");
    const rotuloTipo = { reescrito: "Reescrito", adicionado: "Adicionado", removido: "Removido", reordenado: "Reordenado" };
    mudancas.forEach((m) => {
      const li = el("li", "cv-mudanca");
      const cab = el("div", "cv-mudanca-cab");
      cab.append(el("span", `selo tipo-${m.tipo}`, rotuloTipo[m.tipo] || "Mudado"), el("span", "cv-secao-nome", m.secao || ""));
      li.append(cab);
      if (m.depois) { const d = el("div", "cv-depois"); d.append(el("b", null, "Ficou"), el("span", null, m.depois)); li.append(d); }
      else if (m.tipo !== "removido") { const d = el("div", "cv-depois"); d.append(el("b", null, "Ficou"), el("span", "cv-vazio", "Veja na aba \"CV final\", destacado em verde.")); li.append(d); }
      if (m.antes) { const d = el("div", "cv-antes"); d.append(el("b", null, "Era"), el("span", null, m.antes)); li.append(d); }
      if (m.motivo) li.append(el("p", "cv-motivo", `Por quê: ${m.motivo}`));
      ul.append(li);
    });
    abaMudou.append(ul);
  }

  const la = listaReq("Requisitos que o CV não mostra", lista(g.lacunas));
  if (la) { la.classList.add("cv-lacunas"); abaMudou.append(la); }

  const acoesMudou = el("div", "cv-acoes");
  acoesMudou.append(
    botao("Ver antes e depois", "btn primario", () => mostrar(abaCompara)),
    botao("Ir para o CV final", "btn", () => mostrar(abaCv)),
    botao("Voltar e editar meus dados", "btn", () => { telaDados(); restaurar(rascunho); }),
  );
  abaMudou.append(acoesMudou);

  // ---- Aba 2: antes e depois lado a lado ----
  function montarComparacao() {
    abaCompara.textContent = "";
    abaCompara.append(el("p", "cv-nota", "À esquerda, seu CV como estava. À direita, o CV adaptado: o que está em verde foi a IA que colocou."));
    const grade = el("div", "cv-compara");
    const antes = el("div", "cv-coluna");
    antes.append(el("h4", null, "Seu CV original"));
    antes.append(original ? el("pre", "cv-original", original) : el("p", "cv-nota", "Seu CV veio em PDF e a IA não devolveu o texto dele. Compare pelas mudanças na aba 1."));
    const depois = el("div", "cv-coluna");
    depois.append(el("h4", null, "CV adaptado"));
    const copia = folhaCv(p, g, modelo);
    copia.classList.add("folha-mini");
    if (original) marcarNovidades(copia, original);
    depois.append(copia);
    grade.append(antes, depois);
    abaCompara.append(grade);
    const acoes = el("div", "cv-acoes");
    acoes.append(botao("Ir para o CV final", "btn primario", () => mostrar(abaCv)));
    abaCompara.append(acoes);
  }

  // ---- Aba 3: CV final com modelos, destaque e edição ----
  const opcoes = el("div", "cv-opcoes");
  const escolha = el("div", "cv-modelos");
  escolha.setAttribute("role", "group");
  escolha.setAttribute("aria-label", "Modelo do CV");
  escolha.append(el("span", "cv-opcoes-rotulo", "Modelo"));
  const botoesModelo = MODELOS.map(([id, nome]) => {
    const b = botao(nome + (id === g.modeloSugerido ? " ★" : ""), "chip", () => trocarModelo(id));
    if (id === g.modeloSugerido) b.title = g.motivoModelo ? `Sugerido pela IA: ${g.motivoModelo}` : "Sugerido pela IA";
    escolha.append(b);
    return [id, b];
  });
  const rotuloDestaque = el("label", "marcar");
  const chkDestaque = el("input");
  chkDestaque.type = "checkbox";
  chkDestaque.checked = destacar;
  chkDestaque.addEventListener("change", () => { destacar = chkDestaque.checked; folha.classList.toggle("sem-destaque", !destacar); });
  rotuloDestaque.append(chkDestaque, " Destacar o que a IA colocou");
  opcoes.append(escolha, rotuloDestaque);
  abaCv.append(opcoes);
  if (g.modeloSugerido && g.motivoModelo) abaCv.append(el("p", "cv-nota", `★ Modelo sugerido pela IA: ${g.motivoModelo}`));
  abaCv.append(el("p", "cv-nota", "Clique em qualquer texto do CV para corrigir. O destaque verde não sai no PDF."));

  let folha = null;
  const lugarFolha = el("div");
  function trocarModelo(id) {
    modelo = id;
    botoesModelo.forEach(([m, b]) => b.setAttribute("aria-pressed", String(m === id)));
    folha = folhaCv(p, g, modelo);
    folha.id = "cv-folha";
    folha.contentEditable = "true";
    folha.spellcheck = true;
    if (original) marcarNovidades(folha, original);
    folha.classList.toggle("sem-destaque", !destacar);
    lugarFolha.replaceChildren(folha);
  }
  trocarModelo(modelo);

  const acoes = el("div", "cv-acoes");
  acoes.append(
    botao("Baixar PDF", "btn primario", () => imprimir(p)),
    botao("Copiar texto", "btn", async () => {
      try { await navigator.clipboard.writeText(folha.innerText); avisar("Texto do CV copiado."); }
      catch { avisar("Não consegui copiar."); }
    }),
    botao("Rever mudanças", "btn", () => mostrar(abaMudou)),
  );
  abaCv.append(acoes, lugarFolha);

  mostrar(abaMudou);
}

function imprimir(p) {
  const alvo = $("impressao");
  alvo.textContent = "";
  const copia = $("cv-folha").cloneNode(true);
  copia.removeAttribute("id");
  copia.removeAttribute("contenteditable");
  copia.querySelectorAll("mark.ia").forEach((m) => m.replaceWith(m.textContent)); // destaque não vai para o PDF
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
