// Perguntas do formulário de candidatura (Gupy, Greenhouse, site da empresa...):
// a pessoa cola as perguntas e a IA responde com base no CV adaptado para a vaga e nos requisitos dela,
// usando as palavras-chave da vaga e o tamanho pedido. As respostas ficam salvas na candidatura.

const PERGUNTAS_COMUNS = [
  "Por que você quer trabalhar nesta empresa?",
  "Por que você é a pessoa certa para esta vaga?",
  "Fale sobre um projeto do qual você se orgulha.",
  "Qual a sua pretensão salarial?",
  "Quando você pode começar?",
  "Conte sobre um desafio técnico que você resolveu.",
  "Quais são seus pontos fortes e o que você quer desenvolver?",
];
const TAMANHOS = [
  { id: "curta", rotulo: "Curta", limite: 300, explica: "até 300 caracteres" },
  { id: "media", rotulo: "Média", limite: 700, explica: "até 700 caracteres" },
  { id: "longa", rotulo: "Longa", limite: 1500, explica: "até 1.500 caracteres" },
];
let perg = null; // { id, cand, h (CV do histórico), vaga, tamanho, ocupado }

// O CV adaptado desta candidatura: pelo id da vaga ou, se não tiver, pelo título e empresa
function cvDaCandidatura(id, c) {
  const hist = ler(CHAVE_HIST, []);
  return hist.find((h) => h.vaga?.id === id)
    || hist.find((h) => semAcento(h.vaga?.titulo) === semAcento(c.titulo) && semAcento(h.vaga?.empresa) === semAcento(c.empresa))
    || null;
}

function abrirPerguntas(id) {
  const c = candidaturas[id];
  if (!c) return;
  perg = { id, cand: c, h: cvDaCandidatura(id, c), vaga: dados.vagas.find((v) => v.id === id) || null, tamanho: "media", ocupado: false };
  $("perguntas-vaga").textContent = c.titulo || "Vaga";
  $("perguntas-empresa").textContent = c.empresa || "";
  const d = $("perguntas");
  if (!d.open) d.showModal();
  renderPerguntas();
}

function renderPerguntas(focoNoCampo = true) {
  const box = $("perguntas-corpo");
  box.textContent = "";
  const { h, cand } = perg;

  // De onde a IA tira as respostas
  const base = el("div", `perg-base ${h ? "ok" : "aviso"}`);
  if (h) base.append(el("span", null, `Base: o CV que a IA adaptou para esta vaga em ${fmtData(h.data)}, com os requisitos e palavras-chave da vaga.`));
  else {
    base.append(el("span", null, "Ainda não há CV adaptado para esta vaga: a IA usa o seu CV salvo e os dados da vaga. Adaptar o CV antes deixa as respostas mais certeiras."));
    if (perg.vaga && estado(perg.vaga) !== "encerrada") {
      const b = botao("Adaptar meu CV primeiro", "btn pequeno", () => { $("perguntas").close(); $("painel").close(); abrirAdaptador(perg.vaga); });
      base.append(b);
    }
  }
  box.append(base);

  // Perguntas
  const campo = el("label", "campo");
  campo.append(el("span", null, "Cole as perguntas do formulário (uma por linha) ou toque nas mais comuns"));
  const ta = el("textarea", "perg-texto");
  ta.rows = 4;
  ta.placeholder = "Ex.: Por que você quer trabalhar conosco?\nDescreva sua experiência com React.";
  ta.value = perg.rascunho || "";
  ta.addEventListener("input", () => { perg.rascunho = ta.value; });
  campo.append(ta);
  box.append(campo);

  const comuns = el("div", "perg-comuns");
  PERGUNTAS_COMUNS.forEach((q) => {
    const b = botao(q, "chip", () => {
      const linhas = ta.value.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!linhas.includes(q)) ta.value = [...linhas, q].join("\n");
      perg.rascunho = ta.value;
      ta.focus();
    });
    comuns.append(b);
  });
  box.append(comuns);

  // Tamanho das respostas
  const tam = el("div", "cv-modelos");
  tam.setAttribute("role", "group");
  tam.setAttribute("aria-label", "Tamanho das respostas");
  tam.append(el("span", "cv-opcoes-rotulo", "Tamanho"));
  TAMANHOS.forEach((t) => {
    const b = botao(t.rotulo, "chip", () => { perg.tamanho = t.id; renderPerguntas(false); });
    b.title = t.explica;
    b.setAttribute("aria-pressed", String(perg.tamanho === t.id));
    tam.append(b);
  });
  box.append(tam);

  const acoes = el("div", "cv-acoes");
  const gerar = botao(perg.ocupado ? "A IA está escrevendo…" : "IA: responder", "btn primario", () => responderPerguntas(ta.value));
  gerar.disabled = perg.ocupado;
  acoes.append(gerar);
  box.append(acoes);
  if (perg.ocupado) { const p = el("p", "cv-carregando"); p.append(el("span", "cv-spin"), "Lendo seu CV e a vaga para responder…"); box.append(p); }

  // Respostas salvas nesta candidatura (as mais novas primeiro)
  const salvas = cand.perguntas || [];
  if (salvas.length) {
    box.append(el("h3", "perg-titulo", `Respostas desta candidatura (${salvas.length})`));
    salvas.forEach((r, i) => box.append(cartaoResposta(r, i)));
  }
  if (focoNoCampo && !salvas.length) setTimeout(() => ta.focus(), 50);
}

function cartaoResposta(r, i) {
  const art = el("article", "perg-resposta");
  const cab = el("div", "perg-cab");
  cab.append(el("strong", null, r.pergunta));
  const apagar = botao("Apagar", "link-btn", () => {
    perg.cand.perguntas.splice(i, 1);
    salvarCandidaturas();
    renderPerguntas(false);
  });
  cab.append(apagar);
  art.append(cab);
  const area = el("textarea", "copiavel-texto");
  area.value = r.resposta;
  area.rows = Math.min(12, Math.max(3, Math.ceil(r.resposta.length / 70) + 1));
  area.setAttribute("aria-label", `Resposta: ${r.pergunta}`);
  const conta = el("span", "perg-conta", `${r.resposta.length} caracteres`);
  // Editar a resposta também fica salvo
  area.addEventListener("input", () => {
    r.resposta = area.value;
    conta.textContent = `${area.value.length} caracteres`;
    clearTimeout(cartaoResposta.timer);
    cartaoResposta.timer = setTimeout(salvarCandidaturas, 600);
  });
  art.append(area);
  const rodape = el("div", "perg-rodape");
  if (r.palavras?.length) {
    const tags = el("div", "perg-palavras");
    tags.append(el("span", null, "Palavras-chave da vaga usadas:"));
    r.palavras.forEach((p) => tags.append(el("span", "selo", p)));
    rodape.append(tags);
  }
  const copiar = botao("Copiar", "btn pequeno", async () => {
    try { await navigator.clipboard.writeText(area.value); avisar("Resposta copiada. Cole no formulário da vaga."); }
    catch { area.select(); avisar("Selecionei o texto: use Ctrl+C."); }
  });
  rodape.append(conta, copiar);
  art.append(rodape);
  if (r.dica) art.append(el("p", "cv-nota", r.dica));
  return art;
}

async function responderPerguntas(texto) {
  const perguntas = texto.split("\n").map((l) => l.replace(/^\s*(\d+[.)-]|[-•*])\s*/, "").trim()).filter((l) => l.length > 3).slice(0, 8);
  if (!perguntas.length) { avisar("Cole pelo menos uma pergunta do formulário."); return; }
  const { h, cand, vaga } = perg;
  const tamanho = TAMANHOS.find((t) => t.id === perg.tamanho);
  const p = ler(CHAVE_PERFIL_APP, {});
  const cv = h?.cv
    ? JSON.stringify({ titulo: h.cv.titulo, resumo: h.cv.resumo, habilidades: h.cv.habilidades, experiencias: h.cv.experiencias, projetos: h.cv.projetos, formacao: h.cv.formacao, idiomas: h.cv.idiomas })
    : String(p.cvTexto || p.cvExtraido || "").slice(0, 6000);
  const a = h?.analise;
  const pedido = `Você ajuda ${p.nome || "uma pessoa"} a responder as perguntas do formulário de candidatura da vaga "${cand.titulo || vaga?.titulo || ""}"${cand.empresa ? ` na ${cand.empresa}` : ""}, em português do Brasil.
${a ? `Resumo da vaga: ${a.resumo || ""}\nRequisitos obrigatórios: ${(a.obrigatorios || []).join("; ")}\nDesejáveis: ${(a.desejaveis || []).join("; ")}\nPalavras-chave da vaga: ${(a.palavrasChave || []).join(", ")}` : `Dados da vaga: ${vaga ? textoParaAdaptador(vaga) : [cand.titulo, cand.empresa, cand.link].filter(Boolean).join(" · ")}`}
${vaga?.salario ? `Salário anunciado: ${vaga.salario}` : ""}
CV ${h ? "adaptado para esta vaga" : "da pessoa"}: ${cv}
${p.aprendidas?.length ? `Estudou recentemente (não é experiência profissional): ${p.aprendidas.join(", ")}` : ""}

Perguntas do formulário:
${perguntas.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Regras:
- Primeira pessoa, tom profissional e humano, direto ao ponto. No máximo ${tamanho.limite} caracteres por resposta.
- Use naturalmente as palavras-chave da vaga que a pessoa realmente tem no CV (filtros de RH procuram por elas). Nunca invente experiência, empresa, número ou tecnologia que não esteja no CV.
- Estruture: comece respondendo a pergunta; depois um exemplo concreto do CV (situação, o que fez, resultado); feche ligando à vaga.
- Onde faltar informação que só a pessoa sabe (valor, data, nome), use [colchetes] para ela completar.
- Pretensão salarial: se houver salário anunciado, sugira uma faixa coerente com ele; se não, responda com [sua pretensão] e uma frase de abertura para negociar.
Responda só com JSON: { "respostas": [{ "pergunta": "a pergunta como veio", "resposta": "", "palavrasChave": ["palavras da vaga usadas na resposta"], "dica": "1 frase opcional: o que a pessoa deve conferir ou completar" }] }`;
  perg.ocupado = true;
  perg.rascunho = texto;
  renderPerguntas(false);
  try {
    const r = lerJson(await gemini([{ text: pedido }], { json: true }));
    const novas = (r.respostas || []).filter((x) => x?.resposta).map((x, i) => ({
      pergunta: String(x.pergunta || perguntas[i] || "Pergunta"), resposta: String(x.resposta).trim(),
      palavras: lista(x.palavrasChave).slice(0, 8), dica: String(x.dica || ""), em: hojeLocal(),
    }));
    if (!novas.length) throw new Error("A IA não devolveu respostas. Tente de novo.");
    perg.cand.perguntas = [...novas, ...(perg.cand.perguntas || [])].slice(0, 30);
    salvarCandidaturas();
    perg.rascunho = "";
    perg.mostrarNova = true;
    avisar(novas.length === 1 ? "Resposta pronta. Confira e copie." : `${novas.length} respostas prontas. Confira e copie.`);
  } catch (e) {
    avisar(e.message || String(e));
  } finally {
    perg.ocupado = false;
    renderPerguntas(false);
    renderPainel();
    // Leva a pessoa até a resposta nova (no celular ela fica abaixo do formulário)
    if (perg.mostrarNova) { perg.mostrarNova = false; $("perguntas-corpo").querySelector(".perg-resposta")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }
}

$("perguntas-fechar").addEventListener("click", () => $("perguntas").close());
$("perguntas").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
