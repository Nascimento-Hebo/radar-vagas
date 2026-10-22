// Central de e-mail: lê o Gmail da pessoa (só leitura) e mostra apenas as conversas com as empresas
// das candidaturas dela. A IA classifica cada e-mail, sugere a etapa da candidatura e escreve respostas.
// Os e-mails não são guardados em lugar nenhum: ficam só na memória desta aba.

const EMAIL_DIAS = 120;          // quanto tempo para trás procurar
const EMAIL_MAX = 60;            // quantas mensagens trazer no máximo
const EMAIL_IA_MAX = 30;         // quantas mensagens a IA analisa de uma vez
const QUADROS_DE_VAGA = /(^|\.)(github\.com|gupy\.io|remotar\.com\.br|greenhouse\.io|lever\.co|linkedin\.com|indeed\.com|programathor\.com\.br|vagas\.com\.br|catho\.com\.br)$/i;

let emailEstado = { mensagens: null, analises: {}, carregando: false, erro: "", empresas: [] };

// Empresas das candidaturas e as palavras que identificam cada uma num e-mail
function empresasDasCandidaturas() {
  const mapa = new Map();
  for (const [id, c] of Object.entries(candidaturas)) {
    const nome = String(c.empresa || "").trim();
    let host = "";
    try { host = new URL(c.link).hostname.replace(/^www\./, ""); } catch {}
    const termos = new Set();
    if (nome.length >= 3) termos.add(nome);
    // vaga da Gupy: "empresa.gupy.io" -> "empresa"
    const sub = host.match(/^([a-z0-9-]+)\.(gupy\.io|greenhouse\.io|lever\.co)$/i);
    if (sub) termos.add(sub[1]);
    // site próprio da empresa: o domínio identifica quem manda o e-mail
    else if (host && !QUADROS_DE_VAGA.test(host)) termos.add(host);
    if (!termos.size) continue;
    const chave = semAcento(nome || [...termos][0]);
    const atual = mapa.get(chave) || { nome: nome || [...termos][0], termos: new Set(), candidaturas: [] };
    termos.forEach((t) => atual.termos.add(t));
    atual.candidaturas.push(id);
    mapa.set(chave, atual);
  }
  return [...mapa.values()].map((e) => ({ ...e, termos: [...e.termos] }));
}

const cabecalho = (msg, nome) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === nome.toLowerCase())?.value || "";

function decodificar(dados) {
  try {
    const bin = atob(String(dados).replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return ""; }
}
function textoDoCorpo(payload) {
  const partes = [];
  (function andar(p) {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data) partes.push({ tipo: "texto", v: decodificar(p.body.data) });
    else if (p.mimeType === "text/html" && p.body?.data) partes.push({ tipo: "html", v: decodificar(p.body.data) });
    (p.parts || []).forEach(andar);
  })(payload);
  const texto = partes.find((p) => p.tipo === "texto")?.v;
  if (texto) return texto.trim();
  const html = partes.find((p) => p.tipo === "html")?.v || "";
  const d = new DOMParser().parseFromString(html, "text/html");
  return (d.body?.innerText || d.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

async function emLotes(itens, tamanho, fn) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(...await Promise.all(itens.slice(i, i + tamanho).map(fn)));
  return saida;
}

async function buscarEmails() {
  const nuvem = window.radarNuvem;
  const empresas = empresasDasCandidaturas();
  emailEstado = { ...emailEstado, empresas, carregando: true, erro: "", mensagens: null, analises: {} };
  renderPainel();
  try {
    if (!empresas.length) { emailEstado.mensagens = []; return; }
    const termos = empresas.flatMap((e) => e.termos).map((t) => (/\s/.test(t) ? `"${t}"` : t));
    const q = `newer_than:${EMAIL_DIAS}d -in:chats (${termos.join(" OR ")})`;
    const lista = await nuvem.gmail(`messages?maxResults=${EMAIL_MAX}&q=${encodeURIComponent(q)}`);
    const ids = (lista.messages || []).map((m) => m.id);
    const brutas = await emLotes(ids, 8, (id) => nuvem.gmail(`messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`));
    // Filtro final: só fica o que cita uma das empresas no remetente, assunto ou começo do texto
    emailEstado.mensagens = brutas.map((m) => {
      const de = cabecalho(m, "From"), assunto = cabecalho(m, "Subject");
      const alvo = semAcento(`${de} ${assunto} ${m.snippet || ""}`);
      const empresa = empresas.find((e) => e.termos.some((t) => alvo.includes(semAcento(t))));
      return empresa && { id: m.id, threadId: m.threadId, de, assunto, data: Number(m.internalDate), trecho: m.snippet || "", empresa: empresa.nome, candidaturas: empresa.candidaturas };
    }).filter(Boolean).sort((a, b) => b.data - a.data);
  } catch (e) {
    emailEstado.erro = e.message || String(e);
    if (e.codigo === "gmail-desconectado") emailEstado.mensagens = null;
  } finally {
    emailEstado.carregando = false;
    renderPainel();
  }
  if (emailEstado.mensagens?.length) analisarEmails();
}

// A IA lê assunto + trecho de cada e-mail e diz o que aconteceu no processo
async function analisarEmails() {
  const msgs = emailEstado.mensagens.slice(0, EMAIL_IA_MAX);
  emailEstado.analisando = true;
  renderPainel();
  const etapas = ETAPAS.map(([id, nome]) => `${id} (${nome})`).join(", ");
  const pedido = `Você ajuda uma pessoa a acompanhar processos seletivos de tecnologia no Brasil.
Para cada e-mail abaixo (enviado por empresas onde ela se candidatou), diga o que ele significa para a candidatura.

E-mails (JSON): ${JSON.stringify(msgs.map((m) => ({ id: m.id, empresa: m.empresa, de: m.de, assunto: m.assunto, trecho: m.trecho, data: new Date(m.data).toISOString().slice(0, 10) })))}

Etapas possíveis: ${etapas}.
Responda só com JSON:
{ "analises": [{ "id": "id do e-mail", "tipo": "entrevista" | "teste" | "proposta" | "recusa" | "confirmacao" | "pedido_info" | "outro", "etapa": "id da etapa ou null se o e-mail não muda a etapa", "resumo": "1 frase", "acao": "o que a pessoa deve fazer agora, ou vazio", "prazo": "data ou horário citado, ou vazio", "dataHora": "data e hora da entrevista ou do prazo no formato AAAA-MM-DDTHH:MM (horário de Brasília), ou vazio se não houver data exata" }] }
Hoje é ${hojeLocal()}. Para datas sem ano, use o ano certo.
Não invente: se o trecho não deixa claro, use "outro" e etapa null.`;
  try {
    const r = JSON.parse(String(await window.radarNuvem.gerarIA([{ text: pedido }], { json: true })).replace(/```(json)?/g, ""));
    for (const a of r.analises || []) if (a?.id) emailEstado.analises[a.id] = a;
  } catch (e) {
    emailEstado.erroIA = e.message || String(e);
  } finally {
    emailEstado.analisando = false;
    if (lerAuto()) aplicarSugestoes(sugestoesDosEmails(), true);
    renderPainel();
  }
}

// "Atualizar sozinho": a etapa muda assim que a IA entende o e-mail (opção salva neste navegador)
const CHAVE_EMAIL_AUTO = "radar-vagas:email-auto";
const lerAuto = () => ler(CHAVE_EMAIL_AUTO, false);

function sugestoesDosEmails() {
  const sugestoes = [];
  for (const m of emailEstado.mensagens || []) {
    const a = emailEstado.analises[m.id];
    if (!a?.etapa || !NOME_ETAPA[a.etapa]) continue;
    for (const cid of m.candidaturas) {
      const cand = candidaturas[cid];
      if (cand && cand.etapa !== a.etapa && ORDEM_ETAPA[a.etapa] > ORDEM_ETAPA[cand.etapa] && !sugestoes.some((s) => s.cid === cid)) sugestoes.push({ cid, cand, etapa: a.etapa, m, a });
    }
  }
  return sugestoes;
}

// "2026-10-25T14:30" (horário de Brasília) -> ISO; vazio se a IA não deu data exata
function dataDoEmail(txt) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(txt || ""))) return "";
  const t = Date.parse(`${txt.slice(0, 16)}:00-03:00`);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

function aplicarSugestoes(lista, automatico = false) {
  if (!lista.length) return;
  for (const s of lista) {
    s.cand.etapa = s.etapa;
    s.cand.atualizadaEm = hojeLocal();
    if (s.a.acao) s.cand.nota = [s.cand.nota, `${fmtData(new Date(s.m.data).toISOString())}: ${s.a.acao}`].filter(Boolean).join("\n");
    const quando = dataDoEmail(s.a.dataHora);
    if ((s.etapa === "entrevista" || s.etapa === "teste") && quando) s.cand.compromisso = quando;
  }
  salvarCandidaturas();
  render();
  renderPainel();
  const inicio = automatico ? "Atualizei sozinho" : "Atualizei";
  avisar(lista.length === 1 ? `${inicio}: ${lista[0].cand.titulo || "candidatura"} foi para ${NOME_ETAPA[lista[0].etapa]}.` : `${inicio} ${lista.length} candidaturas pelos e-mails.`);
}

const ROTULO_TIPO = { entrevista: "Entrevista", teste: "Teste técnico", proposta: "Proposta", recusa: "Não avançou", confirmacao: "Recebemos sua candidatura", pedido_info: "Pedem informações", outro: "Outro" };
const ORDEM_ETAPA = Object.fromEntries(ETAPAS.map(([id], i) => [id, i]));

function painelEmails(c) {
  const nuvem = window.radarNuvem;
  c.append(el("p", "painel-nota", "Só aparecem e-mails que citam as empresas das suas candidaturas. Os e-mails são lidos direto do seu Gmail, só nesta aba, e não ficam guardados em lugar nenhum."));

  if (!nuvem?.usuario) { c.append(el("p", "painel-vazio", "Entre na sua conta para usar a central de e-mail.")); return; }
  const empresas = empresasDasCandidaturas();
  if (!empresas.length) {
    c.append(el("p", "painel-vazio", "Marque \"Já me candidatei\" em pelo menos uma vaga. A central procura os e-mails das empresas dessas candidaturas."));
    return;
  }
  const lista = el("p", "email-empresas");
  lista.append(el("span", null, "Empresas acompanhadas: "), empresas.map((e) => e.nome).join(" · "));
  c.append(lista);
  blocoColarEmail(c);

  if (!nuvem.gmailConectado()) {
    const caixa = el("div", "email-conectar");
    caixa.innerHTML = svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>');
    const txt = el("div");
    const passos = el("ol", "email-passos");
    ["Se o Google mostrar “O Google não verificou este app”, clique em Avançado → Acessar (não seguro).", "Na tela de permissões, marque a caixa “Ler seus e-mails” do Gmail.", "Clique em Continuar."].forEach((p) => passos.append(el("li", null, p)));
    txt.append(el("strong", null, "Conecte seu Gmail"), el("p", null, "Permissão só de leitura. O acesso vale por 1 hora; depois é só conectar de novo."), passos);
    const b = el("button", "btn primario", "Conectar meu Gmail");
    b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await nuvem.conectarGmail(); emailEstado.erro = ""; buscarEmails(); }
      catch (e) {
        emailEstado.erro = nuvem.mensagemErro(e);
        console.warn("Gmail:", e?.code, e);
        renderPainel();
      }
    });
    caixa.append(txt, b);
    c.append(caixa);
    if (emailEstado.erro) c.append(el("p", "cv-erro", emailEstado.erro));
    return;
  }

  const barra = el("div", "email-barra");
  const atualizar = el("button", "btn pequeno", emailEstado.carregando ? "Buscando…" : "Atualizar");
  atualizar.type = "button";
  atualizar.disabled = emailEstado.carregando;
  atualizar.addEventListener("click", buscarEmails);
  const desligar = el("button", "link-btn", "Desconectar Gmail");
  desligar.type = "button";
  desligar.addEventListener("click", () => { nuvem.desconectarGmail(); emailEstado.mensagens = null; renderPainel(); });
  barra.append(atualizar, desligar);
  c.append(barra);

  if (emailEstado.mensagens === null && !emailEstado.carregando && !emailEstado.erro) { buscarEmails(); return; }
  if (emailEstado.carregando) { const p = el("p", "cv-carregando"); p.append(el("span", "cv-spin"), "Procurando e-mails das suas empresas…"); c.append(p); return; }
  if (emailEstado.erro) { c.append(el("p", "cv-erro", emailEstado.erro)); return; }
  if (!emailEstado.mensagens.length) { c.append(el("p", "painel-vazio", `Nenhum e-mail dessas empresas nos últimos ${EMAIL_DIAS} dias.`)); return; }

  // Sugestões da IA: etapas que avançaram
  const sugestoes = sugestoesDosEmails();
  const auto = el("label", "email-auto");
  const caixa = el("input");
  caixa.type = "checkbox";
  caixa.checked = lerAuto();
  caixa.addEventListener("change", () => {
    try { localStorage.setItem(CHAVE_EMAIL_AUTO, JSON.stringify(caixa.checked)); } catch {}
    if (caixa.checked) aplicarSugestoes(sugestoesDosEmails(), true);
  });
  auto.append(caixa, " Atualizar minhas candidaturas sozinho quando a IA entender o e-mail (entrevista, teste, proposta ou recusa)");
  c.append(auto);
  if (emailEstado.analisando) { const p = el("p", "cv-carregando"); p.append(el("span", "cv-spin"), "A IA está lendo os e-mails…"); c.append(p); }
  if (emailEstado.erroIA) c.append(el("p", "cv-nota", `A IA não conseguiu analisar agora: ${emailEstado.erroIA}`));
  if (sugestoes.length) {
    const box = el("section", "email-sugestoes");
    const cabSug = el("div", "email-sug-cab");
    cabSug.append(el("h3", null, "A IA encontrou novidades nas suas candidaturas"));
    if (sugestoes.length > 1) {
      const todas = el("button", "btn pequeno", "Aplicar todas");
      todas.type = "button";
      todas.addEventListener("click", () => aplicarSugestoes(sugestoes));
      cabSug.append(todas);
    }
    box.append(cabSug);
    sugestoes.forEach((s) => {
      const linha = el("div", "email-sugestao");
      const quando = dataDoEmail(s.a.dataHora);
      linha.append(el("span", null, `${s.cand.titulo || "Vaga"}${s.cand.empresa ? ` · ${s.cand.empresa}` : ""}: ${NOME_ETAPA[s.cand.etapa]} → ${NOME_ETAPA[s.etapa]}. ${s.a.resumo || ""}${quando ? ` (${fmtCompromisso(quando)})` : ""}`));
      const b = el("button", "btn pequeno primario", `Mudar para ${NOME_ETAPA[s.etapa]}`);
      b.type = "button";
      b.addEventListener("click", () => aplicarSugestoes([s]));
      linha.append(b);
      box.append(linha);
    });
    c.append(box);
  }

  // E-mails agrupados por empresa
  const porEmpresa = new Map();
  emailEstado.mensagens.forEach((m) => porEmpresa.set(m.empresa, [...(porEmpresa.get(m.empresa) || []), m]));
  for (const [empresa, msgs] of porEmpresa) {
    const grupo = el("section", "email-grupo");
    grupo.append(el("h3", null, `${empresa} (${msgs.length})`));
    msgs.forEach((m) => grupo.append(cartaoEmail(m)));
    c.append(grupo);
  }
}

// ---------- Sem Gmail: colar um e-mail recebido ----------
// Funciona para qualquer pessoa (não usa a permissão do Gmail, que exige verificação paga do Google)

let colado = { texto: "", resultado: null, ocupado: false };

async function entenderEmailColado(texto) {
  colado = { texto, resultado: null, ocupado: true };
  renderPainel();
  const lista = Object.entries(candidaturas).map(([id, c]) => ({ id, vaga: c.titulo || "", empresa: c.empresa || "", etapa: c.etapa }));
  const etapas = ETAPAS.map(([id, nome]) => `${id} (${nome})`).join(", ");
  const pedido = `Você ajuda uma pessoa a acompanhar processos seletivos de tecnologia no Brasil. Ela colou um e-mail que recebeu.
Candidaturas dela (JSON): ${JSON.stringify(lista)}
Etapas possíveis: ${etapas}. Hoje é ${hojeLocal()}.
E-mail colado:
${texto.slice(0, 6000)}

Responda só com JSON:
{ "candidatura": "id da candidatura deste e-mail, ou vazio se nenhuma combina", "tipo": "entrevista" | "teste" | "proposta" | "recusa" | "confirmacao" | "pedido_info" | "outro", "etapa": "id da etapa ou null se não muda a etapa", "resumo": "1 frase", "acao": "o que a pessoa deve fazer agora, ou vazio", "prazo": "data ou horário citado, ou vazio", "dataHora": "AAAA-MM-DDTHH:MM (horário de Brasília) da entrevista ou do prazo, ou vazio" }
Não invente: se o texto não deixa claro, use "outro" e etapa null.`;
  try {
    colado.resultado = JSON.parse(String(await window.radarNuvem.gerarIA([{ text: pedido }], { json: true })).replace(/```(json)?/g, ""));
  } catch (e) {
    avisar(e.message || String(e));
  } finally {
    colado.ocupado = false;
    renderPainel();
  }
}

function blocoColarEmail(c) {
  const box = el("details", "email-colar");
  box.open = Boolean(colado.texto) || !window.radarNuvem?.gmailConectado();
  box.append(el("summary", null, "Sem conectar o Gmail: cole um e-mail que você recebeu"));
  const ta = el("textarea");
  ta.rows = 5;
  ta.placeholder = "Copie o e-mail da empresa (assunto e texto) e cole aqui";
  ta.setAttribute("aria-label", "E-mail recebido");
  ta.value = colado.texto;
  const b = el("button", "btn primario", colado.ocupado ? "A IA está lendo…" : "IA: entender este e-mail");
  b.type = "button";
  b.disabled = colado.ocupado;
  b.addEventListener("click", () => {
    if (ta.value.trim().length < 30) { avisar("Cole o e-mail completo."); return; }
    entenderEmailColado(ta.value.trim());
  });
  box.append(ta, b);

  const r = colado.resultado;
  if (r) {
    const cand = candidaturas[r.candidatura];
    const res = el("div", "email-sugestao");
    const quando = dataDoEmail(r.dataHora);
    res.append(el("span", null, [
      ROTULO_TIPO[r.tipo] || "Outro",
      cand ? `${cand.titulo || "Vaga"}${cand.empresa ? ` · ${cand.empresa}` : ""}` : "não achei a candidatura deste e-mail",
      r.resumo, r.acao && `Próximo passo: ${r.acao}`, quando && fmtCompromisso(quando),
    ].filter(Boolean).join(" · ")));
    if (cand && r.etapa && NOME_ETAPA[r.etapa] && r.etapa !== cand.etapa) {
      const aplicar = el("button", "btn pequeno primario", `Mudar para ${NOME_ETAPA[r.etapa]}`);
      aplicar.type = "button";
      aplicar.addEventListener("click", () => {
        aplicarSugestoes([{ cid: r.candidatura, cand, etapa: r.etapa, m: { data: Date.now() }, a: r }]);
        colado = { texto: "", resultado: null, ocupado: false };
        renderPainel();
      });
      res.append(aplicar);
    }
    box.append(res);
  }
  c.append(box);
}

function cartaoEmail(m) {
  const a = emailEstado.analises[m.id];
  const d = el("details", "email");
  const s = el("summary");
  const topo = el("div", "email-topo");
  topo.append(el("strong", null, m.assunto || "(sem assunto)"), el("span", "email-data", new Date(m.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })));
  s.append(topo, el("span", "email-de", m.de.replace(/<.*>/, "").trim() || m.de));
  if (a) {
    const ia = el("div", "email-ia");
    ia.append(el("span", `selo tipo-${a.tipo}`, ROTULO_TIPO[a.tipo] || "Outro"), el("span", null, [a.resumo, a.prazo && `Prazo: ${a.prazo}`].filter(Boolean).join(" · ")));
    s.append(ia);
    if (a.acao) s.append(el("span", "email-acao", `Próximo passo: ${a.acao}`));
  } else s.append(el("span", "email-trecho", m.trecho));
  d.append(s);

  const corpo = el("div", "email-corpo");
  d.addEventListener("toggle", async () => {
    if (!d.open || corpo.dataset.carregado) return;
    corpo.dataset.carregado = "1";
    corpo.append(el("p", "cv-nota", "Abrindo o e-mail…"));
    try {
      const completo = await window.radarNuvem.gmail(`messages/${m.id}?format=full`);
      m.corpo = textoDoCorpo(completo.payload) || m.trecho;
      corpo.textContent = "";
      corpo.append(el("pre", "email-texto", m.corpo.slice(0, 6000)));
      const acoes = el("div", "cv-acoes");
      const responder = el("button", "btn pequeno primario", "IA: sugerir resposta");
      responder.type = "button";
      responder.addEventListener("click", () => sugerirResposta(m, corpo, responder));
      const abrir = el("a", "btn pequeno", "Abrir no Gmail");
      abrir.href = `https://mail.google.com/mail/u/0/#all/${m.threadId}`;
      abrir.target = "_blank";
      abrir.rel = "noopener noreferrer";
      acoes.append(responder, abrir);
      corpo.append(acoes);
    } catch (e) {
      corpo.textContent = "";
      corpo.append(el("p", "cv-erro", e.message || String(e)));
      delete corpo.dataset.carregado;
    }
  });
  d.append(corpo);
  return d;
}

async function sugerirResposta(m, corpo, botaoIA) {
  botaoIA.disabled = true;
  botaoIA.textContent = "Escrevendo…";
  const nome = ler("radar-vagas:perfil", {}).nome || "";
  const pedido = `Escreva uma resposta curta, educada e profissional, em português do Brasil, para este e-mail de um processo seletivo.
Quem responde: ${nome || "a pessoa candidata"}. Empresa: ${m.empresa}.
Assunto: ${m.assunto}
E-mail recebido:
${String(m.corpo || m.trecho).slice(0, 5000)}

Regras: confirme datas/horários se houver, responda ao que foi pedido, não invente informações (use [colchetes] onde a pessoa precisa completar). Só o texto da resposta, sem assunto.`;
  try {
    const texto = await window.radarNuvem.gerarIA([{ text: pedido }]);
    corpo.append(blocoCopiavel("Resposta sugerida", String(texto).trim())); // blocoCopiavel em cv.js
  } catch (e) {
    avisar(e.message || String(e));
  } finally {
    botaoIA.disabled = false;
    botaoIA.textContent = "IA: sugerir resposta";
  }
}
