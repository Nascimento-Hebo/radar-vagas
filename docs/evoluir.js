// Aba "Evoluir" da Minha área:
// 1) Plano de estudos: as tecnologias mais pedidas nas vagas do seu perfil que ainda faltam no seu CV,
//    com um plano da IA (recursos gratuitos + projeto para provar). "Já aprendi" coloca a tecnologia no perfil.
// 2) Perfil online: a IA revisa o título e o "Sobre" do LinkedIn e o GitHub público, com textos prontos para colar.

const CHAVE_EVOLUIR = "radar-vagas:evoluir"; // { plano, perfilOnline }
const MAX_LACUNAS = 6;
let evoluirOcupado = "";

const lerEvoluir = () => ler(CHAVE_EVOLUIR, {});
const salvarEvoluir = (mudanca) => salvar(CHAVE_EVOLUIR, { ...lerEvoluir(), ...mudanca });
const temNoCv = (tec) => Boolean(cvParaCompat) && (TECS_CV[tec] || new RegExp(tec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).test(cvParaCompat);

// Vagas que interessam: as que combinam com as preferências; sem preferências, todas as abertas
function vagasDoMeuPerfil() {
  const abertas = dados.vagas.filter((v) => estado(v) !== "encerrada");
  const minhas = Object.keys(prefs()).length ? abertas.filter((v) => combinaComPreferencias(v)) : [];
  return minhas.length >= 10 ? { vagas: minhas, filtrado: true } : { vagas: abertas, filtrado: false };
}

function lacunas() {
  const { vagas, filtrado } = vagasDoMeuPerfil();
  const contagem = {};
  vagas.forEach((v) => (v.stack || []).forEach((t) => { contagem[t] = (contagem[t] || 0) + 1; }));
  const itens = Object.entries(contagem)
    .filter(([t, n]) => !temNoCv(t) && n / vagas.length >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LACUNAS)
    .map(([tec, n]) => ({ tec, n, pct: Math.round((n / vagas.length) * 100) }));
  return { itens, total: vagas.length, filtrado };
}

function marcarAprendida(tec) {
  const p = ler(CHAVE_PERFIL_APP, {});
  const aprendidas = [...new Set([...(p.aprendidas || []), tec])];
  salvar(CHAVE_PERFIL_APP, { ...p, aprendidas });
  atualizarCompatibilidade();
  avisar(`${tec} entrou no seu perfil. A compatibilidade das vagas foi recalculada e o adaptador de CV já sabe.`);
  renderPainel();
}
function desmarcarAprendida(tec) {
  const p = ler(CHAVE_PERFIL_APP, {});
  salvar(CHAVE_PERFIL_APP, { ...p, aprendidas: (p.aprendidas || []).filter((t) => t !== tec) });
  atualizarCompatibilidade();
  renderPainel();
}

async function gerarPlano(itens) {
  evoluirOcupado = "plano";
  renderPainel();
  const p = ler(CHAVE_PERFIL_APP, {});
  const pr = prefs();
  const pedido = `Você é mentor(a) de carreira de desenvolvimento de software no Brasil.
A pessoa quer vagas de ${pr.area && pr.area !== "todos" ? pr.area : "desenvolvimento"}${pr.nivel && pr.nivel !== "todos" ? `, nível ${pr.nivel}` : ""}.
Tecnologias que as vagas pedem e que ainda não aparecem no CV dela (com % das vagas que pedem): ${itens.map((i) => `${i.tec} (${i.pct}%)`).join(", ")}.
O que ela já sabe (trecho do CV): ${String(cvParaCompat || "não informado").slice(0, 2500)}

Monte um plano de estudos prático, em português do Brasil, com até ${itens.length} tecnologias, na ordem que mais aumenta as chances de contratação (comece pelo que se aprende rápido e é muito pedido).
Para cada tecnologia: por que vale a pena, quanto tempo leva no ritmo de 1 hora por dia, 2 ou 3 recursos GRATUITOS e conhecidos (documentação oficial, freeCodeCamp, MDN, Rocketseat, Curso em Vídeo, Microsoft Learn, roadmap.sh etc., só nomes e sites que existem de verdade) e 1 projeto pequeno para colocar no GitHub e provar que sabe.
Responda só com JSON:
{ "resumo": "1 ou 2 frases sobre a estratégia", "itens": [{ "tecnologia": "", "porque": "", "tempo": "ex.: 2 semanas", "recursos": [{ "nome": "", "url": "https://..." }], "projeto": "" }] }`;
  try {
    const r = lerJson(await gemini([{ text: pedido }], { json: true }));
    salvarEvoluir({ plano: { ...r, geradoEm: hojeLocal(), lacunas: itens.map((i) => i.tec) } });
  } catch (e) {
    avisar(e.message || String(e));
  } finally {
    evoluirOcupado = "";
    renderPainel();
  }
}

// Links da IA: só http(s), e abrem fora do site
function linkSeguro(url, texto) {
  let u = null;
  try { u = new URL(url); } catch {}
  if (!u || !/^https?:$/.test(u.protocol)) return el("span", null, texto);
  const a = el("a", null, texto);
  a.href = u.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function secaoPlano(c) {
  const sec = el("section", "dados-sec evoluir-sec");
  sec.append(el("h3", null, "Plano de estudos"));
  const p = ler(CHAVE_PERFIL_APP, {});
  if (!cvParaCompat) {
    sec.append(el("p", "painel-nota", "Salve o texto do seu CV em \"Meus dados\" para eu comparar com o que as vagas pedem."));
    const b = el("button", "btn primario", "Adicionar meu CV");
    b.type = "button";
    b.addEventListener("click", () => abrirPainel("dados"));
    sec.append(b);
    c.append(sec);
    return;
  }
  const { itens, total, filtrado } = lacunas();
  sec.append(el("p", "painel-nota", `Comparei seu CV com ${total} vagas abertas${filtrado ? " que combinam com Minhas preferências" : ""}. Estas são as tecnologias mais pedidas que ainda não aparecem nele:`));

  if (!itens.length) sec.append(el("p", "evoluir-ok", "Seu CV já cobre as tecnologias mais pedidas nessas vagas. Agora é aprofundar e mostrar projetos."));
  else {
    const lista = el("ul", "lacunas");
    itens.forEach((i) => {
      const li = el("li", "lacuna");
      const info = el("div");
      info.append(el("strong", null, i.tec), el("span", null, `pedida em ${i.pct}% das vagas (${i.n})`));
      const b = el("button", "btn pequeno", "Já aprendi");
      b.type = "button";
      b.title = "Coloca no seu perfil (conta para a compatibilidade e para o adaptador de CV)";
      b.addEventListener("click", () => marcarAprendida(i.tec));
      li.append(info, b);
      lista.append(li);
    });
    sec.append(lista);
  }

  if (p.aprendidas?.length) {
    const ap = el("div", "aprendidas");
    ap.append(el("span", "painel-nota", "Já aprendi: "));
    p.aprendidas.forEach((t) => {
      const chip = el("button", "chip", `${t} ×`);
      chip.type = "button";
      chip.title = `Tirar ${t} do perfil`;
      chip.addEventListener("click", () => desmarcarAprendida(t));
      ap.append(chip);
    });
    sec.append(ap);
  }

  const plano = lerEvoluir().plano;
  const acoes = el("div", "dados-acoes");
  if (itens.length) {
    const gerar = el("button", "btn primario", evoluirOcupado === "plano" ? "A IA está montando…" : plano ? "Montar de novo com a IA" : "IA: montar meu plano de estudos");
    gerar.type = "button";
    gerar.disabled = Boolean(evoluirOcupado);
    gerar.addEventListener("click", () => gerarPlano(itens));
    acoes.append(gerar);
  }
  sec.append(acoes);

  if (plano?.itens?.length) {
    const box = el("div", "plano");
    if (plano.resumo) box.append(el("p", "plano-resumo", plano.resumo));
    const ol = el("ol", "plano-lista");
    plano.itens.forEach((it) => {
      const li = el("li", "plano-item");
      const cab = el("div", "plano-cab");
      cab.append(el("strong", null, it.tecnologia), el("span", "selo", it.tempo || ""));
      li.append(cab);
      if (it.porque) li.append(el("p", null, it.porque));
      if (it.recursos?.length) {
        const r = el("p", "plano-recursos");
        r.append(el("b", null, "Onde estudar de graça: "));
        it.recursos.forEach((x, k) => { if (k) r.append(" · "); r.append(linkSeguro(x.url, x.nome || x.url)); });
        li.append(r);
      }
      if (it.projeto) { const pj = el("p", "plano-projeto"); pj.append(el("b", null, "Projeto para provar: "), it.projeto); li.append(pj); }
      ol.append(li);
    });
    box.append(ol, el("p", "painel-nota", `Plano montado em ${fmtData(plano.geradoEm)}. Quando terminar uma tecnologia, clique em "Já aprendi".`));
    sec.append(box);
  }
  c.append(sec);
}

// ---------- Perfil online (LinkedIn + GitHub) ----------

const usuarioGithub = (texto) => {
  const t = String(texto || "").trim();
  const m = t.match(/github\.com\/([A-Za-z0-9-]+)/i) || t.match(/^@?([A-Za-z0-9-]{1,39})$/);
  return m ? m[1] : "";
};

async function lerGithub(usuario) {
  const api = (c) => fetch(`https://api.github.com/${c}`, { headers: { Accept: "application/vnd.github+json" } });
  const r = await api(`users/${usuario}`);
  if (r.status === 404) throw new Error(`Não achei o usuário "${usuario}" no GitHub.`);
  if (!r.ok) throw new Error("O GitHub não respondeu agora (limite de consultas). Tente daqui a pouco.");
  const u = await r.json();
  const repos = await (await api(`users/${usuario}/repos?sort=pushed&per_page=30`)).json().catch(() => []);
  let readme = "";
  try {
    const rr = await fetch(`https://raw.githubusercontent.com/${usuario}/${usuario}/HEAD/README.md`);
    if (rr.ok) readme = (await rr.text()).slice(0, 4000);
  } catch {}
  return {
    nome: u.name || "", bio: u.bio || "", seguidores: u.followers, reposPublicos: u.public_repos, site: u.blog || "",
    readmePerfil: readme || "(não tem README de perfil)",
    repos: (Array.isArray(repos) ? repos : []).filter((x) => !x.fork).slice(0, 12).map((x) => ({
      nome: x.name, descricao: x.description || "", linguagem: x.language || "", estrelas: x.stargazers_count,
      temSite: Boolean(x.homepage), topicos: (x.topics || []).slice(0, 6), atualizado: String(x.pushed_at || "").slice(0, 10),
    })),
  };
}

async function revisarPerfilOnline(entrada) {
  evoluirOcupado = "perfil";
  renderPainel();
  try {
    const gh = entrada.github ? await lerGithub(entrada.github) : null;
    const pr = prefs();
    const pedido = `Você é recrutador(a) técnico(a) no Brasil revisando o perfil online de uma pessoa que procura vagas de ${pr.area && pr.area !== "todos" ? pr.area : "desenvolvimento"}${pr.nivel && pr.nivel !== "todos" ? ` nível ${pr.nivel}` : ""}.
Tecnologias mais pedidas nessas vagas agora: ${Object.entries(dados.vagas.flatMap((v) => v.stack || []).reduce((a, t) => ({ ...a, [t]: (a[t] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t).join(", ")}.
CV (trecho): ${String(cvParaCompat || "").slice(0, 2500)}
LinkedIn — título atual: ${entrada.titulo || "(não informado)"}
LinkedIn — "Sobre" atual: ${entrada.sobre || "(não informado)"}
GitHub público (JSON): ${gh ? JSON.stringify(gh) : "(não informado)"}

Regras: português do Brasil, direto e prático. Não invente experiências, números ou projetos que não estejam no CV ou no GitHub; use [colchetes] onde a pessoa precisa completar.
Responda só com JSON:
{
  "nota": número de 0 a 10 para o conjunto,
  "resumo": "2 frases: o que um recrutador pensa ao ver este perfil",
  "linkedin": { "titulo": "novo título (até 220 caracteres, com cargo + principais tecnologias + o que busca)", "sobre": "novo texto do Sobre (até 1200 caracteres, 3 parágrafos curtos)", "dicas": ["até 4 ajustes no LinkedIn"] },
  "github": ${gh ? `{ "bio": "nova bio (até 160 caracteres)", "readme": "README de perfil em Markdown, curto, com apresentação, tecnologias e projetos em destaque", "fixar": ["até 4 repositórios para fixar no perfil, com o motivo"], "repos": [{ "nome": "repositório", "melhoria": "o que melhorar (descrição, README, site publicado, testes...)" }], "dicas": ["até 4 dicas"] }` : "null"}
}`;
    const r = lerJson(await gemini([{ text: pedido }], { json: true }));
    salvarEvoluir({ perfilOnline: { entrada, resultado: r, geradoEm: hojeLocal() } });
  } catch (e) {
    avisar(e.message || String(e));
  } finally {
    evoluirOcupado = "";
    renderPainel();
  }
}

function secaoPerfilOnline(c) {
  const sec = el("section", "dados-sec evoluir-sec");
  sec.append(el("h3", null, "LinkedIn e GitHub"));
  sec.append(el("p", "painel-nota", "Recrutadores olham o LinkedIn e o GitHub antes de chamar. A IA revisa os dois pensando nas vagas que você quer e escreve os textos prontos para colar."));
  const salvo = lerEvoluir().perfilOnline;
  const p = ler(CHAVE_PERFIL_APP, {});
  const form = el("div", "perfil-online-form");
  const campo = (rotulo, no) => { const l = el("label", "campo"); l.append(el("span", null, rotulo), no); form.append(l); return no; };
  const titulo = campo("Título do LinkedIn (a frase embaixo do seu nome)", el("input"));
  titulo.value = salvo?.entrada?.titulo || "";
  titulo.placeholder = "Ex.: Desenvolvedor Front-end | React | JavaScript";
  const sobre = campo("\"Sobre\" do LinkedIn", el("textarea"));
  sobre.rows = 4;
  sobre.value = salvo?.entrada?.sobre || "";
  sobre.placeholder = "Cole aqui o texto da seção Sobre (pode deixar em branco se não tiver)";
  const gh = campo("Seu usuário ou link do GitHub", el("input"));
  gh.value = salvo?.entrada?.github || usuarioGithub(p.github) || "";
  gh.placeholder = "Ex.: Nascimento-Hebo";
  sec.append(form);
  const acoes = el("div", "dados-acoes");
  const b = el("button", "btn primario", evoluirOcupado === "perfil" ? "A IA está revisando…" : "IA: revisar meu perfil online");
  b.type = "button";
  b.disabled = Boolean(evoluirOcupado);
  b.addEventListener("click", () => {
    const entrada = { titulo: titulo.value.trim(), sobre: sobre.value.trim(), github: usuarioGithub(gh.value) };
    if (gh.value.trim() && !entrada.github) { avisar("Esse não parece um usuário do GitHub."); return; }
    if (!entrada.titulo && !entrada.sobre && !entrada.github) { avisar("Preencha pelo menos um campo."); return; }
    revisarPerfilOnline(entrada);
  });
  acoes.append(b);
  sec.append(acoes);

  const r = salvo?.resultado;
  if (r) {
    const box = el("div", "perfil-online-resultado");
    const topo = el("div", "po-topo");
    if (typeof r.nota === "number") topo.append(el("span", `po-nota ${r.nota >= 7 ? "ok" : r.nota >= 5 ? "medio" : "ruim"}`, `${r.nota}/10`));
    if (r.resumo) topo.append(el("p", null, r.resumo));
    box.append(topo);
    if (r.linkedin) {
      box.append(el("h4", null, "LinkedIn"));
      if (r.linkedin.titulo) box.append(blocoCopiavel("Novo título", r.linkedin.titulo));
      if (r.linkedin.sobre) box.append(blocoCopiavel("Novo \"Sobre\"", r.linkedin.sobre));
      if (r.linkedin.dicas?.length) { const ul = el("ul", "q-lista"); r.linkedin.dicas.forEach((d) => ul.append(el("li", null, d))); box.append(ul); }
    }
    if (r.github) {
      box.append(el("h4", null, "GitHub"));
      if (r.github.bio) box.append(blocoCopiavel("Nova bio", r.github.bio));
      if (r.github.readme) box.append(blocoCopiavel("README do perfil", r.github.readme));
      const ul = el("ul", "q-lista");
      (r.github.fixar || []).forEach((d) => ul.append(el("li", null, `Fixar: ${d}`)));
      (r.github.repos || []).forEach((x) => ul.append(el("li", null, `${x.nome}: ${x.melhoria}`)));
      (r.github.dicas || []).forEach((d) => ul.append(el("li", null, d)));
      if (ul.childElementCount) box.append(ul);
      if (r.github.readme) box.append(el("p", "painel-nota", `Para o README aparecer no perfil, crie um repositório público chamado exatamente ${salvo.entrada.github || "seu-usuario"} e cole o texto no README.md.`));
    }
    box.append(el("p", "painel-nota", `Revisão feita em ${fmtData(salvo.geradoEm)}.`));
    sec.append(box);
  }
  c.append(sec);
}

function painelEvoluir(c) {
  secaoPlano(c);
  secaoPerfilOnline(c);
}
