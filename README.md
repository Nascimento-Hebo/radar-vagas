# Radar de Vagas

Busca todo dia vagas de **front-end, full-stack e back-end** no GitHub, na Gupy e no Greenhouse, junta as repetidas, descarta as fechadas e mostra tudo numa página com filtros, % de compatibilidade com o seu CV, acompanhamento das candidaturas e um adaptador de CV com IA (Gemini).

Site: https://nascimento-hebo.github.io/radar-vagas/ · Um projeto **OH Tech Technology**.

Feito com **Node.js** (script de busca) e **HTML, CSS e JavaScript puro** (página). Sem dependências.

## Como funciona

```
GitHub Actions (todo dia 7h15)
   └─ scripts/buscar-vagas.mjs
        ├─ API do GitHub: issues abertas de frontendbr, backend-br, react-brasil, phpdevbr e vuejs-br
        ├─ API do portal da Gupy: busca por termos (desenvolvedor react, java, python…)
        ├─ API do Greenhouse: QuintoAndar, Stone, Inter, VTEX, EBANX, Wildlife (só vagas no Brasil)
        ├─ classifica área, nível, contrato, modelo e salário (scripts/vagas-core.mjs)
        ├─ junta a mesma vaga publicada várias vezes com títulos diferentes
        ├─ filtra: remoto em qualquer lugar, ou híbrido/presencial só no Paraná
        ├─ grava docs/vagas.json (e docs/novas.md com o resumo do dia)
        └─ se alguma fonte falhar, a execução fica vermelha e o GitHub avisa por e-mail
GitHub Pages
   └─ docs/index.html lê o vagas.json e mostra as vagas (funciona instalada, como aplicativo)
```

**Como uma vaga é marcada como encerrada?** No GitHub, a vaga aberta é a issue aberta: quando a empresa fecha a issue, ela some da API e o script marca a vaga como encerrada. Na Gupy, a vaga some da busca quando fecha, e o script também descarta vagas com prazo de inscrição vencido.

## Rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm test          # testa a classificação, o salário, a junção de repetidas e a página
npm run buscar    # busca as vagas e atualiza docs/vagas.json
```

Para ver a página, abra `docs/index.html` com a extensão **Live Server** do VS Code (botão "Go Live" no canto de baixo). Abrir o arquivo direto com dois cliques não funciona, porque o navegador bloqueia a leitura do JSON nesse modo.

## Colocar online e rodar sozinho todo dia

1. Crie um repositório no GitHub (por exemplo `radar-vagas`) e envie esta pasta:
   ```bash
   git init
   git add .
   git commit -m "Radar de vagas"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/radar-vagas.git
   git push -u origin main
   ```
2. **Ative o GitHub Pages:** no repositório, vá em *Settings → Pages*, em *Source* escolha *Deploy from a branch*, branch `main`, pasta `/docs`. A página fica em `https://SEU-USUARIO.github.io/radar-vagas/`.
3. **Libere o Action para salvar:** *Settings → Actions → General → Workflow permissions* → marque *Read and write permissions*.
4. **Rode a primeira vez:** aba *Actions* → *Buscar vagas* → *Run workflow*. Depois ele roda sozinho todo dia às 7h15.

## E-mail diário (opcional)

O Action manda um e-mail com as vagas novas se você criar três *secrets* em *Settings → Secrets and variables → Actions*:

| Secret | O que colocar |
|---|---|
| `MAIL_USERNAME` | seu Gmail, que vai enviar |
| `MAIL_PASSWORD` | uma **senha de app** do Gmail (não a sua senha normal). Crie em myaccount.google.com → Segurança → Senhas de app (precisa da verificação em duas etapas ativa) |
| `MAIL_TO` | o e-mail que vai receber |

Sem esses secrets, o passo do e-mail é pulado e o resto funciona normal.

## Ajustar a busca

Tudo fica em `config.json`:

- `gupy.termos`: o que pesquisar na Gupy
- `github.repositorios`: repositórios de vagas no GitHub
- `greenhouse.empresas`: empresas que usam o Greenhouse (o nome que aparece em `boards.greenhouse.io/NOME`)
- `filtros.areas`: quais áreas aceitar
- `filtros.aceitarEstagio`: `true` para incluir estágio
- `filtros.estadoPresencial` e `cidadesPresencial`: onde aceitar vaga híbrida ou presencial
- `prioridade`: pesos que decidem quais vagas aparecem primeiro (júnior, PJ, remoto e Paraná sobem)
- `maxDiasPublicacao`: ignora vagas mais antigas que isso

## Adaptar o CV (Gemini)

O botão **Adaptar meu CV** abre o adaptador dentro da própria página, usando a API do Gemini:

1. **O Gemini lê a vaga.** Nas vagas do GitHub ele recebe o texto da issue; nas outras, lê o link do anúncio. Ele mostra os requisitos obrigatórios, os desejáveis e as palavras-chave.
2. **Você confere seus dados.** Nome, e-mail, telefone, cidade (pode usar a localização do navegador ou digitar), LinkedIn, GitHub e o CV atual (PDF ou texto). Tudo fica salvo no navegador, então da segunda vaga em diante já vem preenchido.
3. **O Gemini faz até 5 perguntas** sobre o que a vaga pede e o seu CV não mostra (ex.: "quantos anos com PostgreSQL?").
4. **Sai o CV adaptado**, em cinco abas:
   - **O que a IA mudou:** cada mudança com o texto novo, o antigo e o motivo.
   - **Antes e depois:** o CV original ao lado do adaptado, com o que a IA colocou em verde.
   - **CV final:** editável, em 4 modelos (Clássico, Moderno, Executivo, Compacto; a IA sugere um). *Baixar PDF* abre a impressão do navegador ("Salvar como PDF").
   - **Carta e mensagens:** carta de apresentação, mensagem para o recrutador no LinkedIn e e-mail de follow-up.
   - **Preparar entrevista:** perguntas prováveis com roteiro de resposta baseado no seu CV.

Achou uma vaga em outro site? Cole o link na busca: a IA lê a página e adapta o CV do mesmo jeito. Sites que pedem login (LinkedIn) não abrem para a IA; nesse caso, cole o texto da vaga no campo que aparece.

O Gemini é instruído a não inventar empresas, cargos, datas ou tecnologias, mas leia o CV antes de enviar.

**Chave do Gemini:** cada pessoa usa a própria chave gratuita, criada em [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Na primeira vez a página pede a chave e guarda só no navegador de quem usa. Ela nunca vai para o repositório, porque o site é público. Os modelos ficam em `GEMINI_MODELOS`, no começo de `docs/cv.js`: a página tenta o primeiro (`gemini-flash-latest`) e passa para o próximo se ele estiver sobrecarregado ou sem cota.

## Minha área

O botão **Minha área**, no topo, guarda tudo só no navegador de quem usa:

- **Candidaturas:** quadro com as etapas *Candidatei → Entrevista → Teste técnico → Proposta → Não avançou*, com anotações. Depois de 7 dias sem resposta aparece o aviso de follow-up, com uma mensagem pronta para copiar.
- **CVs gerados:** os últimos 15 CVs adaptados, para abrir de novo sem gastar outra chamada da IA.
- **Meus dados:** o texto do CV (usado na % de compatibilidade de cada vaga), backup em arquivo, restauração e "apagar meus dados".

A **% de compatibilidade** de cada vaga é calculada na própria página, comparando as tecnologias da vaga com o texto do seu CV. Não usa IA nem envia nada.

## Avisos

- A API da Gupy usada aqui é a mesma que o site da Gupy usa, mas **não é oficial**: pode mudar sem aviso. Se ela falhar, o script continua com as outras fontes e a execução do Action fica vermelha, para você saber.
- O salário só aparece quando o anúncio informa um valor. Benefícios (vale, auxílio, bônus) são ignorados.
- **Privacidade:** não existe servidor guardando dados. Quando você usa a IA, o texto da vaga e do CV vai para a API do Gemini (Google) com a sua chave.
- A classificação (área, nível, contrato) é feita por palavras-chave no título e na descrição. Ela acerta na maioria das vagas, mas pode errar em títulos genéricos. Os testes em `test/` mostram os casos cobertos.

## Estrutura

```
radar-vagas/
├─ .github/workflows/buscar-vagas.yml   roda todo dia e salva o resultado
├─ config.json                           o que buscar e como filtrar
├─ scripts/
│  ├─ buscar-vagas.mjs                   chama as APIs e grava o JSON
│  └─ vagas-core.mjs                     classificação e filtros (sem rede)
├─ test/
│  ├─ vagas-core.test.mjs                testes da lógica da busca
│  └─ pagina.test.mjs                    testes da página (elementos, versões, arquivos)
└─ docs/                                 a página (GitHub Pages)
   ├─ index.html
   ├─ style.css                          tema escuro e claro
   ├─ app.js                             lista, filtros, radar, Minha área
   ├─ cv.js                              adaptador de CV com Gemini
   ├─ sw.js, manifest.webmanifest        modo aplicativo (instalar e abrir sem internet)
   ├─ og.png, icone-*.png, oh-tech-*.png imagens
   ├─ vagas.json                         gerado pelo script
   └─ novas.md                           resumo do dia (vai no e-mail)

Ao mudar `style.css`, `app.js` ou `cv.js`, aumente o número `?v=` no `index.html` e o `VERSAO` no `sw.js` (o teste da página avisa se ficarem diferentes).
```
