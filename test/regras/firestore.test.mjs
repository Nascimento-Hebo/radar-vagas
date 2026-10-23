// Testes das regras do banco (firestore.rules) no emulador do Firestore.
// Rodar: npm run test:regras (precisa do Firebase CLI e do Java).

import { test, before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, increment, Timestamp } from "firebase/firestore";

const ADMIN = { email: "nascimentohebo2@gmail.com", email_verified: true };
let amb;

before(async () => {
  amb = await initializeTestEnvironment({ projectId: "demo-radar", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
});
after(() => amb?.cleanup());

const fichaAna = { nome: "Ana", email: "ana@exemplo.com", foto: "", provedor: "google.com", criadoEm: Timestamp.now(), papel: "usuario", bloqueado: false };
beforeEach(async () => {
  await amb.clearFirestore();
  await amb.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "users/ana"), fichaAna);
    await setDoc(doc(db, "users/ana/dados/perfil"), { valor: { nome: "Ana", cvTexto: "meu CV" } });
    await setDoc(doc(db, "users/ana/dados/suporte"), { valor: [{ de: "eu", texto: "conversa com a IA" }] });
    await setDoc(doc(db, "users/ana/arquivos/cvPdf"), { nome: "cv.pdf", assinatura: "x", partes: 1 });
    await setDoc(doc(db, "users/ana/arquivos/cvPdf-0"), { dados: "JVBERi0" });
    await setDoc(doc(db, "config/ia"), { limiteDiario: 2 });
  });
});

const ana = (extra = {}) => amb.authenticatedContext("ana", { email: "ana@exemplo.com", email_verified: true, ...extra }).firestore();
const bia = () => amb.authenticatedContext("bia", { email: "bia@exemplo.com", email_verified: true }).firestore();
const admin = () => amb.authenticatedContext("admin", ADMIN).firestore();

// ---------- Privacidade ----------

test("outra conta não lê a ficha, os dados nem o PDF de ninguém", async () => {
  const db = bia();
  await assertFails(getDoc(doc(db, "users/ana")));
  await assertFails(getDoc(doc(db, "users/ana/dados/perfil")));
  await assertFails(getDocs(collection(db, "users/ana/dados")));
  await assertFails(getDoc(doc(db, "users/ana/arquivos/cvPdf-0")));
  await assertFails(getDocs(collection(db, "users")));
});

test("outra conta não grava nem apaga nada de ninguém", async () => {
  const db = bia();
  await assertFails(setDoc(doc(db, "users/ana/dados/perfil"), { valor: {} }));
  await assertFails(deleteDoc(doc(db, "users/ana/dados/perfil")));
  await assertFails(setDoc(doc(db, "users/ana/arquivos/cvPdf-0"), { dados: "x" }));
  await assertFails(updateDoc(doc(db, "users/ana"), { nome: "Outra" }));
});

test("a própria pessoa lê e grava o que é dela", async () => {
  const db = ana();
  await assertSucceeds(getDoc(doc(db, "users/ana")));
  await assertSucceeds(getDocs(collection(db, "users/ana/dados")));
  await assertSucceeds(getDoc(doc(db, "users/ana/arquivos/cvPdf-0")));
  await assertSucceeds(setDoc(doc(db, "users/ana/dados/candidaturas"), { valor: { v1: { etapa: "candidatei" } } }));
  await assertSucceeds(setDoc(doc(db, "users/ana/arquivos/cvPdf-1"), { dados: "abc" }));
});

test("o super admin vê a lista de fichas, mas não lê o conteúdo de ninguém", async () => {
  const db = admin();
  await assertSucceeds(getDocs(collection(db, "users")));
  await assertFails(getDoc(doc(db, "users/ana/dados/perfil")));
  await assertFails(getDocs(collection(db, "users/ana/dados")));
  await assertFails(getDoc(doc(db, "users/ana/arquivos/cvPdf-0")));
  await assertFails(setDoc(doc(db, "users/ana/dados/perfil"), { valor: {} }));
});

test("o super admin apaga os dados sem ler e bloqueia a conta", async () => {
  const db = admin();
  await assertSucceeds(deleteDoc(doc(db, "users/ana/dados/perfil")));
  await assertSucceeds(deleteDoc(doc(db, "users/ana/arquivos/cvPdf-0")));
  await assertSucceeds(updateDoc(doc(db, "users/ana"), { bloqueado: true }));
});

test("e-mail do admin sem confirmação não é admin", async () => {
  const db = amb.authenticatedContext("falso", { email: ADMIN.email, email_verified: false }).firestore();
  await assertFails(getDocs(collection(db, "users")));
});

// ---------- Ficha ----------

test("a pessoa não muda papel nem bloqueio, nem grava campos desconhecidos", async () => {
  const db = ana();
  await assertFails(updateDoc(doc(db, "users/ana"), { bloqueado: false, papel: "admin" }));
  await assertFails(updateDoc(doc(db, "users/ana"), { qualquerCoisa: "x" }));
  await assertSucceeds(updateDoc(doc(db, "users/ana"), { onboardingFeito: true, nome: "Ana Souza", ultimoAcesso: serverTimestamp() }));
});

test("o e-mail da ficha tem que ser o do login (o robô manda alertas para ele)", async () => {
  await assertFails(updateDoc(doc(ana(), "users/ana"), { email: "vitima@exemplo.com" }));
  const nova = amb.authenticatedContext("caio", { email: "caio@exemplo.com", email_verified: true }).firestore();
  await assertFails(setDoc(doc(nova, "users/caio"), { nome: "Caio", email: "vitima@exemplo.com", papel: "usuario", bloqueado: false }));
  await assertSucceeds(setDoc(doc(nova, "users/caio"), { nome: "Caio", email: "caio@exemplo.com", foto: "", provedor: "password", criadoEm: serverTimestamp(), ultimoAcesso: serverTimestamp(), papel: "usuario", bloqueado: false }));
});

test("o resumo da ficha só aceita números (sem lista de vagas)", async () => {
  const db = ana();
  await assertFails(updateDoc(doc(db, "users/ana"), { resumo: { nCand: 1, nCvs: 1, etapas: {}, cvsVagas: ["Vaga X · Empresa Y"] } }));
  await assertSucceeds(updateDoc(doc(db, "users/ana"), { resumo: { nCand: 1, nCvs: 1, etapas: { candidatei: 1 } } }));
});

// ---------- Limite da IA ----------

const usarIA = (db, n) => updateDoc(doc(db, "users/ana"), { usoIA: { dia: "2026-10-23", n, em: serverTimestamp() }, usoIATotal: increment(1), "usoIADias.2026-10-23": increment(1) });

test("o uso da IA só sobe de 1 em 1 e para no limite do dia", async () => {
  const db = ana();
  await assertFails(usarIA(db, 5)); // pular o contador
  await assertSucceeds(usarIA(db, 1));
  await assertFails(usarIA(db, 1)); // voltar o contador para 1 no mesmo dia
  await assertSucceeds(usarIA(db, 2));
  await assertFails(usarIA(db, 3)); // limite do config/ia é 2
});

test("não dá para zerar o contador mexendo no dia ou no horário", async () => {
  const db = ana();
  await assertSucceeds(usarIA(db, 1));
  await assertFails(updateDoc(doc(db, "users/ana"), { usoIA: { dia: "2026-10-24", n: 1, em: Timestamp.fromDate(new Date(Date.now() + 86400000)) }, usoIATotal: increment(1) }));
  await assertFails(updateDoc(doc(db, "users/ana"), { usoIA: { dia: "2026-10-23", n: 2, em: serverTimestamp() }, usoIATotal: 0 }));
});

test("limite 0 no config quer dizer sem limite", async () => {
  await amb.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "config/ia"), { limiteDiario: 0 }));
  const db = ana();
  for (let n = 1; n <= 4; n++) await assertSucceeds(usarIA(db, n));
});

test("conta bloqueada não conta uso da IA nem grava dados", async () => {
  await amb.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), "users/ana"), { bloqueado: true }));
  const db = ana();
  await assertFails(usarIA(db, 1));
  await assertFails(setDoc(doc(db, "users/ana/dados/perfil"), { valor: {} }));
  await assertSucceeds(deleteDoc(doc(db, "users/ana/dados/perfil"))); // apagar o que é seu vale mesmo bloqueada
});

// ---------- E-mail não confirmado ----------

test("e-mail não confirmado não grava dados, não usa a IA e não liga alerta por e-mail", async () => {
  const db = ana({ email_verified: false });
  await assertSucceeds(getDoc(doc(db, "users/ana/dados/perfil")));
  await assertFails(setDoc(doc(db, "users/ana/dados/perfil"), { valor: {} }));
  await assertFails(setDoc(doc(db, "users/ana/arquivos/cvPdf-0"), { dados: "x" }));
  await assertFails(usarIA(db, 1));
  await assertFails(updateDoc(doc(db, "users/ana"), { alerta: { ativo: true } }));
  await assertSucceeds(updateDoc(doc(db, "users/ana"), { alerta: { ativo: false }, onboardingFeito: true }));
});

// ---------- PDF do CV ----------

test("o PDF só aceita os nomes e tamanhos combinados", async () => {
  const db = ana();
  await assertFails(setDoc(doc(db, "users/ana/arquivos/outro"), { dados: "x" }));
  await assertFails(setDoc(doc(db, "users/ana/arquivos/cvPdf-0"), { dados: "x".repeat(700001) }));
  await assertFails(setDoc(doc(db, "users/ana/arquivos/cvPdf"), { nome: "cv.pdf", assinatura: "a", partes: 40 }));
  await assertSucceeds(setDoc(doc(db, "users/ana/arquivos/cvPdf"), { nome: "cv.pdf", assinatura: "a", partes: 2, atualizadoEm: serverTimestamp() }));
});
