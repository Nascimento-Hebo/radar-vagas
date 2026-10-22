// Painel do super admin: só abre para a conta definida em firebase.js (SUPER_ADMIN).
// As regras do Firestore também bloqueiam qualquer outra conta, então esconder a página não é a única proteção.
import "./firebase.js?v=13";

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
  ];
  itens.forEach(([rotulo, valor]) => {
    const c = el("div", "admin-numero");
    c.append(el("strong", null, String(valor)), el("span", null, rotulo));
    box.append(c);
  });
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
