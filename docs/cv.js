// Adaptador de CV com o Gemini.
// 1) o Gemini lê a vaga e devolve requisitos + perguntas que faltam responder;
// 2) a pessoa confere os dados (salvos no navegador) e o Gemini monta o CV para a vaga;
// 3) o CV vira PDF pela impressão do navegador.
// A IA roda pelo Firebase AI Logic (window.radarNuvem.gerarIA): precisa da conta conectada e ninguém precisa de chave.

const CHAVE_PERFIL = "radar-vagas:perfil";
const MAX_PDF = 8 * 1024 * 1024;

const CAMPOS = [
  ["nome", "Nome completo", "text", "name"],
  ["email", "E-mail", "email", "email"],
  ["telefone", "Telefone / WhatsApp", "tel", "tel"],
  ["cidade", "Cidade - UF (ex.: Palmeira - PR)", "text", "address-level2"],
  ["linkedin", "LinkedIn", "url", "url"],
  ["github", "GitHub ou portfólio", "url", "url"],
];

const analises = new Map(); // id da vaga -> resposta da etapa 1 (evita pagar duas vezes)
let cvVaga = null;
let cvAnalise = null;
let cvGerado = null;
// CV aberto: rascunho até a pessoa salvar (ou baixar, copiar, imprimir). Só então entra em "Meus CVs".
// Carta, tradução, edições e simulação ficam junto dele.
let cvEntrada = null;
let cvSalvo = false;
const CHAVE_HISTORICO = "radar-vagas:cvs-gerados";
const MAX_HISTORICO = 15;

function perfil() { return ler(CHAVE_PERFIL, {}); }

// ---------- Gemini ----------

async function gemini(partes, { json = false, lerLinks = false } = {}) {
  if (!window.radarNuvem?.usuario) throw new Error("Entre na sua conta para usar a IA.");
  return window.radarNuvem.gerarIA(partes, { json, lerLinks });
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
  else if (!p.cvPdf?.base64 && p.cvExtraido?.trim()) partes.push({ text: `CV da pessoa (texto extraído do PDF dela):\n${p.cvExtraido.trim()}` });
  // Marcadas como aprendidas no plano de estudos (aba Evoluir): entram como estudo recente, não como experiência
  if (p.aprendidas?.length) partes.push({ text: `Tecnologias que a pessoa estudou recentemente (pode citar em Habilidades e em estudos/projetos pessoais, nunca como experiência profissional): ${p.aprendidas.join(", ")}` });
  return partes;
}

// A análise de uma vaga depende da vaga e do CV: fica guardada neste navegador por 14 dias (não gasta IA ao reabrir)
const CHAVE_ANALISES = "radar-vagas:analises";
const ANALISE_DIAS = 14, MAX_ANALISES = 40;
const chaveAnalise = (v, p) => `${v.id}|${hash(p.cvTexto || p.cvExtraido || p.cvPdf?.nome || "")}|${hash((p.aprendidas || []).join(","))}`;
function analiseGuardada(chave) {
  const x = ler(CHAVE_ANALISES, {})[chave];
  return x && Date.now() - x.em < ANALISE_DIAS * 86400000 ? x.a : null;
}
function guardarAnalise(chave, a) {
  const todas = Object.entries({ ...ler(CHAVE_ANALISES, {}), [chave]: { a, em: Date.now() } })
    .sort((x, y) => y[1].em - x[1].em).slice(0, MAX_ANALISES);
  try { localStorage.setItem(CHAVE_ANALISES, JSON.stringify(Object.fromEntries(todas))); } catch {}
}

async function analisarVaga(v) {
  if (analises.has(v.id)) return analises.get(v.id);
  const guardada = analiseGuardada(chaveAnalise(v, perfil()));
  if (guardada) { analises.set(v.id, guardada); return guardada; }
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
  guardarAnalise(chaveAnalise(v, p), a);
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
  "titulo": "título profissional com o nome do cargo como está na vaga (ex.: Desenvolvedor Full Stack Pleno) + as 2 ou 3 tecnologias principais que a pessoa realmente tem, separadas por ·. Não suba o nível além do que o CV mostra.",
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
  cvEntrada = null;
  cvSalvo = false;
  sim = null;
  $("cv-vaga").textContent = v.titulo;
  $("cv-empresa").textContent = [v.empresa, v.local].filter(Boolean).join(" · ");
  const d = $("cv");
  if (!d.open) d.showModal();
  etapaVaga();
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
  box.append(acoes);
  c.append(box);
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
  // Perfil completo: gera direto, sem passar pela tela de dados
  const p = perfil();
  if (perfilCompleto(p)) { await executarGeracao(p, [], { respostas: [] }); return; }
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
  acoes.append(botao("Gerar CV para esta vaga", "btn primario", gerar));
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

const perfilCompleto = (p) => Boolean(p.nome && (p.cvTexto?.trim() || p.cvPdf?.base64 || p.cvExtraido?.trim()));

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
  await executarGeracao(p, respostas, rascunho);
}

async function executarGeracao(p, respostas, rascunho) {
  carregando(respostas.length ? "A IA está montando o seu CV com as suas respostas…" : "A IA está montando o seu CV para esta vaga… (uns 20 segundos)");
  try {
    cvGerado = await gerarCv(cvVaga, cvAnalise, p, respostas);
  } catch (e) {
    falha(e, () => { telaDados(); restaurar(rascunho); });
    return;
  }
  if (cvGerado.textoOriginal && !p.cvTexto?.trim()) {
    salvar(CHAVE_PERFIL, { ...perfil(), cvExtraido: String(cvGerado.textoOriginal) });
  }
  if (typeof atualizarCompatibilidade === "function") atualizarCompatibilidade(); // em app.js
  criarRascunho(p);
  telaResultado(p, rascunho);
}

// Cada geração vira um rascunho, só em memória: gerar de novo para a mesma vaga troca o rascunho.
function criarRascunho(p) {
  const { cvPdf, ...perfilLeve } = p; // o PDF não vai para o histórico (pesa demais)
  cvEntrada = {
    id: `cv-${Date.now()}`,
    data: new Date().toISOString().slice(0, 10),
    vaga: { id: cvVaga.id, titulo: cvVaga.titulo, empresa: cvVaga.empresa || "", local: cvVaga.local || "", link: cvVaga.link, externa: Boolean(cvVaga.externa) },
    analise: cvAnalise,
    perfil: perfilLeve,
    cv: cvGerado,
    extras: {},
  };
  cvSalvo = false;
}

const cvSalvoDaVaga = (vagaId) => ler(CHAVE_HISTORICO, []).find((x) => x.vaga?.id === vagaId) || null;

// Salva o CV aberto em "Meus CVs": um por vaga (substitui o que já existia para a mesma vaga)
function salvarNoHistorico() {
  if (!cvEntrada) return;
  const outros = ler(CHAVE_HISTORICO, []).filter((x) => x.id !== cvEntrada.id && x.vaga?.id !== cvEntrada.vaga?.id);
  const lista = [cvEntrada, ...outros].slice(0, MAX_HISTORICO);
  salvar(CHAVE_HISTORICO, lista);
  if (!ler(CHAVE_HISTORICO, []).some((x) => x.id === cvEntrada.id)) {
    // localStorage cheio: guarda só os mais recentes
    salvar(CHAVE_HISTORICO, lista.slice(0, 5));
  }
  cvSalvo = true;
}

// Muda o CV aberto. Se já está salvo, grava na hora; se é rascunho, fica só aqui até salvar.
function atualizarHistorico(mudanca) {
  if (!cvEntrada) return;
  Object.assign(cvEntrada, mudanca(cvEntrada) || {});
  if (!cvSalvo) return;
  const lista = ler(CHAVE_HISTORICO, []);
  const i = lista.findIndex((x) => x.id === cvEntrada.id);
  if (i < 0) return;
  lista[i] = cvEntrada;
  salvar(CHAVE_HISTORICO, lista);
}

// Reabre um CV gerado antes (vem da "Minha área")
function abrirHistorico(h) {
  cvVaga = h.vaga;
  cvAnalise = h.analise;
  cvGerado = h.cv;
  cvEntrada = h;
  cvSalvo = true;
  sim = null;
  $("cv-vaga").textContent = h.vaga.titulo;
  $("cv-empresa").textContent = [h.vaga.empresa, h.vaga.local].filter(Boolean).join(" · ");
  const d = $("cv");
  if (!d.open) d.showModal();
  telaResultado({ ...perfil(), ...h.perfil }, { respostas: [] });
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

// ---------- Linha de contato do CV: cada item com ícone, texto limpo e link ----------

const icone = (paths) => `<svg class="folha-ic" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONES_CONTATO = {
  cidade: icone('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  email: icone('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
  telefone: icone('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>'),
  linkedin: icone('<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>'),
  github: icone('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.5-1-3.5.3-1.2.3-2.4 0-3.5 0 0-1 0-3 1.5a10.3 10.3 0 0 0-5.5 0C7.5 2 6.5 2 6.5 2c-.3 1.1-.3 2.3 0 3.5A5.4 5.4 0 0 0 5.5 9c0 3.5 3 5.5 6 5.5-.4.5-.7 1-.9 1.6-.2.6-.2 1.2-.1 1.9v4"/><path d="M9 18c-4.5 2-5-2-7-2"/>'),
  site: icone('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
};

// "+5549999088498" -> "+55 (49) 99908-8498"; números de outros países ficam como vieram
const telEstrangeiro = (tel) => /^\s*\+/.test(tel) && !/^\s*\+\s*55/.test(tel);
function formatarTelefone(tel) {
  if (telEstrangeiro(tel)) return String(tel).trim();
  const d = String(tel || "").replace(/\D/g, "");
  const br = d.length === 12 || d.length === 13 ? d.slice(2) : d.length === 10 || d.length === 11 ? d : "";
  if (!br || (d.length >= 12 && !d.startsWith("55"))) return String(tel).trim();
  const ddd = br.slice(0, 2), num = br.slice(2);
  return `+55 (${ddd}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`;
}

// "https://www.linkedin.com/in/fulano/" -> "linkedin.com/in/fulano"
const linkLimpo = (url) => String(url || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
const linkCompleto = (url) => (/^https?:\/\//i.test(url) ? url.trim() : `https://${linkLimpo(url)}`);

function itensDeContato(p) {
  const itens = [];
  if (p.cidade) itens.push({ tipo: "cidade", rotulo: "Cidade", texto: p.cidade.trim() });
  if (p.email) itens.push({ tipo: "email", rotulo: "E-mail", texto: p.email.trim(), link: `mailto:${p.email.trim()}` });
  if (p.telefone) {
    const d = p.telefone.replace(/\D/g, "");
    const zap = d.length >= 10 ? (telEstrangeiro(p.telefone) || d.length > 11 ? d : `55${d}`) : "";
    itens.push({ tipo: "telefone", rotulo: "Telefone / WhatsApp", texto: formatarTelefone(p.telefone), link: zap ? `https://wa.me/${zap}` : "" });
  }
  if (p.linkedin) itens.push({ tipo: "linkedin", rotulo: "LinkedIn", texto: linkLimpo(p.linkedin), link: linkCompleto(p.linkedin) });
  if (p.github) {
    const ehGithub = /github\.com/i.test(p.github);
    itens.push({ tipo: ehGithub ? "github" : "site", rotulo: ehGithub ? "GitHub" : "Portfólio", texto: linkLimpo(p.github), link: linkCompleto(p.github) });
  }
  return itens;
}

const TITULOS_SECAO = {
  pt: { resumo: "Resumo", habilidades: "Habilidades", experiencia: "Experiência", projetos: "Projetos", formacao: "Formação", certificacoes: "Certificações", idiomas: "Idiomas" },
  en: { resumo: "Summary", habilidades: "Skills", experiencia: "Experience", projetos: "Projects", formacao: "Education", certificacoes: "Certifications", idiomas: "Languages" },
};

// "Disponível: 100% remoto · PJ ou CLT", a partir de Minhas preferências
function linhaDisponibilidade(idioma = "pt") {
  const pr = (typeof prefs === "function" ? prefs() : {}) || {};
  if (!pr.local && !pr.regime) return "";
  const en = idioma === "en";
  const onde = pr.local === "remoto" ? (en ? "Remote" : "100% remoto")
    : pr.local?.startsWith("uf:") ? (en ? `Remote or on-site in ${pr.local.slice(3)}, Brazil` : `Remoto ou presencial em ${ESTADOS?.[pr.local.slice(3)] || pr.local.slice(3)}`)
    : (en ? "Remote, hybrid or on-site" : "Remoto, híbrido ou presencial");
  const regime = !pr.regime || pr.regime === "todos" ? (en ? "Contractor (PJ) or CLT" : "PJ ou CLT") : pr.regime === "PJ" ? (en ? "Contractor (PJ)" : "PJ") : "CLT";
  return `${en ? "Available" : "Disponível"}: ${onde} · ${regime}`;
}

// Monta o CV em duas partes (lateral e principal). Cada modelo arruma essas partes de um jeito no CSS.
function folhaCv(p, g, modelo = "classico", idioma = "pt") {
  const T = TITULOS_SECAO[idioma] || TITULOS_SECAO.pt;
  const f = el("article", `folha modelo-${modelo}`);
  const cab = el("header", "folha-cab");
  cab.append(el("h1", null, p.nome));
  if (g.titulo) cab.append(el("div", "folha-titulo", g.titulo));
  const disp = linhaDisponibilidade(idioma);
  if (disp) cab.append(el("div", "folha-disponivel", disp));
  const contato = itensDeContato(p);
  if (contato.length) {
    const ul = el("ul", "folha-contato");
    contato.forEach((c) => {
      const li = el("li");
      li.innerHTML = ICONES_CONTATO[c.tipo]; // SVG fixo do código
      const texto = c.link ? el("a", null, c.texto) : el("span", null, c.texto);
      if (c.link) texto.href = c.link;
      li.title = c.rotulo;
      li.dataset.tipo = c.tipo;
      li.append(el("span", "sr", `${c.rotulo}: `), texto);
      ul.append(li);
    });
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

  if (g.resumo) secao(principal, T.resumo, 1).append(el("p", null, g.resumo));
  if (lista(g.habilidades).length) tags(secao(lateral, T.habilidades, 2), g.habilidades);
  const exps = Array.isArray(g.experiencias) ? g.experiencias.filter((x) => x && (x.cargo || x.empresa)) : [];
  if (exps.length) {
    const s = secao(principal, T.experiencia, 3);
    exps.forEach((x) => {
      const cab = el("div", "folha-item");
      cab.append(el("strong", null, [x.cargo, x.empresa].filter(Boolean).join(" — ")), el("span", null, [x.periodo, x.local].filter(Boolean).join(" · ")));
      s.append(cab);
      itens(s, x.itens);
    });
  }
  const projs = Array.isArray(g.projetos) ? g.projetos.filter((x) => x && x.nome) : [];
  if (projs.length) {
    const s = secao(principal, T.projetos, 4);
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
    const s = secao(principal, T.formacao, 5);
    form.forEach((x) => {
      const cab = el("div", "folha-item");
      cab.append(el("strong", null, [x.curso, x.instituicao].filter(Boolean).join(" — ")), el("span", null, x.periodo || ""));
      s.append(cab);
    });
  }
  if (lista(g.certificacoes).length) itens(secao(lateral, T.certificacoes, 6), g.certificacoes);
  if (lista(g.idiomas).length) itens(secao(lateral, T.idiomas, 7), g.idiomas);
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

const CHAVE_MODELO_CV = "radar-vagas:modelo-cv";

function telaResultado(p, rascunho) {
  const c = corpoCv();
  const textos = { pt: cvGerado, en: cvEntrada?.extras?.en || null };
  const original = String(cvGerado.textoOriginal || p.cvTexto || p.cvExtraido || "").trim();
  const preferido = ler(CHAVE_MODELO_CV, "");
  let modelo = MODELOS.some(([id]) => id === preferido) ? preferido : MODELOS.some(([id]) => id === cvGerado.modeloSugerido) ? cvGerado.modeloSugerido : "classico";
  let idioma = "pt";
  let destacar = true;
  let folha = null;

  // Adaptou direto (sem responder perguntas): oferece responder para melhorar
  const perguntas = cvAnalise?.perguntas || [];
  if (!rascunho.respostas.length && perguntas.length) {
    const a = el("div", "aviso azul");
    a.innerHTML = svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');
    a.append(el("span", null, `A IA tem ${perguntas.length} ${perguntas.length === 1 ? "pergunta sobre esta vaga que pode" : "perguntas sobre esta vaga que podem"} deixar seu CV mais forte.`));
    a.append(botao("Responder", "btn pequeno", () => telaDados()));
    c.append(a);
  }

  // ---- Abas principais: Revisar · CV · Preparar ----
  const abas = el("div", "cv-abas");
  abas.setAttribute("role", "tablist");
  const abaRevisar = el("div", "cv-painel");
  const abaCv = el("div", "cv-painel");
  const abaPreparar = el("div", "cv-painel");
  const botoesAba = [["Revisar o que a IA fez", abaRevisar], ["Meu CV", abaCv], ["Preparar candidatura", abaPreparar]].map(([texto, painel]) => {
    const b = botao(texto, "chip", () => mostrar(painel));
    b.setAttribute("role", "tab");
    abas.append(b);
    return [b, painel];
  });
  function mostrar(painel) {
    botoesAba.forEach(([b, pn]) => { b.setAttribute("aria-pressed", String(pn === painel)); b.setAttribute("aria-selected", String(pn === painel)); pn.hidden = pn !== painel; });
    if (painel === abaRevisar && !abaRevisar.childElementCount) montarRevisar();
    if (painel === abaPreparar && !abaPreparar.childElementCount) montarPreparar();
    if (painel === abaCv) setTimeout(renderQualidade, 50);
    $("cv").querySelector(".cv-interno").scrollIntoView({ block: "start" });
  }
  c.append(abas, abaRevisar, abaCv, abaPreparar);

  // Sub-abas (dentro de Revisar e Preparar)
  function subAbas(box, itens) {
    const barra = el("div", "cv-subabas");
    const area = el("div", "cv-subpainel");
    const botoes = itens.map(([nome, montar]) => {
      const b = botao(nome, "subaba", () => { botoes.forEach((x) => x.setAttribute("aria-pressed", String(x === b))); area.textContent = ""; montar(area); });
      barra.append(b);
      return b;
    });
    box.append(barra, area);
    botoes[0].click();
  }

  // ---- Revisar: o que mudou + antes e depois ----
  function montarRevisar() {
    subAbas(abaRevisar, [["O que mudou", montarMudancas], ["Antes e depois", montarComparacao]]);
  }
  function montarMudancas(box) {
    const g = cvGerado;
    const mudancas = (Array.isArray(g.mudancas) ? g.mudancas : []).filter((m) => m && (m.antes || m.depois));
    box.append(el("p", "cv-nota", mudancas.length ? `A IA fez ${mudancas.length} ${mudancas.length === 1 ? "mudança" : "mudanças"} no seu CV para esta vaga.` : "A IA não detalhou as mudanças. Veja \"Antes e depois\"."));
    const conferir = lista(g.conferir);
    if (conferir.length) {
      const box2 = el("div", "cv-alerta");
      box2.append(el("strong", null, "Confirme se isto é verdade"));
      const ul = el("ul");
      conferir.forEach((t) => ul.append(el("li", null, t)));
      box2.append(ul);
      box.append(box2);
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
        if (m.antes) { const d = el("div", "cv-antes"); d.append(el("b", null, "Era"), el("span", null, m.antes)); li.append(d); }
        if (m.motivo) li.append(el("p", "cv-motivo", `Por quê: ${m.motivo}`));
        ul.append(li);
      });
      box.append(ul);
    }
    const la = listaReq("Requisitos que o CV não mostra", lista(g.lacunas));
    if (la) { la.classList.add("cv-lacunas"); box.append(la); }
    const acoes = el("div", "cv-acoes");
    acoes.append(botao("Está certo, ver meu CV", "btn primario", () => mostrar(abaCv)), botao("Mudar meus dados", "btn", () => { telaDados(); restaurar(rascunho); }));
    box.append(acoes);
  }
  function montarComparacao(box) {
    box.append(el("p", "cv-nota", "À esquerda, seu CV como estava. À direita, o adaptado: em verde, o que a IA colocou."));
    const grade = el("div", "cv-compara");
    const antes = el("div", "cv-coluna");
    antes.append(el("h4", null, "Seu CV original"), original ? el("pre", "cv-original", original) : el("p", "cv-nota", "A IA não devolveu o texto do seu PDF. Compare pelas mudanças."));
    const depois = el("div", "cv-coluna");
    depois.append(el("h4", null, "CV adaptado"));
    const copia = folhaCv(p, cvGerado, modelo);
    copia.classList.add("folha-mini");
    if (original) marcarNovidades(copia, original);
    depois.append(copia);
    grade.append(antes, depois);
    box.append(grade);
  }

  // ---- Preparar: carta e mensagens, perguntas da entrevista, simulação ----
  function montarPreparar() {
    subAbas(abaPreparar, [
      ["Carta e mensagens", (box) => montarExtra(box, "carta", p)],
      ["Sobre a empresa", (box) => montarExtra(box, "empresa", p)],
      ["Perguntas da entrevista", (box) => montarExtra(box, "entrevista", p)],
      ["Simular entrevista", (box) => montarSimulador(box, p)],
    ]);
  }

  // ---- Meu CV ----
  const barra = el("div", "cv-opcoes");
  const escolha = el("div", "cv-modelos");
  escolha.setAttribute("role", "group");
  escolha.setAttribute("aria-label", "Modelo do CV");
  escolha.append(el("span", "cv-opcoes-rotulo", "Modelo"));
  const botoesModelo = MODELOS.map(([id, nome]) => {
    const b = botao(nome + (id === cvGerado.modeloSugerido ? " ★" : ""), "chip", () => { salvar(CHAVE_MODELO_CV, id); modelo = id; montarFolha(); });
    if (id === cvGerado.modeloSugerido) b.title = cvGerado.motivoModelo ? `Sugerido pela IA: ${cvGerado.motivoModelo}` : "Sugerido pela IA";
    escolha.append(b);
    return [id, b];
  });
  const lingua = el("div", "cv-modelos");
  lingua.setAttribute("role", "group");
  lingua.setAttribute("aria-label", "Idioma do CV");
  lingua.append(el("span", "cv-opcoes-rotulo", "Idioma"));
  const botoesIdioma = [["pt", "Português"], ["en", "English"]].map(([id, nome]) => {
    const b = botao(nome, "chip", () => trocarIdioma(id));
    lingua.append(b);
    return [id, b];
  });
  const rotuloDestaque = el("label", "marcar");
  const chk = el("input");
  chk.type = "checkbox";
  chk.checked = destacar;
  chk.addEventListener("change", () => { destacar = chk.checked; folha?.classList.toggle("sem-destaque", !destacar); });
  rotuloDestaque.append(chk, " Destacar o que a IA colocou");
  barra.append(escolha, lingua, rotuloDestaque);

  const qualidade = el("section", "qualidade");
  qualidade.setAttribute("aria-label", "Qualidade do CV");
  const baixar = el("div", "cv-acoes");
  const nomeArquivo = () => ["CV", p.nome, cvVaga.empresa, idioma === "en" ? "EN" : ""].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]/g, "");
  const btPdf = botao("Baixar PDF", "btn primario", () => exportar("pdf", btPdf));
  const btDocx = botao("Baixar Word", "btn", () => exportar("docx", btDocx));
  baixar.append(btPdf, btDocx,
    botao("Copiar texto", "btn", async () => { try { await navigator.clipboard.writeText(folha.innerText); garantirSalvo(); avisar("Texto do CV copiado."); } catch { avisar("Não consegui copiar."); } }),
    botao("Imprimir", "link-btn", () => { garantirSalvo(); imprimir(p); }));
  const estadoCv = el("div", "aviso cv-estado");
  function mostrarEstado() {
    estadoCv.textContent = "";
    if (cvSalvo) {
      estadoCv.className = "aviso verde cv-estado";
      estadoCv.innerHTML = svg('<path d="M20 6 9 17l-5-5"/>');
      estadoCv.append(el("span", null, "Salvo em CVs gerados. O que você mudar aqui fica salvo sozinho."));
      return;
    }
    estadoCv.className = "aviso azul cv-estado";
    estadoCv.innerHTML = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
    const substitui = cvSalvoDaVaga(cvVaga.id);
    estadoCv.append(el("span", null, `Rascunho: ajuste o que quiser e salve quando estiver pronto. Baixar também salva.${substitui ? " Ao salvar, ele substitui o CV que você já tinha desta vaga." : ""}`));
    estadoCv.append(botao("Salvar em CVs gerados", "btn pequeno primario", () => { garantirSalvo(); avisar("CV salvo em Minha área → CVs gerados."); }));
  }
  function garantirSalvo() {
    if (cvSalvo) return;
    salvarNoHistorico();
    mostrarEstado();
  }
  mostrarEstado();
  const candidatura = el("div", "aviso verde cand-barra");
  candidatura.hidden = true;
  const lugarFolha = el("div");
  const notaEdicao = el("p", "cv-nota", "Clique em qualquer texto do CV para corrigir.");
  abaCv.append(barra, qualidade, estadoCv, baixar, candidatura, notaEdicao, lugarFolha);

  const chaveEdicao = () => `${modelo}-${idioma}`;
  let timerEdicao = null;
  function guardarEdicao(redesenhar = true) {
    clearTimeout(timerEdicao);
    timerEdicao = setTimeout(() => {
      const html = folha.innerHTML;
      atualizarHistorico((h) => ({ edicoes: { ...(h.edicoes || {}), [chaveEdicao()]: html } }));
      if (redesenhar) renderQualidade();
    }, 900);
  }

  function montarFolha() {
    botoesModelo.forEach(([m, b]) => b.setAttribute("aria-pressed", String(m === modelo)));
    botoesIdioma.forEach(([m, b]) => b.setAttribute("aria-pressed", String(m === idioma)));
    folha = folhaCv(p, textos[idioma], modelo, idioma);
    folha.id = "cv-folha";
    folha.contentEditable = "true";
    folha.spellcheck = true;
    folha.lang = idioma === "en" ? "en" : "pt-BR";
    const salvo = cvEntrada?.edicoes?.[chaveEdicao()];
    if (salvo) folha.innerHTML = salvo; // conteúdo do próprio CV da pessoa, guardado na conta dela
    else if (idioma === "pt" && original) marcarNovidades(folha, original);
    folha.classList.toggle("sem-destaque", !destacar);
    folha.addEventListener("input", () => guardarEdicao(true));
    lugarFolha.replaceChildren(folha);
    setTimeout(renderQualidade, 50);
  }

  async function trocarIdioma(id) {
    if (id === idioma) return;
    if (id === "en" && !textos.en) {
      lugarFolha.textContent = "";
      const pr = el("p", "cv-carregando");
      pr.append(el("span", "cv-spin"), document.createTextNode("A IA está traduzindo seu CV para o inglês…"));
      lugarFolha.append(pr);
      try {
        const g = cvGerado;
        const pedido = `Translate this resume to professional US English, for a tech job application. Keep exactly the same JSON structure and facts; do not add anything. Use strong action verbs. Keep company names, product names and technologies as they are. Translate dates like "2023 – atual" to "2023 – Present". Answer only with JSON.
${JSON.stringify({ titulo: g.titulo, resumo: g.resumo, habilidades: g.habilidades, experiencias: g.experiencias, projetos: g.projetos, formacao: g.formacao, certificacoes: g.certificacoes, idiomas: g.idiomas })}`;
        textos.en = lerJson(await gemini([{ text: pedido }], { json: true }));
        atualizarHistorico((h) => ({ extras: { ...(h.extras || {}), en: textos.en } }));
      } catch (e) {
        avisar(e.message || String(e));
        montarFolha();
        return;
      }
    }
    idioma = id;
    montarFolha();
  }

  async function exportar(tipo, b) {
    const texto = b.textContent;
    b.disabled = true;
    b.textContent = "Gerando arquivo…";
    try {
      if (tipo === "pdf") await baixarPdf(folha, modelo, nomeArquivo());
      else await baixarDocx(folha, nomeArquivo());
      garantirSalvo();
      perguntarCandidatura();
    } catch (e) {
      avisar(`${e.message || e} Use "Imprimir" e escolha "Salvar como PDF".`);
    } finally {
      b.disabled = false;
      b.textContent = texto;
    }
  }

  // Depois de baixar: marcar a candidatura sem sair daqui
  function perguntarCandidatura() {
    const ja = candidaturas[cvVaga.id];
    candidatura.textContent = "";
    candidatura.innerHTML = svg('<path d="M20 6 9 17l-5-5"/>');
    if (ja) {
      candidatura.append(el("span", null, `Esta vaga já está nas suas candidaturas (${NOME_ETAPA[ja.etapa] || "Candidatei"}).`));
    } else {
      candidatura.append(el("span", null, `CV baixado! Já enviou para ${cvVaga.empresa || "a empresa"}?`));
      candidatura.append(botao("Sim, marcar como candidatura", "btn pequeno primario", () => {
        const v = dados.vagas.find((x) => x.id === cvVaga.id);
        if (v) alternarCandidatura(v); // em app.js: marca e conta na meta
        else {
          candidaturas[cvVaga.id] = { data: hojeLocal(), etapa: "candidatei", nota: "", atualizadaEm: hojeLocal(), titulo: cvVaga.titulo, empresa: cvVaga.empresa, link: cvVaga.link };
          salvarCandidaturas();
          render();
          avisar("Candidatura marcada. Acompanhe em Minha área.");
        }
        perguntarCandidatura();
      }), botao("Ainda não", "link-btn", () => { candidatura.hidden = true; }));
    }
    candidatura.hidden = false;
  }

  // ---- Painel de qualidade: nota ATS, frases fracas, uma página, revisão de texto ----
  function cartaoQualidade(estado, titulo, detalhe) {
    const k = el("article", `q-cartao ${estado}`);
    const cab = el("div", "q-cab");
    cab.append(el("span", "q-ponto"), el("strong", null, titulo));
    k.append(cab);
    if (detalhe) k.append(el("p", null, detalhe));
    qualidade.append(k);
    return k;
  }
  const linhasDaFolha = () => [...folha.querySelectorAll(".folha-titulo, .folha-corpo li, .folha-corpo section > p")].map((n, i) => ({ n, i, texto: textoLimpo(n) })).filter((x) => x.texto);

  function renderQualidade() {
    if (!folha || abaCv.hidden) return;
    qualidade.textContent = "";
    qualidade.append(el("h3", "q-titulo", "Checagem antes de enviar"));
    const grade = el("div", "q-grade");
    qualidade.append(grade);
    const add = (...a) => { const k = cartaoQualidade(...a); grade.append(k); return k; };

    const ats = notaAts(folha, cvAnalise);
    if (ats) {
      const k = add(ats.pct >= 75 ? "ok" : ats.pct >= 50 ? "medio" : "ruim", `Palavras-chave da vaga: ${ats.pct}%`, ats.faltando.length ? `Faltam: ${ats.faltando.slice(0, 6).join(", ")}${ats.faltando.length > 6 ? "…" : ""}` : "Seu CV cita todas as palavras-chave da vaga.");
      k.title = "Os sistemas de RH (ATS) filtram CVs por estas palavras.";
      if (ats.faltando.length) k.append(botao("IA: onde encaixar", "btn pequeno", (ev) => sugerirPalavras(ats.faltando, ev.currentTarget, k)));
    }
    const fracas = frasesFracas(folha);
    const kf = add(fracas.length ? "medio" : "ok", fracas.length ? `${fracas.length} ${fracas.length === 1 ? "frase pode" : "frases podem"} ficar mais forte${fracas.length === 1 ? "" : "s"}` : "Frases com verbo de ação", fracas.length ? "Começam com \"responsável por\", \"ajudei\" ou parecido." : "Nenhuma frase fraca encontrada.");
    if (fracas.length) kf.append(botao("IA: deixar mais fortes", "btn pequeno", (ev) => fortalecer(fracas, ev.currentTarget, kf)));
    const pg = paginasDaFolha(folha);
    const kp = add(pg <= 1.02 ? "ok" : "medio", pg <= 1.02 ? "Cabe em 1 página" : `Ocupa cerca de ${pg.toFixed(1).replace(".", ",")} páginas`, pg <= 1.02 ? "Recrutador lê em segundos: uma página é o ideal." : "O ideal é 1 página para até 10 anos de experiência.");
    if (pg > 1.02) kp.append(botao("Compactar", "btn pequeno", (ev) => compactar(ev.currentTarget)));
    const kr = add("neutro", idioma === "en" ? "Revisar o inglês" : "Revisar o português", "Acentos, concordância e tempos verbais iguais em todo o CV.");
    kr.append(botao("IA: revisar", "btn pequeno", (ev) => revisarTexto(ev.currentTarget, kr)));
  }

  async function comIA(botaoIA, rotulo, fn) {
    const t0 = botaoIA.textContent;
    botaoIA.disabled = true;
    botaoIA.textContent = rotulo;
    try { await fn(); } catch (e) { avisar(e.message || String(e)); } finally { botaoIA.disabled = false; botaoIA.textContent = t0; }
  }

  function sugerirPalavras(faltando, b, k) {
    comIA(b, "Pensando…", async () => {
      const pedido = `CV (texto): ${folha.innerText.slice(0, 6000)}
Palavras-chave da vaga que não aparecem no CV: ${faltando.join(", ")}.
Para cada palavra, diga em português se dá para incluir com honestidade (só se o CV ou o perfil indicarem que a pessoa tem essa experiência) e onde. Nunca sugira mentir.
Responda só com JSON: { "sugestoes": [{ "palavra": "", "podeIncluir": true|false, "onde": "em qual seção e como, em 1 frase", "seNao": "se não puder incluir, o que estudar ou como falar disso na entrevista" }] }`;
      const r = lerJson(await gemini([{ text: pedido }], { json: true }));
      const ul = el("ul", "q-sugestoes");
      (r.sugestoes || []).forEach((s) => ul.append(el("li", s.podeIncluir ? "pode" : "nao", `${s.palavra}: ${s.podeIncluir ? s.onde : s.seNao}`)));
      k.querySelector(".q-sugestoes")?.remove();
      k.append(ul);
      b.remove();
    });
  }

  function fortalecer(fracas, b, k) {
    comIA(b, "Reescrevendo…", async () => {
      const pedido = `Reescreva estas frases de currículo${idioma === "en" ? " (em inglês)" : " em português do Brasil"} começando com verbo de ação forte e mostrando resultado.
Não invente números: quando um número ajudaria, deixe uma lacuna como [X%] ou [N usuários] para a pessoa completar.
Frases: ${JSON.stringify(fracas)}
Responda só com JSON: { "sugestoes": [{ "original": "frase exatamente como veio", "nova": "" }] }`;
      const r = lerJson(await gemini([{ text: pedido }], { json: true }));
      const box = el("div", "q-reescritas");
      (r.sugestoes || []).filter((s) => s.original && s.nova).forEach((s) => {
        const linha = el("div", "q-reescrita");
        const ant = el("div", "cv-antes"); ant.append(el("b", null, "Era"), el("span", null, s.original));
        const nov = el("div", "cv-depois"); nov.append(el("b", null, "Fica"), el("span", null, s.nova));
        const ap = botao("Aplicar", "btn pequeno primario", () => {
          if (trocarTextoNaFolha(folha, s.original, s.nova)) { linha.classList.add("aplicada"); ap.replaceWith(el("span", "q-ok", "Aplicada. Complete o que estiver entre [ ]")); guardarEdicao(false); }
          else avisar("Não achei essa frase no CV (talvez você já tenha editado).");
        });
        linha.append(ant, nov, ap);
        box.append(linha);
      });
      k.querySelector(".q-reescritas")?.remove();
      k.append(box);
      b.remove();
    });
  }

  function compactar(b) {
    if (modelo !== "compacto") { salvar(CHAVE_MODELO_CV, "compacto"); modelo = "compacto"; montarFolha(); avisar("Mudei para o modelo Compacto."); return; }
    comIA(b, "Encurtando…", async () => {
      const g = textos[idioma];
      const pedido = `Encurte este currículo para caber em UMA página A4, mantendo o que mais importa para a vaga "${cvVaga.titulo}". Resumo com no máximo 3 linhas, no máximo 4 itens por experiência, junte ou corte o que for menos relevante. Não invente nada. Mesmo idioma e mesma estrutura JSON. Responda só com JSON.
${JSON.stringify({ titulo: g.titulo, resumo: g.resumo, habilidades: g.habilidades, experiencias: g.experiencias, projetos: g.projetos, formacao: g.formacao, certificacoes: g.certificacoes, idiomas: g.idiomas })}`;
      const curto = lerJson(await gemini([{ text: pedido }], { json: true }));
      textos[idioma] = { ...g, ...curto };
      if (idioma === "pt") { cvGerado = textos.pt; atualizarHistorico(() => ({ cv: cvGerado })); }
      else atualizarHistorico((h) => ({ extras: { ...(h.extras || {}), en: textos.en } }));
      atualizarHistorico((h) => { const e = { ...(h.edicoes || {}) }; delete e[chaveEdicao()]; return { edicoes: e }; });
      montarFolha();
      avisar("CV encurtado. Confira se nada importante saiu.");
    });
  }

  function revisarTexto(b, k) {
    comIA(b, "Revisando…", async () => {
      const linhas = linhasDaFolha();
      const pedido = `Revise a ortografia e a gramática destas linhas de um currículo em ${idioma === "en" ? "inglês" : "português do Brasil"}: acentos, concordância, pontuação e tempos verbais consistentes (use o mesmo tempo em todas as experiências passadas). Não mude o sentido nem acrescente informação.
Linhas: ${JSON.stringify(linhas.map((l) => ({ i: l.i, texto: l.texto })))}
Responda só com JSON, listando apenas as linhas que precisam de correção: { "correcoes": [{ "i": 0, "corrigido": "", "motivo": "curto" }] }`;
      const r = lerJson(await gemini([{ text: pedido }], { json: true }));
      const cor = (r.correcoes || []).filter((x) => linhas[x.i] && x.corrigido && x.corrigido !== linhas[x.i].texto);
      cor.forEach((x) => { linhas[x.i].n.textContent = x.corrigido; linhas[x.i].n.classList.add("editado"); });
      if (cor.length) guardarEdicao(false);
      k.querySelector(".q-lista")?.remove();
      const ul = el("ul", "q-lista");
      if (!cor.length) ul.append(el("li", null, "Nada para corrigir. Texto revisado."));
      cor.slice(0, 10).forEach((x) => ul.append(el("li", null, `${x.motivo || "Corrigido"}: “${x.corrigido.slice(0, 90)}${x.corrigido.length > 90 ? "…" : ""}”`)));
      k.append(ul);
      k.className = "q-cartao ok";
      k.querySelector("strong").textContent = cor.length ? `${cor.length} ${cor.length === 1 ? "correção aplicada" : "correções aplicadas"}` : "Texto revisado";
      b.remove();
    });
  }

  montarFolha();
  mostrar(abaCv);
}

// ---------- Carta de apresentação, mensagens e preparação para entrevista ----------

const EXTRAS = {
  carta: {
    titulo: "Carta e mensagens",
    explica: "A IA escreve uma carta de apresentação curta, uma mensagem para o recrutador no LinkedIn e um e-mail de follow-up, usando o CV adaptado e a vaga.",
    botao: "Escrever carta e mensagens",
    pedido: (v, a, g, p) => `Escreva, em português do Brasil, textos para a candidatura de ${p.nome} à vaga "${v.titulo}"${v.empresa ? ` na ${v.empresa}` : ""}.
Resumo da vaga: ${a?.resumo || ""}
Requisitos: ${(a?.obrigatorios || []).join("; ")}
CV adaptado (JSON): ${JSON.stringify({ titulo: g.titulo, resumo: g.resumo, habilidades: g.habilidades, experiencias: g.experiencias, projetos: g.projetos })}

Regras: tom profissional e humano, sem exageros, sem inventar nada que não esteja no CV. Primeira pessoa.
Responda só com JSON:
{
  "carta": "carta de apresentação com 3 parágrafos curtos (no máximo 180 palavras)",
  "linkedin": "mensagem para o recrutador no LinkedIn, no máximo 300 caracteres",
  "followup": "e-mail curto de follow-up para mandar 7 dias depois, com assunto na primeira linha"
}`,
    mostrar: (box, r) => {
      [["Carta de apresentação", r.carta], ["Mensagem para o recrutador (LinkedIn)", r.linkedin], ["E-mail de follow-up", r.followup]].forEach(([titulo, texto]) => {
        if (!texto) return;
        box.append(blocoCopiavel(titulo, String(texto)));
      });
    },
  },
  empresa: {
    titulo: "Sobre a empresa",
    explica: "A IA lê o anúncio e junta o que se sabe da empresa: o que ela faz, o produto, como trabalha e como você pode se posicionar. Confira no site da empresa antes da entrevista, porque a IA pode estar desatualizada.",
    botao: "Pesquisar a empresa",
    lerLinks: true, // abre o link da vaga para ler o anúncio e o que ele diz da empresa
    pedido: (v, a, g, p) => `Pesquise a empresa desta vaga para preparar ${p.nome || "a pessoa candidata"} para a entrevista, em português do Brasil.
Vaga: "${v.titulo}"${v.empresa ? ` na ${v.empresa}` : ""}.${v.link ? ` Anúncio: ${v.link}` : ""}
Resumo da vaga: ${a?.resumo || ""}
Requisitos: ${(a?.obrigatorios || []).join("; ")}
O que a pessoa tem (CV adaptado): ${JSON.stringify({ titulo: g.titulo, habilidades: g.habilidades, experiencias: (g.experiencias || []).map((e) => `${e.cargo} na ${e.empresa}`) })}

Use o anúncio e o que você sabe da empresa. Se não conhecer a empresa, diga isso em "confianca" e baseie-se só no anúncio. Nunca invente números, clientes, notícias ou pessoas.
Responda só com JSON (sem texto fora dele):
{
  "confianca": "alta" | "media" | "baixa",
  "oQueFaz": "2 ou 3 frases: o que a empresa faz e para quem",
  "produto": "produto ou serviço principal e onde esta vaga entra nele",
  "porte": "porte e momento (startup, grande empresa, consultoria...), se souber",
  "cultura": ["até 4 pontos sobre o jeito de trabalhar que aparecem no anúncio ou são conhecidos"],
  "comoSePosicionar": ["até 4 frases de como ligar a sua experiência ao que a empresa precisa"],
  "perguntasParaFazer": ["até 5 perguntas inteligentes para fazer ao recrutador sobre a empresa e o time"],
  "pesquisarAntes": ["o que conferir sozinho antes da entrevista (site, LinkedIn da empresa, Glassdoor, produto)"]
}`,
    mostrar: (box, r) => {
      const conf = { alta: "A IA conhece bem esta empresa.", media: "A IA conhece em parte. Confira os detalhes.", baixa: "A IA não conhece esta empresa: o resumo vem só do anúncio." }[r.confianca];
      if (conf) box.append(el("p", `cv-nota confianca-${r.confianca}`, conf));
      [["O que faz", r.oQueFaz], ["Produto", r.produto], ["Porte e momento", r.porte]].forEach(([t, txt]) => {
        if (!txt) return;
        const d = el("div", "cv-depois");
        d.append(el("b", null, t), el("span", null, String(txt)));
        box.append(d);
      });
      [["Jeito de trabalhar", r.cultura], ["Como se posicionar", r.comoSePosicionar], ["Perguntas para fazer ao recrutador", r.perguntasParaFazer], ["Confira antes da entrevista", r.pesquisarAntes]].forEach(([t, itens]) => {
        const l = lista(itens);
        if (l.length) box.append(listaReq(t, l));
      });
    },
  },
  entrevista: {
    titulo: "Preparar entrevista",
    explica: "A IA lista as perguntas mais prováveis para esta vaga e sugere como responder com base no seu CV. Treine em voz alta antes da entrevista.",
    botao: "Gerar perguntas e respostas",
    pedido: (v, a, g, p) => `Prepare ${p.nome} para a entrevista da vaga "${v.titulo}"${v.empresa ? ` na ${v.empresa}` : ""}, em português do Brasil.
Requisitos: ${(a?.obrigatorios || []).join("; ")}. Desejáveis: ${(a?.desejaveis || []).join("; ")}.
Pontos fracos (requisitos não comprovados): ${(g.lacunas || []).join("; ") || "nenhum"}
CV (JSON): ${JSON.stringify({ resumo: g.resumo, habilidades: g.habilidades, experiencias: g.experiencias, projetos: g.projetos, formacao: g.formacao })}

Responda só com JSON:
{
  "perguntas": [{ "pergunta": "", "tipo": "técnica" | "comportamental" | "sobre a vaga", "porque": "por que costumam perguntar isso", "comoResponder": "roteiro curto de resposta usando experiências reais do CV (método STAR quando for comportamental)" }],
  "lacunas": [{ "tema": "requisito que a pessoa não tem", "comoLidar": "como responder com honestidade e mostrar vontade de aprender" }],
  "perguntasParaFazer": ["perguntas inteligentes para a pessoa fazer ao final da entrevista"]
}
Entre 6 e 8 perguntas, misturando técnicas e comportamentais. Não invente experiências.`,
    mostrar: (box, r) => {
      const ul = el("ol", "entrevista");
      (r.perguntas || []).forEach((q) => {
        const li = el("li", "entrevista-item");
        const d = el("details");
        const sm = el("summary");
        sm.append(el("span", "selo", q.tipo || "pergunta"), el("strong", null, q.pergunta));
        d.append(sm);
        if (q.porque) d.append(el("p", "cv-nota", `Por que perguntam: ${q.porque}`));
        if (q.comoResponder) { const r2 = el("div", "cv-depois"); r2.append(el("b", null, "Como responder"), el("span", null, q.comoResponder)); d.append(r2); }
        li.append(d);
        ul.append(li);
      });
      if ((r.perguntas || []).length) { box.append(el("h4", null, "Perguntas prováveis")); box.append(ul); }
      if ((r.lacunas || []).length) {
        const w = el("div", "cv-alerta");
        w.append(el("strong", null, "Se perguntarem do que você ainda não tem"));
        const l = el("ul");
        r.lacunas.forEach((x) => l.append(el("li", null, `${x.tema}: ${x.comoLidar}`)));
        w.append(l);
        box.append(w);
      }
      const fazer = lista(r.perguntasParaFazer);
      if (fazer.length) box.append(listaReq("Perguntas para você fazer no final", fazer));
    },
  },
};

function blocoCopiavel(titulo, texto) {
  const b = el("section", "copiavel");
  const cab = el("div", "copiavel-cab");
  cab.append(el("h4", null, titulo));
  const copiar = botao("Copiar", "btn pequeno", async () => {
    try { await navigator.clipboard.writeText(area.value); avisar(`${titulo} copiada.`); }
    catch { area.select(); avisar("Selecionei o texto: use Ctrl+C."); }
  });
  cab.append(copiar);
  const area = el("textarea", "copiavel-texto");
  area.value = texto;
  area.rows = Math.min(14, Math.max(3, Math.ceil(texto.length / 80) + texto.split("\n").length));
  area.setAttribute("aria-label", titulo);
  b.append(cab, area);
  return b;
}

async function montarExtra(box, tipo, p) {
  const cfg = EXTRAS[tipo];
  const salvo = cvEntrada?.extras?.[tipo];
  box.textContent = "";
  if (salvo) {
    box.append(el("p", "cv-nota", cfg.explica));
    cfg.mostrar(box, salvo);
    const acoes = el("div", "cv-acoes");
    acoes.append(botao("Gerar de novo", "btn", () => gerarExtra(box, tipo, p)));
    box.append(acoes);
    return;
  }
  box.append(el("p", "cv-nota", cfg.explica));
  const acoes = el("div", "cv-acoes");
  acoes.append(botao(cfg.botao, "btn primario", () => gerarExtra(box, tipo, p)));
  box.append(acoes);
}

async function gerarExtra(box, tipo, p) {
  const cfg = EXTRAS[tipo];
  box.textContent = "";
  const carregandoEl = el("p", "cv-carregando");
  carregandoEl.append(el("span", "cv-spin"), document.createTextNode("A IA está escrevendo…"));
  box.append(carregandoEl);
  try {
    // Ler links (url_context) não combina com resposta em JSON forçado: nesse caso o lerJson tira o JSON do texto
    const lerLinks = Boolean(cfg.lerLinks && cvVaga.link);
    const r = lerJson(await gemini([{ text: cfg.pedido(cvVaga, cvAnalise, cvGerado, p) }], { json: !lerLinks, lerLinks }));
    atualizarHistorico((h) => ({ extras: { ...(h.extras || {}), [tipo]: r } }));
    box.textContent = "";
    box.append(el("p", "cv-nota", cfg.explica));
    cfg.mostrar(box, r);
    const acoes = el("div", "cv-acoes");
    acoes.append(botao("Gerar de novo", "btn", () => gerarExtra(box, tipo, p)));
    box.append(acoes);
  } catch (e) {
    box.textContent = "";
    const erroBox = el("div", "cv-erro");
    erroBox.append(el("strong", null, "Não deu certo"), el("p", null, e.message || String(e)));
    const acoes = el("div", "grupo");
    acoes.append(botao("Tentar de novo", "btn primario", () => gerarExtra(box, tipo, p)));
    erroBox.append(acoes);
    box.append(erroBox);
  }
}

// ---------- Simulador de entrevista: a IA faz o papel do recrutador desta vaga ----------

const SIM_PERGUNTAS = 6;
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let sim = null; // { perguntas, i, respostas, resultado }

// ---------- Voz do recrutador: a voz pt-BR mais natural do aparelho, num ritmo de conversa ----------

const CHAVE_VOZ = "radar-vagas:voz";
const VELOCIDADES = [{ v: 1, rotulo: "Normal" }, { v: 1.2, rotulo: "Ágil" }, { v: 1.4, rotulo: "Rápida" }];
const temVoz = "speechSynthesis" in window;
let vozes = [];
const carregarVozes = () => { vozes = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith("pt")); };
if (temVoz) { carregarVozes(); speechSynthesis.addEventListener?.("voiceschanged", carregarVozes); }
const ajustesVoz = () => ({ vel: 1.2, nome: "", auto: false, ...ler(CHAVE_VOZ, {}) });

// Vozes neurais (Edge "Online (Natural)", Google, Siri premium) soam como gente; as antigas, como robô
function notaVoz(v) {
  const n = v.name.toLowerCase();
  let nota = v.lang.toLowerCase().replace("_", "-") === "pt-br" ? 100 : 0;
  if (/natural|neural|online|premium|enhanced|aprimorad/.test(n)) nota += 50;
  if (/google/.test(n)) nota += 30;
  if (/francisca|antonio|thalita|luciana|felipe/.test(n)) nota += 10;
  if (!v.localService) nota += 5;
  return nota;
}

function vozEscolhida() {
  const { nome } = ajustesVoz();
  return vozes.find((v) => v.name === nome) || [...vozes].sort((a, b) => notaVoz(b) - notaVoz(a))[0] || null;
}

function falar(texto, aoTerminar) {
  if (!temVoz) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  const voz = vozEscolhida();
  u.lang = voz?.lang || "pt-BR";
  if (voz) u.voice = voz;
  u.rate = ajustesVoz().vel;
  u.pitch = 1;
  u.onend = u.onerror = () => aoTerminar?.();
  speechSynthesis.speak(u);
}

const pararVoz = () => { if (temVoz) speechSynthesis.cancel(); };

async function montarSimulador(box, p) {
  box.textContent = "";
  const salvo = cvEntrada?.extras?.simulacao;
  if (!sim && salvo?.resultado) sim = { ...salvo, i: salvo.perguntas.length };
  if (sim?.resultado) { mostrarResultadoSim(box, p); return; }
  if (sim) { mostrarPerguntaSim(box, p); return; }

  box.append(el("p", "cv-nota", `A IA faz o papel de quem vai te entrevistar na ${cvVaga.empresa || "empresa"}: ${SIM_PERGUNTAS} perguntas, uma por vez, técnicas e comportamentais, baseadas na vaga e no seu CV. No final você recebe uma nota e dicas para cada resposta.`));
  const dicas = el("ul", "sim-dicas");
  ["Responda como se fosse a entrevista de verdade, com exemplos do seu trabalho.", Reconhecimento ? "Pode responder falando: clique no microfone." : "Seu navegador não reconhece voz; responda escrevendo.", "Leva uns 10 minutos."].forEach((d) => dicas.append(el("li", null, d)));
  box.append(dicas);
  const op = el("label", "sim-auto");
  const caixa = el("input");
  caixa.type = "checkbox";
  caixa.checked = ler(CHAVE_SIM_APROFUNDAR, true);
  caixa.addEventListener("change", () => { try { localStorage.setItem(CHAVE_SIM_APROFUNDAR, JSON.stringify(caixa.checked)); } catch {} });
  op.append(caixa, " O recrutador pode fazer perguntas de aprofundamento sobre as suas respostas, como numa entrevista de verdade");
  box.append(op);
  const acoes = el("div", "cv-acoes");
  acoes.append(botao("Começar a simulação", "btn primario", () => iniciarSimulacao(box, p)));
  box.append(acoes);
}

// ---------- Conversa: perguntas de aprofundamento e jeito de falar ----------

const CHAVE_SIM_APROFUNDAR = "radar-vagas:sim-aprofundar";
const MAX_APROFUNDAR = 2;
const MULETAS = ["tipo", "né", "então", "aí", "assim", "basicamente", "meio que", "sabe", "enfim", "na verdade"];

// Depois de uma resposta, o recrutador decide se pede mais detalhe (no máximo 2 vezes por simulação)
async function talvezAprofundar(box, q, resposta) {
  if (!sim.aprofundar || sim.aprofundou >= MAX_APROFUNDAR || q.tipo === "aprofundamento" || q.tipo === "abertura" || resposta.length < 40) return;
  const espera = el("p", "cv-carregando");
  espera.append(el("span", "cv-spin"), document.createTextNode("O recrutador está pensando na sua resposta…"));
  box.append(espera);
  try {
    const pedido = `Você é recrutador(a) técnico(a) entrevistando para a vaga "${cvVaga.titulo}". Você perguntou: "${q.pergunta}" (quer descobrir: ${q.avalia || "—"}).
A pessoa respondeu: "${resposta.slice(0, 2500)}"
Numa entrevista real, você faria UMA pergunta curta de aprofundamento? Faça só se a resposta foi vaga, genérica, sem exemplo concreto, sem resultado, ou citou algo técnico que vale explorar. Se a resposta já foi completa, não faça.
Responda só com JSON: { "aprofundar": true | false, "pergunta": "pergunta curta e natural, falada, em português do Brasil", "avalia": "o que quer descobrir" }`;
    const r = lerJson(await gemini([{ text: pedido }], { json: true }));
    if (r.aprofundar && r.pergunta) {
      sim.perguntas.splice(sim.i + 1, 0, { pergunta: String(r.pergunta), tipo: "aprofundamento", avalia: String(r.avalia || "") });
      sim.aprofundou++;
    }
  } catch { /* sem aprofundamento: a entrevista segue normal */ }
  espera.remove();
}

// Ritmo (palavras por minuto) e palavras de apoio nas respostas faladas
function analiseFala() {
  const faladas = (sim.fala || []).filter((f) => f?.texto && f.segundos > 3);
  if (!faladas.length) return null;
  const palavras = faladas.reduce((n, f) => n + f.texto.split(/\s+/).filter(Boolean).length, 0);
  const segundos = faladas.reduce((n, f) => n + f.segundos, 0);
  const texto = semAcento(faladas.map((f) => f.texto).join(" "));
  const muletas = MULETAS.map((m) => [m, (texto.match(new RegExp(`(^|\\s)${semAcento(m)}(?=\\s|$|[,.!?])`, "g")) || []).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return { respostas: faladas.length, ppm: Math.round(palavras / (segundos / 60)), palavras, muletas, porCem: Math.round((muletas.reduce((n, [, k]) => n + k, 0) / Math.max(1, palavras)) * 1000) / 10 };
}

function blocoFala(f) {
  const box = el("section", "sim-fala");
  box.append(el("h4", null, "Seu jeito de falar"));
  const ritmo = f.ppm < 100 ? ["devagar", "Você falou um pouco devagar. Tente frases mais diretas, sem pausas longas."]
    : f.ppm > 170 ? ["rápido", "Você falou rápido. Respire entre as ideias: quem entrevista precisa anotar."]
    : ["bom", "Ritmo bom e natural para uma entrevista."];
  const grade = el("div", "sim-fala-grade");
  const item = (valor, rotulo, sub) => { const d = el("div", "sim-fala-item"); d.append(el("strong", null, valor), el("span", null, rotulo), el("small", null, sub)); grade.append(d); };
  item(`${f.ppm}`, "palavras por minuto", `ritmo ${ritmo[0]} (o ideal fica entre 120 e 160)`);
  item(f.muletas.length ? f.muletas.slice(0, 3).map(([m, n]) => `"${m}" ${n}×`).join(" · ") : "nenhuma", "palavras de apoio", `${f.porCem} a cada 100 palavras`);
  box.append(grade, el("p", "cv-nota", `${ritmo[1]} ${f.porCem > 3 ? "Diminua as palavras de apoio: troque por uma pausa curta." : ""} Baseado em ${f.respostas} ${f.respostas === 1 ? "resposta falada" : "respostas faladas"}; o reconhecimento de voz não escreve "é…" e "ãh", então eles não entram na conta.`));
  return box;
}

async function iniciarSimulacao(box, p) {
  box.textContent = "";
  const carregandoEl = el("p", "cv-carregando");
  carregandoEl.append(el("span", "cv-spin"), document.createTextNode("Preparando a entrevista…"));
  box.append(carregandoEl);
  const g = cvGerado || {};
  const pedido = `Você é recrutador(a) técnico(a) da ${cvVaga.empresa || "empresa"} entrevistando ${p.nome || "a pessoa candidata"} para a vaga "${cvVaga.titulo}".
Requisitos: ${(cvAnalise?.obrigatorios || []).join("; ")}. Desejáveis: ${(cvAnalise?.desejaveis || []).join("; ")}.
CV da pessoa (JSON): ${JSON.stringify({ resumo: g.resumo, habilidades: g.habilidades, experiencias: g.experiencias, projetos: g.projetos })}
Crie ${SIM_PERGUNTAS} perguntas de entrevista, em português do Brasil, na ordem de uma entrevista real: começa com "fale sobre você", depois técnicas ligadas aos requisitos e ao CV, e comportamentais (método STAR). Uma pergunta por item, curta e natural, como se estivesse falando.
Responda só com JSON: { "perguntas": [{ "pergunta": "", "tipo": "abertura" | "técnica" | "comportamental", "avalia": "o que você quer descobrir com ela" }] }`;
  try {
    const r = lerJson(await gemini([{ text: pedido }], { json: true }));
    const perguntas = (r.perguntas || []).filter((q) => q?.pergunta).slice(0, SIM_PERGUNTAS);
    if (!perguntas.length) throw new Error("A IA não montou as perguntas. Tente de novo.");
    sim = { perguntas, i: 0, respostas: [], fala: [], aprofundar: ler(CHAVE_SIM_APROFUNDAR, true), aprofundou: 0, resultado: null };
    mostrarPerguntaSim(box, p);
  } catch (e) {
    box.textContent = "";
    box.append(el("p", "cv-erro", e.message || String(e)));
    const acoes = el("div", "cv-acoes");
    acoes.append(botao("Tentar de novo", "btn primario", () => iniciarSimulacao(box, p)));
    box.append(acoes);
  }
}

function mostrarPerguntaSim(box, p) {
  box.textContent = "";
  sim.fala = sim.fala || [];
  if (sim.i >= sim.perguntas.length) { avaliarSimulacao(box, p); return; }
  const q = sim.perguntas[sim.i];
  const prog = el("div", "sim-progresso");
  prog.append(el("span", null, `Pergunta ${sim.i + 1} de ${sim.perguntas.length}`), el("span", "selo", q.tipo || "pergunta"));
  const barra = el("div", "sim-barra");
  const fill = el("span");
  fill.style.width = `${(sim.i / sim.perguntas.length) * 100}%`;
  barra.append(fill);
  box.append(prog, barra);

  const conversa = el("div", "sim-conversa");
  const linha = el("div", "msg-linha ia");
  const av = el("div", "sim-recrutador");
  av.innerHTML = svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>');
  const balao = el("div", "msg ia");
  balao.append(el("p", null, q.pergunta));
  linha.append(av, balao);
  conversa.append(linha);
  box.append(conversa);

  const ouvir = botao("Ouvir a pergunta", "btn pequeno", () => {
    if (speechSynthesis.speaking) { pararVoz(); return; }
    ouvir.textContent = "Parar a voz";
    falar(q.pergunta, () => { ouvir.textContent = "Ouvir a pergunta"; });
  });
  if (!temVoz) ouvir.hidden = true;

  // Ajustes da voz: velocidade, qual voz e ler sozinho (ficam salvos)
  const ajustes = el("div", "sim-voz");
  if (temVoz) {
    // As vozes mudam de aparelho para aparelho, então isto fica só neste navegador
    const salvarVoz = (mudanca) => { try { localStorage.setItem(CHAVE_VOZ, JSON.stringify({ ...ajustesVoz(), ...mudanca })); } catch {} };
    const vel = el("select");
    vel.setAttribute("aria-label", "Velocidade da voz");
    VELOCIDADES.forEach(({ v, rotulo }) => { const o = el("option", null, `Voz ${rotulo.toLowerCase()}`); o.value = v; o.selected = v === ajustesVoz().vel; vel.append(o); });
    vel.addEventListener("change", () => { salvarVoz({ vel: Number(vel.value) }); falar(q.pergunta); });
    ajustes.append(vel);
    if (vozes.length > 1) {
      const qual = el("select");
      qual.setAttribute("aria-label", "Qual voz usar");
      const atual = vozEscolhida()?.name;
      [...vozes].sort((a, b) => notaVoz(b) - notaVoz(a)).forEach((v) => {
        const o = el("option", null, v.name.replace(/^(Microsoft|Google)\s+/, "").replace(/\s*-\s*Portuguese.*$/i, ""));
        o.value = v.name; o.selected = v.name === atual; qual.append(o);
      });
      qual.addEventListener("change", () => { salvarVoz({ nome: qual.value }); falar(q.pergunta); });
      ajustes.append(qual);
    }
    const auto = el("label", "sim-auto");
    const caixa = el("input");
    caixa.type = "checkbox";
    caixa.checked = ajustesVoz().auto;
    caixa.addEventListener("change", () => salvarVoz({ auto: caixa.checked }));
    auto.append(caixa, document.createTextNode(" Ler cada pergunta sozinho"));
    ajustes.append(auto);
    if (ajustesVoz().auto) setTimeout(() => { ouvir.textContent = "Parar a voz"; falar(q.pergunta, () => { ouvir.textContent = "Ouvir a pergunta"; }); }, 250);
  }

  const ta = el("textarea", "sim-resposta");
  ta.rows = 6;
  ta.placeholder = "Sua resposta…";
  ta.setAttribute("aria-label", "Sua resposta");
  ta.value = sim.respostas[sim.i] || "";

  const ferramentas = el("div", "sim-ferramentas");
  ferramentas.append(ouvir);
  if (Reconhecimento) {
    let rec = null;
    const mic = botao("Responder falando", "btn pequeno", () => {
      if (rec) { rec.stop(); return; }
      rec = new Reconhecimento();
      rec.lang = "pt-BR";
      rec.continuous = true;
      rec.interimResults = true;
      const base = ta.value ? ta.value.trimEnd() + " " : "";
      const inicio = Date.now();
      let falado = "";
      rec.onresult = (ev) => {
        falado = [...ev.results].map((r) => r[0].transcript).join(" ");
        ta.value = base + falado;
      };
      rec.onend = () => {
        rec = null; mic.textContent = "Responder falando"; mic.classList.remove("gravando");
        // Guarda quanto tempo falou e o que falou: vira ritmo e vícios de fala no resultado
        if (falado.trim()) {
          const f = sim.fala[sim.i] || { texto: "", segundos: 0 };
          sim.fala[sim.i] = { texto: `${f.texto} ${falado}`.trim(), segundos: f.segundos + (Date.now() - inicio) / 1000 };
        }
      };
      rec.onerror = (ev) => { avisar(ev.error === "not-allowed" ? "Libere o microfone para responder falando." : "Não consegui ouvir. Tente de novo ou escreva."); };
      rec.start();
      mic.textContent = "Parar de gravar";
      mic.classList.add("gravando");
    });
    ferramentas.append(mic);
  }
  box.append(ferramentas, ajustes, ta);

  const acoes = el("div", "cv-acoes");
  acoes.append(
    botao(sim.i + 1 === sim.perguntas.length ? "Responder e ver meu resultado" : "Responder e ir para a próxima", "btn primario", async () => {
      if (!ta.value.trim()) { avisar("Escreva ou fale sua resposta (ou use Pular)."); return; }
      sim.respostas[sim.i] = ta.value.trim();
      pararVoz();
      await talvezAprofundar(box, q, sim.respostas[sim.i]);
      sim.i++;
      mostrarPerguntaSim(box, p);
    }),
    botao("Pular", "btn", () => { pararVoz(); sim.respostas[sim.i] = ""; sim.i++; mostrarPerguntaSim(box, p); }),
    botao("Recomeçar", "link-btn", () => { if (confirm("Recomeçar a simulação do zero?")) { sim = null; montarSimulador(box, p); } }),
  );
  box.append(acoes);
  ta.focus();
}

async function avaliarSimulacao(box, p) {
  box.textContent = "";
  const carregandoEl = el("p", "cv-carregando");
  carregandoEl.append(el("span", "cv-spin"), document.createTextNode("A IA está avaliando suas respostas…"));
  box.append(carregandoEl);
  const pares = sim.perguntas.map((q, i) => ({ pergunta: q.pergunta, tipo: q.tipo, avalia: q.avalia, resposta: sim.respostas[i] || "(pulou)", falada: Boolean(sim.fala?.[i]) }));
  const fala = analiseFala();
  const pedido = `Você entrevistou ${p.nome || "uma pessoa"} para a vaga "${cvVaga.titulo}"${cvVaga.empresa ? ` na ${cvVaga.empresa}` : ""}. Avalie as respostas como um(a) recrutador(a) justo(a) e construtivo(a), em português do Brasil.
Perguntas e respostas (JSON): ${JSON.stringify(pares)}
${fala ? `Respostas faladas (transcritas por reconhecimento de voz, ignore erros de transcrição): ritmo de ${fala.ppm} palavras por minuto; palavras de apoio: ${fala.muletas.map(([m, n]) => `${m} ${n}x`).join(", ") || "nenhuma"}. Comente a comunicação em "melhorar" se fizer sentido.` : ""}
Perguntas do tipo "aprofundamento" foram feitas por você depois de uma resposta incompleta: avalie se a pessoa completou bem.
Responda só com JSON:
{
  "nota": número de 0 a 10,
  "resumo": "2 frases sobre o desempenho geral",
  "pontosFortes": ["..."],
  "melhorar": ["..."],
  "porPergunta": [{ "nota": 0-10, "comentario": "o que foi bom e o que faltou", "respostaMelhor": "como responder melhor, usando só o que a pessoa disse ou tem no CV" }]
}`;
  try {
    sim.resultado = lerJson(await gemini([{ text: pedido }], { json: true }));
    atualizarHistorico((h) => ({ extras: { ...(h.extras || {}), simulacao: { perguntas: sim.perguntas, respostas: sim.respostas, fala: sim.fala, resultado: sim.resultado } } }));
    mostrarResultadoSim(box, p);
  } catch (e) {
    box.textContent = "";
    box.append(el("p", "cv-erro", e.message || String(e)));
    const acoes = el("div", "cv-acoes");
    acoes.append(botao("Tentar avaliar de novo", "btn primario", () => avaliarSimulacao(box, p)));
    box.append(acoes);
  }
}

function mostrarResultadoSim(box, p) {
  box.textContent = "";
  const r = sim.resultado;
  const nota = Math.max(0, Math.min(10, Number(r.nota) || 0));
  const topo = el("div", `sim-nota ${nota >= 7 ? "boa" : nota >= 5 ? "media" : "baixa"}`);
  topo.append(el("strong", null, nota.toFixed(1).replace(".", ",")), el("span", null, "de 10"));
  const resumo = el("div");
  resumo.append(el("h4", null, "Resultado da simulação"), el("p", null, r.resumo || ""));
  const cab = el("div", "sim-cab");
  cab.append(topo, resumo);
  box.append(cab);
  const colunas = el("div", "cv-req");
  [listaReq("Pontos fortes", lista(r.pontosFortes)), listaReq("Para melhorar", lista(r.melhorar))].forEach((n) => n && colunas.append(n));
  box.append(colunas);
  const fala = analiseFala();
  if (fala) box.append(blocoFala(fala));

  const ol = el("ol", "entrevista");
  sim.perguntas.forEach((q, i) => {
    const a = (r.porPergunta || [])[i] || {};
    const li = el("li", "entrevista-item");
    const d = el("details");
    const s = el("summary");
    s.append(el("span", "selo", `${a.nota ?? "–"}/10`), el("strong", null, q.pergunta));
    d.append(s);
    const sua = el("div", "cv-antes");
    sua.append(el("b", null, "Você"), el("span", null, sim.respostas[i] || "(pulou)"));
    d.append(sua);
    if (a.comentario) d.append(el("p", "cv-nota", a.comentario));
    if (a.respostaMelhor) { const m = el("div", "cv-depois"); m.append(el("b", null, "Melhor"), el("span", null, a.respostaMelhor)); d.append(m); }
    li.append(d);
    ol.append(li);
  });
  box.append(el("h4", null, "Pergunta por pergunta"), ol);
  const acoes = el("div", "cv-acoes");
  acoes.append(botao("Fazer outra simulação", "btn primario", () => { sim = null; montarSimulador(box, p); }));
  box.append(acoes);
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
  copia.querySelectorAll(".editado").forEach((n) => n.classList.remove("editado"));
  window.addEventListener("afterprint", fim, { once: true });
  window.print();
}

// Fechar com um rascunho não salvo: pergunta antes (salvar, descartar ou continuar ajustando)
function fecharCv() {
  if (!cvEntrada || cvSalvo) { $("cv").close(); return; }
  const corpo = $("cv-corpo");
  corpo.querySelector(".cv-sair")?.remove();
  const a = el("div", "aviso laranja cv-sair");
  a.setAttribute("role", "alertdialog");
  a.innerHTML = svg('<path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/>');
  a.append(el("span", null, "Este CV ainda não foi salvo. Quer guardar em CVs gerados antes de fechar?"));
  const acoes = el("div", "grupo");
  const salvarFechar = botao("Salvar e fechar", "btn pequeno primario", () => { salvarNoHistorico(); avisar("CV salvo em Minha área → CVs gerados."); $("cv").close(); });
  acoes.append(salvarFechar,
    botao("Descartar", "btn pequeno", () => { cvEntrada = null; $("cv").close(); }),
    botao("Continuar ajustando", "link-btn", () => a.remove()));
  a.append(acoes);
  corpo.prepend(a);
  $("cv").querySelector(".cv-interno").scrollIntoView({ block: "start" });
  salvarFechar.focus();
}
$("cv-fechar").addEventListener("click", fecharCv);
$("cv").addEventListener("click", (e) => { if (e.target === e.currentTarget) fecharCv(); });
$("cv").addEventListener("cancel", (e) => { if (cvEntrada && !cvSalvo) { e.preventDefault(); fecharCv(); } }); // tecla Esc
$("cv").addEventListener("close", pararVoz);
