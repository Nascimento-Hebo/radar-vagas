// Dados pessoais guardados neste navegador: de qual conta são e como limpar.
// Separado do firebase.js para ser testado sem o Firebase (test/conta-local.test.mjs).
// Regra: o navegador só guarda dados de uma conta por vez. Outra conta que entrar não vê nem herda nada.

export const CHAVE_DONO = "radar-vagas:dono"; // uid da conta dona dos dados guardados aqui
const CHAVE_PERFIL = "radar-vagas:perfil";
const DO_APARELHO = new Set(["radar-vagas:tema"]); // preferência do aparelho, não é de ninguém: fica

const lerJson = (armazem, k) => { try { return JSON.parse(armazem.getItem(k)); } catch { return null; } };

// Apaga tudo o que é de uma pessoa (CV, candidaturas, conversas com a IA, token do Gmail...). Devolve quantos itens apagou.
export function limparDadosLocais(armazem = globalThis.localStorage, sessao = globalThis.sessionStorage) {
  let n = 0;
  try {
    const chaves = [];
    for (let i = 0; i < armazem.length; i++) {
      const k = armazem.key(i);
      if (k?.startsWith("radar-vagas:") && !DO_APARELHO.has(k) && k !== CHAVE_DONO) chaves.push(k);
    }
    chaves.forEach((k) => armazem.removeItem(k));
    armazem.removeItem(CHAVE_DONO);
    n = chaves.length;
  } catch {}
  try { sessao?.clear(); } catch {}
  return n;
}

// Prepara o navegador para a conta que entrou. Se os dados guardados forem de outra conta, ou de antes de
// existir o dono, apaga tudo. Exceção: o PDF do CV de antes do dono fica se tiver o nome do PDF que esta
// conta registrou na nuvem (nomePdfDaConta), porque nesse caso é dela.
// Devolve quantos itens de outra pessoa foram apagados (0 = nada mudou).
export function prepararParaConta(uid, { nomePdfDaConta = "" } = {}, armazem = globalThis.localStorage, sessao = globalThis.sessionStorage) {
  let dono = null;
  try { dono = armazem.getItem(CHAVE_DONO); } catch {}
  if (dono === uid) return 0;
  const pdf = lerJson(armazem, CHAVE_PERFIL)?.cvPdf;
  const apagados = limparDadosLocais(armazem, sessao);
  try {
    if (dono == null && pdf?.nome && pdf.nome === nomePdfDaConta) armazem.setItem(CHAVE_PERFIL, JSON.stringify({ cvPdf: pdf }));
    armazem.setItem(CHAVE_DONO, uid);
  } catch {}
  return apagados;
}

// Assinatura de um PDF (nome + tamanho + hash), para saber se o da nuvem e o do navegador são o mesmo arquivo
export function assinaturaPdf(pdf) {
  if (!pdf?.base64) return "";
  let h = 2166136261;
  for (let i = 0; i < pdf.base64.length; i++) { h ^= pdf.base64.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${pdf.nome || ""}|${pdf.base64.length}|${(h >>> 0).toString(36)}`;
}

// Divide o PDF (base64) em partes que cabem num documento do Firestore (limite de 1 MB por documento)
export const PARTE_PDF = 700000;
export const MAX_PARTES_PDF = 16; // 8 MB de PDF viram ~11 MB em base64
export function partesDoPdf(base64) {
  const partes = [];
  for (let i = 0; i < base64.length; i += PARTE_PDF) partes.push(base64.slice(i, i + PARTE_PDF));
  return partes;
}
