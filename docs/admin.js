// Painel do super admin: só abre para a conta definida em firebase.js (SUPER_ADMIN).
// As regras do Firestore também bloqueiam qualquer outra conta, então esconder a página não é a única proteção.
import "./firebase.js?v=21";

const nuvem = window.radarNuvem;
const $ = (id) => document.getElementById(id);
function el(tag, cls, texto) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texto != null) n.textContent = texto;
  return n;
}
const quando = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
};
const hoje = () => new Date().toISOString().slice(0, 10);
const NOME_ETAPA = { candidatei: "Candidatei", entrevista: "Entrevista", teste: "Teste técnico", proposta: "Proposta", recusado: "Não avançou" };

function avisar(texto) {
  const t = $("toast");
  const aberta = [...document.querySelectorAll("dialog[open]")].pop();
  if (t.parentElement !== (aberta || document.body)) (aberta || document.body).append(t);
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => { t.hidden = true; }, 3600);
}

let usuarios = [];

window.addEventListener("radar:usuario", (e) => {
  const { usuario, admin } = e.detail;
  if (!usuario) { location.replace("login.html?volta=admin.html"); return; }
  if (!admin) { location.replace("index.html"); return; }
  $("carregando-conta").hidden = true;
  $("admin-sub").textContent = `Conectado como ${usuario.email}. Controle dos usuários cadastrados e da IA do Radar de Vagas.`;
  carregarTudo();
});

async function carregarTudo() {
  preencherIA();
  preencherAssistente();
  try {
    const lista = await nuvem.listarUsuarios();
    // Para cada pessoa, conta candidaturas e CVs (lê os dados dela)
    usuarios = await Promise.all(lista.map(async (u) => {
      let dados = {};
      try { dados = await nuvem.dadosDoUsuario(u.uid); } catch {}
      return { ...u, dados, nCand: Object.keys(dados.candidaturas || {}).length, nCvs: (dados.cvs || []).length };
    }));
    usuarios.sort((a, b) => (b.ultimoAcesso?.seconds || 0) - (a.ultimoAcesso?.seconds || 0));
    renderNumeros();
    renderGraficos();
    renderUsuarios();
  } catch (e) {
    avisar(nuvem.mensagemErro(e));
  }
}

function renderNumeros() {
  const box = $("numeros");
  box.textContent = "";
  const seteDias = Date.now() / 1000 - 7 * 86400;
  const etapas = {};
  usuarios.forEach((u) => Object.values(u.dados.candidaturas || {}).forEach((c) => {
    const et = typeof c === "string" ? "candidatei" : c.etapa || "candidatei";
    etapas[et] = (etapas[et] || 0) + 1;
  }));
  const itens = [
    ["Usuários", usuarios.length],
    ["Ativos nos últimos 7 dias", usuarios.filter((u) => (u.ultimoAcesso?.seconds || 0) > seteDias).length],
    ["Candidaturas", usuarios.reduce((s, u) => s + u.nCand, 0)],
    ["Entrevistas", etapas.entrevista || 0],
    ["Propostas", etapas.proposta || 0],
    ["CVs gerados", usuarios.reduce((s, u) => s + u.nCvs, 0)],
    ["Usos da IA hoje", usuarios.reduce((s, u) => s + (u.usoIA?.dia === hoje() ? u.usoIA.n : 0), 0)],
    ["Bloqueados", usuarios.filter((u) => u.bloqueado).length],
    ["Com alerta por e-mail", usuarios.filter((u) => u.alerta?.ativo).length],
  ];
  itens.forEach(([rotulo, valor]) => {
    const c = el("div", "admin-numero");
    c.append(el("strong", null, String(valor)), el("span", null, rotulo));
    box.append(c);
  });
}

// ---------- Gráficos (SVG simples, uma série por gráfico, com dica ao passar o mouse e tabela) ----------

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const teto = (n) => { if (n <= 4) return Math.max(1, Math.ceil(n)); const p = 10 ** Math.floor(Math.log10(n)); return Math.ceil(n / (p / 2)) * (p / 2); };
const dataCurta = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

function dica(box) {
  let d = box.querySelector(".graf-dica");
  if (!d) { d = el("div", "graf-dica"); d.hidden = true; box.append(d); }
  return d;
}

function tabelaDoGrafico(dados, rotuloValor) {
  const det = el("details", "graf-tabela");
  det.append(el("summary", null, "Ver como tabela"));
  const t = el("table");
  const cab = el("tr");
  cab.append(el("th", null, "Item"), el("th", null, rotuloValor));
  t.append(cab);
  dados.forEach((d) => { const tr = el("tr"); tr.append(el("td", null, d.rotulo), el("td", "num", String(d.valor))); t.append(tr); });
  det.append(t);
  return det;
}

// Colunas verticais (uma por dia): barras de no máximo 24px, ponta arredondada de 4px, eixo discreto
function graficoColunas(box, dados, rotuloValor) {
  box.textContent = "";
  if (!dados.some((d) => d.valor > 0)) { box.append(el("p", "painel-nota", "Ainda sem dados neste período.")); return; }
  const L = 560, A = 200, mE = 32, mB = 26, mT = 18;
  const max = teto(Math.max(...dados.map((d) => d.valor)));
  const larguraFaixa = (L - mE) / dados.length;
  const larguraBarra = Math.min(24, larguraFaixa - 2);
  const y = (v) => mT + (A - mT - mB) * (1 - v / max);
  const s = svgEl("svg", { viewBox: `0 0 ${L} ${A}`, class: "graf-svg", role: "img", "aria-label": `${rotuloValor} por dia` });
  [0, ...(Number.isInteger(max / 2) ? [max / 2] : []), max].forEach((v) => { // contagens: só marcas inteiras
    s.append(svgEl("line", { x1: mE, x2: L, y1: y(v), y2: y(v), class: "graf-grade" }));
    const tx = svgEl("text", { x: mE - 6, y: y(v) + 4, class: "graf-eixo", "text-anchor": "end" });
    tx.textContent = Number.isInteger(v) ? v : v.toFixed(1);
    s.append(tx);
  });
  const passo = Math.ceil(dados.length / 6);
  const indiceMax = dados.reduce((m, d, i) => (d.valor > dados[m].valor ? i : m), 0);
  const dicaEl = dica(box);
  dados.forEach((d, i) => {
    const x = mE + i * larguraFaixa + (larguraFaixa - larguraBarra) / 2;
    if (d.valor > 0) {
      const topo = y(d.valor), base = y(0), r = Math.min(4, (base - topo) / 2, larguraBarra / 2);
      s.append(svgEl("path", { class: "graf-barra", d: `M${x},${base} V${topo + r} Q${x},${topo} ${x + r},${topo} H${x + larguraBarra - r} Q${x + larguraBarra},${topo} ${x + larguraBarra},${topo + r} V${base} Z` }));
    }
    if (i % passo === 0 || i === dados.length - 1) {
      const tx = svgEl("text", { x: x + larguraBarra / 2, y: A - 8, class: "graf-eixo", "text-anchor": "middle" });
      tx.textContent = d.rotulo;
      s.append(tx);
    }
    if (i === indiceMax) {
      const tx = svgEl("text", { x: x + larguraBarra / 2, y: y(d.valor) - 5, class: "graf-valor", "text-anchor": "middle" });
      tx.textContent = d.valor;
      s.append(tx);
    }
    // área de toque maior que a barra
    const alvo = svgEl("rect", { x: mE + i * larguraFaixa, y: mT, width: larguraFaixa, height: A - mT - mB, class: "graf-alvo", tabindex: 0, "aria-label": `${d.rotulo}: ${d.valor} ${rotuloValor.toLowerCase()}` });
    const mostrar = () => {
      dicaEl.textContent = `${d.rotulo}: ${d.valor} ${rotuloValor.toLowerCase()}`;
      dicaEl.hidden = false;
      dicaEl.style.left = `${((x + larguraBarra / 2) / L) * 100}%`;
      dicaEl.style.top = `${(y(d.valor) / A) * 100}%`;
    };
    alvo.addEventListener("mouseenter", mostrar);
    alvo.addEventListener("focus", mostrar);
    alvo.addEventListener("mouseleave", () => { dicaEl.hidden = true; });
    alvo.addEventListener("blur", () => { dicaEl.hidden = true; });
    s.append(alvo);
  });
  box.prepend(s);
  box.append(tabelaDoGrafico(dados, rotuloValor));
}

// Barras horizontais (categorias): rótulo à esquerda, valor na ponta
function graficoBarras(box, dados, rotuloValor) {
  box.textContent = "";
  if (!dados.some((d) => d.valor > 0)) { box.append(el("p", "painel-nota", "Ainda sem dados.")); return; }
  const max = Math.max(...dados.map((d) => d.valor));
  const lista = el("div", "graf-barras");
  dados.forEach((d) => {
    const linha = el("div", "graf-linha");
    linha.title = `${d.rotulo}: ${d.valor} ${rotuloValor.toLowerCase()}`;
    const trilho = el("div", "graf-trilho");
    const barra = el("span", "graf-hbarra");
    barra.style.width = `${Math.max(d.valor ? 2 : 0, (d.valor / max) * 100)}%`;
    trilho.append(barra, el("span", "graf-hvalor", String(d.valor)));
    linha.append(el("span", "graf-rotulo", d.rotulo), trilho);
    lista.append(linha);
  });
  box.append(lista, tabelaDoGrafico(dados, rotuloValor));
}

function diasAtras(n) {
  const dias = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); dias.push(d.toISOString().slice(0, 10)); }
  return dias;
}

function renderGraficos() {
  const dias30 = diasAtras(30);
  const porDia = {};
  usuarios.forEach((u) => {
    const d = u.criadoEm?.toDate ? u.criadoEm.toDate() : u.criadoEm ? new Date(u.criadoEm) : null;
    if (d) { const k = d.toISOString().slice(0, 10); porDia[k] = (porDia[k] || 0) + 1; }
  });
  graficoColunas($("graf-cadastros"), dias30.map((k) => ({ rotulo: dataCurta(k), valor: porDia[k] || 0 })), "Cadastros");

  const dias14 = diasAtras(14);
  const ia = {};
  usuarios.forEach((u) => Object.entries(u.usoIADias || {}).forEach(([k, n]) => { ia[k] = (ia[k] || 0) + Number(n || 0); }));
  graficoColunas($("graf-ia"), dias14.map((k) => ({ rotulo: dataCurta(k), valor: ia[k] || 0 })), "Usos da IA");

  const etapas = {};
  usuarios.forEach((u) => Object.values(u.dados.candidaturas || {}).forEach((c) => {
    const et = typeof c === "string" ? "candidatei" : c.etapa || "candidatei";
    etapas[et] = (etapas[et] || 0) + 1;
  }));
  graficoBarras($("graf-etapas"), Object.entries(NOME_ETAPA).map(([k, nome]) => ({ rotulo: nome, valor: etapas[k] || 0 })), "Candidaturas");

  const vagas = {};
  usuarios.forEach((u) => (u.dados.cvs || []).forEach((h) => {
    const k = [h.vaga?.titulo || "Vaga", h.vaga?.empresa].filter(Boolean).join(" · ");
    vagas[k] = (vagas[k] || 0) + 1;
  }));
  const top = Object.entries(vagas).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([rotulo, valor]) => ({ rotulo, valor }));
  graficoBarras($("graf-vagas"), top, "CVs gerados");
}

function renderUsuarios() {
  const termo = $("filtro-usuarios").value.trim().toLowerCase();
  const tb = $("usuarios");
  tb.textContent = "";
  const lista = usuarios.filter((u) => !termo || `${u.nome} ${u.email}`.toLowerCase().includes(termo));
  if (!lista.length) {
    const tr = el("tr");
    const td = el("td", "admin-vazio", usuarios.length ? "Ninguém com esse nome ou e-mail." : "Ainda não há usuários cadastrados.");
    td.colSpan = 8;
    tr.append(td);
    tb.append(tr);
    return;
  }
  lista.forEach((u) => {
    const tr = el("tr");
    const pessoa = el("td", "admin-pessoa");
    pessoa.append(el("strong", null, u.nome || "(sem nome)"), el("span", null, u.email));
    if (u.email === nuvem.SUPER_ADMIN) pessoa.append(el("span", "selo foco", "super admin"));
    const situacao = el("td");
    situacao.append(el("span", `selo ${u.bloqueado ? "tipo-removido" : "nova"}`, u.bloqueado ? "Bloqueado" : "Ativo"));
    const acoes = el("td", "admin-acoes");
    const ver = el("button", "btn pequeno", "Ver");
    ver.type = "button";
    ver.addEventListener("click", () => abrirDetalhe(u));
    acoes.append(ver);
    if (u.email !== nuvem.SUPER_ADMIN) {
      const bloq = el("button", "btn pequeno", u.bloqueado ? "Desbloquear" : "Bloquear");
      bloq.type = "button";
      bloq.addEventListener("click", () => alternarBloqueio(u));
      acoes.append(bloq);
    }
    tr.append(
      pessoa,
      el("td", null, quando(u.criadoEm)),
      el("td", null, quando(u.ultimoAcesso)),
      el("td", "num", String(u.nCand)),
      el("td", "num", String(u.nCvs)),
      el("td", "num", `${u.usoIA?.dia === hoje() ? u.usoIA.n : 0} / ${u.usoIATotal || 0}`),
      situacao,
      acoes,
    );
    tb.append(tr);
  });
}

async function alternarBloqueio(u) {
  const bloquear = !u.bloqueado;
  if (bloquear && !confirm(`Bloquear ${u.email}? A pessoa continua vendo as vagas, mas não salva nada nem usa a IA.`)) return;
  try {
    await nuvem.atualizarUsuario(u.uid, { bloqueado: bloquear });
    u.bloqueado = bloquear;
    renderNumeros();
    renderUsuarios();
    avisar(bloquear ? "Usuário bloqueado." : "Usuário desbloqueado.");
  } catch (e) { avisar(nuvem.mensagemErro(e)); }
}

function secao(pai, titulo) {
  const s = el("section", "dados-sec");
  s.append(el("h3", null, titulo));
  pai.append(s);
  return s;
}

function abrirDetalhe(u) {
  $("detalhe-titulo").textContent = u.nome || u.email;
  const c = $("detalhe-corpo");
  c.textContent = "";
  const d = u.dados || {};

  const info = secao(c, "Conta");
  const ul = el("ul", "admin-info");
  [["E-mail", u.email], ["Login por", u.provedor || "—"], ["Cadastro", quando(u.criadoEm)], ["Último acesso", quando(u.ultimoAcesso)], ["Usos da IA (total)", u.usoIATotal || 0], ["Situação", u.bloqueado ? "Bloqueado" : "Ativo"]]
    .forEach(([k, v]) => { const li = el("li"); li.append(el("span", null, k), el("strong", null, String(v))); ul.append(li); });
  info.append(ul);

  const p = d.perfil || {};
  const perfilSec = secao(c, "Perfil");
  const up = el("ul", "admin-info");
  [["Nome", p.nome], ["Cidade", p.cidade], ["Telefone", p.telefone], ["LinkedIn", p.linkedin], ["GitHub", p.github], ["CV em PDF", p.cvPdfNome]]
    .forEach(([k, v]) => { if (!v) return; const li = el("li"); li.append(el("span", null, k), el("strong", null, String(v))); up.append(li); });
  if (up.children.length) perfilSec.append(up); else perfilSec.append(el("p", "painel-nota", "Sem dados de perfil."));
  if (p.cvTexto || p.cvExtraido) {
    const det = el("details");
    det.append(el("summary", null, "Ver texto do CV"), el("pre", "cv-original", p.cvTexto || p.cvExtraido));
    perfilSec.append(det);
  }

  const cands = Object.values(d.candidaturas || {});
  const candSec = secao(c, `Candidaturas (${cands.length})`);
  if (!cands.length) candSec.append(el("p", "painel-nota", "Nenhuma."));
  cands.forEach((x) => {
    const linha = el("div", "admin-linha");
    const cand = typeof x === "string" ? { data: x, etapa: "candidatei" } : x;
    linha.append(el("strong", null, cand.titulo || "Vaga"), el("span", null, [cand.empresa, NOME_ETAPA[cand.etapa] || cand.etapa, cand.data].filter(Boolean).join(" · ")));
    if (cand.nota) linha.append(el("span", "painel-nota", cand.nota));
    candSec.append(linha);
  });

  const cvs = d.cvs || [];
  const cvSec = secao(c, `CVs gerados (${cvs.length})`);
  if (!cvs.length) cvSec.append(el("p", "painel-nota", "Nenhum."));
  cvs.forEach((h) => {
    const linha = el("div", "admin-linha");
    linha.append(el("strong", null, h.vaga?.titulo || "Vaga"), el("span", null, [h.vaga?.empresa, h.data].filter(Boolean).join(" · ")));
    cvSec.append(linha);
  });

  const conversa = d.suporte || [];
  const supSec = secao(c, `Conversas com o suporte (${conversa.length} mensagens)`);
  if (!conversa.length) supSec.append(el("p", "painel-nota", "Nenhuma."));
  const msgs = el("div", "suporte-msgs admin-msgs");
  conversa.forEach((m) => { const b = el("div", `msg ${m.de === "eu" ? "eu" : "ia"}`); b.append(el("p", null, m.texto)); msgs.append(b); });
  if (conversa.length) supSec.append(msgs);

  if (u.email !== nuvem.SUPER_ADMIN) {
    const perigo = secao(c, "Zona de perigo");
    perigo.append(el("p", "painel-nota", "Apaga a ficha e todos os dados desta pessoa no Firebase. A conta de login continua existindo; para removê-la de vez, use Authentication no console do Firebase."));
    const apagar = el("button", "btn perigo", "Apagar todos os dados deste usuário");
    apagar.type = "button";
    apagar.addEventListener("click", async () => {
      if (prompt(`Para confirmar, digite o e-mail da pessoa: ${u.email}`) !== u.email) { avisar("E-mail não confere. Nada foi apagado."); return; }
      try {
        await nuvem.apagarDadosDoUsuario(u.uid);
        usuarios = usuarios.filter((x) => x.uid !== u.uid);
        $("detalhe").close();
        renderNumeros();
        renderUsuarios();
        avisar("Dados apagados.");
      } catch (e) { avisar(nuvem.mensagemErro(e)); }
    });
    perigo.append(apagar);
  }
  $("detalhe").showModal();
}

function preencherIA() {
  const cfg = nuvem.configIA;
  const st = $("appcheck-status");
  st.textContent = "Verificando a proteção App Check…";
  nuvem.verificarAppCheck().then((ok) => {
    st.textContent = ok ? "Proteção App Check ativa: só este site consegue usar a IA e o banco." : "App Check não conseguiu verificar este navegador. Se continuar, avise o desenvolvedor.";
    st.className = `appcheck ${ok ? "ok" : "erro"}`;
  });
  $("ia-ativa").checked = cfg.ativa !== false;
  $("ia-modelos").value = (cfg.modelos || []).join(", ");
  $("ia-limite").value = cfg.limiteDiario ?? 0;
}

$("form-ia").addEventListener("submit", async (e) => {
  e.preventDefault();
  const modelos = $("ia-modelos").value.split(",").map((m) => m.trim()).filter(Boolean);
  if (!modelos.length) { avisar("Informe pelo menos um modelo."); return; }
  try {
    await nuvem.salvarConfigIA({ ativa: $("ia-ativa").checked, modelos, limiteDiario: Math.max(0, Number($("ia-limite").value) || 0) });
    avisar("Configuração da IA salva. Vale para todos na próxima vez que abrirem o site.");
  } catch (err) { avisar(nuvem.mensagemErro(err)); }
});

// ---------- Assistente de suporte: nome, avatar e saudação ----------

let avatarEscolhido = "";

function mostrarPrevia() {
  $("ass-previa").src = avatarEscolhido || window.avatarPadrao();
  $("ass-previa-nome").textContent = $("ass-nome").value.trim() || "Suporte Radar";
  document.querySelectorAll(".avatar-opcao").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === (avatarEscolhido || window.avatarPadrao()))));
}

function preencherAssistente() {
  const cfg = nuvem.configSuporte;
  avatarEscolhido = cfg.avatar || "";
  $("ass-nome").value = cfg.nome || "Suporte Radar";
  $("ass-saudacao").value = cfg.saudacao || "";
  const box = $("ass-avatares");
  box.textContent = "";
  window.AVATARES.forEach((a) => {
    const b = el("button", "avatar-opcao");
    b.type = "button";
    b.dataset.src = a.src;
    b.title = a.nome;
    b.setAttribute("aria-label", `Usar o avatar ${a.nome}`);
    const img = el("img");
    img.src = a.src;
    img.alt = "";
    b.append(img);
    b.addEventListener("click", () => { avatarEscolhido = a.src; mostrarPrevia(); });
    box.append(b);
  });
  mostrarPrevia();
}

// Recorta a imagem enviada num quadrado do centro e reduz para 160 px, para caber no banco (limite de 1 MB por documento)
function reduzirImagem(arquivo) {
  return new Promise((ok, falhou) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 160;
      c.getContext("2d").drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      const webp = c.toDataURL("image/webp", 0.85);
      ok(webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); falhou(new Error("Não consegui abrir essa imagem.")); };
    img.src = url;
  });
}

$("ass-arquivo").addEventListener("change", async (e) => {
  const arq = e.target.files[0];
  if (!arq) return;
  if (arq.size > 8 * 1024 * 1024) { avisar("Imagem grande demais (máx. 8 MB)."); return; }
  try { avatarEscolhido = await reduzirImagem(arq); mostrarPrevia(); }
  catch (err) { avisar(err.message); }
});
$("ass-nome").addEventListener("input", mostrarPrevia);

$("form-assistente").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await nuvem.salvarConfigSuporte({
      nome: $("ass-nome").value.trim() || "Suporte Radar",
      avatar: avatarEscolhido === window.avatarPadrao() ? "" : avatarEscolhido,
      saudacao: $("ass-saudacao").value.trim(),
    });
    avisar("Assistente salvo. Aparece para todos na próxima vez que abrirem o site.");
  } catch (err) { avisar(nuvem.mensagemErro(err)); }
});

function exportarCsv() {
  const linhas = [["nome", "email", "cadastro", "ultimo_acesso", "candidaturas", "cvs", "uso_ia_total", "bloqueado"]];
  usuarios.forEach((u) => linhas.push([u.nome, u.email, quando(u.criadoEm), quando(u.ultimoAcesso), u.nCand, u.nCvs, u.usoIATotal || 0, u.bloqueado ? "sim" : "não"]));
  const csv = linhas.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = el("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `radar-vagas-usuarios-${hoje()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$("filtro-usuarios").addEventListener("input", renderUsuarios);
$("exportar").addEventListener("click", exportarCsv);
$("recarregar").addEventListener("click", carregarTudo);
$("sair").addEventListener("click", async () => { await nuvem.sair(); location.replace("login.html"); });
$("detalhe-fechar").addEventListener("click", () => $("detalhe").close());
$("detalhe").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
