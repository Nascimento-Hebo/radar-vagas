// Página do Radar de Vagas: lê vagas.json e mostra com filtros.
// As marcações de "já me candidatei" ficam salvas no seu navegador (localStorage).

const filtros = { area: "todos", nivel: "todos", regime: "todos", remoto: false, ocultar: false, texto: "" };
let dados = { vagas: [] };
let carregado = false;
let erro = "";

const CHAVE_CAND = "radar-vagas:candidaturas";
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const salvar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let candidaturas = ler(CHAVE_CAND, {});

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
  avisar.timer = setTimeout(() => { t.hidden = true; }, 3200);
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

function alternarCandidatura(id) {
  if (candidaturas[id]) delete candidaturas[id];
  else candidaturas[id] = new Date().toISOString().slice(0, 10);
  salvar(CHAVE_CAND, candidaturas);
  render();
}

function cartao(v) {
  const st = estado(v);
  const li = el("li", `vaga ${st}`);
  li.append(el("div", "faixa"));
  const corpo = el("div", "corpo");

  const topo = el("div", "topo");
  const tit = el("div");
  tit.append(el("h2", "titulo", v.titulo), el("div", "empresa", v.empresa || v.fonte));
  const selos = el("div", "selos");
  selos.append(el("span", "selo area", v.area), el("span", `selo ${st}`, st === "nova" ? "Nova hoje" : st === "encerrada" ? "Encerrada" : "Aberta"));
  topo.append(tit, selos);
  corpo.append(topo);

  const meta = el("div", "meta");
  for (const [rotulo, valor] of [["Nível", v.nivel], ["Contrato", v.regime], ["Modelo", v.modelo], ["Local", v.local]]) {
    if (!valor) continue;
    const s = el("span");
    s.append(el("b", null, rotulo), document.createTextNode(valor));
    meta.append(s);
  }
  corpo.append(meta);

  if (v.stack?.length) {
    const sk = el("div", "stack");
    v.stack.forEach((t) => sk.append(el("span", null, t)));
    corpo.append(sk);
  }

  if (v.requisitos?.length) {
    const d = el("details", "req");
    d.append(el("summary", null, `Requisitos (${v.requisitos.length})`));
    const ul = el("ul");
    v.requisitos.forEach((r) => ul.append(el("li", null, r)));
    d.append(ul);
    corpo.append(d);
  }

  const acoes = el("div", "acoes");
  const esq = el("div", "grupo");
  const abrir = el("a", "btn primario", st === "encerrada" ? "Ver anúncio" : "Abrir vaga");
  abrir.href = v.link;
  abrir.target = "_blank";
  abrir.rel = "noopener noreferrer";
  esq.append(abrir);
  if (st !== "encerrada") {
    const adaptar = el("button", "btn", "Adaptar meu CV");
    adaptar.type = "button";
    adaptar.addEventListener("click", () => abrirAdaptador(v)); // em cv.js
    esq.append(adaptar);
  }
  const tg = el("button", "toggle");
  tg.type = "button";
  const marcada = Boolean(candidaturas[v.id]);
  tg.setAttribute("aria-pressed", String(marcada));
  tg.append(el("span", "box", marcada ? "✓" : ""), document.createTextNode(marcada ? `Candidatei em ${fmtData(candidaturas[v.id])}` : "Já me candidatei"));
  tg.addEventListener("click", () => alternarCandidatura(v.id));
  esq.append(tg);
  acoes.append(esq);

  const datas = [v.publicadaEm && `publicada ${fmtData(v.publicadaEm)}`, v.verificadaEm && `conferida ${fmtData(v.verificadaEm)}`].filter(Boolean).join(" · ");
  acoes.append(el("span", "datas", datas));
  corpo.append(acoes);

  li.append(corpo);
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

function render() {
  const rodada = $("rodada");
  rodada.textContent = "";
  if (dados.atualizadoEm) {
    const s = el("span");
    s.append("Última busca: ", el("strong", null, fmtHora(dados.atualizadoEm)));
    rodada.append(s, el("span", "n-new", `${dados.totais?.novas ?? 0} novas`), el("span", null, `${dados.totais?.encerradas ?? 0} encerradas`));
    const n = Object.keys(candidaturas).length;
    if (n) rodada.append(el("span", null, `${n} ${n === 1 ? "candidatura" : "candidaturas"}`));
  } else {
    rodada.append(el("span", null, carregado ? "Nenhuma busca rodou ainda." : "Carregando…"));
  }

  const ordem = { nova: 0, aberta: 1, encerrada: 2 };
  const vagas = [...dados.vagas].sort((a, b) =>
    ordem[estado(a)] - ordem[estado(b)] || (b.prioridade ?? 0) - (a.prioridade ?? 0) || String(b.publicadaEm).localeCompare(String(a.publicadaEm)));
  const abertas = vagas.filter((v) => estado(v) !== "encerrada" && passa(v));
  const fechadas = vagas.filter((v) => estado(v) === "encerrada" && passa(v));
  const total = vagas.filter((v) => estado(v) !== "encerrada").length;

  const lista = $("lista");
  lista.textContent = "";
  if (erro) lista.append(vazio("Não consegui ler o vagas.json", erro));
  else if (!carregado) lista.append(vazio("Carregando vagas…", "Lendo o arquivo da última busca."));
  else if (!dados.vagas.length) lista.append(vazio("Nenhuma vaga ainda", "Rode <code>npm run buscar</code> no terminal, na pasta do projeto. Depois atualize esta página."));
  else if (!abertas.length) lista.append(vazio("Nenhuma vaga com esses filtros", "Tente liberar algum filtro, como área, nível ou tipo de contrato."));
  else abertas.forEach((v) => lista.append(cartao(v)));

  $("contagem").textContent = carregado && total ? `${abertas.length} de ${total} vagas abertas` : "";
  $("fechadas").hidden = !fechadas.length;
  $("fechadas-resumo").textContent = `${fechadas.length} ${fechadas.length === 1 ? "vaga encerrada" : "vagas encerradas"} recentemente`;
  const lf = $("lista-fechadas");
  lf.textContent = "";
  fechadas.forEach((v) => lf.append(cartao(v)));
}

document.querySelectorAll(".chip").forEach((b) => {
  b.addEventListener("click", () => {
    const f = b.dataset.f;
    if (f === "remoto" || f === "ocultar") {
      filtros[f] = !filtros[f];
      b.setAttribute("aria-pressed", String(filtros[f]));
    } else {
      filtros[f] = b.dataset.v;
      document.querySelectorAll(`.chip[data-f="${f}"]`).forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    }
    render();
  });
});
$("busca").addEventListener("input", (e) => { filtros.texto = e.target.value.trim(); render(); });

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
