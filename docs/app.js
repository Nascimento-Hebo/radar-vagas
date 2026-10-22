// Página do Radar de Vagas (OH Tech): lê vagas.json e mostra com busca e filtros simples.
// As marcações de "já me candidatei", a meta da semana e a preferência de dicas ficam no navegador (localStorage).

const FILTROS_PADRAO = { area: "todos", nivel: "todos", regime: "todos", remoto: false, ocultar: false, texto: "" };
const filtros = { ...FILTROS_PADRAO };
let dados = { vagas: [] };
let carregado = false;
let erro = "";

const CHAVE_CAND = "radar-vagas:candidaturas";
const CHAVE_META = "radar-vagas:meta-semana";
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const salvar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let candidaturas = ler(CHAVE_CAND, {});
const metaSemana = ler(CHAVE_META, 5);
const FOCO_MIN = 4; // prioridade a partir da qual a vaga combina com o foco do config.json (júnior, PJ, remoto, Paraná)

const $ = (id) => document.getElementById(id);
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
  if (filtros.remoto && v.modelo !== "Remoto") return false;
  if (filtros.ocultar && candidaturas[v.id]) return false;
  if (filtros.texto) {
    const alvo = semAcento([v.titulo, v.empresa, v.local, ...(v.stack || []), ...(v.requisitos || [])].join(" "));
    if (!semAcento(filtros.texto).split(/\s+/).every((p) => alvo.includes(p))) return false;
  }
  return true;
}

function avisar(texto) {
  const t = $("toast");
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
const feitasNaSemana = () => Object.values(candidaturas).filter((d) => d >= inicioSemana()).length;

function alternarCandidatura(id) {
  const marcou = !candidaturas[id];
  if (marcou) candidaturas[id] = hojeLocal();
  else delete candidaturas[id];
  salvar(CHAVE_CAND, candidaturas);
  render();
  if (!marcou) return;
  const falta = metaSemana - feitasNaSemana();
  avisar(falta > 0 ? `Boa! Mais uma candidatura. Faltam ${falta} para a meta da semana.` : "Meta da semana batida! Continue assim.");
}

function renderMeta() {
  const feitas = feitasNaSemana();
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
  if (st !== "encerrada" && (v.prioridade ?? 0) >= FOCO_MIN) {
    const f = el("span", "selo foco", "Combina com você");
    f.title = "Júnior, PJ, remoto ou no Paraná";
    selos.append(f);
  }
  cab.append(selos, el("h2", "titulo", v.titulo), el("div", "empresa", v.empresa || v.fonte));
  li.append(cab);

  const fatos = [v.nivel, v.regime, v.modelo === "Remoto" ? "100% remoto" : v.modelo, v.modelo !== "Remoto" && v.local]
    .filter((x) => x && x !== "Não informado");
  if (fatos.length) li.append(el("p", "fatos", fatos.join("  ·  ")));

  if (v.stack?.length) {
    const sk = el("div", "stack");
    v.stack.slice(0, 5).forEach((t) => sk.append(el("span", null, t)));
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
  const marcada = Boolean(candidaturas[v.id]);
  tg.setAttribute("aria-pressed", String(marcada));
  const box = el("span", "box");
  if (marcada) box.innerHTML = ICONES.check;
  tg.append(box, document.createTextNode(marcada ? `Candidatei em ${fmtData(candidaturas[v.id])}` : "Já me candidatei"));
  tg.addEventListener("click", () => alternarCandidatura(v.id));
  rodape.append(tg, el("span", "datas", v.publicadaEm ? `Publicada em ${fmtData(v.publicadaEm)}` : ""));
  li.append(rodape);
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
  ["Júnior remoto", { nivel: "Júnior", remoto: true }],
  ["PJ remoto", { regime: "PJ", remoto: true }],
  ["React", { texto: "React" }],
  ["Node.js", { texto: "Node" }],
  ["Java", { texto: "Java" }],
  ["Python", { texto: "Python" }],
];
function renderAtalhos() {
  const box = $("atalhos");
  box.textContent = "";
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

function mostrarExterna(url) {
  linkExterno = url;
  const box = $("externa");
  box.hidden = !url;
  if (!url) return;
  let site = url;
  try { site = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  $("externa-site").textContent = site;
  const abrir = $("externa-abrir");
  abrir.href = url;
  abrir.innerHTML = ICONES.externo;
  abrir.append("Abrir o site da vaga");
  const adaptar = $("externa-adaptar");
  adaptar.innerHTML = ICONES.cv;
  adaptar.append("Ler a vaga e adaptar meu CV");
}

$("externa-adaptar").addEventListener("click", () => {
  if (!linkExterno) return;
  let site = "outro site";
  try { site = new URL(linkExterno).hostname.replace(/^www\./, ""); } catch {}
  abrirAdaptador({
    id: `externa-${linkExterno}`,
    externa: true,
    titulo: "Vaga de " + site,
    empresa: "",
    local: site,
    link: linkExterno,
    descricao: $("externa-descricao").value.trim(),
  }); // em cv.js
});

// ---------- Tela ----------

function render() {
  $("rodada").textContent = dados.atualizadoEm
    ? `Vagas de front-end, full-stack e back-end. Atualizado em ${fmtHora(dados.atualizadoEm)}.`
    : carregado ? "Ainda não há vagas carregadas." : "Carregando vagas…";

  const ordem = { nova: 0, aberta: 1, encerrada: 2 };
  const vagas = [...dados.vagas].sort((a, b) =>
    ordem[estado(a)] - ordem[estado(b)] || (b.prioridade ?? 0) - (a.prioridade ?? 0) || String(b.publicadaEm).localeCompare(String(a.publicadaEm)));
  const abertas = vagas.filter((v) => estado(v) !== "encerrada" && passa(v));
  const fechadas = vagas.filter((v) => estado(v) === "encerrada" && passa(v));
  const total = vagas.filter((v) => estado(v) !== "encerrada").length;

  const lista = $("lista");
  lista.textContent = "";
  if (erro) lista.append(vazio("Não consegui ler as vagas", erro));
  else if (!carregado) lista.append(vazio("Carregando vagas…", "Só um instante."));
  else if (!dados.vagas.length) lista.append(vazio("Nenhuma vaga ainda", "Rode <code>npm run buscar</code> no terminal, na pasta do projeto. Depois atualize esta página."));
  else if (!abertas.length) lista.append(vazio("Nenhuma vaga com esses filtros", "Tente outra palavra na busca ou clique em \"Limpar filtros\"."));
  else abertas.forEach((v) => lista.append(cartao(v)));

  const filtrado = Object.entries(FILTROS_PADRAO).some(([k, v]) => filtros[k] !== v);
  $("contagem").textContent = carregado && total ? (filtrado ? `${abertas.length} de ${total} vagas` : `${total} vagas abertas`) : "";
  $("limpar").hidden = !filtrado;
  $("fechadas").hidden = !fechadas.length;
  $("fechadas-resumo").textContent = `${fechadas.length} ${fechadas.length === 1 ? "vaga encerrada" : "vagas encerradas"} recentemente`;
  const lf = $("lista-fechadas");
  lf.textContent = "";
  fechadas.forEach((v) => lf.append(cartao(v)));
  renderMeta();
  renderAtalhos();
  renderRadar(vagas.filter((v) => estado(v) !== "encerrada"));
}

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
  $("n-foco").textContent = n(abertas.filter((v) => (v.prioridade ?? 0) >= FOCO_MIN).length);
}

function sincronizarControles() {
  document.querySelectorAll(".aba").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === filtros.area)));
  $("f-nivel").value = filtros.nivel;
  $("f-regime").value = filtros.regime;
  $("f-remoto").checked = filtros.remoto;
  $("f-ocultar").checked = filtros.ocultar;
  if (!linkExterno) $("busca").value = filtros.texto;
}

document.querySelectorAll(".aba").forEach((b) => b.addEventListener("click", () => { filtros.area = b.dataset.v; sincronizarControles(); render(); }));
$("f-nivel").addEventListener("change", (e) => { filtros.nivel = e.target.value; render(); });
$("f-regime").addEventListener("change", (e) => { filtros.regime = e.target.value; render(); });
$("f-remoto").addEventListener("change", (e) => { filtros.remoto = e.target.checked; render(); });
$("f-ocultar").addEventListener("change", (e) => { filtros.ocultar = e.target.checked; render(); });
$("busca").addEventListener("input", (e) => {
  const valor = e.target.value.trim();
  if (ehLink(valor)) { mostrarExterna(valor); filtros.texto = ""; }
  else { mostrarExterna(""); filtros.texto = valor; }
  render();
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
  .finally(() => { carregado = true; render(); });
