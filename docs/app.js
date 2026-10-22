// Página do Radar de Vagas (OH Tech): lê vagas.json e mostra com busca e filtros simples.
// As marcações de "já me candidatei", a meta da semana e a preferência de dicas ficam no navegador (localStorage).

const FILTROS_PADRAO = { area: "todos", nivel: "todos", regime: "todos", remoto: false, ocultar: false, texto: "" };
const filtros = { ...FILTROS_PADRAO };
let dados = { vagas: [] };
let carregado = false;
let erro = "";

const CHAVE_CAND = "radar-vagas:candidaturas";
const CHAVE_META = "radar-vagas:meta-semana";
const CHAVE_DICAS = "radar-vagas:esconder-dicas";
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const salvar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let candidaturas = ler(CHAVE_CAND, {});
const metaSemana = ler(CHAVE_META, 5);
const FOCO_MIN = 4; // prioridade a partir da qual a vaga combina com o foco do config.json (júnior, PJ, remoto, Paraná)

const $ = (id) => document.getElementById(id);
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
    `Área: ${v.area} · Nível: ${v.nivel} · Contrato: ${v.regime} · Modelo: ${v.modelo}`,
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
  const abrir = el("a", "btn primario", st === "encerrada" ? "Ver anúncio" : "Ver vaga ↗");
  abrir.href = v.link;
  abrir.target = "_blank";
  abrir.rel = "noopener noreferrer";
  acoes.append(abrir);
  if (st !== "encerrada") {
    const adaptar = el("button", "btn", "✨ Adaptar meu CV");
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
  tg.append(el("span", "box", marcada ? "✓" : ""), document.createTextNode(marcada ? `Candidatei em ${fmtData(candidaturas[v.id])}` : "Já me candidatei"));
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

// ---------- Dicas (uma por vez, dá para esconder) ----------

const DICAS = [
  "Clique em \"Adaptar meu CV\": a IA lê a vaga, pergunta só o que falta e mostra cada mudança antes de gerar o PDF.",
  "Não cumpre 100% dos requisitos? Candidate-se mesmo assim. Requisito costuma ser lista de desejos.",
  "As vagas que mais combinam com você aparecem primeiro, com o selo \"Combina com você\".",
  "Marque \"Já me candidatei\" depois de enviar. Assim você acompanha a meta da semana no topo da página.",
  "Vagas novas chegam todo dia às 7:15. Quem se candidata cedo tem mais chance de ser visto.",
  "Uma candidatura bem feita por dia são mais de 20 por mês. Constância vence pressa.",
];
let dicaAtual = Math.floor(Math.random() * DICAS.length);
const mostrarDica = () => { $("dica-texto").textContent = DICAS[dicaAtual % DICAS.length]; };
$("dica-proxima").addEventListener("click", () => { dicaAtual++; mostrarDica(); });
$("dica-fechar").addEventListener("click", () => { $("dica").hidden = true; salvar(CHAVE_DICAS, true); });
$("dica").hidden = ler(CHAVE_DICAS, false);
mostrarDica();

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
}

function sincronizarControles() {
  document.querySelectorAll(".aba").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === filtros.area)));
  $("f-nivel").value = filtros.nivel;
  $("f-regime").value = filtros.regime;
  $("f-remoto").checked = filtros.remoto;
  $("f-ocultar").checked = filtros.ocultar;
  $("busca").value = filtros.texto;
}

document.querySelectorAll(".aba").forEach((b) => b.addEventListener("click", () => { filtros.area = b.dataset.v; sincronizarControles(); render(); }));
$("f-nivel").addEventListener("change", (e) => { filtros.nivel = e.target.value; render(); });
$("f-regime").addEventListener("change", (e) => { filtros.regime = e.target.value; render(); });
$("f-remoto").addEventListener("change", (e) => { filtros.remoto = e.target.checked; render(); });
$("f-ocultar").addEventListener("change", (e) => { filtros.ocultar = e.target.checked; render(); });
$("busca").addEventListener("input", (e) => { filtros.texto = e.target.value.trim(); render(); });
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
