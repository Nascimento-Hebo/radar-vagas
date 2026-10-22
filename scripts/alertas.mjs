// Alerta diário: depois da busca, manda para cada pessoa as vagas novas de hoje que combinam com o que ela procura,
// por e-mail (se ativou o alerta) e por notificação nos aparelhos que ela ativou.
// Precisa dos secrets do GitHub:
//   FIREBASE_SERVICE_ACCOUNT  conta de serviço com acesso ao Firestore (já configurada)
//   MAIL_USERNAME / MAIL_PASSWORD  Gmail que envia + senha de app do Gmail
//   VAPID_PRIVATE_KEY  chave privada das notificações (a pública está em docs/push.js)
// Sem MAIL_* ou sem VAPID_PRIVATE_KEY, aquele canal roda em modo de teste: mostra quantos mandaria, sem enviar.

import { readFile, appendFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { combinaComAlerta } from "./vagas-core.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://nascimento-hebo.github.io/radar-vagas/";
const MAX_VAGAS_POR_EMAIL = 15;
const VAPID_PUBLICA = "BD0x7EOdUjwhMPycjYPwwOFuKa8YjBWE3zlibdKU0rnkNtWF9V63DzFScOFGlpBWgj5bsW9zkX0WFg8vYSjKSL4"; // a mesma de docs/push.js

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

// Token de acesso do Google a partir da conta de serviço (JWT assinado com a chave privada)
async function tokenGoogle(sa) {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: sa.token_uri, iat: agora, exp: agora + 3600 }));
  const assinatura = createSign("RSA-SHA256").update(`${cab}.${corpo}`).sign(sa.private_key);
  const r = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cab}.${corpo}.${b64url(assinatura)}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Não consegui o token do Google: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

// Converte o formato do Firestore REST ({stringValue: "x"}) em objeto comum
function valor(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valor);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, valor(x)]));
  return null;
}

async function consultar(sa, token, campo) {
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:runQuery`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "users" }], where: { fieldFilter: { field: { fieldPath: campo }, op: "EQUAL", value: { booleanValue: true } } } } }),
  });
  const linhas = await r.json();
  if (!r.ok) throw new Error(`Firestore respondeu ${r.status}: ${JSON.stringify(linhas).slice(0, 200)}`);
  return linhas.filter((l) => l.document).map((l) => ({ uid: l.document.name.split("/").pop(), ...valor({ mapValue: { fields: l.document.fields } }) }));
}

// Quem ativou o e-mail ou alguma notificação (uma pessoa pode estar nas duas listas)
async function pessoasComAlerta(sa, token) {
  const [email, push] = await Promise.all([consultar(sa, token, "alerta.ativo"), consultar(sa, token, "pushAtivo")]);
  const porUid = new Map([...email, ...push].map((u) => [u.uid, u]));
  return [...porUid.values()].filter((u) => !u.bloqueado);
}

// Aparelho que não existe mais (desinstalou, limpou o navegador): tira da ficha
async function removerInscricao(sa, token, uid, id) {
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=push.${id}`;
  await fetch(url, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields: {} }) }).catch(() => {});
}

function montarNotificacao(vagas, total) {
  const primeira = vagas[0];
  const corpo = total === 1
    ? `${primeira.titulo}${primeira.empresa ? ` · ${primeira.empresa}` : ""}`
    : `${vagas.slice(0, 3).map((v) => v.titulo).join(" · ")}${total > 3 ? ` e mais ${total - 3}` : ""}`;
  return JSON.stringify({ titulo: `${total} ${total === 1 ? "vaga nova combina" : "vagas novas combinam"} com você`, corpo, url: "./#para-voce", tag: "vagas-novas" });
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function montarEmail(pessoa, vagas, total) {
  const nome = (pessoa.nome || "").split(" ")[0];
  const itens = vagas.map((v) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e5e9f2">
      <a href="${esc(v.link)}" style="font:700 16px Arial,sans-serif;color:#2456d6;text-decoration:none">${esc(v.titulo)}</a>
      <div style="font:14px Arial,sans-serif;color:#55627d;margin-top:4px">${esc([v.empresa, v.nivel, v.regime, v.modelo === "Remoto" ? "100% remoto" : v.local].filter((x) => x && x !== "Não informado").join(" · "))}</div>
      ${v.salario ? `<div style="font:700 14px Arial,sans-serif;color:#047857;margin-top:4px">${esc(v.salario)}</div>` : ""}
    </td></tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f7fc">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fc;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;padding:28px">
    <tr><td style="font:800 22px Arial,sans-serif;color:#0f1830">${nome ? `${esc(nome)}, ` : ""}${total} ${total === 1 ? "vaga nova combina" : "vagas novas combinam"} com você</td></tr>
    <tr><td style="font:15px Arial,sans-serif;color:#55627d;padding:6px 0 10px">Do Radar de Vagas de hoje, filtradas pelo que você procura.</td></tr>
    ${itens}
    <tr><td style="padding:22px 0 6px"><a href="${SITE}" style="display:inline-block;background:#2456d6;color:#fff;font:700 15px Arial,sans-serif;padding:12px 20px;border-radius:10px;text-decoration:none">Ver no Radar e adaptar meu CV</a></td></tr>
    <tr><td style="font:12px Arial,sans-serif;color:#8a94ab;padding-top:18px">Você recebe este e-mail porque ativou o alerta de vagas no Radar de Vagas (OH Tech Technology). Para parar, abra o site, clique na sua foto → Minhas preferências e desligue o alerta.</td></tr>
  </table></td></tr></table></body></html>`;
  const texto = `${total} vagas novas combinam com você no Radar de Vagas:\n\n` + vagas.map((v) => `- ${v.titulo}${v.empresa ? ` (${v.empresa})` : ""}\n  ${v.link}`).join("\n") + `\n\nVer todas: ${SITE}\nPara parar: Minhas preferências no site.`;
  return { assunto: `${total} ${total === 1 ? "vaga nova" : "vagas novas"} para você no Radar de Vagas`, html, texto };
}

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "null");
if (!sa) { console.log("Sem FIREBASE_SERVICE_ACCOUNT: alertas desligados."); process.exit(0); }

const dados = JSON.parse(await readFile(join(RAIZ, "docs", "vagas.json"), "utf8"));
const novasHoje = dados.vagas.filter((v) => v.status === "aberta" && v.encontradaEm === dados.dataRodada);
console.log(`Alertas · ${novasHoje.length} vagas novas hoje`);

const token = await tokenGoogle(sa);
const pessoas = await pessoasComAlerta(sa, token);
console.log(`${pessoas.length} pessoas com alerta ativo`);

let transporte = null;
if (process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD) {
  const nodemailer = (await import("nodemailer")).default;
  transporte = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USERNAME, pass: process.env.MAIL_PASSWORD } });
} else {
  console.log("Sem MAIL_USERNAME/MAIL_PASSWORD: modo de teste, nenhum e-mail será enviado.");
}

let webpush = null;
if (process.env.VAPID_PRIVATE_KEY) {
  webpush = (await import("web-push")).default;
  webpush.setVapidDetails(`mailto:${process.env.MAIL_USERNAME || "nascimentohebo2@gmail.com"}`, VAPID_PUBLICA, process.env.VAPID_PRIVATE_KEY);
} else {
  console.log("Sem VAPID_PRIVATE_KEY: modo de teste, nenhuma notificação será enviada.");
}

let enviados = 0, falhas = 0, notificacoes = 0, removidas = 0;
for (const p of pessoas) {
  const combinam = novasHoje.filter((v) => combinaComAlerta(v, p.alerta || {}));
  if (!combinam.length) continue;

  if (p.alerta?.ativo && p.email) {
    const email = montarEmail(p, combinam.slice(0, MAX_VAGAS_POR_EMAIL), combinam.length);
    if (!transporte) console.log(`  [teste] mandaria e-mail com ${combinam.length} vagas para uma pessoa`);
    else {
      try {
        await transporte.sendMail({ from: `Radar de Vagas <${process.env.MAIL_USERNAME}>`, to: p.email, subject: email.assunto, html: email.html, text: email.texto });
        enviados++;
      } catch (e) {
        falhas++;
        console.warn(`  ! e-mail falhou para uma pessoa: ${e.message}`);
      }
    }
  }

  const aparelhos = Object.entries(p.push || {}).filter(([, x]) => x?.endpoint && x?.keys?.p256dh && x?.keys?.auth);
  if (!aparelhos.length) continue;
  if (!webpush) { console.log(`  [teste] mandaria notificação para ${aparelhos.length} aparelho(s)`); continue; }
  const msg = montarNotificacao(combinam, combinam.length);
  for (const [id, x] of aparelhos) {
    try {
      await webpush.sendNotification({ endpoint: x.endpoint, keys: x.keys }, msg, { TTL: 12 * 3600 });
      notificacoes++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await removerInscricao(sa, token, p.uid, id); removidas++; }
      else { falhas++; console.warn(`  ! notificação falhou: ${e.statusCode || e.message}`); }
    }
  }
}
console.log(`E-mails: ${enviados} · notificações: ${notificacoes}${removidas ? ` · aparelhos removidos: ${removidas}` : ""}${falhas ? ` · falhas: ${falhas}` : ""}`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Alertas\n${pessoas.length} pessoas com alerta · ${enviados} e-mails${transporte ? "" : " (modo de teste: falta MAIL_USERNAME/MAIL_PASSWORD)"} · ${notificacoes} notificações${webpush ? "" : " (modo de teste: falta VAPID_PRIVATE_KEY)"}\n`);
