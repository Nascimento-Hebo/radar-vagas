// Extensão do Radar de Vagas: pega o anúncio da página aberta e abre o adaptador de CV com ele.
// Não lê nada sozinha: só age quando a pessoa clica no ícone ou no menu do botão direito (permissão activeTab).

const SITE = "https://radar-vagas-five.vercel.app/";
const MAX_TEXTO = 15000;

// Roda dentro da página da vaga: texto selecionado ou, sem seleção, o miolo da página
function lerAnuncio() {
  const selecao = String(getSelection() || "").trim();
  if (selecao.length > 80) return { texto: selecao, titulo: document.title, link: location.href };
  const candidatos = ["[class*='job-description']", "[class*='jobDescription']", "[data-testid*='description']", "#job-details", "[class*='description']", "article", "main", "[role='main']"];
  const bloco = candidatos.map((s) => document.querySelector(s)).find((n) => n && n.innerText.trim().length > 300) || document.body;
  const titulo = (document.querySelector("h1")?.innerText || document.title).trim();
  return { texto: `${titulo}\n\n${bloco.innerText}`.replace(/\n{3,}/g, "\n\n").trim(), titulo, link: location.href };
}

// Texto em UTF-8 -> base64, para ir no endereço do site (#vaga=...)
function base64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function enviar(tab, textoSelecionado) {
  let anuncio;
  if (textoSelecionado) anuncio = { texto: textoSelecionado, titulo: tab.title || "", link: tab.url || "" };
  else {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: lerAnuncio });
      anuncio = r?.result;
    } catch {
      anuncio = null; // páginas do próprio navegador (chrome://) não deixam ler
    }
  }
  if (!anuncio || anuncio.texto.length < 40) {
    chrome.tabs.create({ url: SITE });
    return;
  }
  const link = /^https?:/.test(anuncio.link) ? anuncio.link : "";
  const params = `vaga=${encodeURIComponent(base64(anuncio.texto.slice(0, MAX_TEXTO)))}&link=${encodeURIComponent(link)}&titulo=${encodeURIComponent(anuncio.titulo.slice(0, 140))}`;
  chrome.tabs.create({ url: `${SITE}#${params}` });
}

chrome.action.onClicked.addListener((tab) => enviar(tab));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "adaptar-selecao", title: "Adaptar meu CV com este texto (Radar de Vagas)", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "adaptar-selecao") enviar(tab, String(info.selectionText || "").trim());
});
