// Página do Radar de Vagas (OH Tech): lê vagas.json e mostra com busca, filtros, radar e a área pessoal.
// Candidaturas, meta da semana, CVs gerados, perfil e tema ficam só no navegador de quem usa (localStorage).

const FILTROS_PADRAO = { area: "todos", nivel: "todos", regime: "todos", local: "todos", ocultar: false, salario: false, paraVoce: false, texto: "", ordem: "relevancia" };
const filtros = { ...FILTROS_PADRAO };
let dados = { vagas: [] };
let carregado = false;
let erro = "";

const CHAVE_CAND = "radar-vagas:candidaturas";
const CHAVE_META = "radar-vagas:meta-semana";
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
// Salva no navegador e, com a conta conectada, também na nuvem (Firebase)
const salvar = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  window.radarNuvem?.salvar(k, v);
};
const CHAVE_PERFIL_APP = "radar-vagas:perfil"; // o mesmo que o cv.js usa
const CHAVE_HIST = "radar-vagas:cvs-gerados";
const CHAVE_TEMA = "radar-vagas:tema";
const ETAPAS = [
  ["candidatei", "Candidatei"],
  ["entrevista", "Entrevista"],
  ["teste", "Teste técnico"],
  ["proposta", "Proposta"],
  ["recusado", "Não avançou"],
];
const NOME_ETAPA = Object.fromEntries(ETAPAS);
const FOLLOWUP_DIAS = 7;

// Antes era { id: "2026-10-21" }; agora cada candidatura guarda etapa, nota e os dados da vaga (que pode sumir do radar).
function normalizarCandidaturas(c) {
  const out = {};
  for (const [id, x] of Object.entries(c || {})) {
    out[id] = typeof x === "string" ? { data: x, etapa: "candidatei", nota: "", atualizadaEm: x } : { etapa: "candidatei", nota: "", ...x };
  }
  return out;
}
let candidaturas = normalizarCandidaturas(ler(CHAVE_CAND, {}));
const salvarCandidaturas = () => salvar(CHAVE_CAND, candidaturas);
let metaSemana = ler(CHAVE_META, 5);
const FOCO_MIN = 4; // prioridade a partir da qual a vaga combina com o foco do config.json (júnior, PJ, remoto, Paraná)

const $ = (id) => document.getElementById(id);

// ---------- Partes carregadas só quando a pessoa usa (abre o site mais rápido) ----------

const MODULOS = {
  cv: ["cv.js", "cv-ferramentas.js"],          // adaptador de CV
  email: ["@cv", "email.js"],                  // central de e-mail (usa blocos do adaptador)
  evoluir: ["@cv", "evoluir.js"],              // plano de estudos e perfil online (usa a IA do adaptador)
  mercado: ["mercado.js"],
  perguntas: ["@cv", "perguntas.js"],         // respostas para o formulário da candidatura
};
const VERSAO_ARQUIVOS = (document.querySelector('script[src*="app.js"]')?.getAttribute("src").match(/\?v=(\d+)/) || [])[1] || "";
const modulosPedidos = new Map();
const modulosProntos = new Set();

function carregarArquivo(arq) {
  return new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = VERSAO_ARQUIVOS ? `${arq}?v=${VERSAO_ARQUIVOS}` : arq;
    s.onload = ok;
    s.onerror = () => falha(new Error("Sem conexão para carregar esta parte do site. Tente de novo."));
    document.body.append(s);
  });
}
function precisa(nome) {
  if (!modulosPedidos.has(nome)) {
    // "@cv" na lista = carregar o módulo cv antes
    const p = (async () => { for (const arq of MODULOS[nome]) await (arq.startsWith("@") ? precisa(arq.slice(1)) : carregarArquivo(arq)); })();
    p.then(() => modulosProntos.add(nome), () => modulosPedidos.delete(nome)); // se falhar, deixa tentar de novo
    modulosPedidos.set(nome, p);
  }
  return modulosPedidos.get(nome);
}
const moduloPronto = (nome) => modulosProntos.has(nome);

// Atalhos: até o cv.js chegar, estes nomes carregam o adaptador e chamam a versão de verdade (que substitui estas)
async function abrirAdaptador(v) {
  const atalho = abrirAdaptador;
  try { await precisa("cv"); } catch (e) { avisar(e.message); return; }
  if (window.abrirAdaptador !== atalho) window.abrirAdaptador(v);
}
async function abrirHistorico(h) {
  const atalho = abrirHistorico;
  try { await precisa("cv"); } catch (e) { avisar(e.message); return; }
  if (window.abrirHistorico !== atalho) window.abrirHistorico(h);
}
// Carrega o adaptador em segundo plano quando o navegador estiver livre: o primeiro clique já abre na hora
const quandoLivre = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
const svg = (paths) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONES = {
  externo: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  cv: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
};
// Cria um elemento com ícone + texto (ícones são SVG fixos do código; o texto entra como texto)
function comIcone(tag, cls, icone, texto) {
  const n = el(tag, cls);
  n.innerHTML = icone;
  n.append(texto);
  return n;
}
function el(tag, cls, texto) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texto != null) n.textContent = texto;
  return n;
}
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmtData = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "");
const fmtHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function estado(v) {
  if (v.status === "encerrada") return "encerrada";
  if (v.encontradaEm && v.encontradaEm === dados.dataRodada) return "nova";
  return "aberta";
}

function passa(v) {
  if (filtros.area !== "todos" && v.area !== filtros.area) return false;
  if (filtros.nivel !== "todos" && !(v.nivel || "").includes(filtros.nivel)) return false;
  if (filtros.regime !== "todos" && !(v.regime || "").includes(filtros.regime)) return false;
  if (filtros.local !== "todos" && !noLocal(v, filtros.local)) return false;
  if (filtros.ocultar && candidaturas[v.id]) return false;
  if (filtros.salario && !v.salario) return false;
  if (filtros.paraVoce && !combinaComPreferencias(v)) return false;
  if (filtros.texto) {
    const alvo = semAcento([v.titulo, v.empresa, v.local, ...(v.stack || []), ...(v.requisitos || [])].join(" "));
    if (!semAcento(filtros.texto).split(/\s+/).every((p) => alvo.includes(p))) return false;
  }
  return true;
}

function avisar(texto) {
  const t = $("toast");
  // janela aberta fica numa camada própria do navegador: o aviso precisa estar dentro dela para aparecer por cima
  const aberta = [...document.querySelectorAll("dialog[open]")].pop();
  if (t.parentElement !== (aberta || document.body)) (aberta || document.body).append(t);
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => { t.hidden = true; }, 3600);
}

function textoParaAdaptador(v) {
  return [
    `Vaga: ${v.titulo}`,
    v.empresa && `Empresa: ${v.empresa}`,
    [v.area && `Área: ${v.area}`, v.nivel && `Nível: ${v.nivel}`, v.regime && `Contrato: ${v.regime}`, v.modelo && `Modelo: ${v.modelo}`].filter(Boolean).join(" · "),
    v.stack?.length && `Tecnologias: ${v.stack.join(", ")}`,
    v.requisitos?.length && "Requisitos:\n- " + v.requisitos.join("\n- "),
    `Link: ${v.link}`,
  ].filter(Boolean).join("\n");
}

// ---------- Candidaturas e meta da semana ----------

const hojeLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
function inicioSemana() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // segunda-feira
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const feitasNaSemana = () => Object.values(candidaturas).filter((c) => c.data >= inicioSemana()).length;
const diasDesde = (iso) => Math.floor((Date.parse(hojeLocal()) - Date.parse(String(iso).slice(0, 10))) / 86400000);
const precisaFollowup = (c) => c.etapa === "candidatei" && diasDesde(c.atualizadaEm || c.data) >= FOLLOWUP_DIAS;

function alternarCandidatura(v) {
  const id = v.id;
  const marcou = !candidaturas[id];
  if (marcou) candidaturas[id] = { data: hojeLocal(), etapa: "candidatei", nota: "", atualizadaEm: hojeLocal(), titulo: v.titulo, empresa: v.empresa, link: v.link };
  else delete candidaturas[id];
  salvarCandidaturas();
  render();
  if (!marcou) return;
  const falta = metaSemana - feitasNaSemana();
  avisar(falta > 0 ? `Boa! Mais uma candidatura. Faltam ${falta} para a meta da semana.` : "Meta da semana batida! Continue assim.");
}

function renderMeta() {
  const feitas = feitasNaSemana();
  const n = Object.keys(candidaturas).length;
  const pend = Object.values(candidaturas).filter(precisaFollowup).length;
  $("abrir-painel-n").textContent = n ? String(n) : "";
  $("abrir-painel-n").classList.toggle("alerta", pend > 0);
  $("meta-feitas").textContent = feitas;
  $("meta-total").textContent = metaSemana;
  $("meta-fill").style.width = `${Math.min(100, (feitas / metaSemana) * 100)}%`;
  $("meta-curta").classList.toggle("completa", feitas >= metaSemana);
}

// ---------- Cartão de vaga ----------

function cartao(v) {
  const st = estado(v);
  const li = el("li", `vaga ${st}`);
  li.dataset.area = v.area;

  const cab = el("div", "vaga-cab");
  const selos = el("div", "selos");
  selos.append(el("span", "selo area", v.area));
  if (st === "nova") selos.append(el("span", "selo nova", "Nova hoje"));
  if (st === "encerrada") selos.append(el("span", "selo encerrada", "Encerrada"));
  const temPrefs = Object.keys(prefs()).length > 0;
  if (st !== "encerrada" && temPrefs && combinaComPreferencias(v)) {
    const f = el("span", "selo foco", "★ Para você");
    f.title = "Combina com o que você procura (Minhas preferências)";
    selos.append(f);
  } else if (st !== "encerrada" && !temPrefs && (v.prioridade ?? 0) >= FOCO_MIN) {
    const f = el("span", "selo foco", "Combina com você");
    f.title = "Júnior, PJ, remoto ou no Paraná";
    selos.append(f);
  }
  const compat = compatibilidade(v);
  const topoCartao = el("div", "vaga-topo");
  topoCartao.append(selos);
  if (compat) {
    const c = el("span", `compat ${compat.pct >= 70 ? "alta" : compat.pct >= 40 ? "media" : "baixa"}`);
    c.append(el("strong", null, `${compat.pct}%`), " compatível");
    c.title = [
      `Tecnologias: ${compat.tem.length} de ${v.stack.length} no seu CV${compat.falta.length ? ` (falta ${compat.falta.join(", ")})` : ""}`,
      ...compat.fatores.map(([nome, ok]) => `${nome}: ${ok ? "combina com suas preferências" : "diferente do que você procura"}`),
    ].join("\n");
    c.setAttribute("aria-label", `${compat.pct}% compatível. ${c.title.replace(/\n/g, ". ")}`);
    topoCartao.append(c);
  }
  cab.append(topoCartao, el("h2", "titulo", v.titulo), el("div", "empresa", v.empresa || v.fonte));
  li.append(cab);

  const fatos = [v.nivel, v.regime, v.modelo === "Remoto" ? "100% remoto" : v.modelo, v.modelo !== "Remoto" && v.local]
    .filter((x) => x && x !== "Não informado");
  if (fatos.length) li.append(el("p", "fatos", fatos.join("  ·  ")));
  if (v.salario) li.append(el("p", "salario", v.salario));

  if (v.stack?.length) {
    const sk = el("div", "stack");
    v.stack.slice(0, 5).forEach((t) => sk.append(el("span", compat?.tem.includes(t) ? "tem" : null, t)));
    if (v.stack.length > 5) sk.append(el("span", "mais", `+${v.stack.length - 5}`));
    li.append(sk);
  }

  if (v.requisitos?.length) {
    const d = el("details", "req");
    d.append(el("summary", null, `Ver requisitos (${v.requisitos.length})`));
    const ul = el("ul");
    v.requisitos.forEach((r) => ul.append(el("li", null, r)));
    d.append(ul);
    li.append(d);
  }

  const acoes = el("div", "acoes");
  const abrir = comIcone("a", "btn primario", ICONES.externo, st === "encerrada" ? "Ver anúncio" : "Ver vaga");
  abrir.href = v.link;
  abrir.target = "_blank";
  abrir.rel = "noopener noreferrer";
  acoes.append(abrir);
  if (st !== "encerrada") {
    const adaptar = comIcone("button", "btn", ICONES.cv, "Adaptar meu CV");
    adaptar.type = "button";
    adaptar.addEventListener("click", () => abrirAdaptador(v)); // em cv.js
    acoes.append(adaptar);
  }
  li.append(acoes);

  const rodape = el("div", "vaga-rodape");
  const tg = el("button", "toggle");
  tg.type = "button";
  const cand = candidaturas[v.id];
  tg.setAttribute("aria-pressed", String(Boolean(cand)));
  const box = el("span", "box");
  if (cand) box.innerHTML = ICONES.check;
  tg.append(box, document.createTextNode(!cand ? "Já me candidatei" : cand.etapa === "candidatei" ? `Candidatei em ${fmtData(cand.data)}` : `${NOME_ETAPA[cand.etapa]} · candidatei em ${fmtData(cand.data)}`));
  tg.addEventListener("click", () => {
    if (cand && cand.etapa !== "candidatei" && !confirm("Desmarcar apaga o andamento e as notas desta candidatura. Continuar?")) return;
    alternarCandidatura(v);
  });
  rodape.append(tg, el("span", "datas", v.publicadaEm ? `Publicada em ${fmtData(v.publicadaEm)}` : ""));
  li.append(rodape);
  return li;
}

// ---------- Lista aos poucos ----------

const POR_PAGINA = 30;
let limiteLista = POR_PAGINA;
let assinaturaLista = "";
let observadorLista = null;

// Último item da lista: carrega mais sozinho quando aparece na tela (e tem botão, para teclado e leitores de tela)
function maisVagas(restantes) {
  const li = el("li", "mais-vagas");
  const b = el("button", "btn", `Mostrar mais ${Math.min(POR_PAGINA, restantes)} vagas (faltam ${restantes})`);
  b.type = "button";
  const carregarMais = () => {
    observadorLista?.disconnect();
    const y = window.scrollY;
    limiteLista += POR_PAGINA;
    render();
    window.scrollTo(0, y);
  };
  b.addEventListener("click", carregarMais);
  li.append(b);
  if ("IntersectionObserver" in window) {
    observadorLista?.disconnect();
    observadorLista = new IntersectionObserver((itens) => { if (itens.some((i) => i.isIntersecting)) carregarMais(); }, { rootMargin: "600px 0px" });
    requestAnimationFrame(() => observadorLista.observe(li));
  }
  return li;
}

function vazio(titulo, html) {
  const li = el("li", "vazio");
  li.append(el("h2", null, titulo));
  const p = el("p");
  p.innerHTML = html; // texto fixo escrito aqui no código, nunca vindo das vagas
  li.append(p);
  return li;
}

// ---------- Dicas (em destaque, com setas; trocam sozinhas) ----------

const DICAS = [
  "Clique em \"Adaptar meu CV\": a IA lê a vaga, pergunta só o que falta e mostra cada mudança antes de gerar o PDF.",
  "Achou uma vaga em outro site? Cole o link na busca. A IA lê a vaga e adapta seu CV aqui mesmo.",
  "Não cumpre 100% dos requisitos? Candidate-se mesmo assim. Requisito costuma ser lista de desejos.",
  "As vagas que mais combinam com você aparecem primeiro, com o selo \"Combina com você\".",
  "Marque \"Já me candidatei\" depois de enviar. Assim você acompanha a meta da semana no topo da página.",
  "Vagas novas chegam todo dia às 7:15. Quem se candidata cedo tem mais chance de ser visto.",
  "Mostre resultado, não tarefa: \"reduzi o tempo de carregamento em 40%\" chama mais atenção que \"otimizei o site\".",
  "Uma candidatura bem feita por dia são mais de 20 por mês. Constância vence pressa.",
];
let dicaAtual = 0;
function mostrarDica(i) {
  dicaAtual = (i + DICAS.length) % DICAS.length;
  const p = $("dica-texto");
  p.classList.remove("entra");
  void p.offsetWidth; // reinicia a animação de entrada
  p.textContent = DICAS[dicaAtual];
  p.classList.add("entra");
  $("dica-n").textContent = `${dicaAtual + 1} de ${DICAS.length}`;
}
const TROCA_DICA_MS = 15000;
let timerDica = setInterval(() => mostrarDica(dicaAtual + 1), TROCA_DICA_MS);
function irParaDica(i) {
  clearInterval(timerDica);
  mostrarDica(i);
  timerDica = setInterval(() => mostrarDica(dicaAtual + 1), TROCA_DICA_MS);
}
$("dica-proxima").addEventListener("click", () => irParaDica(dicaAtual + 1));
$("dica-anterior").addEventListener("click", () => irParaDica(dicaAtual - 1));
mostrarDica(0);

// ---------- Buscas rápidas ----------

const ATALHOS = [
  ["Júnior remoto", { nivel: "Júnior", local: "remoto" }],
  ["PJ remoto", { regime: "PJ", local: "remoto" }],
  ["React", { texto: "React" }],
  ["Node.js", { texto: "Node" }],
  ["Java", { texto: "Java" }],
  ["Python", { texto: "Python" }],
];
function renderAtalhos() {
  const box = $("atalhos");
  box.textContent = "";
  if (Object.keys(prefs()).length) {
    const b = el("button", "atalho destaque", "★ Para você");
    b.type = "button";
    b.title = "Só as vagas que combinam com Minhas preferências";
    b.setAttribute("aria-pressed", String(filtros.paraVoce));
    b.addEventListener("click", () => { filtros.paraVoce = !filtros.paraVoce; render(); });
    box.append(b);
  }
  ATALHOS.forEach(([rotulo, f]) => {
    const ativo = Object.entries({ ...FILTROS_PADRAO, ...f }).every(([k, v]) => filtros[k] === v);
    const b = el("button", "atalho", rotulo);
    b.type = "button";
    b.setAttribute("aria-pressed", String(ativo));
    b.addEventListener("click", () => { Object.assign(filtros, FILTROS_PADRAO, ativo ? {} : f); sincronizarControles(); render(); });
    box.append(b);
  });
}

// ---------- Link de vaga de outro site ----------

const ehLink = (texto) => /^https?:\/\/\S+\.\S+/i.test(texto);
let linkExterno = "";

function mostrarExterna(url, { soTexto = false } = {}) {
  linkExterno = url;
  const box = $("externa");
  box.hidden = !url && !soTexto;
  $("externa-gatilho").hidden = !box.hidden;
  if (box.hidden) return;
  $("externa-titulo").textContent = soTexto ? "Vaga de outro site" : "Link de vaga de outro site";
  $("externa-explica").textContent = soTexto
    ? "Copie o anúncio inteiro no site da vaga (título, empresa e requisitos) e cole abaixo. A IA lê e adapta seu CV."
    : "A IA abre esse link, lê os requisitos e adapta seu CV, tudo aqui dentro.";
  document.querySelector(".externa-texto").open = soTexto;
  $("externa-abrir").hidden = !url;
  const adaptar = $("externa-adaptar");
  adaptar.innerHTML = ICONES.cv;
  adaptar.append("Ler a vaga e adaptar meu CV");
  if (soTexto) {
    $("externa-site").textContent = "LinkedIn, Indeed, site da empresa…";
    setTimeout(() => $("externa-descricao").focus(), 50);
    return;
  }
  let site = url;
  try { site = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  $("externa-site").textContent = site;
  const abrir = $("externa-abrir");
  abrir.href = url;
  abrir.innerHTML = ICONES.externo;
  abrir.append("Abrir o site da vaga");
}

$("externa-adaptar").addEventListener("click", () => {
  const descricao = $("externa-descricao").value.trim();
  if (!linkExterno && descricao.length < 80) { avisar("Cole o texto completo da vaga (título, empresa e requisitos)."); $("externa-descricao").focus(); return; }
  adaptarVagaExterna({ link: linkExterno, descricao });
});
$("externa-gatilho").addEventListener("click", () => { $("busca").value = ""; filtros.texto = ""; mostrarExterna("", { soTexto: true }); render(); });

// Vaga de fora (link e/ou texto): vira uma "vaga" para o adaptador. O título real a IA tira do texto.
function adaptarVagaExterna({ link = "", descricao = "", titulo = "" }) {
  let site = "outro site";
  try { site = new URL(link).hostname.replace(/^www\./, ""); } catch {}
  const primeira = descricao.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && l.length < 120) || "";
  abrirAdaptador({
    id: `externa-${link || hash(descricao.slice(0, 2000))}`,
    externa: true,
    titulo: titulo || (link ? "Vaga de " + site : primeira || "Vaga de outro site"),
    empresa: "",
    local: link ? site : "",
    link,
    descricao,
  }); // em cv.js
}

// Extensão do navegador: abre o site com #vaga=<texto em base64 UTF-8>&link=...&titulo=...
function lerVagaDoEndereco() {
  // Clique na notificação de vagas novas: abre já filtrado em "Para você"
  if (location.hash === "#para-voce") {
    history.replaceState(null, "", location.pathname + location.search);
    if (Object.keys(prefs()).length) { filtros.paraVoce = true; render(); }
    return;
  }
  if (!location.hash.startsWith("#vaga=")) return;
  const params = new URLSearchParams(location.hash.slice(1));
  let descricao = "";
  try { descricao = new TextDecoder().decode(Uint8Array.from(atob(params.get("vaga") || ""), (c) => c.charCodeAt(0))); } catch {}
  history.replaceState(null, "", location.pathname + location.search); // tira o texto do endereço
  if (descricao.trim().length < 40) return;
  // Não gasta IA sozinho (o link pode vir de qualquer lugar): preenche a caixa e a pessoa confere e clica
  const link = params.get("link") || "";
  mostrarExterna(/^https?:\/\//i.test(link) ? link : "", { soTexto: !/^https?:\/\//i.test(link) });
  $("externa-descricao").value = descricao.slice(0, 15000);
  document.querySelector(".externa-texto").open = true;
  $("externa-explica").textContent = "A extensão trouxe o anúncio abaixo. Confira e clique em \"Ler a vaga e adaptar meu CV\".";
  $("externa").scrollIntoView({ block: "center" });
  $("externa-adaptar").focus();
}

// ---------- Tela ----------

function render() {
  $("rodada").textContent = dados.atualizadoEm
    ? `Vagas de front-end, full-stack e back-end. Atualizado em ${fmtHora(dados.atualizadoEm)}.`
    : carregado ? "Ainda não há vagas carregadas." : "Carregando vagas…";

  const ordem = { nova: 0, aberta: 1, encerrada: 2 };
  const recentes = (a, b) => String(b.publicadaEm).localeCompare(String(a.publicadaEm));
  const criterio = {
    relevancia: (a, b) => ordem[estado(a)] - ordem[estado(b)] || (b.prioridade ?? 0) - (a.prioridade ?? 0) || recentes(a, b),
    compatibilidade: (a, b) => (compatibilidade(b)?.pct ?? -1) - (compatibilidade(a)?.pct ?? -1) || (b.prioridade ?? 0) - (a.prioridade ?? 0),
    recentes,
    salario: (a, b) => valorSalario(b) - valorSalario(a) || recentes(a, b),
  }[filtros.ordem] || ((a, b) => 0);
  const vagas = [...dados.vagas].sort(criterio);
  const abertas = vagas.filter((v) => estado(v) !== "encerrada" && passa(v));
  const fechadas = vagas.filter((v) => estado(v) === "encerrada" && passa(v));
  const total = vagas.filter((v) => estado(v) !== "encerrada").length;

  const lista = $("lista");
  lista.textContent = "";
  if (erro) lista.append(vazio("Não consegui ler as vagas", erro));
  else if (!carregado) lista.append(vazio("Carregando vagas…", "Só um instante."));
  else if (!dados.vagas.length) lista.append(vazio("Nenhuma vaga ainda", "Rode <code>npm run buscar</code> no terminal, na pasta do projeto. Depois atualize esta página."));
  else if (!abertas.length) lista.append(vazio("Nenhuma vaga com esses filtros", "Tente outra palavra na busca ou clique em \"Limpar filtros\"."));
  else {
    // Mostra aos poucos: montar 300 cartões de uma vez deixa a abertura lenta no celular
    const assinatura = JSON.stringify(filtros);
    if (assinatura !== assinaturaLista) { assinaturaLista = assinatura; limiteLista = POR_PAGINA; }
    abertas.slice(0, limiteLista).forEach((v) => lista.append(cartao(v)));
    if (abertas.length > limiteLista) lista.append(maisVagas(abertas.length - limiteLista));
  }

  const filtrado = Object.entries(FILTROS_PADRAO).some(([k, v]) => k !== "ordem" && filtros[k] !== v);
  // No celular, nível/contrato/local/ordem ficam recolhidos atrás de "Filtros": o número mostra quantos estão ligados
  const extras = ["nivel", "regime", "local", "salario", "ocultar", "ordem"].filter((k) => filtros[k] !== FILTROS_PADRAO[k]).length;
  $("filtros-n").textContent = extras ? String(extras) : "";
  $("contagem").textContent = carregado && total ? (filtrado ? `${abertas.length} de ${total} vagas` : `${total} vagas abertas`) : "";
  $("limpar").hidden = !filtrado;
  $("fechadas").hidden = !fechadas.length;
  $("fechadas-resumo").textContent = `${fechadas.length} ${fechadas.length === 1 ? "vaga encerrada" : "vagas encerradas"} recentemente`;
  const lf = $("lista-fechadas");
  lf.textContent = "";
  fechadas.forEach((v) => lf.append(cartao(v)));
  renderMeta();
  renderAtalhos();
  renderAvisos();
  renderRadar(vagas.filter((v) => estado(v) !== "encerrada"));
}

// ---------- Local da vaga: estados e cidades lidos do texto de "local" ----------

const ESTADOS = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
// Cidades que costumam aparecer sozinhas, sem o estado
const CAPITAIS = { "sao paulo": "SP", "rio de janeiro": "RJ", "belo horizonte": "MG", "curitiba": "PR", "porto alegre": "RS", "brasilia": "DF", "recife": "PE", "fortaleza": "CE", "salvador": "BA", "florianopolis": "SC", "goiania": "GO", "campinas": "SP", "manaus": "AM", "belem": "PA", "vitoria": "ES", "joinville": "SC", "londrina": "PR", "maringa": "PR", "ribeirao preto": "SP", "uberlandia": "MG", "sorocaba": "SP", "barueri": "SP", "sao jose dos campos": "SP" };
const NOME_UF = Object.fromEntries(Object.entries(ESTADOS).map(([uf, nome]) => [semAcento(nome), uf]));
const NAO_CIDADE = /^(brasil|brazil|remoto|remote|hibrido|presencial|home office|anywhere|latam|todo o brasil|tempo determinado.*|\d.*)$/;
const cacheLocal = new Map();

function infoLocal(v) {
  if (cacheLocal.has(v.id)) return cacheLocal.get(v.id);
  const texto = String(v.local || "");
  const ufs = new Set();
  const cidades = new Map(); // nome bonito -> uf
  for (const m of texto.matchAll(/\b([A-Z]{2})\b/g)) if (ESTADOS[m[1]]) ufs.add(m[1]);
  const partes = texto.split(/\s*(?:,|;|\/|\||\bou\b|\be\b|\s-\s)\s*/i).map((p) => p.trim()).filter(Boolean);
  partes.forEach((p, i) => {
    const n = semAcento(p);
    if (NOME_UF[n]) {
      // "São Paulo - São Paulo": a parte anterior é a cidade desse estado
      ufs.add(NOME_UF[n]);
      const ant = partes[i - 1];
      if (ant && !NOME_UF[semAcento(ant)] && !ESTADOS[ant] && !NAO_CIDADE.test(semAcento(ant))) {
        const ufAnt = CAPITAIS[semAcento(ant)] || NOME_UF[n]; // "Belo Horizonte ou São Paulo": BH continua em MG
        ufs.add(ufAnt);
        cidades.set(ant, ufAnt);
      }
      return;
    }
    if (ESTADOS[p] || NAO_CIDADE.test(n) || p.length < 3) return;
    const uf = CAPITAIS[n];
    if (uf) { ufs.add(uf); cidades.set(p, uf); }
  });
  // "São Paulo" sozinho também é a cidade
  for (const [nome, uf] of Object.entries({ "São Paulo": "SP", "Rio de Janeiro": "RJ" })) {
    if (ufs.has(uf) && semAcento(texto).includes(semAcento(nome)) && ![...cidades.keys()].some((c) => semAcento(c) === semAcento(nome))) cidades.set(nome, uf);
  }
  const r = { ufs, cidades };
  cacheLocal.set(v.id, r);
  return r;
}

function noLocal(v, filtro) {
  if (filtro === "remoto") return v.modelo === "Remoto";
  const [tipo, valor] = filtro.split(":");
  const info = infoLocal(v);
  if (tipo === "uf") return info.ufs.has(valor);
  if (tipo === "cidade") return [...info.cidades.keys()].some((c) => semAcento(c) === valor);
  return true;
}

// Monta a lista "Local" com o que existe nas vagas abertas, com a quantidade de cada uma
function montarLocais() {
  const abertas = dados.vagas.filter((v) => v.status !== "encerrada");
  const porUf = {}, porCidade = {};
  for (const v of abertas) {
    const info = infoLocal(v);
    info.ufs.forEach((uf) => { porUf[uf] = (porUf[uf] || 0) + 1; });
    info.cidades.forEach((uf, nome) => {
      const k = semAcento(nome);
      porCidade[k] = porCidade[k] || { nome, uf, n: 0 };
      porCidade[k].n++;
    });
  }
  const sel = $("f-local");
  sel.textContent = "";
  const opcao = (valor, texto) => { const o = el("option", null, texto); o.value = valor; return o; };
  sel.append(opcao("todos", "Qualquer lugar"), opcao("remoto", `100% remoto (${abertas.filter((v) => v.modelo === "Remoto").length})`));
  const grupoUf = el("optgroup");
  grupoUf.label = "Estado (presencial ou híbrido)";
  Object.entries(porUf).sort((a, b) => b[1] - a[1]).forEach(([uf, n]) => grupoUf.append(opcao(`uf:${uf}`, `${ESTADOS[uf]} (${n})`)));
  if (grupoUf.children.length) sel.append(grupoUf);
  const grupoCidade = el("optgroup");
  grupoCidade.label = "Cidade";
  Object.entries(porCidade).sort((a, b) => b[1].n - a[1].n || a[1].nome.localeCompare(b[1].nome)).forEach(([k, c]) => grupoCidade.append(opcao(`cidade:${k}`, `${c.nome} - ${c.uf} (${c.n})`)));
  if (grupoCidade.children.length) sel.append(grupoCidade);
  if (![...sel.options].some((o) => o.value === filtros.local)) filtros.local = "todos";
  sel.value = filtros.local;
}

// Preferências do primeiro acesso / Minhas preferências (editadas em onboarding.js)
function prefs() { return ler(CHAVE_PERFIL_APP, {}).preferencias || {}; }

// Mesma regra do alerta por e-mail (scripts/vagas-core.mjs → combinaComAlerta), para o selo "Para você"
function combinaComPreferencias(v, p = prefs()) {
  if (!p || !Object.keys(p).length || v.status === "encerrada") return false;
  if (p.area && p.area !== "todos" && v.area !== p.area) return false;
  if (p.nivel && p.nivel !== "todos" && !String(v.nivel || "").includes(p.nivel)) return false;
  if (p.regime && p.regime !== "todos" && !String(v.regime || "").includes(p.regime)) return false;
  const local = p.local || "todos";
  if (local === "remoto" && v.modelo !== "Remoto") return false;
  if (local.startsWith("uf:") && v.modelo !== "Remoto" && !infoLocal(v).ufs.has(local.slice(3))) return false;
  const tecs = (p.tecnologias || []).map(semAcento).filter(Boolean);
  if (tecs.length) {
    const alvo = [semAcento(v.titulo), ...(v.stack || []).map(semAcento)];
    if (!tecs.some((t) => alvo.some((x) => x.includes(t)))) return false;
  }
  return true;
}

// ---------- Compatibilidade com o CV (calculada aqui, sem gastar IA) ----------

const TECS_CV = {
  "React": /\breact(\.js|js)?\b/i, "Next.js": /next\.?js/i, "Angular": /angular/i, "Vue": /\bvue|nuxt/i,
  "TypeScript": /typescript|\bts\b/i, "JavaScript": /javascript|\bjs\b|es6/i, "HTML/CSS": /\bhtml|\bcss/i, "Tailwind": /tailwind/i,
  "Node.js": /node\.?js|\bnode\b/i, "NestJS": /nest\.?js/i, "Express": /express/i, "Java": /\bjava\b(?!script)/i, "Spring": /spring/i,
  "Python": /python/i, "Django": /django/i, "FastAPI": /fastapi/i, "PHP": /\bphp\b/i, "Laravel": /laravel/i, ".NET": /\.net\b|dotnet/i,
  "C#": /c#/i, "Go": /golang|\bgo\b/i, "Ruby": /\bruby|rails/i, "SQL": /\bsql\b|postgres|mysql|sql server|oracle/i, "MongoDB": /mongo/i,
  "Docker": /docker/i, "AWS": /\baws\b|amazon web services/i, "Git": /\bgit\b|github|gitlab/i, "APIs REST": /\brest\b|restful|\bapis?\b/i,
  "GraphQL": /graphql/i, "Testes": /jest|vitest|cypress|playwright|testes|testing|tdd/i,
};
const textoDoCv = () => { const p = ler(CHAVE_PERFIL_APP, {}); return [p.cvTexto, p.cvExtraido, (p.aprendidas || []).join(", ")].filter(Boolean).join("\n"); };
let cvParaCompat = textoDoCv();
const cacheCompat = new Map();

function compatibilidade(v) {
  if (!cvParaCompat || !v.stack?.length) return null;
  if (cacheCompat.has(v.id)) return cacheCompat.get(v.id);
  const tem = v.stack.filter((tec) => (TECS_CV[tec] || new RegExp(tec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).test(cvParaCompat));
  const pctTec = (tem.length / v.stack.length) * 100;
  // Com preferências salvas, nível, local e contratação valem 1/4 da nota; as tecnologias, 3/4
  const p = prefs();
  const fatores = [];
  if (p.nivel && p.nivel !== "todos" && v.nivel && v.nivel !== "Não informado") fatores.push(["Nível", String(v.nivel).includes(p.nivel)]);
  if (p.local && p.local !== "todos") fatores.push(["Local", p.local === "remoto" ? v.modelo === "Remoto" : v.modelo === "Remoto" || infoLocal(v).ufs.has(p.local.slice(3))]);
  if (p.regime && p.regime !== "todos" && v.regime && v.regime !== "Não informado") fatores.push(["Contratação", String(v.regime).includes(p.regime)]);
  const pctPref = fatores.length ? (fatores.filter(([, ok]) => ok).length / fatores.length) * 100 : null;
  const r = { pct: Math.round(pctPref == null ? pctTec : pctTec * 0.75 + pctPref * 0.25), tem, falta: v.stack.filter((tec) => !tem.includes(tec)), fatores };
  cacheCompat.set(v.id, r);
  return r;
}
// Chamado pelo cv.js quando o CV muda
function atualizarCompatibilidade() {
  cvParaCompat = textoDoCv();
  cacheCompat.clear();
  render();
}

function valorSalario(v) {
  const m = String(v.salario || "").match(/([\d.]+)(?:\s*a\s*([\d.]+))?/);
  if (!m) return -1;
  const a = Number(m[1].replace(/\./g, "")), b = m[2] ? Number(m[2].replace(/\./g, "")) : a;
  return ((a + b) / 2) * (/US\$/.test(v.salario) ? 5 : 1); // dólar convertido por alto só para ordenar
}

// ---------- Avisos no topo da lista (follow-up e CV para compatibilidade) ----------

function renderAvisos() {
  const box = $("avisos");
  box.textContent = "";
  const novasParaVoce = carregado && Object.keys(prefs()).length ? dados.vagas.filter((v) => estado(v) === "nova" && combinaComPreferencias(v)).length : 0;
  if (novasParaVoce && !filtros.paraVoce) {
    const a = el("div", "aviso verde");
    a.innerHTML = svg('<path d="M12 2l2.9 6.9L22 10l-5.5 4.7L18.2 22 12 18.3 5.8 22l1.7-7.3L2 10l7.1-1.1z"/>');
    a.append(el("span", null, `${novasParaVoce} ${novasParaVoce === 1 ? "vaga nova hoje combina" : "vagas novas hoje combinam"} com o que você procura.`));
    const b = el("button", "btn pequeno primario", "Ver só essas");
    b.type = "button";
    b.addEventListener("click", () => { filtros.paraVoce = true; render(); });
    a.append(b);
    box.append(a);
  }
  compromissosProximos().forEach((x) => {
    const a = el("div", "aviso azul");
    a.innerHTML = svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>');
    a.append(el("span", null, `${textoCompromisso(x).titulo} — ${fmtCompromisso(x.compromisso)}.`));
    const b = el("button", "btn pequeno primario", x.etapa === "teste" ? "Ver candidatura" : "Treinar a entrevista");
    b.type = "button";
    b.addEventListener("click", () => {
      const vaga = dados.vagas.find((v) => candidaturas[v.id] === x);
      if (x.etapa !== "teste" && vaga) abrirAdaptador(vaga);
      else abrirPainel("candidaturas");
    });
    a.append(b);
    box.append(a);
  });
  const pendentes = Object.values(candidaturas).filter(precisaFollowup);
  if (pendentes.length) {
    const a = el("div", "aviso laranja");
    a.innerHTML = svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>');
    a.append(el("span", null, `${pendentes.length} ${pendentes.length === 1 ? "candidatura está" : "candidaturas estão"} há mais de ${FOLLOWUP_DIAS} dias sem resposta. Um follow-up educado pode destravar o processo.`));
    const b = el("button", "btn pequeno", "Ver e mandar follow-up");
    b.type = "button";
    b.addEventListener("click", () => abrirPainel("candidaturas"));
    a.append(b);
    box.append(a);
  }
  if (!cvParaCompat && carregado && dados.vagas.length) {
    const a = el("div", "aviso azul");
    a.innerHTML = svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>');
    a.append(el("span", null, "Adicione o texto do seu CV para ver a % de compatibilidade com cada vaga."));
    const b = el("button", "btn pequeno", "Adicionar meu CV");
    b.type = "button";
    b.addEventListener("click", () => abrirPainel("dados"));
    a.append(b);
    box.append(a);
  }
}

// ---------- Minha área: candidaturas, CVs gerados e meus dados ----------

let abaPainel = "candidaturas";
function abrirPainel(aba = abaPainel) {
  abaPainel = aba;
  const d = $("painel");
  if (!d.open) d.showModal();
  renderPainel();
}

function completarCandidaturas() {
  let mudou = false;
  for (const v of dados.vagas) {
    const c = candidaturas[v.id];
    if (c && !c.titulo) { Object.assign(c, { titulo: v.titulo, empresa: v.empresa, link: v.link }); mudou = true; }
  }
  if (mudou) salvarCandidaturas();
}

function renderPainel() {
  document.querySelectorAll(".painel-aba").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === abaPainel)));
  const n = Object.keys(candidaturas).length;
  $("painel-n-cand").textContent = n || "";
  $("painel-n-cvs").textContent = ler(CHAVE_HIST, []).length || "";
  const c = $("painel-corpo");
  c.textContent = "";
  // E-mails e Evoluir vêm de arquivos carregados só quando a aba abre (email.js, evoluir.js)
  const modulo = { emails: "email", evoluir: "evoluir" }[abaPainel];
  if (modulo && !moduloPronto(modulo)) {
    const p = el("p", "cv-carregando");
    p.append(el("span", "cv-spin"), "Carregando…");
    c.append(p);
    precisa(modulo).then(renderPainel, (e) => { c.textContent = ""; c.append(el("p", "cv-erro", e.message)); });
    return;
  }
  ({ candidaturas: painelCandidaturas, emails: window.painelEmails, cvs: painelCvs, evoluir: window.painelEvoluir, dados: painelDados })[abaPainel](c);
}

function painelCandidaturas(c) {
  const lista = Object.entries(candidaturas).sort((a, b) => String(b[1].atualizadaEm || b[1].data).localeCompare(String(a[1].atualizadaEm || a[1].data)));
  if (!lista.length) {
    c.append(el("p", "painel-vazio", "Você ainda não marcou nenhuma candidatura. Quando se candidatar, clique em \"Já me candidatei\" na vaga e acompanhe aqui cada etapa."));
    return;
  }
  const resumo = el("div", "funil");
  ETAPAS.forEach(([id, nome]) => {
    const q = lista.filter(([, x]) => x.etapa === id).length;
    const f = el("div", `funil-etapa etapa-${id}`);
    f.append(el("strong", null, String(q)), el("span", null, nome));
    resumo.append(f);
  });
  c.append(resumo);

  c.append(el("p", "painel-nota quadro-dica", "Arraste os cartões entre as colunas (ou escolha a etapa no cartão)."));
  const colunas = el("div", "quadro");
  ETAPAS.forEach(([id, nome]) => {
    const col = el("section", `quadro-col etapa-${id}`);
    const itens = lista.filter(([, x]) => x.etapa === id);
    col.append(el("h3", null, `${nome} (${itens.length})`));
    if (!itens.length) col.append(el("p", "quadro-vazio", "Nada aqui ainda."));
    itens.forEach(([vid, x]) => col.append(cartaoCandidatura(vid, x)));
    // Soltar um cartão aqui muda a etapa
    col.addEventListener("dragover", (e) => { if (arrastando) { e.preventDefault(); col.classList.add("soltar"); } });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("soltar"); });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("soltar");
      const x = candidaturas[arrastando];
      arrastando = null;
      if (x && x.etapa !== id) mudarEtapa(x, id);
    });
    colunas.append(col);
  });
  c.append(colunas);
}

let arrastando = null; // id da candidatura sendo arrastada no quadro

function mudarEtapa(x, etapa) {
  x.etapa = etapa;
  x.atualizadaEm = hojeLocal();
  salvarCandidaturas();
  render();
  renderPainel();
  if (etapa === "proposta") avisar("Proposta! Parabéns, esse é o resultado da sua constância.");
  else if (etapa === "entrevista" || etapa === "teste") avisar(etapa === "entrevista" ? "Entrevista! Coloque a data no cartão para lembrar e baixar o convite da agenda." : "Teste técnico! Coloque o prazo no cartão para não esquecer.");
}

// ---------- Compromissos (entrevista, prazo de teste): lembrete e convite de agenda ----------

const fmtCompromisso = (iso) => new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const diaLocal = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
function compromissosProximos() {
  const hoje = hojeLocal(), amanha = diaLocal(Date.now() + 86400000);
  return Object.values(candidaturas).filter((c) => c.compromisso && [hoje, amanha].includes(diaLocal(c.compromisso)) && Date.parse(c.compromisso) > Date.now() - 3600000);
}

function textoCompromisso(x) {
  return { titulo: `${x.etapa === "teste" ? "Entrega do teste" : "Entrevista"}: ${x.titulo || "vaga"}${x.empresa ? ` · ${x.empresa}` : ""}`, detalhes: [x.link && `Vaga: ${x.link}`, x.nota].filter(Boolean).join("\n") };
}
// Arquivo .ics: abre no Google Agenda, Outlook ou no calendário do celular, com aviso 1 hora antes
function baixarIcs(x) {
  const ini = new Date(x.compromisso), fim = new Date(ini.getTime() + 60 * 60000);
  const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const { titulo, detalhes } = textoCompromisso(x);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OH Tech//Radar de Vagas//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${hash(titulo + x.compromisso)}@radar-vagas`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(ini)}`, `DTEND:${utc(fim)}`,
    `SUMMARY:${esc(titulo)}`, `DESCRIPTION:${esc(detalhes)}`, ...(x.link ? [`URL:${x.link}`] : []),
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${esc(titulo)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = `${titulo.replace(/[\\/:*?"<>|]/g, "").slice(0, 80)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function linkGoogleAgenda(x) {
  const ini = new Date(x.compromisso), fim = new Date(ini.getTime() + 60 * 60000);
  const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const { titulo, detalhes } = textoCompromisso(x);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titulo)}&dates=${utc(ini)}/${utc(fim)}&details=${encodeURIComponent(detalhes)}`;
}

function blocoCompromisso(x) {
  const box = el("div", "cand-compromisso");
  const rotulo = el("label");
  rotulo.append(el("span", null, x.etapa === "teste" ? "Prazo do teste" : "Data da entrevista"));
  const data = el("input");
  data.type = "datetime-local";
  if (x.compromisso) { const d = new Date(x.compromisso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); data.value = d.toISOString().slice(0, 16); }
  data.addEventListener("change", () => {
    x.compromisso = data.value ? new Date(data.value).toISOString() : "";
    salvarCandidaturas();
    renderPainel();
    render();
  });
  rotulo.append(data);
  box.append(rotulo);
  if (x.compromisso) {
    const acoes = el("div", "cand-agenda");
    const ics = el("button", "btn pequeno", "Baixar convite (.ics)");
    ics.type = "button";
    ics.title = "Abre no Outlook, Apple Calendário ou no celular, com aviso 1 hora antes";
    ics.addEventListener("click", () => baixarIcs(x));
    const g = el("a", "btn pequeno", "Google Agenda");
    g.href = linkGoogleAgenda(x);
    g.target = "_blank";
    g.rel = "noopener noreferrer";
    acoes.append(ics, g);
    box.append(acoes);
  }
  return box;
}

function cartaoCandidatura(id, x) {
  const card = el("article", "cand");
  card.draggable = true;
  card.addEventListener("pointerdown", (e) => { card.draggable = !e.target.closest("input, textarea, select, button, a"); });
  card.addEventListener("dragstart", (e) => { arrastando = id; card.classList.add("arrastando"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); });
  card.addEventListener("dragend", () => { arrastando = null; card.classList.remove("arrastando"); document.querySelectorAll(".quadro-col.soltar").forEach((c) => c.classList.remove("soltar")); });
  const titulo = el("a", "cand-titulo", x.titulo || "Vaga");
  if (x.link) { titulo.href = x.link; titulo.target = "_blank"; titulo.rel = "noopener noreferrer"; }
  card.append(titulo, el("div", "cand-empresa", [x.empresa, `candidatei em ${fmtData(x.data)}`].filter(Boolean).join(" · ")));

  const linha = el("div", "cand-linha");
  const sel = el("select");
  sel.setAttribute("aria-label", "Etapa da candidatura");
  ETAPAS.forEach(([v, nome]) => { const o = el("option", null, nome); o.value = v; sel.append(o); });
  sel.value = x.etapa;
  sel.addEventListener("change", () => mudarEtapa(x, sel.value));
  const dias = diasDesde(x.atualizadaEm || x.data);
  linha.append(sel, el("span", "cand-dias", dias === 0 ? "hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`));
  card.append(linha);
  if (x.etapa === "entrevista" || x.etapa === "teste" || x.compromisso) card.append(blocoCompromisso(x));

  if (precisaFollowup(x)) {
    const f = el("div", "cand-follow");
    f.append(el("span", null, "Hora do follow-up"));
    const b = el("button", "btn pequeno", "Copiar mensagem");
    b.type = "button";
    b.addEventListener("click", async () => {
      const nome = ler(CHAVE_PERFIL_APP, {}).nome || "";
      const msg = `Olá! Tudo bem? Me candidatei à vaga de ${x.titulo || "desenvolvimento"}${x.empresa ? ` na ${x.empresa}` : ""} no dia ${fmtData(x.data)} e continuo com muito interesse na oportunidade. Fico à disposição para conversar e mandar qualquer informação que ajude. Obrigado(a)!${nome ? `\n${nome}` : ""}`;
      try { await navigator.clipboard.writeText(msg); avisar("Mensagem copiada. Mande para o recrutador no LinkedIn ou por e-mail."); }
      catch { prompt("Copie a mensagem:", msg); }
      x.atualizadaEm = hojeLocal(); // conta como contato feito: o lembrete volta daqui a 7 dias
      salvarCandidaturas();
      render();
      renderPainel();
    });
    f.append(b);
    card.append(f);
  }

  // Perguntas do formulário da vaga: a IA responde com base no CV adaptado (perguntas.js, carregado ao abrir)
  const nResp = (x.perguntas || []).length;
  const perguntas = comIcone("button", "btn pequeno cand-perguntas", svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/>'), nResp ? `Respostas do formulário (${nResp})` : "IA: responder perguntas da vaga");
  perguntas.type = "button";
  perguntas.title = "Cole as perguntas do formulário de candidatura e a IA responde com base no seu CV adaptado";
  perguntas.addEventListener("click", async () => {
    try { await precisa("perguntas"); abrirPerguntas(id); } catch (e) { avisar(e.message); }
  });
  card.append(perguntas);

  const nota = el("textarea", "cand-nota");
  nota.rows = 2;
  nota.placeholder = "Anotações: nome do recrutador, data da entrevista, salário combinado…";
  nota.value = x.nota || "";
  nota.setAttribute("aria-label", "Anotações da candidatura");
  nota.addEventListener("input", () => { x.nota = nota.value; salvarCandidaturas(); });
  card.append(nota);

  const rem = el("button", "cand-remover", "Remover");
  rem.type = "button";
  rem.addEventListener("click", () => {
    if (!confirm("Remover esta candidatura do acompanhamento?")) return;
    delete candidaturas[id];
    salvarCandidaturas();
    render();
    renderPainel();
  });
  card.append(rem);
  return card;
}

function painelCvs(c) {
  const hist = ler(CHAVE_HIST, []);
  if (!hist.length) {
    c.append(el("p", "painel-vazio", "Os CVs que a IA adaptar ficam guardados aqui, para abrir de novo, baixar ou gerar a carta de apresentação sem gastar outra chamada."));
    return;
  }
  const ul = el("ul", "hist");
  hist.forEach((h) => {
    const li = el("li", "hist-item");
    const info = el("div");
    info.append(el("strong", null, h.vaga?.titulo || "Vaga"), el("span", null, [h.vaga?.empresa, `gerado em ${fmtData(h.data)}`].filter(Boolean).join(" · ")));
    const acoes = el("div", "hist-acoes");
    const abrir = el("button", "btn pequeno primario", "Abrir");
    abrir.type = "button";
    abrir.addEventListener("click", () => { $("painel").close(); abrirHistorico(h); }); // em cv.js
    const apagar = el("button", "btn pequeno", "Apagar");
    apagar.type = "button";
    apagar.addEventListener("click", () => {
      salvar(CHAVE_HIST, ler(CHAVE_HIST, []).filter((x) => x.id !== h.id));
      renderPainel();
    });
    acoes.append(abrir, apagar);
    li.append(info, acoes);
    ul.append(li);
  });
  c.append(ul);
}

function painelDados(c) {
  const p = ler(CHAVE_PERFIL_APP, {});
  const sec = el("section", "dados-sec");
  sec.append(el("h3", null, "Seu CV em texto"));
  sec.append(el("p", "painel-nota", "Usado para calcular a % de compatibilidade de cada vaga e pelo adaptador de CV. Se você enviou o CV em PDF no adaptador, o texto aparece aqui depois da primeira adaptação."));
  const ta = el("textarea", "dados-cv");
  ta.rows = 8;
  ta.value = p.cvTexto || p.cvExtraido || "";
  ta.placeholder = "Cole aqui o texto do seu CV: experiências, tecnologias, formação…";
  ta.setAttribute("aria-label", "Texto do seu CV");
  const salvarCv = el("button", "btn primario", "Salvar CV");
  salvarCv.type = "button";
  salvarCv.addEventListener("click", () => {
    salvar(CHAVE_PERFIL_APP, { ...ler(CHAVE_PERFIL_APP, {}), cvTexto: ta.value });
    atualizarCompatibilidade();
    avisar("CV salvo. A compatibilidade das vagas foi atualizada.");
  });
  sec.append(ta, salvarCv);
  c.append(sec);
  secaoNotificacoes(c); // em push.js

  const bkp = el("section", "dados-sec");
  bkp.append(el("h3", null, "Backup dos seus dados"));
  bkp.append(el("p", "painel-nota", "Leve suas candidaturas, CVs gerados e perfil para outro navegador ou computador. A chave do Gemini não vai junto no arquivo."));
  const linha = el("div", "dados-acoes");
  const exportar = el("button", "btn", "Baixar backup");
  exportar.type = "button";
  exportar.addEventListener("click", exportarDados);
  const importar = el("label", "btn");
  const arq = el("input");
  arq.type = "file";
  arq.accept = "application/json,.json";
  arq.hidden = true;
  arq.addEventListener("change", () => arq.files[0] && importarDados(arq.files[0]));
  importar.append("Restaurar backup", arq);
  const limpar = el("button", "btn perigo", "Apagar meus dados");
  limpar.type = "button";
  limpar.addEventListener("click", apagarDados);
  linha.append(exportar, importar, limpar);
  bkp.append(linha);
  c.append(bkp);

  if (window.radarNuvem?.usuario) {
    const exc = el("section", "dados-sec perigo-sec");
    exc.append(el("h3", null, "Excluir minha conta"));
    exc.append(el("p", "painel-nota", "Apaga para sempre sua conta de login, candidaturas, CVs gerados, perfil e conversas com o suporte. Não dá para desfazer."));
    const b = el("button", "btn perigo", "Excluir minha conta");
    b.type = "button";
    b.addEventListener("click", async () => {
      const u = window.radarNuvem.usuario;
      if (!confirm("Excluir sua conta e todos os seus dados para sempre?")) return;
      let senha = "";
      if (u.providerData.some((p) => p.providerId === "password")) {
        senha = prompt("Para confirmar, digite a senha da sua conta:") || "";
        if (!senha) return;
      }
      b.disabled = true;
      try {
        await window.radarNuvem.excluirConta(senha);
        alert("Sua conta foi excluída. Obrigado por usar o Radar de Vagas.");
        location.replace("login.html");
      } catch (e) { avisar(window.radarNuvem.mensagemErro(e)); b.disabled = false; }
    });
    exc.append(b);
    c.append(exc);
  }

  const priv = el("section", "dados-sec");
  priv.append(el("h3", null, "Privacidade"));
  const ul = el("ul", "privacidade");
  [
    "Seu CV, suas candidaturas e suas preferências ficam neste navegador e na sua conta (Firebase, do Google), para você usar em qualquer aparelho. Só você e o administrador do Radar têm acesso. O PDF do CV fica só neste navegador.",
    "Quando você usa a IA (adaptador, plano de estudos, revisão do perfil), o texto da vaga e do seu CV vão para o Gemini (Google) para gerar a resposta.",
    "Se você ativar as notificações, o endereço técnico de entrega deste aparelho fica na sua conta. Desativar apaga.",
    "Ao usar \"Usar minha localização\", só a cidade é buscada no OpenStreetMap; a posição exata não é guardada.",
  ].forEach((t) => ul.append(el("li", null, t)));
  priv.append(ul);
  const links = el("p", "painel-nota");
  links.innerHTML = 'Leia a <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a> e os <a href="termos.html" target="_blank" rel="noopener">Termos de uso</a>.'; // texto fixo do código
  priv.append(links);
  c.append(priv);
}

const CHAVES_BACKUP = [CHAVE_CAND, CHAVE_META, CHAVE_PERFIL_APP, CHAVE_HIST, CHAVE_TEMA, "radar-vagas:evoluir"];
function exportarDados() {
  const dadosBkp = { app: "radar-vagas", versao: 1, exportadoEm: new Date().toISOString(), dados: {} };
  for (const k of CHAVES_BACKUP) { const v = ler(k, null); if (v != null) dadosBkp.dados[k] = v; }
  if (dadosBkp.dados[CHAVE_PERFIL_APP]?.cvPdf) dadosBkp.dados[CHAVE_PERFIL_APP] = { ...dadosBkp.dados[CHAVE_PERFIL_APP], cvPdf: null };
  const blob = new Blob([JSON.stringify(dadosBkp, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `radar-vagas-backup-${hojeLocal()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importarDados(arquivo) {
  try {
    const j = JSON.parse(await arquivo.text());
    if (j.app !== "radar-vagas" || !j.dados) throw new Error("formato");
    if (!confirm("Restaurar este backup? Os dados atuais deste navegador serão substituídos.")) return;
    for (const k of CHAVES_BACKUP) if (k in j.dados) salvar(k, j.dados[k]);
    candidaturas = normalizarCandidaturas(ler(CHAVE_CAND, {}));
    atualizarCompatibilidade();
    renderPainel();
    avisar("Backup restaurado.");
  } catch { avisar("Esse arquivo não é um backup do Radar de Vagas."); }
}
function apagarDados() {
  if (!confirm("Apagar suas candidaturas, CVs gerados e perfil (neste navegador e na sua conta)? Isso não pode ser desfeito.")) return;
  for (const k of [...CHAVES_BACKUP, "radar-vagas:suporte"]) {
    try { localStorage.removeItem(k); } catch {}
    window.radarNuvem?.salvar(k, null);
  }
  candidaturas = {};
  atualizarCompatibilidade();
  renderPainel();
  avisar("Seus dados foram apagados.");
}

document.querySelectorAll(".painel-aba").forEach((b) => b.addEventListener("click", () => { abaPainel = b.dataset.aba; renderPainel(); }));
$("abrir-painel").addEventListener("click", () => abrirPainel());
$("painel-fechar").addEventListener("click", () => $("painel").close());
$("painel").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// ---------- Tema claro / escuro ----------

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  const b = $("tema");
  const escuro = tema === "escuro";
  b.innerHTML = escuro
    ? svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>')
    : svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
  b.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
  b.title = b.getAttribute("aria-label");
  document.querySelector('meta[name="theme-color"]').content = escuro ? "#0a0f1d" : "#f5f7fc";
}
$("tema").addEventListener("click", () => {
  const novo = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
  salvar(CHAVE_TEMA, novo);
  aplicarTema(novo);
});
aplicarTema(document.documentElement.dataset.tema || "escuro");

// ---------- Conta (Firebase): login obrigatório, menu do usuário e dados vindos da nuvem ----------

function recarregarDoNavegador() {
  candidaturas = normalizarCandidaturas(ler(CHAVE_CAND, {}));
  metaSemana = ler(CHAVE_META, 5);
  const tema = ler(CHAVE_TEMA, null);
  if (tema) aplicarTema(tema);
  atualizarCompatibilidade(); // também chama render()
}

function renderConta(u, admin) {
  const box = $("conta");
  box.textContent = "";
  if (!u) return;
  const nome = u.displayName || u.email || "Minha conta";
  const botaoConta = el("button", "conta-btn");
  botaoConta.type = "button";
  botaoConta.setAttribute("aria-haspopup", "menu");
  botaoConta.setAttribute("aria-expanded", "false");
  botaoConta.setAttribute("aria-label", `Conta de ${nome}`);
  if (u.photoURL) {
    const img = el("img");
    img.src = u.photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    botaoConta.append(img);
  } else botaoConta.append(el("span", "conta-inicial", nome.trim()[0].toUpperCase()));
  const menu = el("div", "conta-menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.append(el("strong", null, nome), el("span", "conta-email", u.email || ""));
  if (admin) {
    const a = el("a", "conta-item", "Painel do super admin");
    a.href = "admin.html";
    a.setAttribute("role", "menuitem");
    menu.append(a);
  }
  if (!u.emailVerified) {
    const verificar = el("button", "conta-item", "Verificar meu e-mail");
    verificar.type = "button";
    verificar.setAttribute("role", "menuitem");
    verificar.addEventListener("click", async () => {
      try { await window.radarNuvem.reenviarVerificacao(); avisar(`Enviamos o link para ${u.email}. Veja também a caixa de spam. Depois de clicar no link, volte aqui e recarregue a página.`); }
      catch (e) { avisar(window.radarNuvem.mensagemErro(e)); }
    });
    menu.append(verificar);
  }
  // No celular o botão de tema sai do topo (falta espaço) e vem para cá
  const temaBtn = el("button", "conta-item so-celular", document.documentElement.dataset.tema === "escuro" ? "Usar tema claro" : "Usar tema escuro");
  temaBtn.type = "button";
  temaBtn.setAttribute("role", "menuitem");
  temaBtn.addEventListener("click", () => { $("tema").click(); temaBtn.textContent = document.documentElement.dataset.tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"; });
  menu.append(temaBtn);
  const prefBtn = el("button", "conta-item", "Minhas preferências");
  prefBtn.type = "button";
  prefBtn.setAttribute("role", "menuitem");
  prefBtn.addEventListener("click", () => abrirBoasVindas(2)); // em onboarding.js
  menu.append(prefBtn);
  const sairBtn = el("button", "conta-item", "Sair");
  sairBtn.type = "button";
  sairBtn.setAttribute("role", "menuitem");
  sairBtn.addEventListener("click", async () => { await window.radarNuvem.sair(); location.replace("login.html"); });
  menu.append(sairBtn);
  botaoConta.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    botaoConta.setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", () => { menu.hidden = true; botaoConta.setAttribute("aria-expanded", "false"); });
  box.append(botaoConta, menu);
}

window.addEventListener("radar:usuario", (e) => {
  const { usuario, ficha, admin } = e.detail;
  if (!usuario) { location.replace(`login.html?volta=${encodeURIComponent(location.pathname.split("/").pop() || "index.html")}`); return; }
  $("carregando-conta").hidden = true;
  if (ficha?.bloqueado) avisar("Sua conta está bloqueada pelo administrador. Você pode ver as vagas, mas não salvar nem usar a IA.");
  renderConta(usuario, admin);
  recarregarDoNavegador();
  if (!usuario.emailVerified) avisar("Confirme seu e-mail para salvar seus dados na nuvem e usar a IA: menu da conta → Verificar meu e-mail.");
});
window.addEventListener("radar:aviso", (e) => avisar(e.detail));
window.addEventListener("radar:erro-nuvem", (e) => avisar(`Não consegui falar com a nuvem: ${e.detail}`));
// Sem internet o Firebase não carrega: libera a página com os dados guardados neste navegador
setTimeout(() => { if (!window.radarNuvem?.pronto) $("carregando-conta").hidden = true; }, navigator.onLine ? 12000 : 1500);

// ---------- Radar: cada ponto é uma vaga aberta, colorida pela área ----------

const VARREDURA_S = 6; // mesma duração da animação .radar-varredura no CSS

function hash(texto) {
  let h = 2166136261;
  for (const ch of String(texto)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function renderRadar(abertas) {
  const box = $("radar-pontos");
  box.textContent = "";
  abertas.slice(0, 80).forEach((v) => {
    const h = hash(v.id);
    const ang = h % 360;
    const nova = estado(v) === "nova";
    const r = nova ? 12 + ((h >>> 9) % 16) : 22 + ((h >>> 9) % 22); // % do raio; novas mais perto do centro
    const p = el("span", `ponto${(v.prioridade ?? 0) >= FOCO_MIN ? " foco" : ""}`);
    p.dataset.area = v.area;
    p.style.left = `${50 + r * Math.sin((ang * Math.PI) / 180)}%`;
    p.style.top = `${50 - r * Math.cos((ang * Math.PI) / 180)}%`;
    p.style.animationDelay = `${(ang / 360) * VARREDURA_S}s`; // acende quando a varredura passa
    box.append(p);
  });
  const n = (x) => (carregado ? String(x) : "—");
  $("n-abertas").textContent = n(abertas.length);
  $("n-novas").textContent = n(abertas.filter((v) => estado(v) === "nova").length);
  const temPrefs = Object.keys(prefs()).length > 0;
  $("n-foco").textContent = n(abertas.filter((v) => (temPrefs ? combinaComPreferencias(v) : (v.prioridade ?? 0) >= FOCO_MIN)).length);
}

function sincronizarControles() {
  document.querySelectorAll(".aba").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === filtros.area)));
  $("f-nivel").value = filtros.nivel;
  $("f-regime").value = filtros.regime;
  $("f-local").value = filtros.local;
  $("f-ocultar").checked = filtros.ocultar;
  $("f-salario").checked = filtros.salario;
  $("f-ordem").value = filtros.ordem;
  if (!linkExterno) $("busca").value = filtros.texto;
}

document.querySelectorAll(".aba").forEach((b) => b.addEventListener("click", () => { filtros.area = b.dataset.v; sincronizarControles(); render(); }));
$("f-nivel").addEventListener("change", (e) => { filtros.nivel = e.target.value; render(); });
$("f-regime").addEventListener("change", (e) => { filtros.regime = e.target.value; render(); });
$("f-local").addEventListener("change", (e) => { filtros.local = e.target.value; render(); });
$("f-ocultar").addEventListener("change", (e) => { filtros.ocultar = e.target.checked; render(); });
$("f-salario").addEventListener("change", (e) => { filtros.salario = e.target.checked; render(); });
$("f-ordem").addEventListener("change", (e) => { filtros.ordem = e.target.value; render(); });
$("busca").addEventListener("input", (e) => {
  const valor = e.target.value.trim();
  if (ehLink(valor)) { mostrarExterna(valor); filtros.texto = ""; }
  else { mostrarExterna(""); filtros.texto = valor; }
  render();
});
$("filtros-botao").addEventListener("click", () => {
  const aberto = $("filtros-extra").classList.toggle("aberto");
  $("filtros-botao").setAttribute("aria-expanded", String(aberto));
});
$("limpar").addEventListener("click", () => { Object.assign(filtros, FILTROS_PADRAO); sincronizarControles(); render(); });

render();
fetch("vagas.json", { cache: "no-store" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((json) => { dados = { ...json, vagas: Array.isArray(json.vagas) ? json.vagas : [] }; })
  .catch(() => {
    erro = location.protocol === "file:"
      ? "Abrindo o arquivo direto, o navegador bloqueia a leitura do JSON. Use a extensão <b>Live Server</b> do VS Code ou rode <code>npx serve docs</code>."
      : "O arquivo não foi encontrado. Rode <code>npm run buscar</code> para criá-lo.";
  })
  .finally(() => {
    carregado = true; completarCandidaturas(); montarLocais(); render();
    quandoLivre(() => precisa("cv").catch(() => {})); // adianta o adaptador sem atrasar a lista
  });
lerVagaDoEndereco();

$("abrir-mercado").addEventListener("click", async () => {
  try { await precisa("mercado"); abrirMercado(); } catch (e) { avisar(e.message); }
});

// Modo aplicativo: funciona instalado e mostra a última lista mesmo sem internet
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
