// Suporte com IA: chat no canto da tela que conhece o Radar de Vagas e ajuda a pessoa a usar o sistema
// e a se candidatar melhor. A conversa fica na conta da pessoa (o super admin consegue ver no painel).

const CHAVE_SUPORTE = "radar-vagas:suporte";
const SUPORTE_MAX = 40; // mensagens guardadas
const SUPORTE_SISTEMA = `Você é o "Suporte Radar", assistente do Radar de Vagas, um site da OH Tech Technology que ajuda pessoas a conseguir vagas de tecnologia no Brasil.
Responda em português do Brasil, de forma curta, simpática e prática. Use frases simples e, quando ajudar, passos numerados. Não use markdown (sem asteriscos, sem #).

O que existe no site, para você orientar:
- Lista de vagas de front-end, full-stack e back-end, atualizada todo dia às 7:15, vindas do GitHub, da Gupy e do Greenhouse. Vagas repetidas são juntadas.
- Busca por tecnologia ou empresa; filtros de área (abas), nível, contrato, local (100% remoto, estado ou cidade), "Só com salário" e "Esconder as que já me candidatei"; ordenar por relevância, compatibilidade, mais recentes ou salário; buscas rápidas.
- Selo "Combina com você" (júnior, PJ, remoto ou Paraná) e % de compatibilidade de cada vaga com o CV (calculada com o texto do CV salvo em Minha área → Meus dados).
- Colar o link de uma vaga de outro site na busca: a IA lê a vaga e adapta o CV. Sites com login (LinkedIn) pedem para colar o texto da vaga.
- Botão "Adaptar meu CV" em cada vaga: a IA lê a vaga, faz até 5 perguntas, gera o CV em 5 abas: o que mudou, antes e depois (verde = o que a IA colocou), CV final editável em 4 modelos (Clássico, Moderno, Executivo, Compacto) com "Baixar PDF", carta e mensagens (carta, LinkedIn, follow-up) e preparar entrevista.
- "Já me candidatei" em cada vaga soma na meta da semana (topo da página).
- Minha área (botão no topo): Candidaturas em quadro por etapa (Candidatei, Entrevista, Teste técnico, Proposta, Não avançou) com anotações e aviso de follow-up após 7 dias; E-mails das empresas (conecta o Gmail só para leitura e mostra apenas e-mails das empresas das candidaturas; a IA classifica e sugere mudar a etapa e responder); CVs gerados; Meus dados (CV em texto, backup, apagar dados).
- Tema claro/escuro no botão do sol/lua. O site pode ser instalado como aplicativo pelo navegador.
- Dados ficam na conta da pessoa (Firebase). A IA não inventa experiência no CV, mas a pessoa deve revisar antes de enviar.

Também ajude com dúvidas de carreira: como melhorar o CV, como se preparar para entrevistas, como escrever para recrutadores.
Se não souber algo do site, diga que não tem certeza e sugira falar com o administrador. Nunca peça senhas nem chaves.`;
const SUPORTE_SUGESTOES = ["Como adapto meu CV para uma vaga?", "Como filtro vagas da minha cidade?", "Como funciona a central de e-mail?", "Dicas para entrevista técnica"];

let suporteConversa = ler(CHAVE_SUPORTE, []);
let suporteEnviando = false;

function renderSuporte() {
  const box = $("suporte-msgs");
  box.textContent = "";
  if (!suporteConversa.length) {
    const ola = el("div", "msg ia");
    ola.append(el("p", null, "Olá! Sou o assistente do Radar de Vagas. Posso explicar como usar o site, ajudar com seu CV ou com entrevistas. O que você precisa?"));
    box.append(ola);
  }
  suporteConversa.forEach((m) => {
    const d = el("div", `msg ${m.de === "eu" ? "eu" : "ia"}`);
    d.append(el("p", null, m.texto));
    box.append(d);
  });
  if (suporteEnviando) {
    const d = el("div", "msg ia digitando");
    d.append(el("span"), el("span"), el("span"));
    d.setAttribute("aria-label", "O assistente está escrevendo");
    box.append(d);
  }
  box.scrollTop = box.scrollHeight;
  const sug = $("suporte-sugestoes");
  sug.textContent = "";
  if (suporteConversa.length < 2) SUPORTE_SUGESTOES.forEach((s) => {
    const b = el("button", "atalho", s);
    b.type = "button";
    b.addEventListener("click", () => enviarSuporte(s));
    sug.append(b);
  });
}

async function enviarSuporte(texto) {
  texto = String(texto || "").trim();
  if (!texto || suporteEnviando) return;
  if (!window.radarNuvem?.usuario) { avisar("Entre na sua conta para usar o suporte."); return; }
  const historico = suporteConversa.slice(-16).map((m) => ({ role: m.de === "eu" ? "user" : "model", parts: [{ text: m.texto }] }));
  suporteConversa.push({ de: "eu", texto, em: new Date().toISOString() });
  suporteEnviando = true;
  renderSuporte();
  try {
    const resposta = await window.radarNuvem.gerarIA([{ text: texto }], { sistema: SUPORTE_SISTEMA, historico });
    suporteConversa.push({ de: "ia", texto: String(resposta).replace(/\*\*/g, "").trim(), em: new Date().toISOString() });
  } catch (e) {
    suporteConversa.push({ de: "ia", texto: `Não consegui responder agora: ${e.message || e}`, em: new Date().toISOString(), erro: true });
  } finally {
    suporteEnviando = false;
    suporteConversa = suporteConversa.slice(-SUPORTE_MAX);
    salvar(CHAVE_SUPORTE, suporteConversa.filter((m) => !m.erro));
    renderSuporte();
  }
}

function abrirSuporte(abrir) {
  $("suporte").hidden = !abrir;
  $("suporte-abrir").setAttribute("aria-expanded", String(abrir));
  if (abrir) { suporteConversa = ler(CHAVE_SUPORTE, suporteConversa); renderSuporte(); $("suporte-texto").focus(); }
}

$("suporte-abrir").addEventListener("click", () => abrirSuporte($("suporte").hidden));
$("suporte-fechar").addEventListener("click", () => { abrirSuporte(false); $("suporte-abrir").focus(); });
$("suporte-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const campo = $("suporte-texto");
  enviarSuporte(campo.value);
  campo.value = "";
  campo.style.height = "";
});
$("suporte-texto").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("suporte-form").requestSubmit(); }
});
$("suporte-texto").addEventListener("input", (e) => { e.target.style.height = ""; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("suporte").hidden) abrirSuporte(false); });
