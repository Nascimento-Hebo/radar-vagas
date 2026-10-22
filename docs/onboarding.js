// Primeiro acesso guiado (e "Minhas preferências" depois):
// 1) a IA lê o CV e preenche o perfil; 2) o que a pessoa procura; 3) meta da semana e alerta por e-mail.
// As preferências ficam no perfil (navegador + nuvem) e na ficha (users/{uid}.alerta), que o alerta diário lê.

const ob = { passo: 1, extraido: null, pdf: null, salvando: false };
const AREAS_OB = ["todos", "Front-end", "Full-stack", "Back-end"];

function abrirBoasVindas(passo = 1) {
  ob.passo = passo;
  ob.extraido = null;
  const d = $("boasvindas");
  if (!d.open) d.showModal();
  renderBoasVindas();
}

function cabecalhoOb(c) {
  const topo = el("div", "ob-topo");
  const passos = el("ol", "ob-passos");
  ["Seu CV", "O que você procura", "Meta e alertas"].forEach((nome, i) => {
    const li = el("li", i + 1 === ob.passo ? "atual" : i + 1 < ob.passo ? "feito" : "");
    li.append(el("span", null, String(i + 1)), nome);
    passos.append(li);
  });
  const fechar = el("button", "suporte-acao ob-fechar");
  fechar.type = "button";
  fechar.setAttribute("aria-label", "Fechar");
  fechar.innerHTML = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  fechar.addEventListener("click", () => concluirBoasVindas(true));
  topo.append(passos, fechar);
  c.append(topo);
}

function renderBoasVindas() {
  const c = $("ob-corpo");
  c.textContent = "";
  cabecalhoOb(c);
  ({ 1: passoCv, 2: passoPreferencias, 3: passoMeta })[ob.passo](c);
}

// ---------- Passo 1: CV ----------

function passoCv(c) {
  const p = ler(CHAVE_PERFIL_APP, {});
  const u = window.radarNuvem?.usuario;
  c.append(el("h2", "ob-titulo", `Bem-vindo${u?.displayName ? `, ${u.displayName.split(" ")[0]}` : ""}! Vamos deixar o Radar com a sua cara`));
  c.append(el("p", "cv-nota", "Envie seu currículo e a IA preenche seu perfil, descobre sua área, nível e tecnologias. Leva uns 20 segundos e você só confere."));

  const area = el("label", "ob-arquivo");
  area.innerHTML = svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m9 15 3-3 3 3"/>');
  const titulo = el("strong", null, ob.pdf ? ob.pdf.nome : p.cvPdf?.nome ? `CV salvo: ${p.cvPdf.nome}` : "Clique para enviar seu CV em PDF");
  area.append(titulo, el("span", null, "Ou cole o texto logo abaixo"));
  const arq = el("input");
  arq.type = "file";
  arq.accept = "application/pdf";
  arq.hidden = true;
  arq.addEventListener("change", async () => {
    const f = arq.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { avisar("PDF grande demais (máx. 8 MB)."); return; }
    ob.pdf = { nome: f.name, base64: await lerArquivo(f) }; // lerArquivo em cv.js
    titulo.textContent = f.name;
  });
  area.append(arq);
  c.append(area);

  const ta = el("textarea", "ob-texto");
  ta.rows = 5;
  ta.placeholder = "Cole aqui o texto do seu CV, ou escreva suas experiências do seu jeito.";
  ta.value = p.cvTexto || "";
  ta.setAttribute("aria-label", "Texto do CV");
  c.append(ta);

  const acoes = el("div", "cv-acoes");
  const ler1 = el("button", "btn primario", "Ler meu CV com IA");
  ler1.type = "button";
  ler1.addEventListener("click", async () => {
    const pdf = ob.pdf || p.cvPdf;
    const texto = ta.value.trim();
    if (!pdf?.base64 && !texto) { avisar("Envie o PDF ou cole o texto do CV."); return; }
    ler1.disabled = true;
    ler1.textContent = "A IA está lendo seu CV…";
    try {
      ob.extraido = await extrairDoCv(pdf, texto);
      const atual = ler(CHAVE_PERFIL_APP, {});
      const x = ob.extraido;
      const novo = {
        ...atual,
        nome: atual.nome || x.nome || u?.displayName || "",
        email: atual.email || x.email || u?.email || "",
        telefone: atual.telefone || x.telefone || "",
        cidade: atual.cidade || x.cidade || "",
        linkedin: atual.linkedin || x.linkedin || "",
        github: atual.github || x.github || "",
        cvTexto: texto || atual.cvTexto || "",
        cvExtraido: x.textoCv || atual.cvExtraido || "",
      };
      if (ob.pdf) novo.cvPdf = ob.pdf;
      salvar(CHAVE_PERFIL_APP, novo);
      atualizarCompatibilidade(); // em app.js
      ob.passo = 2;
      renderBoasVindas();
    } catch (e) {
      avisar(e.message || String(e));
      ler1.disabled = false;
      ler1.textContent = "Ler meu CV com IA";
    }
  });
  const pular = el("button", "link-btn", "Pular, preencho depois");
  pular.type = "button";
  pular.addEventListener("click", () => { if (ta.value.trim()) salvar(CHAVE_PERFIL_APP, { ...ler(CHAVE_PERFIL_APP, {}), cvTexto: ta.value.trim() }); ob.passo = 2; renderBoasVindas(); });
  acoes.append(ler1, pular);
  c.append(acoes);
}

async function extrairDoCv(pdf, texto) {
  const partes = [{ text: `Leia o currículo anexo e responda só com JSON, em português:
{
  "nome": "", "email": "", "telefone": "", "cidade": "Cidade - UF", "linkedin": "", "github": "",
  "area": "Front-end" | "Full-stack" | "Back-end",
  "nivel": "Estágio" | "Júnior" | "Pleno" | "Sênior",
  "tecnologias": ["as principais tecnologias, no máximo 8"],
  "textoCv": "o texto completo do currículo, em texto simples"
}
Deixe vazio o que não estiver no currículo. Não invente.` }];
  if (pdf?.base64) partes.push({ inline_data: { mime_type: "application/pdf", data: pdf.base64 } });
  if (texto) partes.push({ text: `Currículo:\n${texto}` });
  const r = await window.radarNuvem.gerarIA(partes, { json: true });
  return lerJson(r); // lerJson em cv.js
}

// ---------- Passo 2: o que a pessoa procura ----------

function ufDaCidade(cidade) {
  const m = String(cidade || "").match(/\b([A-Z]{2})\b/);
  if (m && ESTADOS[m[1]]) return m[1];
  return infoLocal({ id: `cidade-${cidade}`, local: cidade || "" }).ufs.values().next().value || "";
}

function passoPreferencias(c) {
  const p = prefs();
  const x = ob.extraido || {};
  const perfilAtual = ler(CHAVE_PERFIL_APP, {});
  const atual = {
    area: p.area || x.area || "todos",
    nivel: p.nivel || (x.nivel && x.nivel !== "Estágio" ? x.nivel : "todos"),
    regime: p.regime || "todos",
    local: p.local || "todos",
    tecnologias: p.tecnologias || x.tecnologias || [],
  };
  const ufSugerida = (atual.local.startsWith("uf:") && atual.local.slice(3)) || ufDaCidade(perfilAtual.cidade) || "PR";

  c.append(el("h2", "ob-titulo", "O que você procura?"));
  c.append(el("p", "cv-nota", ob.extraido ? "A IA preencheu com base no seu CV. Ajuste o que quiser." : "Isso deixa a lista e os alertas do jeito que você precisa. Dá para mudar depois."));

  const form = el("div", "ob-form");
  const grupo = (rotulo, campo) => { const g = el("div", "campo"); g.append(el("span", null, rotulo), campo); form.append(g); return g; };

  const abas = el("div", "abas");
  AREAS_OB.forEach((a) => {
    const b = el("button", "aba", a === "todos" ? "Todas" : a);
    b.type = "button";
    b.setAttribute("aria-pressed", String(atual.area === a));
    b.addEventListener("click", () => { atual.area = a; abas.querySelectorAll(".aba").forEach((o) => o.setAttribute("aria-pressed", String(o === b))); });
    abas.append(b);
  });
  grupo("Área", abas);

  const linha = el("div", "ob-linha");
  const sel = (opcoes, valor) => { const s = el("select"); opcoes.forEach(([v, n]) => { const o = el("option", null, n); o.value = v; s.append(o); }); s.value = valor; return s; };
  const nivel = sel([["todos", "Qualquer nível"], ["Júnior", "Júnior"], ["Pleno", "Pleno"], ["Sênior", "Sênior"]], atual.nivel);
  const regime = sel([["todos", "CLT ou PJ"], ["CLT", "Só CLT"], ["PJ", "Só PJ"]], atual.regime);
  const ln = el("label", "seletor"); ln.append("Nível", nivel);
  const lr = el("label", "seletor"); lr.append("Contrato", regime);
  linha.append(ln, lr);
  form.append(linha);

  const onde = el("div", "ob-onde");
  const tipoLocal = atual.local === "remoto" ? "remoto" : atual.local.startsWith("uf:") ? "uf" : "todos";
  const ufSel = sel(Object.entries(ESTADOS).map(([uf, nome]) => [uf, nome]), ufSugerida);
  ufSel.setAttribute("aria-label", "Estado");
  [["remoto", "Só 100% remoto"], ["uf", "Remoto ou presencial no meu estado:"], ["todos", "Qualquer lugar do Brasil"]].forEach(([v, n]) => {
    const l = el("label", "marcar");
    const r = el("input");
    r.type = "radio";
    r.name = "ob-local";
    r.value = v;
    r.checked = tipoLocal === v;
    l.append(r, ` ${n}`);
    if (v === "uf") l.append(ufSel);
    onde.append(l);
  });
  grupo("Onde", onde);

  const tec = el("input");
  tec.type = "text";
  tec.value = atual.tecnologias.join(", ");
  tec.placeholder = "Ex.: React, Node.js, Java (deixe vazio para todas)";
  grupo("Tecnologias que você quer usar", tec);
  c.append(form);

  const acoes = el("div", "cv-acoes");
  const seguir = el("button", "btn primario", "Continuar");
  seguir.type = "button";
  seguir.addEventListener("click", () => {
    const escolhido = form.querySelector('input[name="ob-local"]:checked')?.value || "todos";
    const preferencias = {
      area: atual.area,
      nivel: nivel.value,
      regime: regime.value,
      local: escolhido === "uf" ? `uf:${ufSel.value}` : escolhido,
      tecnologias: tec.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
    };
    salvar(CHAVE_PERFIL_APP, { ...ler(CHAVE_PERFIL_APP, {}), preferencias });
    ob.passo = 3;
    renderBoasVindas();
  });
  const voltar = el("button", "link-btn", "Voltar");
  voltar.type = "button";
  voltar.addEventListener("click", () => { ob.passo = 1; renderBoasVindas(); });
  acoes.append(seguir, voltar);
  c.append(acoes);
}

// ---------- Passo 3: meta e alertas ----------

function passoMeta(c) {
  const ficha = window.radarNuvem?.ficha || {};
  let meta = metaSemana;
  c.append(el("h2", "ob-titulo", "Sua meta e seus alertas"));
  c.append(el("p", "cv-nota", "Quem se candidata com constância consegue mais entrevistas. Escolha um número que caiba na sua semana."));

  const metaBox = el("div", "ob-meta");
  const menos = el("button", "mini", "−");
  const mais = el("button", "mini", "+");
  const valor = el("strong", null, String(meta));
  [menos, mais].forEach((b) => { b.type = "button"; });
  menos.setAttribute("aria-label", "Diminuir meta");
  mais.setAttribute("aria-label", "Aumentar meta");
  menos.addEventListener("click", () => { meta = Math.max(1, meta - 1); valor.textContent = meta; });
  mais.addEventListener("click", () => { meta = Math.min(30, meta + 1); valor.textContent = meta; });
  metaBox.append(menos, valor, mais, el("span", null, "candidaturas por semana"));
  c.append(metaBox);

  const alerta = el("label", "ob-alerta");
  const chk = el("input");
  chk.type = "checkbox";
  chk.checked = ficha.alerta ? ficha.alerta.ativo !== false : true;
  const txt = el("div");
  txt.append(el("strong", null, "Receber as vagas novas por e-mail"), el("span", null, `Um e-mail de manhã, só nos dias em que aparecer vaga que combina com você, para ${window.radarNuvem?.usuario?.email || "seu e-mail"}.`));
  alerta.append(chk, txt);
  c.append(alerta);

  const acoes = el("div", "cv-acoes");
  const fim = el("button", "btn primario", "Concluir e ver minhas vagas");
  fim.type = "button";
  fim.addEventListener("click", async () => {
    fim.disabled = true;
    metaSemana = meta;
    salvar(CHAVE_META, meta);
    try {
      await window.radarNuvem?.atualizarMinhaFicha({ onboardingFeito: true, alerta: { ativo: chk.checked, ...prefs() } });
    } catch (e) { avisar(window.radarNuvem.mensagemErro(e)); }
    concluirBoasVindas(false, true);
  });
  const voltar = el("button", "link-btn", "Voltar");
  voltar.type = "button";
  voltar.addEventListener("click", () => { ob.passo = 2; renderBoasVindas(); });
  acoes.append(fim, voltar);
  c.append(acoes);
}

async function concluirBoasVindas(pulou, aplicar = false) {
  $("boasvindas").close();
  if (pulou && !window.radarNuvem?.ficha?.onboardingFeito) {
    try { await window.radarNuvem?.atualizarMinhaFicha({ onboardingFeito: true }); } catch {}
  }
  if (aplicar) {
    filtros.paraVoce = true; // mostra só o que combina com as preferências
    sincronizarControles();
    render();
    avisar("Pronto! A lista mostra as vagas que combinam com você. Para ver todas, clique em \"Limpar filtros\".");
  } else render();
}

window.addEventListener("radar:usuario", (e) => {
  const { usuario, ficha } = e.detail;
  if (usuario && ficha && !ficha.onboardingFeito && !ficha.bloqueado) setTimeout(() => abrirBoasVindas(1), 400);
});
