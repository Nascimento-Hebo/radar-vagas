// Ponte entre a página e o Firebase (projeto radar-de-vagas-1f800, plano gratuito).
// - Login: Google ou e-mail/senha (Firebase Authentication).
// - Dados de cada pessoa: Firestore em users/{uid} e users/{uid}/dados/{nome}. O navegador guarda uma cópia (localStorage).
// - IA: Firebase AI Logic com a Gemini Developer API. A chave fica no Firebase, nunca no navegador.
// - Gmail: token de leitura pedido pelo login do Google, só quando a pessoa conecta a central de e-mail.
// As páginas (app.js, cv.js, admin.js) usam tudo por window.radarNuvem.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut,
  reauthenticateWithPopup, linkWithPopup,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";

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
const auth = getAuth(app);
auth.languageCode = "pt";
const db = getFirestore(app);
const ai = getAI(app, { backend: new GoogleAIBackend() });

// Chaves do localStorage que vão para a nuvem. O PDF do CV não vai (pesa demais).
const SINCRONIZADAS = {
  "radar-vagas:candidaturas": "candidaturas",
  "radar-vagas:meta-semana": "meta",
  "radar-vagas:perfil": "perfil",
  "radar-vagas:cvs-gerados": "cvs",
  "radar-vagas:tema": "tema",
  "radar-vagas:suporte": "suporte",
};
const SCOPE_GMAIL = "https://www.googleapis.com/auth/gmail.readonly";

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
const sair = () => signOut(auth);

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

// Traz os dados da nuvem para o navegador. Na primeira vez, sobe o que já existia neste navegador.
async function carregarDados(u) {
  const snaps = await getDocs(collection(db, "users", u.uid, "dados"));
  const naNuvem = Object.fromEntries(snaps.docs.map((d) => [d.id, d.data().valor]));
  for (const [chave, nome] of Object.entries(SINCRONIZADAS)) {
    const local = lerLocal(chave);
    if (nome in naNuvem) {
      let valor = naNuvem[nome];
      if (nome === "candidaturas" && local && typeof local === "object") valor = { ...local, ...valor }; // junta as duas listas
      if (nome === "perfil" && local?.cvPdf) valor = { ...valor, cvPdf: local.cvPdf }; // PDF fica só no navegador
      gravarLocal(chave, valor);
      if (nome === "candidaturas" && Object.keys(valor).length !== Object.keys(naNuvem[nome] || {}).length) agendarEnvio(chave, valor);
    } else if (local != null) {
      agendarEnvio(chave, local);
    }
  }
}

function agendarEnvio(chave, valor) {
  if (!SINCRONIZADAS[chave]) return;
  pendentes.set(chave, valor);
  clearTimeout(timerEnvio);
  timerEnvio = setTimeout(enviarPendentes, 800);
}

async function enviarPendentes() {
  if (!usuario || fichaUsuario?.bloqueado) return;
  const lote = [...pendentes.entries()];
  pendentes.clear();
  for (const [chave, valor] of lote) {
    const ref = doc(db, "users", usuario.uid, "dados", SINCRONIZADAS[chave]);
    try {
      if (valor == null) await deleteDoc(ref);
      else await setDoc(ref, { valor: semPdf(chave, valor), atualizadoEm: serverTimestamp() });
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

async function contarUsoIA() {
  if (!usuario) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const uso = fichaUsuario?.usoIA?.dia === hoje ? fichaUsuario.usoIA.n : 0;
  if (!ehAdmin() && configIA.limiteDiario && uso >= configIA.limiteDiario) {
    throw new Error(`Você chegou ao limite de ${configIA.limiteDiario} usos da IA por dia. Amanhã libera de novo.`);
  }
  fichaUsuario = { ...fichaUsuario, usoIA: { dia: hoje, n: uso + 1 } };
  updateDoc(doc(db, "users", usuario.uid), { usoIA: { dia: hoje, n: uso + 1 }, usoIATotal: increment(1) }).catch(() => {});
}

const TEMPO_MAX_IA = 45000; // se um modelo travar, passa para o próximo

// Gera texto com o Gemini. Tenta os modelos em ordem: se um estiver sobrecarregado ou sem cota, vai para o próximo.
async function gerarIA(partes, { json = false, lerLinks = false, sistema = "", historico = null } = {}) {
  if (!usuario) throw new Error("Entre na sua conta para usar a IA.");
  if (fichaUsuario?.bloqueado) throw new Error("Sua conta está bloqueada. Fale com o administrador.");
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
  if (/firebasevertexai|ai logic|has not been used|api.*disabled|PERMISSION_DENIED|403/i.test(msg)) {
    throw new Error("A IA ainda não foi ativada no Firebase (console → AI Logic → Começar → Gemini Developer API).");
  }
  if (/429|quota|exhaust/i.test(msg)) throw new Error("Limite gratuito da IA atingido agora. Tente de novo em alguns minutos.");
  if (/503|overload|unavailable/i.test(msg)) throw new Error("A IA está sobrecarregada agora. Tente de novo em instantes.");
  throw new Error(`A IA respondeu com erro: ${msg}`);
}

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
  const r = temGoogle ? await reauthenticateWithPopup(usuario, provedor) : await linkWithPopup(usuario, provedor);
  const cred = GoogleAuthProvider.credentialFromResult(r);
  if (!cred?.accessToken) throw new Error("O Google não liberou o acesso ao Gmail.");
  sessionStorage.setItem(CHAVE_TOKEN, JSON.stringify({ token: cred.accessToken, expira: Date.now() + 55 * 60000 }));
  return cred.accessToken;
}

const desconectarGmail = () => sessionStorage.removeItem(CHAVE_TOKEN);

async function gmail(caminho) {
  const token = tokenGmail();
  if (!token) throw Object.assign(new Error("Conecte o Gmail de novo (o acesso vale por 1 hora)."), { codigo: "gmail-desconectado" });
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) { desconectarGmail(); throw Object.assign(new Error("O acesso ao Gmail venceu. Conecte de novo."), { codigo: "gmail-desconectado" }); }
  if (r.status === 403) {
    const j = await r.json().catch(() => ({}));
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
async function dadosDoUsuario(uid) {
  const snaps = await getDocs(collection(db, "users", uid, "dados"));
  return Object.fromEntries(snaps.docs.map((d) => [d.id, d.data().valor]));
}
const atualizarUsuario = (uid, campos) => updateDoc(doc(db, "users", uid), campos);
async function apagarDadosDoUsuario(uid) {
  const snaps = await getDocs(collection(db, "users", uid, "dados"));
  await Promise.all(snaps.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "users", uid));
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
  ehAdmin: () => ehAdmin(),
  entrarComGoogle, entrarComEmail, criarConta, recuperarSenha, reenviarVerificacao, sair, mensagemErro,
  salvar: agendarEnvio,
  gerarIA,
  conectarGmail, desconectarGmail, gmailConectado: () => Boolean(tokenGmail()), gmail,
  listarUsuarios, dadosDoUsuario, atualizarUsuario, apagarDadosDoUsuario, salvarConfigIA, carregarConfigIA, salvarConfigSuporte,
};
window.radarNuvem = nuvem;

onAuthStateChanged(auth, async (u) => {
  usuario = u;
  fichaUsuario = null;
  if (u) {
    try {
      await registrarUsuario(u);
      await Promise.all([carregarDados(u), carregarConfigIA()]);
    } catch (e) {
      console.warn("Firebase:", e);
      window.dispatchEvent(new CustomEvent("radar:erro-nuvem", { detail: mensagemErro(e) }));
    }
  }
  nuvem.pronto = true;
  window.dispatchEvent(new CustomEvent("radar:usuario", { detail: { usuario: u, ficha: fichaUsuario, admin: ehAdmin(u) } }));
});
