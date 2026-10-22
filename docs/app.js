// Página do Radar de Vagas (OH Tech): lê vagas.json e mostra com filtros, radar, meta e dicas.
// As marcações de "já me candidatei" e a meta da semana ficam salvas no seu navegador (localStorage).

const filtros = { area: "todos", nivel: "todos", regime: "todos", remoto: false, ocultar: false, texto: "" };
let dados = { vagas: [] };
let carregado = false;
let erro = "";

const CHAVE_CAND = "radar-vagas:candidaturas";
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const salvar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let candidaturas = ler(CHAVE_CAND, {});
const CHAVE_META = "radar-vagas:meta-semana";
let metaSemana = ler(CHAVE_META, 5);
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

const hojeLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
function inicioSemana() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // segunda-feira
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const feitasNaSemana = () => Object.values(candidaturas).filter((d) => d >= inicioSemana()).length;

const COMEMORA = [
  "Mais uma no radar. Constância é o que separa quem procura de quem é contratado.",
  "Boa! Cada candidatura bem feita aumenta suas chances.",
  "Registrado. Agora siga para a próxima: o ritmo importa.",
  "Isso aí! Quem se candidata com CV adaptado sai na frente.",
];

function alternarCandidatura(id) {
  const marcou = !candidaturas[id];
  if (marcou) candidaturas[id] = hojeLocal();
  else delete candidaturas[id];
  salvar(CHAVE_CAND, candidaturas);
  render();
  if (!marcou) return;
  const falta = metaSemana - feitasNaSemana();
  avisar(falta > 0 ? `${COMEMORA[Math.floor(Math.random() * COMEMORA.length)]} Faltam ${falta} para a meta da semana.`
    : falta === 0 ? "Meta da semana batida! Você está no ritmo certo."
    : "Acima da meta! Continue enquanto o ritmo está bom.");
}

function cartao(v) {
  const st = estado(v);
  const li = el("li", `vaga ${st}`);
  li.dataset.area = v.area;
  li.append(el("div", "faixa"));
  const corpo = el("div", "corpo");

  const topo = el("div", "topo");
  const tit = el("div");
  tit.append(el("h2", "titulo", v.titulo), el("div", "empresa", v.empresa || v.fonte));
  const selos = el("div", "selos");
  selos.append(el("span", "selo area", v.area), el("span", `selo ${st}`, st === "nova" ? "Nova hoje" : st === "encerrada" ? "Encerrada" : "Aberta"));
  if (st !== "encerrada" && (v.prioridade ?? 0) >= FOCO_MIN) {
    const f = el("span", "selo foco", "◎ No seu foco");
    f.title = "Combina com o foco do radar: júnior, PJ, remoto ou Paraná";
    selos.prepend(f);
  }
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
    s.append("Última varredura: ", el("strong", null, fmtHora(dados.atualizadoEm)));
    rodada.append(s, el("span", null, "Próxima: amanhã às 7:15"));
    const enc = dados.totais?.encerradas ?? 0;
    if (enc) rodada.append(el("span", null, `${enc} ${enc === 1 ? "vaga fechou" : "vagas fecharam"} desde a anterior`));
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

  const todasAbertas = vagas.filter((v) => estado(v) !== "encerrada");
  renderHud(todasAbertas);
  renderRadar(todasAbertas);
  renderMeta();
  renderLeitura(abertas, total);
  dicas = montarDicas(todasAbertas, abertas);
  if (!dicaMostrada) mostrarDica(0);
  $("fechadas").hidden = !fechadas.length;
  $("fechadas-resumo").textContent = `${fechadas.length} ${fechadas.length === 1 ? "vaga encerrada" : "vagas encerradas"} recentemente`;
  const lf = $("lista-fechadas");
  lf.textContent = "";
  fechadas.forEach((v) => lf.append(cartao(v)));
}

// ---------- Painéis: números, radar, meta, leitura e dicas ----------

function renderHud(abertas) {
  const hud = $("hud");
  hud.textContent = "";
  const novas = abertas.filter((v) => estado(v) === "nova").length;
  const remotas = abertas.filter((v) => v.modelo === "Remoto").length;
  const foco = abertas.filter((v) => (v.prioridade ?? 0) >= FOCO_MIN).length;
  const minhas = Object.keys(candidaturas).length;
  const n = (x) => (carregado ? String(x) : "—");
  const itens = [
    ["Vagas abertas", n(abertas.length), "no radar agora", ""],
    ["Novas hoje", n(novas), novas ? "da última varredura" : "nada novo desde ontem", "verde"],
    ["No seu foco", n(foco), "júnior, PJ, remoto ou PR", "laranja"],
    ["100% remoto", n(remotas), abertas.length ? `${Math.round((remotas / abertas.length) * 100)}% das abertas` : "", ""],
    ["Suas candidaturas", String(minhas), minhas ? `${feitasNaSemana()} nesta semana` : "marque nas vagas", ""],
  ];
  for (const [rotulo, valor, nota, cor] of itens) {
    const c = el("div", `hud-item ${cor}`.trim());
    c.append(el("span", "hud-rotulo", rotulo), el("strong", "hud-valor", valor), el("span", "hud-nota", nota));
    hud.append(c);
  }
}

function hash(texto) {
  let h = 2166136261;
  for (const ch of String(texto)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const VARREDURA_S = 6; // mesma duração da animação .radar-varredura no CSS
function renderRadar(abertas) {
  const box = $("radar-pontos");
  box.textContent = "";
  abertas.slice(0, 60).forEach((v) => {
    const h = hash(v.id);
    const ang = h % 360;
    const nova = estado(v) === "nova";
    const r = nova ? 10 + ((h >>> 9) % 18) : 20 + ((h >>> 9) % 26); // novas mais perto do centro (em % do raio)
    const p = el("span", "ponto");
    p.dataset.area = v.area;
    p.style.left = `${50 + r * Math.sin((ang * Math.PI) / 180)}%`;
    p.style.top = `${50 - r * Math.cos((ang * Math.PI) / 180)}%`;
    p.style.animationDelay = `${(ang / 360) * VARREDURA_S}s`; // acende quando a varredura passa
    box.append(p);
  });
  $("status-texto").textContent = carregado && dados.atualizadoEm ? `Radar online · ${abertas.length} sinais` : "Radar online";
}

function renderMeta() {
  const feitas = feitasNaSemana();
  const pct = Math.min(100, Math.round((feitas / metaSemana) * 100));
  $("meta-valor").textContent = metaSemana;
  $("meta-feitas").textContent = feitas;
  $("meta-de").textContent = `/ ${metaSemana} candidaturas`;
  $("meta-fill").style.width = `${pct}%`;
  const barra = $("meta-barra");
  barra.setAttribute("aria-valuemax", metaSemana);
  barra.setAttribute("aria-valuenow", feitas);
  barra.classList.toggle("completa", feitas >= metaSemana);
  const dia = (new Date().getDay() + 6) % 7; // 0 = segunda
  $("meta-msg").textContent = feitas >= metaSemana ? "Meta batida. Agora é qualidade: revise o LinkedIn e prepare-se para as entrevistas."
    : feitas === 0 && dia <= 1 ? "Semana nova, radar limpo. Comece pela primeira vaga da lista: é a que mais combina com você."
    : feitas === 0 ? "Ainda sem candidaturas nesta semana. Uma agora já tira você do zero."
    : pct >= 60 ? `Quase lá: faltam ${metaSemana - feitas}. Mantenha o ritmo.`
    : `Bom começo. Faltam ${metaSemana - feitas} para a meta. Uma por dia resolve.`;
}

function renderLeitura(abertas, total) {
  const box = $("leitura");
  box.textContent = "";
  if (!carregado || !total) return;
  const cont = el("span", "leitura-cont");
  cont.append(el("strong", null, String(abertas.length)), ` de ${total} vagas na tela`);
  box.append(cont);
  const freq = {};
  abertas.forEach((v) => (v.stack || []).forEach((t) => { freq[t] = (freq[t] || 0) + 1; }));
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) return;
  const tech = el("span", "leitura-tech");
  tech.append(el("span", "leitura-rotulo", "Mais pedidas aqui:"));
  top.forEach(([nome, qtd]) => {
    const b = el("button", "tech");
    b.type = "button";
    b.title = `Buscar vagas com ${nome}`;
    b.append(nome, el("span", null, String(qtd)));
    b.addEventListener("click", () => { $("busca").value = nome; filtros.texto = nome; render(); });
    tech.append(b);
  });
  box.append(tech);
}

const DICAS_FIXAS = [
  "Não cumpre 100% dos requisitos? Candidate-se mesmo assim. Requisito costuma ser lista de desejos, não muro.",
  "Adapte o CV para cada vaga. O adaptador mostra o que a vaga pede e o que falta no seu CV, e você revisa tudo antes de baixar.",
  "Antes de enviar, abra a aba \"O que a IA fez\" no adaptador. Quem responde pelo CV é você, não a IA.",
  "Constância vence intensidade: uma candidatura bem feita por dia são mais de 20 por mês.",
  "Vagas novas chegam todo dia às 7:15. Volte de manhã para estar entre os primeiros a se candidatar.",
  "Marque \"Já me candidatei\" em cada vaga. Assim você acompanha a meta da semana e esconde o que já fez.",
  "Use as tecnologias mais pedidas, logo acima da lista, para decidir o que estudar a seguir.",
  "Recrutador lê o CV em segundos. Os três primeiros itens de cada experiência são os que mais contam.",
  "Um projeto no GitHub com README caprichado vale mais que uma lista longa de cursos.",
];

let dicas = DICAS_FIXAS;
let dicaAtual = 0;
let dicaMostrada = false;

function montarDicas(todas, visiveis) {
  const ctx = [];
  const novas = todas.filter((v) => estado(v) === "nova").length;
  if (novas) ctx.push(`Hoje entraram ${novas} vagas novas. Nas primeiras 48 horas o recrutador ainda lê cada candidatura com calma.`);
  if (!Object.keys(candidaturas).length) ctx.push("Primeira vez por aqui? Escolha uma vaga \"No seu foco\", clique em \"Adaptar meu CV\" e marque \"Já me candidatei\" quando enviar.");
  const foco = visiveis.filter((v) => (v.prioridade ?? 0) >= FOCO_MIN).length;
  if (foco) ctx.push(`${foco} das vagas na tela estão no seu foco. Elas aparecem primeiro na lista.`);
  if (filtros.area !== "todos" && visiveis.length) ctx.push(`Você está vendo só ${filtros.area}. Vale olhar Full-stack também: muitas vagas pedem as mesmas tecnologias.`);
  if (filtros.texto && visiveis.length < 3) ctx.push(`Poucas vagas com "${filtros.texto}". Tente um termo mais amplo ou tire algum filtro.`);
  return [...ctx, ...DICAS_FIXAS];
}

function mostrarDica(i) {
  if (!dicas.length) return;
  dicaAtual = ((i % dicas.length) + dicas.length) % dicas.length;
  dicaMostrada = true;
  const t = $("dica-texto");
  t.classList.remove("entra");
  void t.offsetWidth; // reinicia a animação de entrada
  t.textContent = dicas[dicaAtual];
  t.classList.add("entra");
  const pts = $("dica-pontos");
  pts.textContent = "";
  dicas.forEach((_, n) => pts.append(el("span", n === dicaAtual ? "ativo" : null)));
}

const TROCA_DICA_MS = 12000;
let timerDica = setInterval(() => mostrarDica(dicaAtual + 1), TROCA_DICA_MS);
$("dica-proxima").addEventListener("click", () => {
  clearInterval(timerDica);
  mostrarDica(dicaAtual + 1);
  timerDica = setInterval(() => mostrarDica(dicaAtual + 1), TROCA_DICA_MS);
});

function mudarMeta(delta) {
  metaSemana = Math.max(1, Math.min(30, metaSemana + delta));
  salvar(CHAVE_META, metaSemana);
  renderMeta();
}
$("meta-menos").addEventListener("click", () => mudarMeta(-1));
$("meta-mais").addEventListener("click", () => mudarMeta(1));

document.querySelectorAll(".filtros .chip").forEach((b) => {
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
