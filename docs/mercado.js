// Painel do mercado: o que as vagas abertas pedem, quanto pagam e como o número de vagas muda dia a dia.
// Usa as vagas já carregadas (app.js) e o docs/historico.json que o robô grava a cada busca.

const NIVEIS_MERCADO = ["Estágio", "Júnior", "Pleno", "Sênior", "Especialista"];
const REGIMES_MERCADO = ["CLT", "PJ", "Freela"];
const filtroMercado = { area: "todos", nivel: "todos" };
let historicoMercado = null; // { dias: [...] } depois de carregado

const fmtN = (n) => Number(n).toLocaleString("pt-BR");
const fmtReais = (n) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const pctDe = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Uma dica flutuante para todos os gráficos (mouse e teclado)
function dicaGrafico() {
  let d = document.getElementById("mercado-dica");
  if (!d) {
    d = el("div", "mercado-dica");
    d.id = "mercado-dica";
    d.setAttribute("role", "status");
    d.hidden = true;
  }
  const dlg = $("mercado");
  if (d.parentElement !== dlg) dlg.append(d);
  return d;
}
function mostrarDicaGrafico(alvo, valor, rotulo) {
  const d = dicaGrafico();
  d.textContent = "";
  d.append(el("strong", null, valor), el("span", null, rotulo));
  d.hidden = false;
  const r = alvo.getBoundingClientRect();
  const largura = d.offsetWidth;
  d.style.left = `${Math.max(8, Math.min(window.innerWidth - largura - 8, r.left + r.width / 2 - largura / 2))}px`;
  d.style.top = `${Math.max(8, r.top - d.offsetHeight - 8)}px`;
}
const esconderDicaGrafico = () => { const d = document.getElementById("mercado-dica"); if (d) d.hidden = true; };

function vagasDoMercado() {
  return dados.vagas.filter((v) => estado(v) !== "encerrada"
    && (filtroMercado.area === "todos" || v.area === filtroMercado.area)
    && (filtroMercado.nivel === "todos" || String(v.nivel || "").includes(filtroMercado.nivel)));
}

function cartaoMercado(titulo, sub) {
  const c = el("section", "mercado-cartao");
  c.append(el("h3", null, titulo));
  if (sub) c.append(el("p", "mercado-sub", sub));
  return c;
}

// Barras horizontais com o valor na ponta. itens: [{ rotulo, valor, extra? }]
function barras(itens, total, { marca } = {}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const lista = el("div", "barras");
  lista.setAttribute("role", "list");
  itens.forEach((i) => {
    const linha = el("div", "barra-linha");
    linha.setAttribute("role", "listitem");
    linha.tabIndex = 0;
    const nome = el("span", "barra-nome", i.rotulo);
    if (marca?.(i)) nome.append(el("span", "barra-marca", "✓ no seu CV"));
    const trilho = el("span", "barra-trilho");
    const barra = el("span", "barra");
    barra.style.width = `${Math.max(1.5, (i.valor / max) * 100)}%`;
    trilho.append(barra);
    const valor = el("span", "barra-valor", fmtN(i.valor));
    linha.append(nome, trilho, valor);
    const texto = `${fmtN(i.valor)} ${i.valor === 1 ? "vaga" : "vagas"}`;
    const rotulo = `${i.rotulo} · ${pctDe(i.valor, total)}% das vagas${i.extra ? ` · ${i.extra}` : ""}`;
    linha.setAttribute("aria-label", `${texto}. ${rotulo}`);
    const ver = () => mostrarDicaGrafico(barra, texto, rotulo);
    linha.addEventListener("pointerenter", ver);
    linha.addEventListener("focus", ver);
    linha.addEventListener("pointerleave", esconderDicaGrafico);
    linha.addEventListener("blur", esconderDicaGrafico);
    lista.append(linha);
  });
  return lista;
}

function blocoNumeros(vagas) {
  const box = el("div", "mercado-numeros");
  const remotas = vagas.filter((v) => v.modelo === "Remoto").length;
  const novas = vagas.filter((v) => estado(v) === "nova").length;
  const comSalario = vagas.filter((v) => v.salario).length;
  [
    ["Vagas abertas", fmtN(vagas.length), "agora no radar"],
    ["100% remotas", `${pctDe(remotas, vagas.length)}%`, `${fmtN(remotas)} vagas`],
    ["Novas hoje", fmtN(novas), "chegaram na última busca"],
    ["Mostram salário", `${pctDe(comSalario, vagas.length)}%`, `${fmtN(comSalario)} vagas`],
  ].forEach(([rotulo, valor, sub]) => {
    const t = el("div", "mercado-numero");
    t.append(el("span", "mn-rotulo", rotulo), el("strong", null, valor), el("span", "mn-sub", sub));
    box.append(t);
  });
  return box;
}

function blocoTecnologias(vagas) {
  const contagem = {};
  vagas.forEach((v) => (v.stack || []).forEach((t) => { contagem[t] = (contagem[t] || 0) + 1; }));
  const itens = Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([rotulo, valor]) => ({ rotulo, valor }));
  const c = cartaoMercado("Tecnologias mais pedidas", "Quantas vagas abertas citam cada tecnologia.");
  if (!itens.length) { c.append(el("p", "painel-vazio", "Nenhuma vaga com esse filtro.")); return c; }
  const noCv = (i) => cvParaCompat && (TECS_CV[i.rotulo] || new RegExp(i.rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).test(cvParaCompat);
  c.append(barras(itens, vagas.length, { marca: noCv }));
  const faltam = itens.slice(0, 8).filter((i) => cvParaCompat && !noCv(i)).map((i) => i.rotulo);
  if (faltam.length) {
    const p = el("p", "mercado-dica-texto");
    p.append(`Muito pedidas e ainda fora do seu CV: ${faltam.slice(0, 4).join(", ")}. `);
    const b = el("button", "link-btn", "Montar plano de estudos");
    b.type = "button";
    b.addEventListener("click", () => { $("mercado").close(); abrirPainel("evoluir"); });
    p.append(b);
    c.append(p);
  } else if (!cvParaCompat) c.append(el("p", "mercado-sub", "Salve o texto do seu CV em Minha área → Meus dados para ver quais você já tem."));
  return c;
}

function blocoNivel(vagas) {
  const itens = [...NIVEIS_MERCADO, "Não informado"].map((n) => ({
    rotulo: n,
    valor: vagas.filter((v) => (n === "Não informado" ? !NIVEIS_MERCADO.some((x) => String(v.nivel || "").includes(x)) : String(v.nivel || "").includes(n))).length,
  })).filter((i) => i.valor);
  const c = cartaoMercado("Vagas por nível", "Uma vaga \"Pleno/Sênior\" conta nos dois.");
  c.append(barras(itens, vagas.length));
  return c;
}

function blocoRegime(vagas) {
  const itens = [...REGIMES_MERCADO, "Não informado"].map((r) => ({
    rotulo: r,
    valor: vagas.filter((v) => (r === "Não informado" ? !REGIMES_MERCADO.some((x) => String(v.regime || "").includes(x)) : String(v.regime || "").includes(r))).length,
  })).filter((i) => i.valor);
  const c = cartaoMercado("Tipo de contratação", "Muitas vagas só dizem o regime na entrevista.");
  c.append(barras(itens, vagas.length));
  return c;
}

// Salário: mediana em reais por nível e regime (vagas em dólar ficam fora da conta)
function salarioReais(s) {
  const m = String(s || "").match(/^R\$\s*([\d.]+)(?:\s*a\s*([\d.]+))?/);
  if (!m) return 0;
  const a = Number(m[1].replace(/\./g, "")), b = m[2] ? Number(m[2].replace(/\./g, "")) : a;
  return (a + b) / 2;
}
function blocoSalarios(vagas) {
  const c = cartaoMercado("Quanto pagam", "Mediana mensal em reais das vagas que informam salário. Com poucas vagas, use só como referência.");
  const tabela = el("table", "mercado-tabela");
  const cab = el("tr");
  ["Nível", "CLT", "PJ"].forEach((t) => cab.append(el("th", null, t)));
  const thead = el("thead");
  thead.append(cab);
  const tbody = el("tbody");
  let temAlgum = false;
  NIVEIS_MERCADO.forEach((nivel) => {
    const tr = el("tr");
    tr.append(el("th", null, nivel));
    let linhaTem = false;
    ["CLT", "PJ"].forEach((regime) => {
      const vals = vagas.filter((v) => String(v.nivel).includes(nivel) && String(v.regime).includes(regime)).map((v) => salarioReais(v.salario)).filter(Boolean).sort((a, b) => a - b);
      const td = el("td");
      if (vals.length) {
        linhaTem = true;
        const meio = Math.floor(vals.length / 2);
        const med = vals.length % 2 ? vals[meio] : (vals[meio - 1] + vals[meio]) / 2;
        td.append(el("strong", null, fmtReais(med)), el("span", null, vals.length > 1 ? `${fmtReais(vals[0])} a ${fmtReais(vals.at(-1))} · ${vals.length} vagas` : "1 vaga"));
      } else td.append(el("span", "vazio-celula", "—"));
      tr.append(td);
    });
    if (linhaTem) { tbody.append(tr); temAlgum = true; }
  });
  if (!temAlgum) { c.append(el("p", "painel-vazio", "Nenhuma vaga com esse filtro informa salário em reais.")); return c; }
  tabela.append(thead, tbody);
  c.append(tabela);
  const usd = vagas.filter((v) => /^US\$/.test(v.salario || "")).length;
  if (usd) c.append(el("p", "mercado-sub", `Mais ${usd} ${usd === 1 ? "vaga paga" : "vagas pagam"} em dólar (ficam fora desta conta).`));
  return c;
}

// Linha do número de vagas abertas por dia (histórico do robô)
function blocoEvolucao() {
  const c = cartaoMercado("Vagas abertas por dia", filtroMercado.area === "todos" ? "Todas as áreas. O nível não entra neste gráfico." : `Só ${filtroMercado.area}. O nível não entra neste gráfico.`);
  if (!historicoMercado) {
    c.append(el("p", "cv-nota", "Carregando o histórico…"));
    carregarHistoricoMercado();
    return c;
  }
  const pontos = (historicoMercado.dias || []).slice(-90).map((d) => ({ data: d.data, valor: filtroMercado.area === "todos" ? d.abertas : d.porArea?.[filtroMercado.area] || 0 }));
  if (pontos.length < 2) {
    c.append(el("p", "painel-vazio", "O robô começou a guardar o histórico agora. O gráfico aparece a partir do segundo dia de busca."));
    return c;
  }
  const box = el("div", "linha-box");
  c.append(box);
  // desenha depois de entrar na tela, para medir a largura real
  requestAnimationFrame(() => desenharLinha(box, pontos));

  const tabela = el("details", "mercado-numeros-tabela");
  tabela.append(el("summary", null, "Ver os números"));
  const t = el("table", "mercado-tabela");
  const cab = el("tr");
  cab.append(el("th", null, "Dia"), el("th", null, "Vagas abertas"));
  t.append(cab);
  [...pontos].reverse().forEach((p) => { const tr = el("tr"); tr.append(el("td", null, fmtData(p.data)), el("td", null, fmtN(p.valor))); t.append(tr); });
  tabela.append(t);
  c.append(tabela);
  return c;
}

function desenharLinha(box, pontos) {
  const NS = "http://www.w3.org/2000/svg";
  const L = Math.max(280, box.clientWidth), A = 200;
  const m = { e: 40, d: 16, t: 14, b: 26 };
  const max = Math.max(...pontos.map((p) => p.valor));
  const passo = Math.pow(10, Math.floor(Math.log10(Math.max(1, max))));
  const topo = Math.ceil((max * 1.1) / passo) * passo || 1;
  const x = (i) => m.e + (i / (pontos.length - 1)) * (L - m.e - m.d);
  const y = (v) => m.t + (1 - v / topo) * (A - m.t - m.b);
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", `0 0 ${L} ${A}`);
  s.setAttribute("width", L);
  s.setAttribute("height", A);
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", `Vagas abertas por dia: de ${fmtN(pontos[0].valor)} em ${fmtData(pontos[0].data)} para ${fmtN(pontos.at(-1).valor)} em ${fmtData(pontos.at(-1).data)}`);
  const no = (tag, attrs, pai = s) => { const n = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); pai.append(n); return n; };
  [0, 0.5, 1].forEach((f) => {
    const v = topo * f;
    no("line", { x1: m.e, x2: L - m.d, y1: y(v), y2: y(v), class: f === 0 ? "eixo" : "grade" });
    no("text", { x: m.e - 6, y: y(v) + 4, "text-anchor": "end", class: "eixo-texto" }).textContent = v >= 1000 ? `${Math.round(v / 100) / 10}K` : fmtN(Math.round(v));
  });
  [0, pontos.length - 1].forEach((i) => { no("text", { x: x(i), y: A - 6, "text-anchor": i ? "end" : "start", class: "eixo-texto" }).textContent = fmtData(pontos[i].data); });
  const caminho = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  no("path", { d: `${caminho} L${x(pontos.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, class: "linha-area" });
  no("path", { d: caminho, class: "linha" });
  const ult = pontos.length - 1;
  no("circle", { cx: x(ult), cy: y(pontos[ult].valor), r: 4, class: "linha-ponto" });
  const guia = no("line", { x1: 0, x2: 0, y1: m.t, y2: A - m.b, class: "guia" });
  const marcador = no("circle", { r: 4, class: "linha-ponto" });
  guia.style.display = marcador.style.display = "none";
  const alvo = no("rect", { x: m.e, y: 0, width: L - m.e - m.d, height: A, fill: "transparent", tabindex: 0 });
  let atual = ult;
  const marcar = (i) => {
    atual = Math.max(0, Math.min(ult, i));
    const p = pontos[atual];
    guia.setAttribute("x1", x(atual)); guia.setAttribute("x2", x(atual));
    marcador.setAttribute("cx", x(atual)); marcador.setAttribute("cy", y(p.valor));
    guia.style.display = marcador.style.display = "";
    mostrarDicaGrafico(marcador, `${fmtN(p.valor)} vagas`, fmtData(p.data));
  };
  const soltar = () => { guia.style.display = marcador.style.display = "none"; esconderDicaGrafico(); };
  alvo.addEventListener("pointermove", (e) => {
    const r = s.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * L;
    marcar(Math.round(((px - m.e) / (L - m.e - m.d)) * ult));
  });
  alvo.addEventListener("pointerleave", soltar);
  alvo.addEventListener("focus", () => marcar(atual));
  alvo.addEventListener("blur", soltar);
  alvo.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") marcar(atual - 1); else if (e.key === "ArrowRight") marcar(atual + 1); });
  box.textContent = "";
  box.append(s);
}

async function carregarHistoricoMercado() {
  if (carregarHistoricoMercado.pedido) return;
  carregarHistoricoMercado.pedido = true;
  try {
    const r = await fetch("historico.json", { cache: "no-store" });
    historicoMercado = r.ok ? await r.json() : { dias: [] };
  } catch { historicoMercado = { dias: [] }; }
  if ($("mercado").open) renderMercado();
}

function renderMercado() {
  const corpo = $("mercado-corpo");
  corpo.textContent = "";
  esconderDicaGrafico();
  if (!carregado) { corpo.append(el("p", "cv-nota", "Carregando vagas…")); return; }

  // Filtros: valem para tudo abaixo
  const barra = el("div", "mercado-filtros");
  const abas = el("div", "abas");
  abas.setAttribute("role", "group");
  abas.setAttribute("aria-label", "Área");
  [["todos", "Todas"], ["Front-end", "Front-end"], ["Full-stack", "Full-stack"], ["Back-end", "Back-end"]].forEach(([v, t]) => {
    const b = el("button", "aba", t);
    b.type = "button";
    b.setAttribute("aria-pressed", String(filtroMercado.area === v));
    b.addEventListener("click", () => { filtroMercado.area = v; renderMercado(); });
    abas.append(b);
  });
  const nivel = el("label", "seletor");
  nivel.append("Nível ");
  const sel = el("select");
  [["todos", "Todos"], ...NIVEIS_MERCADO.map((n) => [n, n])].forEach(([v, t]) => { const o = el("option", null, t); o.value = v; sel.append(o); });
  sel.value = filtroMercado.nivel;
  sel.addEventListener("change", () => { filtroMercado.nivel = sel.value; renderMercado(); });
  nivel.append(sel);
  barra.append(abas, nivel);
  corpo.append(barra);

  const vagas = vagasDoMercado();
  corpo.append(blocoNumeros(vagas));
  const grade = el("div", "mercado-grade");
  grade.append(blocoTecnologias(vagas), blocoNivel(vagas), blocoRegime(vagas), blocoSalarios(vagas));
  corpo.append(grade, blocoEvolucao());
  corpo.append(el("p", "mercado-sub", `Baseado nas ${fmtN(dados.vagas.filter((v) => estado(v) !== "encerrada").length)} vagas abertas no radar (GitHub, Gupy, Greenhouse e Remotar), atualizadas em ${dados.atualizadoEm ? fmtHora(dados.atualizadoEm) : "—"}.`));
}

function abrirMercado() {
  const d = $("mercado");
  if (!d.open) d.showModal();
  renderMercado();
}

$("abrir-mercado").addEventListener("click", abrirMercado);
$("mercado-fechar").addEventListener("click", () => $("mercado").close());
$("mercado").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$("mercado").addEventListener("close", esconderDicaGrafico);
let timerMercado;
window.addEventListener("resize", () => { clearTimeout(timerMercado); timerMercado = setTimeout(() => { if ($("mercado").open) renderMercado(); }, 200); });
