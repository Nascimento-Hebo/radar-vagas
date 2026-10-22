// Firebase simulado para os testes de ponta a ponta: usuário logado e IA com respostas fixas por tipo de pedido.
// Os testes trocam o docs/firebase.js por este arquivo (page.route), então nada vai para o Firebase de verdade.
const usuario = { uid: "u1", email: "teste@exemplo.com", displayName: "Pessoa de Teste", emailVerified: true, photoURL: "", providerData: [{ providerId: "google.com" }] };
const ficha = { papel: "usuario", onboardingFeito: true };
const cvBase = {
  titulo: "Desenvolvedor Full Stack · React · Node.js",
  resumo: "Desenvolvedor com 3 anos em produtos web, focado em React e Node.js.",
  habilidades: ["React", "Node.js", "JavaScript", "Git"],
  experiencias: [{ cargo: "Desenvolvedor Full Stack", empresa: "Loja X", periodo: "2023 – atual", local: "Curitiba - PR", itens: ["Responsável por manter o sistema de pedidos.", "Criei APIs REST em Node.js."] }],
  projetos: [], formacao: [{ curso: "Análise e Desenvolvimento de Sistemas", instituicao: "UTFPR", periodo: "2021 – 2023" }],
  certificacoes: [], idiomas: ["Inglês intermediário"], textoOriginal: "Dev na Loja X.", modeloSugerido: "moderno", motivoModelo: "",
  mudancas: [{ secao: "Resumo", tipo: "reescrito", antes: "Dev", depois: "Desenvolvedor com 3 anos", motivo: "Vaga pede experiência." }],
  conferir: [], lacunas: ["Docker"],
};
window.__pedidosIA = [];
window.radarNuvem = {
  SUPER_ADMIN: "admin@exemplo.com", pronto: true, usuario, ficha,
  configIA: { ativa: true, modelos: ["x"], limiteDiario: 60 }, configSuporte: { nome: "Suporte Radar", avatar: "", saudacao: "" },
  ehAdmin: () => false, salvar() {}, mensagemErro: (e) => e.message, sair: async () => {}, gmailConectado: () => false,
  verificarAppCheck: async () => true, atualizarMinhaFicha: async () => {}, registrarPush: async () => {}, removerPush: async () => {},
  async gerarIA(partes) {
    await new Promise((r) => setTimeout(r, 100));
    const p = partes[0].text;
    window.__pedidosIA.push(p.slice(0, 60));
    if (p.startsWith("Monte")) return JSON.stringify(cvBase);
    if (p.startsWith("Você é mentor")) return JSON.stringify({ resumo: "Comece por Docker.", itens: [{ tecnologia: "Docker", porque: "Muito pedido.", tempo: "2 semanas", recursos: [{ nome: "Docs do Docker", url: "https://docs.docker.com/get-started/" }], projeto: "Suba sua API num container." }] });
    if (p.startsWith("Pesquise a empresa")) return JSON.stringify({ confianca: "baixa", oQueFaz: "Empresa de tecnologia.", produto: "Plataforma web.", porte: "", cultura: [], comoSePosicionar: ["Mostre APIs REST."], perguntasParaFazer: ["Como é o time?"], pesquisarAntes: ["Site da empresa"] });
    if (p.startsWith("Você é recrutador(a) técnico(a) da")) return JSON.stringify({ perguntas: [{ pergunta: "Fale sobre você.", tipo: "abertura", avalia: "comunicação" }, { pergunta: "Como você cria uma API REST em Node.js?", tipo: "técnica", avalia: "Node.js" }] });
    if (p.startsWith("Você é recrutador(a) técnico(a) entrevistando")) return JSON.stringify({ aprofundar: true, pergunta: "Como você tratou os erros nessa API?", avalia: "boas práticas" });
    if (p.startsWith("Você entrevistou")) return JSON.stringify({ nota: 7, resumo: "Bom desempenho.", pontosFortes: ["Clareza"], melhorar: ["Dar números"], porPergunta: [{ nota: 7 }, { nota: 7 }, { nota: 6 }] });
    if (/^(Reescreva|Revise|Translate)/.test(p)) return JSON.stringify({ sugestoes: [], correcoes: [] });
    if (p.includes("Palavras-chave da vaga que não aparecem")) return JSON.stringify({ sugestoes: [] });
    // Análise da vaga (primeiro pedido do adaptador)
    return JSON.stringify({ titulo: "Desenvolvedor Full Stack Pleno", empresa: "Empresa Externa", resumo: "Vaga full-stack.", obrigatorios: ["React", "Node.js"], desejaveis: ["Docker"], palavrasChave: ["React", "Node.js", "Docker"], perguntas: [] });
  },
};
setTimeout(() => window.dispatchEvent(new CustomEvent("radar:usuario", { detail: { usuario, ficha, admin: false } })), 50);
