// Notificações das vagas novas (Web Push). Funciona no site instalado ou aberto no navegador, no celular e no computador.
// O aparelho se inscreve aqui; o robô diário (scripts/alertas.mjs) manda o aviso com as vagas que combinam com a pessoa.

const VAPID_PUBLICA = "BD0x7EOdUjwhMPycjYPwwOFuKa8YjBWE3zlibdKU0rnkNtWF9V63DzFScOFGlpBWgj5bsW9zkX0WFg8vYSjKSL4";
const CHAVE_PUSH_ID = "radar-vagas:push-id"; // id da inscrição deste aparelho (cada aparelho tem a sua)

const pushSuportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const idPush = () => { try { return localStorage.getItem(CHAVE_PUSH_ID) || ""; } catch { return ""; } };

function chaveVapid() {
  const b64 = VAPID_PUBLICA.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (VAPID_PUBLICA.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// iPhone: só recebe notificação com o site adicionado à Tela de Início
const ehIphoneSemInstalar = () => /iphone|ipad/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches;

async function ativarPush() {
  if (!pushSuportado()) throw new Error(ehIphoneSemInstalar() ? "No iPhone, primeiro toque em Compartilhar → Adicionar à Tela de Início e abra o Radar por lá." : "Este navegador não recebe notificações.");
  if (location.protocol !== "https:" && location.hostname !== "localhost") throw new Error("As notificações só funcionam no site publicado (https).");
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") throw new Error("As notificações foram bloqueadas. Libere nas configurações do site (cadeado ao lado do endereço).");
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const inscricao = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid() }));
  const j = inscricao.toJSON();
  const id = `a${hash(j.endpoint).toString(36)}`; // começa com letra: vira nome de campo no Firestore
  await window.radarNuvem.registrarPush(id, {
    endpoint: j.endpoint, keys: j.keys, criadoEm: hojeLocal(),
    aparelho: /mobile|android|iphone/i.test(navigator.userAgent) ? "Celular" : "Computador",
  });
  try { localStorage.setItem(CHAVE_PUSH_ID, id); } catch {}
  return id;
}

async function desativarPush() {
  const id = idPush();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {}
  if (id) await window.radarNuvem.removerPush(id);
  try { localStorage.removeItem(CHAVE_PUSH_ID); } catch {}
}

// Ao abrir o site: se este aparelho perdeu a inscrição (permissão tirada, dados do navegador limpos), tira da ficha.
// O robô diário só lê o banco, então a limpeza acontece aqui.
async function conferirPush() {
  const id = idPush();
  if (!id || !pushSuportado() || !window.radarNuvem?.ficha?.push?.[id]) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const inscricao = await reg?.pushManager.getSubscription();
    if (Notification.permission !== "granted" || !inscricao) await desativarPush();
    // O navegador às vezes troca o endereço de entrega: grava o novo (a permissão já existe, não pergunta de novo)
    else if (inscricao.endpoint !== window.radarNuvem.ficha.push[id].endpoint) { await window.radarNuvem.removerPush(id); await ativarPush(); }
  } catch {}
}
window.addEventListener("radar:usuario", (e) => { if (e.detail?.usuario) setTimeout(conferirPush, 4000); });

const pushAtivoAqui = () => pushSuportado() && Notification.permission === "granted" && Boolean(idPush()) && Boolean(window.radarNuvem?.ficha?.push?.[idPush()]);

async function notificacaoDeTeste() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Ative as notificações primeiro.");
  await reg.showNotification("Radar de Vagas", { body: "Pronto! É assim que as vagas novas vão chegar.", icon: "icone-192.png", badge: "icone-192.png", tag: "teste" });
}

// Seção em Minha área → Meus dados
function secaoNotificacoes(c) {
  const sec = el("section", "dados-sec");
  sec.append(el("h3", null, "Notificações neste aparelho"));
  sec.append(el("p", "painel-nota", "Receba um aviso de manhã quando chegarem vagas novas que combinam com Minhas preferências. Cada aparelho (celular, computador) é ativado separado."));
  const linha = el("div", "dados-acoes");
  if (!window.radarNuvem?.usuario) { sec.append(el("p", "painel-vazio", "Entre na sua conta para ativar.")); c.append(sec); return; }
  if (pushAtivoAqui()) {
    sec.append(el("p", "evoluir-ok", "Ativadas neste aparelho."));
    const teste = el("button", "btn", "Mandar um teste");
    teste.type = "button";
    teste.addEventListener("click", () => notificacaoDeTeste().catch((e) => avisar(e.message)));
    const desligar = el("button", "btn", "Desativar");
    desligar.type = "button";
    desligar.addEventListener("click", async () => {
      desligar.disabled = true;
      try { await desativarPush(); avisar("Notificações desativadas neste aparelho."); } catch (e) { avisar(window.radarNuvem.mensagemErro(e)); }
      renderPainel();
    });
    linha.append(teste, desligar);
  } else {
    const ativar = el("button", "btn primario", "Ativar notificações");
    ativar.type = "button";
    ativar.addEventListener("click", async () => {
      ativar.disabled = true;
      try { await ativarPush(); avisar("Notificações ativadas. As vagas novas chegam de manhã."); await notificacaoDeTeste().catch(() => {}); }
      catch (e) { avisar(e.message || String(e)); }
      renderPainel();
    });
    linha.append(ativar);
    if (ehIphoneSemInstalar()) sec.append(el("p", "painel-nota", "No iPhone: toque em Compartilhar → Adicionar à Tela de Início, abra o Radar pelo ícone e ative aqui."));
  }
  sec.append(linha);
  c.append(sec);
}
