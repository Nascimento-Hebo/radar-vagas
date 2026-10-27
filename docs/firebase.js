// Ponte entre a página e o Firebase (projeto radar-de-vagas-1f800, plano gratuito).
// - Login: Google ou e-mail/senha (Firebase Authentication).
// - Dados de cada pessoa: Firestore em users/{uid}, users/{uid}/dados/{nome} e users/{uid}/arquivos/* (PDF do CV).
//   O navegador guarda uma cópia (localStorage) de uma conta por vez: veja conta-local.js.
// - IA: Firebase AI Logic com a Gemini Developer API. A chave fica no Firebase, nunca no navegador.
// - Gmail: token de leitura pedido pelo login do Google, só quando a pessoa conecta a central de e-mail.
// As páginas (app.js, cv.js, admin.js) usam tudo por window.radarNuvem.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut,
  reauthenticateWithPopup, linkWithPopup, deleteUser, EmailAuthProvider, reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, increment, deleteField,
  addDoc, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken as tokenAppCheck } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { limparDadosLocais, prepararParaConta, assinaturaPdf, partesDoPdf, MAX_PARTES_PDF } from "./conta-local.js?v=29";

const config = {
  apiKey: "AIzaSyByGuqZQH4mPZhsHh7rozWRRat0fsJtGg0", // chave pública do app web (identifica o projeto; quem protege os dados são as regras do Firestore)
  authDomain: "radar-de-vagas-1f800.firebaseapp.com",
  projectId: "radar-de-vagas-1f800",
  storageBucket: "radar-de-vagas-1f800.firebasestorage.app",
  messagingSenderId: "1045776255274",
  appId: "1:1045776255274:web:dae06d6ce04918b0c27653",
};

export const SUPER_ADMIN = "nascimentohebo2@gmail.com";
const app = initializeApp(config);
// App Check: prova (com reCAPTCHA invisível) que o pedido vem deste site. Sem isso, qualquer um poderia gastar a cota da IA e do banco.
const RECAPTCHA_SITE_KEY = "6LfkX_stAAAAAHz8sBetbRCMgt9cI2K-6KDSqlgw";
let appCheck = null;
try { appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true }); }
catch (e) { console.warn("App Check não iniciou:", e); }
const auth = getAuth(app);
auth.languageCode = "pt";
const db = getFirestore(app);
const ai = getAI(app, { backend: new GoogleAIBackend() });

// Chaves do localStorage que vão para a nuvem (users/{uid}/dados). O PDF do CV vai à parte, em users/{uid}/arquivos.
const SINCRONIZADAS = {
  "radar-vagas:candidaturas": "candidaturas",
  "radar-vagas:meta-semana": "meta",
  "radar-vagas:perfil": "perfil",
  "radar-vagas:cvs-gerados": "cvs",
  "radar-vagas:tema": "tema",
  "radar-vagas:suporte": "suporte",
  "radar-vagas:evoluir": "evoluir",
};
const SCOPE_GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
try { localStorage.removeItem("radar-vagas:gemini-chave"); } catch {} // sobra de quando a IA usava a chave de cada pessoa

let usuario = null;
let fichaUsuario = null; // documento users/{uid}
// Assistente de suporte: nome, avatar (imagem pequena em data URL) e saudação. O super admin edita no painel.
let configSuporte = { nome: "Suporte Radar", avatar: "", saudacao: "" };
let configIA = { ativa: true, modelos: ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"], limiteDiario: 60 };
const pendentes = new Map();
let timerEnvio = null;

const lerLocal = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ehAdmin = (u = usuario) => Boolean(u && u.email === SUPER_ADMIN && u.emailVerified);

function semPdf(chave, valor) {
  if (chave === "radar-vagas:perfil" && valor?.cvPdf) return { ...valor, cvPdf: null, cvPdfNome: valor.cvPdf.nome || "" };
  return valor;
}

// ---------- Login ----------

async function entrarComGoogle() {
  const provedor = new GoogleAuthProvider();
  provedor.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provedor);
}

async function entrarComEmail(email, senha) {
  return signInWithEmailAndPassword(auth, email, senha);
}

async function criarConta(nome, email, senha) {
  const r = await createUserWithEmailAndPassword(auth, email, senha);
  if (nome) await updateProfile(r.user, { displayName: nome });
  try { await sendEmailVerification(r.user); } catch {}
  return r;
}

const recuperarSenha = (email) => sendPasswordResetEmail(auth, email);
const reenviarVerificacao = () => sendEmailVerification(auth.currentUser);

// Excluir minha conta (LGPD): apaga os dados, a ficha e a conta de login. Pede o login de novo se o Firebase exigir.
async function excluirConta(senha = "") {
  const u = auth.currentUser;
  if (!u) throw new Error("Entre na sua conta primeiro.");
  const reautenticar = async () => {
    if (u.providerData.some((p) => p.providerId === "password") && senha) {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, senha));
    } else {
      await reauthenticateWithPopup(u, new GoogleAuthProvider());
    }
  };
  if (senha) await reautenticar(); // confirma antes de apagar qualquer coisa
  const snaps = await Promise.all(["dados", "arquivos"].map((sub) => getDocs(collection(db, "users", u.uid, sub))));
  await Promise.all(snaps.flatMap((s) => s.docs.map((d) => deleteDoc(d.ref))));
  await deleteDoc(doc(db, "users", u.uid));
  try { await deleteUser(u); }
  catch (e) {
    if (e?.code !== "auth/requires-recent-login") throw e;
    await reautenticar();
    await deleteUser(u);
  }
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
}

// Tira a inscrição de notificações deste aparelho (para não chegar aviso de uma conta na outra)
async function cancelarPushDoAparelho() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await (await reg?.pushManager?.getSubscription())?.unsubscribe();
  } catch {}
}

// Sair: termina de salvar, desliga as notificações deste aparelho e limpa o navegador para a próxima pessoa
async function sair() {
  clearTimeout(timerEnvio);
  if (pendentes.size) await enviarPendentes().catch(() => {});
  let idPush = "";
  try { idPush = localStorage.getItem("radar-vagas:push-id") || ""; } catch {}
  await cancelarPushDoAparelho();
  if (idPush) await removerPush(idPush).catch(() => {});
  await signOut(auth);
  limparDadosLocais();
}

// Traduz os erros do Firebase para mensagens que a pessoa entende
function mensagemErro(e) {
  const c = e?.code || "";
  const m = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "Não existe conta com esse e-mail. Clique em \"Criar conta\".",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Use \"Entrar\" ou \"Esqueci a senha\".",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/invalid-email": "Esse e-mail não parece válido.",
    "auth/popup-closed-by-user": "A janela do Google foi fechada antes de terminar.",
    "auth/cancelled-popup-request": "A janela do Google foi fechada antes de terminar.",
    "auth/popup-blocked": "O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente de novo.",
    "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "auth/unauthorized-domain": "Este endereço ainda não foi autorizado no Firebase (Authentication → Configurações → Domínios autorizados).",
    "auth/operation-not-allowed": "Esse tipo de login ainda não foi ativado no Firebase (Authentication → Método de login).",
    "auth/credential-already-in-use": "Essa conta Google já está ligada a outro usuário do Radar.",
    "auth/user-mismatch": "Escolha a mesma conta Google com que você entrou no Radar.",
    "auth/internal-error": "O Google recusou o pedido. Se apareceu \"app bloqueado\" ou \"acesso negado\", o administrador precisa liberar seu e-mail como testador do Gmail.",
    "auth/admin-restricted-operation": "Essa operação está bloqueada nas configurações do Firebase.",
    "permission-denied": "Sem permissão para essa ação.",
  }[c];
  return m || e?.message || String(e);
}

// ---------- Dados do usuário ----------

async function registrarUsuario(u) {
  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  const base = {
    nome: u.displayName || "",
    email: u.email || "",
    foto: u.photoURL || "",
    provedor: u.providerData.map((p) => p.providerId).join(","),
    ultimoAcesso: serverTimestamp(),
  };
  if (!snap.exists()) await setDoc(ref, { ...base, criadoEm: serverTimestamp(), papel: "usuario", bloqueado: false });
  else await updateDoc(ref, base);
  fichaUsuario = (await getDoc(ref)).data();
}

/// Traz os dados da nuvem para o navegador. Só sobe o que está no navegador se ele for desta mesma conta:
// dados de outra pessoa (ou de antes de existir o dono) são apagados, nunca copiados para a conta que entrou.
// Devolve true quando apagou dados de outra pessoa (a página aberta precisa recarregar).
async function carregarDados(u) {
  const snaps = await getDocs(collection(db, "users", u.uid, "dados"));
  const naNuvem = Object.fromEntries(snaps.docs.map((d) => [d.id, d.data().valor]));
  let tinhaPush = false;
  try { tinhaPush = Boolean(localStorage.getItem("radar-vagas:push-id")); } catch {}
  const apagados = prepararParaConta(u.uid, { nomePdfDaConta: naNuvem.perfil?.cvPdfNome || "" });
  if (apagados && tinhaPush) await cancelarPushDoAparelho(); // a inscrição era da outra conta
  for (const [chave, nome] of Object.entries(SINCRONIZADAS)) {
    const local = lerLocal(chave);
    if (nome in naNuvem) {
      let valor = naNuvem[nome];
      if (nome === "candidaturas" && local && typeof local === "object") valor = { ...local, ...valor }; // junta as duas listas
      if (nome === "perfil" && local?.cvPdf) valor = { ...valor, cvPdf: local.cvPdf }; // o PDF vem à parte (sincronizarPdf)
      gravarLocal(chave, valor);
      if (nome === "candidaturas" && Object.keys(valor).length !== Object.keys(naNuvem[nome] || {}).length) agendarEnvio(chave, valor);
    } else if (local != null) {
      agendarEnvio(chave, local);
    }
  }
  await sincronizarPdf(u, naNuvem.perfil).catch((e) => console.warn("PDF do CV:", e));
  return apagados > 0;
}

// ---------- PDF do CV na nuvem: users/{uid}/arquivos/cvPdf (dados do arquivo) + cvPdf-0, cvPdf-1... (o conteúdo em partes) ----------

let pdfNaNuvem = { assinatura: "", partes: 0 }; // o que está na nuvem agora

const refArquivo = (uid, id) => doc(db, "users", uid, "arquivos", id);

// Ao entrar: baixa o PDF da nuvem se este navegador não tem o mesmo; sobe o deste navegador se a nuvem ainda não tem (contas antigas)
async function sincronizarPdf(u, perfilNaNuvem) {
  const meta = (await getDoc(refArquivo(u.uid, "cvPdf"))).data();
  pdfNaNuvem = { assinatura: meta?.assinatura || "", partes: meta?.partes || 0 };
  const local = lerLocal("radar-vagas:perfil");
  const pdfLocal = local?.cvPdf;
  if (meta) {
    if (assinaturaPdf(pdfLocal) === meta.assinatura) return;
    const partes = await Promise.all(Array.from({ length: meta.partes }, (_, i) => getDoc(refArquivo(u.uid, `cvPdf-${i}`))));
    if (partes.some((p) => !p.exists())) return;
    const pdf = { nome: meta.nome, base64: partes.map((p) => p.data().dados).join("") };
    if (assinaturaPdf(pdf) === meta.assinatura) gravarLocal("radar-vagas:perfil", { ...(lerLocal("radar-vagas:perfil") || {}), cvPdf: pdf });
  } else if (pdfLocal?.base64 && usuario?.emailVerified) {
    // Sem PDF na nuvem: sobe se a ficha desta conta registra esse PDF (ou se ainda não tem perfil); se ela tirou o PDF em outro aparelho, tira daqui também
    if (!perfilNaNuvem || perfilNaNuvem.cvPdfNome === pdfLocal.nome) await enviarPdf(pdfLocal);
    else gravarLocal("radar-vagas:perfil", { ...local, cvPdf: null });
  }
}

async function enviarPdf(pdf) {
  const assinatura = assinaturaPdf(pdf);
  if (assinatura === pdfNaNuvem.assinatura) return;
  const uid = usuario.uid;
  if (!assinatura) { await apagarPdfDaNuvem(uid, pdfNaNuvem.partes); pdfNaNuvem = { assinatura: "", partes: 0 }; return; }
  const partes = partesDoPdf(pdf.base64);
  if (partes.length > MAX_PARTES_PDF) throw new Error("O PDF do CV é grande demais para guardar na nuvem.");
  for (let i = 0; i < partes.length; i++) await setDoc(refArquivo(uid, `cvPdf-${i}`), { dados: partes[i] });
  await setDoc(refArquivo(uid, "cvPdf"), { nome: pdf.nome || "", assinatura, partes: partes.length, atualizadoEm: serverTimestamp() });
  for (let i = partes.length; i < pdfNaNuvem.partes; i++) await deleteDoc(refArquivo(uid, `cvPdf-${i}`)); // sobras de um PDF maior
  pdfNaNuvem = { assinatura, partes: partes.length };
}

// Sem ler antes (o super admin não pode ler os arquivos): apaga todos os nomes possíveis
async function apagarPdfDaNuvem(uid, partes = MAX_PARTES_PDF) {
  await deleteDoc(refArquivo(uid, "cvPdf"));
  await Promise.all(Array.from({ length: partes }, (_, i) => deleteDoc(refArquivo(uid, `cvPdf-${i}`))));
}

function agendarEnvio(chave, valor) {
  if (!SINCRONIZADAS[chave]) return;
  pendentes.set(chave, valor);
  clearTimeout(timerEnvio);
  timerEnvio = setTimeout(enviarPendentes, 800);
}

// Resumo na ficha (users/{uid}.resumo): só números. O painel do admin lê só isso; o conteúdo de cada pessoa é só dela.
function montarResumo() {
  const cands = Object.values(lerLocal("radar-vagas:candidaturas") || {});
  const cvs = lerLocal("radar-vagas:cvs-gerados") || [];
  const etapas = {};
  cands.forEach((c) => { const e = typeof c === "string" ? "candidatei" : c.etapa || "candidatei"; etapas[e] = (etapas[e] || 0) + 1; });
  return { nCand: cands.length, nCvs: cvs.length, etapas };
}
async function atualizarResumo() {
  if (!usuario || fichaUsuario?.bloqueado) return;
  const resumo = montarResumo();
  if (JSON.stringify(resumo) === JSON.stringify(fichaUsuario?.resumo)) return;
  try {
    await updateDoc(doc(db, "users", usuario.uid), { resumo });
    fichaUsuario = { ...fichaUsuario, resumo };
  } catch (e) { console.warn("Resumo:", e); }
}

const AVISO_VERIFICAR = "Confirme seu e-mail para salvar seus dados na nuvem e usar a IA: clique no link que enviamos (menu da conta → Verificar meu e-mail) e recarregue a página.";
let avisouVerificar = false;

async function enviarPendentes() {
  if (!usuario || fichaUsuario?.bloqueado) return;
  // Conta de e-mail e senha sem e-mail confirmado: o banco não aceita. Os dados ficam neste navegador e sobem depois de confirmar.
  if (!usuario.emailVerified) {
    if (!avisouVerificar) { avisouVerificar = true; window.dispatchEvent(new CustomEvent("radar:aviso", { detail: AVISO_VERIFICAR })); }
    return;
  }
  const lote = [...pendentes.entries()];
  pendentes.clear();
  if (lote.some(([k]) => k === "radar-vagas:candidaturas" || k === "radar-vagas:cvs-gerados")) atualizarResumo();
  for (const [chave, valor] of lote) {
    const ref = doc(db, "users", usuario.uid, "dados", SINCRONIZADAS[chave]);
    try {
      if (valor == null) await deleteDoc(ref);
      else await setDoc(ref, { valor: semPdf(chave, valor), atualizadoEm: serverTimestamp() });
      if (chave === "radar-vagas:perfil") await enviarPdf(valor?.cvPdf);
    } catch (e) {
      console.warn("Não consegui salvar na nuvem:", chave, e);
      window.dispatchEvent(new CustomEvent("radar:erro-nuvem", { detail: mensagemErro(e) }));
    }
  }
}
window.addEventListener("pagehide", () => { if (pendentes.size) enviarPendentes(); });

// ---------- IA (Firebase AI Logic) ----------

async function carregarConfigIA() {
  try {
    const [ia, sup] = await Promise.all([getDoc(doc(db, "config", "ia")), getDoc(doc(db, "config", "suporte"))]);
    if (ia.exists()) configIA = { ...configIA, ...ia.data() };
    if (sup.exists()) configSuporte = { ...configSuporte, ...sup.data() };
  } catch {}
}

// Converte as partes no formato da API REST (inline_data) para o formato do SDK (inlineData)
const converterPartes = (partes) => partes.map((p) => p.inline_data ? { inlineData: { mimeType: p.inline_data.mime_type, data: p.inline_data.data } } : p);

const diaUTC = (d) => d.toISOString().slice(0, 10); // o banco conta o dia em UTC (request.time.date())
const dataDe = (x) => (x?.toDate ? x.toDate() : x ? new Date(x) : null);

// Usos da IA hoje, pelo horário que o banco registrou (usoIA.em). Fichas antigas, sem "em", começam do zero.
function usoDeHoje() {
  const em = dataDe(fichaUsuario?.usoIA?.em);
  return em && diaUTC(em) === diaUTC(new Date()) ? fichaUsuario.usoIA.n || 0 : 0;
}

// Conta o uso ANTES de chamar a IA. As regras do banco só aceitam +1 por vez, até o limite do dia:
// se o banco recusar, a IA não é chamada.
async function contarUsoIA() {
  if (!usuario) return;
  if (!usuario.emailVerified) throw new Error(AVISO_VERIFICAR);
  const ref = doc(db, "users", usuario.uid);
  const limite = configIA.limiteDiario;
  const msgLimite = `Você chegou ao limite de ${limite} usos da IA por dia. Amanhã libera de novo.`;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const uso = usoDeHoje();
    if (!ehAdmin() && limite && uso >= limite) throw new Error(msgLimite);
    const hoje = diaUTC(new Date());
    try {
      // usoIADias alimenta o gráfico do admin
      await updateDoc(ref, { usoIA: { dia: hoje, n: uso + 1, em: serverTimestamp() }, usoIATotal: increment(1), [`usoIADias.${hoje}`]: increment(1) });
      fichaUsuario = { ...fichaUsuario, usoIA: { dia: hoje, n: uso + 1, em: new Date() } };
      return;
    } catch (e) {
      if (e?.code !== "permission-denied") throw e;
      // O contador pode ter mudado em outra aba ou aparelho: lê de novo do banco e tenta uma vez
      fichaUsuario = (await getDoc(ref)).data();
      if (fichaUsuario?.bloqueado) throw new Error("Sua conta está bloqueada. Fale com o administrador.");
    }
  }
  throw new Error(limite && usoDeHoje() >= limite ? msgLimite : "Não consegui registrar o uso da IA. Recarregue a página e tente de novo.");
}

const TEMPO_MAX_IA = 45000; // se um modelo travar, passa para o próximo

// Gera texto com o Gemini. Tenta os modelos em ordem: se um estiver sobrecarregado ou sem cota, vai para o próximo.
async function gerarIA(partes, { json = false, lerLinks = false, sistema = "", historico = null } = {}) {
  if (!usuario) throw new Error("Entre na sua conta para usar a IA.");
  if (fichaUsuario?.bloqueado) throw new Error("Sua conta está bloqueada. Fale com o administrador.");
  if (!usuario.emailVerified) throw new Error(AVISO_VERIFICAR);
  if (configIA.ativa === false) throw new Error("A IA está desligada pelo administrador no momento.");
  await contarUsoIA();
  let ultimoErro;
  for (const modelo of configIA.modelos) {
    try {
      const m = getGenerativeModel(ai, {
        model: modelo,
        generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: "application/json" } : {}) },
        ...(lerLinks ? { tools: [{ urlContext: {} }] } : {}),
        ...(sistema ? { systemInstruction: sistema } : {}),
      }, { timeout: TEMPO_MAX_IA });
      const r = historico
        ? await m.startChat({ history: historico }).sendMessage(converterPartes(partes))
        : await m.generateContent({ contents: [{ role: "user", parts: converterPartes(partes) }] });
      const texto = r.response.text();
      if (texto) return texto;
      ultimoErro = new Error("A IA não devolveu resposta.");
    } catch (e) {
      ultimoErro = e;
      const msg = String(e?.message || e);
      if (!/overload|503|429|quota|exhaust|not found|404|unavailable|500|timeout|timed out|abort/i.test(msg)) break; // outro modelo não resolve
    }
  }
  const msg = String(ultimoErro?.message || ultimoErro);
  registrarErro("ia", msg, `modelos: ${configIA.modelos.join(", ")}`);
  if (/firebasevertexai|ai logic|has not been used|api.*disabled|PERMISSION_DENIED|403/i.test(msg)) {
    throw new Error("A IA ainda não foi ativada no Firebase (console → AI Logic → Começar → Gemini Developer API).");
  }
  if (/429|quota|exhaust/i.test(msg)) throw new Error("Limite gratuito da IA atingido agora. Tente de novo em alguns minutos.");
  if (/503|overload|unavailable/i.test(msg)) throw new Error("A IA está sobrecarregada agora. Tente de novo em instantes.");
  throw new Error(`A IA respondeu com erro: ${msg}`);
}

// ---------- Registro de erros (o super admin vê em admin.html) ----------
// Só a mensagem, onde aconteceu e o navegador: nada de CV, vaga ou e-mail. No máximo 5 por página aberta.

const MAX_ERROS_POR_PAGINA = 5;
const errosEnviados = new Set();
const RUIDO = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|safari-extension:|Non-Error promise rejection|AbortError|Load failed|Failed to fetch|NetworkError/i;

function registrarErro(tipo, mensagem, origem = "") {
  const m = String(mensagem || "").slice(0, 500);
  if (!usuario || !m || RUIDO.test(m) || RUIDO.test(origem) || errosEnviados.has(m) || errosEnviados.size >= MAX_ERROS_POR_PAGINA) return;
  errosEnviados.add(m);
  addDoc(collection(db, "erros"), {
    tipo, mensagem: m, origem: String(origem).slice(0, 300),
    pagina: (location.pathname.split("/").pop() || "index.html").slice(0, 200),
    navegador: navigator.userAgent.slice(0, 200), uid: usuario.uid, criadoEm: serverTimestamp(),
  }).catch(() => {});
}
window.addEventListener("error", (e) => registrarErro("js", e.message || String(e.error || ""), `${String(e.filename || "").split("/").pop()}:${e.lineno || 0}:${e.colno || 0}`));
window.addEventListener("unhandledrejection", (e) => registrarErro("promessa", e.reason?.message || String(e.reason || ""), String(e.reason?.stack || "").split("\n")[1]?.trim() || ""));

async function listarErros() {
  if (!ehAdmin()) throw new Error("Só o super admin pode ver isso.");
  const snaps = await getDocs(query(collection(db, "erros"), orderBy("criadoEm", "desc"), limit(200)));
  return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
}
const apagarErros = (ids) => Promise.all(ids.map((id) => deleteDoc(doc(db, "erros", id))));

// ---------- Gmail (central de e-mail) ----------

const CHAVE_TOKEN = "radar-vagas:gmail-token"; // fica só nesta aba (sessionStorage) e vence em 1 hora

function tokenGmail() {
  try {
    const t = JSON.parse(sessionStorage.getItem(CHAVE_TOKEN));
    if (t && t.expira > Date.now() + 60000) return t.token;
  } catch {}
  return "";
}

async function conectarGmail() {
  if (!usuario) throw new Error("Entre na sua conta primeiro.");
  const provedor = new GoogleAuthProvider();
  provedor.addScope(SCOPE_GMAIL);
  provedor.setCustomParameters({ prompt: "consent", ...(usuario.email ? { login_hint: usuario.email } : {}) });
  const temGoogle = usuario.providerData.some((p) => p.providerId === "google.com");
  let r;
  try {
    r = temGoogle ? await reauthenticateWithPopup(usuario, provedor) : await linkWithPopup(usuario, provedor);
  } catch (e) {
    // Conta Google diferente da do login, ou já ligada a outro usuário: o Google ainda devolve o token do Gmail junto com o erro
    const credErro = GoogleAuthProvider.credentialFromError(e);
    if (credErro?.accessToken) return guardarTokenGmail(await conferirEscopo(credErro.accessToken));
    if (e?.code !== "auth/provider-already-linked") throw e;
    r = await reauthenticateWithPopup(usuario, provedor);
  }
  const cred = GoogleAuthProvider.credentialFromResult(r);
  if (!cred?.accessToken) throw new Error("O Google não liberou o acesso ao Gmail.");
  return guardarTokenGmail(await conferirEscopo(cred.accessToken));
}

// O Google deixa a pessoa desmarcar a permissão do Gmail na tela de consentimento: confere antes de usar
const PERMISSAO_GMAIL_FALTANDO = "O Google liberou o acesso sem a permissão do Gmail. Clique em \"Conectar meu Gmail\" de novo e, na tela de permissões, marque a caixa \"Ler seus e-mails\" antes de continuar.";
async function conferirEscopo(token) {
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    const info = await r.json();
    if (r.ok && !String(info.scope || "").split(" ").includes(SCOPE_GMAIL)) throw Object.assign(new Error(PERMISSAO_GMAIL_FALTANDO), { codigo: "gmail-sem-permissao" });
  } catch (e) {
    if (e.codigo) throw e; // sem internet para conferir: segue e o Gmail avisa se faltar
  }
  return token;
}

function guardarTokenGmail(token) {
  sessionStorage.setItem(CHAVE_TOKEN, JSON.stringify({ token, expira: Date.now() + 55 * 60000 }));
  return token;
}

const desconectarGmail = () => sessionStorage.removeItem(CHAVE_TOKEN);

async function gmail(caminho) {
  const token = tokenGmail();
  if (!token) throw Object.assign(new Error("Conecte o Gmail de novo (o acesso vale por 1 hora)."), { codigo: "gmail-desconectado" });
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) { desconectarGmail(); throw Object.assign(new Error("O acesso ao Gmail venceu. Conecte de novo."), { codigo: "gmail-desconectado" }); }
  if (r.status === 403) {
    const j = await r.json().catch(() => ({}));
    if (/insufficient.*scope/i.test(j.error?.message || "")) { desconectarGmail(); throw Object.assign(new Error(PERMISSAO_GMAIL_FALTANDO), { codigo: "gmail-desconectado" }); }
    throw new Error(/has not been used|disabled/i.test(j.error?.message || "") ? "A Gmail API ainda não foi ativada no projeto do Firebase." : `O Gmail recusou: ${j.error?.message || "sem permissão"}`);
  }
  if (!r.ok) throw new Error(`Gmail respondeu ${r.status}`);
  return r.json();
}

// ---------- Super admin ----------

async function listarUsuarios() {
  if (!ehAdmin()) throw new Error("Só o super admin pode ver isso.");
  const snaps = await getDocs(collection(db, "users"));
  return snaps.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
const atualizarUsuario = (uid, campos) => updateDoc(doc(db, "users", uid), campos);
// O super admin não lê o conteúdo de ninguém (as regras não deixam): apaga pelos nomes conhecidos, sem abrir
async function apagarDadosDoUsuario(uid) {
  await Promise.all(Object.values(SINCRONIZADAS).map((nome) => deleteDoc(doc(db, "users", uid, "dados", nome))));
  await apagarPdfDaNuvem(uid);
  await deleteDoc(doc(db, "users", uid));
}
// A própria pessoa atualiza campos da ficha dela (preferências, alerta, primeiro acesso). As regras impedem mexer em papel e bloqueio.
async function atualizarMinhaFicha(campos) {
  if (!usuario) throw new Error("Entre na sua conta primeiro.");
  // Alerta por e-mail só com o e-mail confirmado (senão daria para mandar alertas para o e-mail de outra pessoa)
  if (campos.alerta?.ativo && !usuario.emailVerified) {
    campos = { ...campos, alerta: { ...campos.alerta, ativo: false } };
    window.dispatchEvent(new CustomEvent("radar:aviso", { detail: "O alerta por e-mail liga depois que você confirmar seu e-mail (menu da conta → Verificar meu e-mail)." }));
  }
  await updateDoc(doc(db, "users", usuario.uid), campos);
  fichaUsuario = { ...fichaUsuario, ...campos };
}
// Notificações: cada aparelho vira users/{uid}.push.{id}; o robô diário manda as vagas novas para eles
async function registrarPush(id, inscricao) {
  if (!usuario) throw new Error("Entre na sua conta primeiro.");
  await updateDoc(doc(db, "users", usuario.uid), { [`push.${id}`]: inscricao, pushAtivo: true });
  fichaUsuario = { ...fichaUsuario, push: { ...(fichaUsuario?.push || {}), [id]: inscricao }, pushAtivo: true };
}
async function removerPush(id) {
  if (!usuario) return;
  const { [id]: _, ...outros } = fichaUsuario?.push || {};
  await updateDoc(doc(db, "users", usuario.uid), { [`push.${id}`]: deleteField(), pushAtivo: Object.keys(outros).length > 0 });
  fichaUsuario = { ...fichaUsuario, push: outros, pushAtivo: Object.keys(outros).length > 0 };
}

const salvarConfigSuporte = async (campos) => { await setDoc(doc(db, "config", "suporte"), campos, { merge: true }); configSuporte = { ...configSuporte, ...campos }; };
const salvarConfigIA = async (campos) => { await setDoc(doc(db, "config", "ia"), campos, { merge: true }); configIA = { ...configIA, ...campos }; };

// ---------- Início ----------

const nuvem = {
  SUPER_ADMIN,
  pronto: false,
  get usuario() { return usuario; },
  get ficha() { return fichaUsuario; },
  get configIA() { return configIA; },
  get configSuporte() { return configSuporte; },
  // Confere se o App Check consegue emitir o comprovante deste navegador (usado no painel do admin)
  verificarAppCheck: async () => { if (!appCheck) return false; try { return Boolean((await tokenAppCheck(appCheck)).token); } catch { return false; } },
  ehAdmin: () => ehAdmin(),
  entrarComGoogle, entrarComEmail, criarConta, recuperarSenha, reenviarVerificacao, excluirConta, sair, mensagemErro,
  salvar: agendarEnvio,
  atualizarMinhaFicha, registrarPush, removerPush,
  gerarIA,
  conectarGmail, desconectarGmail, gmailConectado: () => Boolean(tokenGmail()), gmail,
  listarErros, apagarErros,
  listarUsuarios, atualizarUsuario, apagarDadosDoUsuario, salvarConfigIA, carregarConfigIA, salvarConfigSuporte,
};
window.radarNuvem = nuvem;

onAuthStateChanged(auth, async (u) => {
  usuario = u;
  fichaUsuario = null;
  if (!u) limparDadosLocais(); // ninguém conectado: nada pessoal fica no navegador
  if (u) {
    try {
      // Conta de e-mail e senha: confere se a pessoa já clicou no link de confirmação (e atualiza o login para o banco saber)
      if (!u.emailVerified && u.providerData.some((p) => p.providerId === "password")) {
        try { await u.reload(); if (u.emailVerified) await u.getIdToken(true); } catch {}
      }
      await registrarUsuario(u);
      const [apagouDeOutro] = await Promise.all([carregarDados(u), carregarConfigIA()]);
      // A página aberta pode já ter mostrado dados de quem usou o navegador antes: recarrega só com os desta conta
      if (apagouDeOutro && !/login\.html$/.test(location.pathname)) { location.reload(); return; }
      if (!fichaUsuario?.resumo || fichaUsuario.resumo.cvsVagas) atualizarResumo(); // contas de antes do resumo, ou com o resumo antigo (que listava as vagas)
    } catch (e) {
      console.warn("Firebase:", e);
      window.dispatchEvent(new CustomEvent("radar:erro-nuvem", { detail: mensagemErro(e) }));
    }
  }
  nuvem.pronto = true;
  window.dispatchEvent(new CustomEvent("radar:usuario", { detail: { usuario: u, ficha: fichaUsuario, admin: ehAdmin(u) } }));
});
