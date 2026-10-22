// Ferramentas do CV final: baixar PDF e Word de verdade, nota ATS, frases fracas,
// checagem de uma página, versão em inglês e revisão de português.
// Tudo trabalha em cima da folha que está na tela (#cv-folha), então as edições da pessoa entram junto.

const LIB_PDF = ["https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/pdfmake.min.js", "https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/vfs_fonts.js"];
const LIB_DOCX = ["https://unpkg.com/docx@9.8.1/dist/index.iife.js"];
const scriptsCarregados = new Map();

function carregarScript(url) {
  if (!scriptsCarregados.has(url)) {
    scriptsCarregados.set(url, new Promise((ok, falhou) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = ok;
      s.onerror = () => { scriptsCarregados.delete(url); falhou(new Error("Não consegui baixar o gerador de arquivo. Verifique a internet.")); };
      document.head.append(s);
    }));
  }
  return scriptsCarregados.get(url);
}
const carregarTodos = async (urls) => { for (const u of urls) await carregarScript(u); };

const COR_MODELO = { classico: "#2448d6", moderno: "#0f766e", executivo: "#1e3a8a", compacto: "#2448d6" };
const textoLimpo = (n) => (n?.textContent || "").replace(/\s+/g, " ").trim();

// ---------- Lê a folha da tela num formato simples (serve para PDF e Word) ----------

function lerFolha(folha) {
  const cab = folha.querySelector(".folha-cab");
  const contato = [...cab.querySelectorAll(".folha-contato li")].map((li) => {
    const a = li.querySelector("a");
    // CVs salvos antes do data-tipo: compara o SVG inteiro
    const svg = li.querySelector("svg")?.outerHTML || "";
    const tipo = li.dataset.tipo || Object.keys(ICONES_CONTATO).find((k) => svg === ICONES_CONTATO[k]) || "";
    return { tipo, texto: textoLimpo(a || li.querySelector("span:not(.sr)")), link: a?.href || "" };
  });
  const secoes = [...folha.querySelectorAll(".folha-corpo section")].map((s) => {
    const blocos = [];
    [...s.children].forEach((n) => {
      if (n.tagName === "H2") return;
      if (n.classList.contains("folha-item")) blocos.push({ tipo: "item", titulo: textoLimpo(n.querySelector("strong")), detalhe: textoLimpo(n.querySelector("span")) });
      else if (n.classList.contains("folha-tags")) blocos.push({ tipo: "tags", itens: [...n.children].map(textoLimpo).filter(Boolean) });
      else if (n.tagName === "UL") blocos.push({ tipo: "lista", itens: [...n.children].map(textoLimpo).filter(Boolean) });
      else if (n.tagName === "P") blocos.push({ tipo: "texto", texto: textoLimpo(n) });
    });
    return { titulo: textoLimpo(s.querySelector("h2")), ordem: Number(s.style.order || 0), lateral: Boolean(s.closest(".folha-lateral")), blocos };
  }).sort((a, b) => a.ordem - b.ordem);
  return {
    nome: textoLimpo(cab.querySelector("h1")),
    titulo: textoLimpo(cab.querySelector(".folha-titulo")),
    disponivel: textoLimpo(cab.querySelector(".folha-disponivel")),
    contato,
    secoes,
  };
}

// ---------- PDF (pdfmake): texto selecionável, links clicáveis, fiel ao modelo escolhido ----------

function svgIcone(tipo, cor) {
  const base = ICONES_CONTATO[tipo];
  if (!base) return null;
  return base.replace('class="folha-ic"', `width="24" height="24" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"`).replace(' aria-hidden="true"', "");
}

function blocosPdf(blocos, cor, base) {
  const saida = [];
  for (const b of blocos) {
    if (b.tipo === "item") saida.push({ columns: [{ text: b.titulo, bold: true, width: "*" }, { text: b.detalhe, width: "auto", color: "#4b5366", fontSize: base - 1 }], columnGap: 8, margin: [0, 4, 0, 1] });
    else if (b.tipo === "lista") saida.push({ ul: b.itens, margin: [0, 1, 0, 4], markerColor: cor });
    else if (b.tipo === "tags") saida.push({ text: b.itens.join("  ·  "), margin: [0, 1, 0, 4] });
    else if (b.tipo === "texto") saida.push({ text: b.texto, margin: [0, 0, 0, 3] });
  }
  return saida;
}

function secoesPdf(secoes, cor, base, executivo) {
  return secoes.flatMap((s) => [
    // Título com borda inferior: a linha acompanha a largura da coluna, sem vazar da página
    {
      table: { widths: ["*"], body: [[{ text: s.titulo.toUpperCase(), bold: true, color: executivo ? "#0f1b3d" : cor, fontSize: base - 0.5, characterSpacing: 1, border: [false, false, false, true] }]] },
      layout: { hLineWidth: () => (executivo ? 1.2 : 0.6), hLineColor: () => (executivo ? cor : "#dde2ec"), paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 2 },
      margin: [0, 10, 0, 4],
    },
    ...blocosPdf(s.blocos, cor, base),
  ]);
}

function documentoPdf(d, modelo) {
  const cor = COR_MODELO[modelo] || COR_MODELO.classico;
  const base = modelo === "compacto" ? 9 : 10;
  const executivo = modelo === "executivo";
  const corTextoCab = executivo ? "#cfd8ee" : "#4b5366";
  const linhasContato = [];
  for (let i = 0; i < d.contato.length; i += 3) {
    linhasContato.push({
      columns: d.contato.slice(i, i + 3).map((c) => ({
        width: "auto",
        columns: [
          ...(svgIcone(c.tipo, executivo ? "#a9c3ff" : cor) ? [{ svg: svgIcone(c.tipo, executivo ? "#a9c3ff" : cor), width: 8, margin: [0, 1.5, 3, 0] }] : []),
          { text: c.texto, link: c.link || undefined, color: corTextoCab, width: "auto" },
        ],
      })),
      columnGap: 14,
      margin: [0, 2, 0, 0],
      fontSize: base - 1,
    });
  }
  const cabecalho = [
    { text: d.nome, fontSize: base + 12, bold: true, color: executivo ? "#ffffff" : "#111111" },
    d.titulo && { text: d.titulo, bold: true, color: executivo ? "#a9c3ff" : cor, margin: [0, 2, 0, 0] },
    d.disponivel && { text: d.disponivel, color: corTextoCab, fontSize: base - 1, margin: [0, 2, 0, 0] },
    ...linhasContato,
  ].filter(Boolean);

  let conteudo;
  if (executivo) {
    conteudo = [
      { table: { widths: ["*"], body: [[{ stack: cabecalho, fillColor: "#0f1b3d", margin: [14, 12, 14, 12] }]] }, layout: "noBorders", margin: [0, 0, 0, 6] },
      ...secoesPdf(d.secoes, cor, base, true),
    ];
  } else if (modelo === "moderno") {
    const lateral = d.secoes.filter((s) => s.lateral), principal = d.secoes.filter((s) => !s.lateral);
    conteudo = [
      { stack: cabecalho, margin: [0, 0, 0, 8] },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: "#dde2ec" }] },
      { table: { widths: ["32%", "*"], body: [[{ stack: secoesPdf(lateral, cor, base, false), fillColor: "#f1f7f6", margin: [8, 0, 8, 8] }, { stack: secoesPdf(principal, cor, base, false), margin: [12, 0, 0, 0] }]] }, layout: "noBorders" },
    ];
  } else {
    conteudo = [
      { stack: cabecalho, margin: [0, 0, 0, 6] },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: cor }] },
      ...secoesPdf(d.secoes, cor, base, false),
    ];
  }
  return {
    pageSize: "A4",
    pageMargins: [40, 36, 40, 36],
    info: { title: `CV - ${d.nome}`, author: d.nome, subject: d.titulo, creator: "Radar de Vagas · OH Tech" },
    defaultStyle: { font: "Roboto", fontSize: base, lineHeight: 1.25, color: "#1a1f2e" },
    content: conteudo,
  };
}

async function baixarPdf(folha, modelo, nomeArquivo) {
  await carregarTodos(LIB_PDF);
  const pm = window.pdfMake;
  try { pm.addFonts?.({ Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" } }); } catch {}
  await pm.createPdf(documentoPdf(lerFolha(folha), modelo)).download(`${nomeArquivo}.pdf`);
}

// ---------- Word (.docx): estrutura simples, que os sistemas de RH leem bem ----------

async function baixarDocx(folha, nomeArquivo) {
  await carregarTodos(LIB_DOCX);
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, AlignmentType, BorderStyle, TabStopType } = window.docx;
  const d = lerFolha(folha);
  const filhos = [
    new Paragraph({ children: [new TextRun({ text: d.nome, bold: true, size: 36 })] }),
    ...(d.titulo ? [new Paragraph({ children: [new TextRun({ text: d.titulo, bold: true, color: "2448D6", size: 22 })] })] : []),
    ...(d.disponivel ? [new Paragraph({ children: [new TextRun({ text: d.disponivel, color: "4B5366", size: 19 })] })] : []),
    new Paragraph({
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "2448D6", space: 4 } },
      children: d.contato.flatMap((c, i) => [
        ...(i ? [new TextRun({ text: "  |  ", color: "9AA3B8", size: 19 })] : []),
        c.link ? new ExternalHyperlink({ link: c.link, children: [new TextRun({ text: c.texto, color: "4B5366", size: 19 })] }) : new TextRun({ text: c.texto, color: "4B5366", size: 19 }),
      ]),
    }),
  ];
  for (const s of d.secoes) {
    filhos.push(new Paragraph({ spacing: { before: 200, after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDE2EC", space: 2 } }, children: [new TextRun({ text: s.titulo.toUpperCase(), bold: true, color: "2448D6", size: 20 })] }));
    for (const b of s.blocos) {
      if (b.tipo === "item") filhos.push(new Paragraph({ spacing: { before: 80 }, tabStops: [{ type: TabStopType.RIGHT, position: 9000 }], children: [new TextRun({ text: b.titulo, bold: true, size: 21 }), ...(b.detalhe ? [new TextRun({ text: `\t${b.detalhe}`, color: "4B5366", size: 19 })] : [])] }));
      else if (b.tipo === "lista") b.itens.forEach((t) => filhos.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: t, size: 21 })] })));
      else if (b.tipo === "tags") filhos.push(new Paragraph({ children: [new TextRun({ text: b.itens.join(" · "), size: 21 })] }));
      else if (b.tipo === "texto") filhos.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: b.texto, size: 21 })] }));
    }
  }
  const doc = new Document({
    creator: "Radar de Vagas · OH Tech",
    title: `CV - ${d.nome}`,
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 800, right: 800 } } }, children: filhos }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nomeArquivo}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

// ---------- Nota ATS: palavras-chave da vaga que aparecem no CV (calculado aqui, sem IA) ----------

function notaAts(folha, analise) {
  const texto = semAcento(folha.innerText);
  const termos = [...new Set([...(analise?.palavrasChave || [])].map((t) => String(t).trim()).filter((t) => t.length >= 2))];
  if (!termos.length) return null;
  const tem = (t) => {
    const n = semAcento(t);
    const raiz = n.replace(/\.js$|js$/, "").replace(/[^a-z0-9#+]/g, "");
    return texto.includes(n) || (raiz.length >= 3 && texto.replace(/[^a-z0-9#+ ]/g, "").includes(raiz));
  };
  const cobertas = termos.filter(tem), faltando = termos.filter((t) => !tem(t));
  return { pct: Math.round((cobertas.length / termos.length) * 100), cobertas, faltando };
}

// ---------- Frases fracas: sem verbo de ação ou sem resultado ----------

const RE_FRACA = /^(respons[aá]vel por|fui respons[aá]vel|ajudei|auxiliei|auxiliava|participei|participa[cç][aã]o|trabalhei (com|em|no|na)|atuei (com|em|no|na)|fazia|realizava|tarefas|atividades|suporte a|apoio a)/i;
function frasesFracas(folha) {
  return [...folha.querySelectorAll(".folha-corpo li, .folha-corpo section p")]
    .map((n) => textoLimpo(n))
    .filter((t) => t.length > 12 && t.length < 260 && RE_FRACA.test(t))
    .slice(0, 8);
}

// ---------- Cabe em uma página? (A4 com margens de 12 mm) ----------

// Mede numa cópia com a largura exata de uma folha A4 (assim o resultado é o mesmo no celular e no computador)
function paginasDaFolha(folha) {
  const larguraUtil = 794 - 2 * 45; // px de uma página A4 a 96 dpi, menos as margens
  const alturaUtil = 1123 - 2 * 45;
  const copia = folha.cloneNode(true);
  copia.removeAttribute("id");
  copia.style.cssText = `position:absolute;left:-10000px;top:0;width:${larguraUtil}px;padding:0;box-shadow:none;visibility:hidden`;
  (folha.parentElement || document.body).append(copia);
  const altura = copia.scrollHeight;
  copia.remove();
  return altura / alturaUtil;
}

// Troca o texto de um item da folha (usado ao aplicar sugestões da IA)
function trocarTextoNaFolha(folha, original, novo) {
  const alvo = [...folha.querySelectorAll(".folha-corpo li, .folha-corpo p, .folha-titulo, .folha-cab h1")].find((n) => textoLimpo(n) === original);
  if (!alvo) return false;
  alvo.textContent = novo;
  alvo.classList.add("editado");
  return true;
}
