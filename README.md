# Radar de Vagas

Busca todo dia vagas de **front-end, full-stack e back-end** no GitHub, na Gupy, no Greenhouse e na Remotar. Junta as repetidas, descarta as fechadas e mostra tudo numa página com:
- filtros e % de compatibilidade com o seu CV;
- um painel do mercado e o acompanhamento das candidaturas;
- um adaptador de CV com IA (Gemini) e alertas por e-mail e notificação.

Site: https://nascimento-hebo.github.io/radar-vagas/ · Um projeto **OH Tech Technology**.

Feito com **Node.js** (script de busca) e **HTML, CSS e JavaScript puro** (página), com Firebase no plano gratuito.

## Como funciona

```
GitHub Actions (todo dia 7h15)
   └─ scripts/buscar-vagas.mjs
        ├─ API do GitHub: issues abertas de frontendbr, backend-br, react-brasil, phpdevbr e vuejs-br
        ├─ API do portal da Gupy: busca por termos (desenvolvedor react, java, python…)
        ├─ API do Greenhouse: QuintoAndar, Stone, Inter, VTEX, EBANX, Wildlife, Gympass, Jusbrasil, RD Station (só no Brasil)
        ├─ API da Remotar: vagas 100% remotas para o Brasil, categoria Programação
        ├─ classifica área, nível, contrato, modelo e salário (scripts/vagas-core.mjs)
        ├─ junta a mesma vaga publicada várias vezes com títulos diferentes
        ├─ grava docs/vagas.json, docs/novas.md e docs/historico.json (um retrato do mercado por dia)
        └─ se alguma fonte falhar, a execução fica vermelha e o GitHub avisa por e-mail
   └─ scripts/alertas.mjs: e-mail e notificação para quem ativou, só com as vagas novas que combinam
GitHub Pages
   └─ docs/index.html lê o vagas.json e mostra as vagas (funciona instalada, como aplicativo)
```

**Como uma vaga é marcada como encerrada?** No GitHub, a vaga aberta é a issue aberta: quando a empresa fecha a issue, ela some da API e o script marca a vaga como encerrada. Nas outras fontes, a vaga some da busca quando fecha, e o script também descarta vagas com prazo de inscrição vencido.

## Rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm test             # testa a classificação, o salário, a junção de repetidas e a página
npm run buscar       # busca as vagas e atualiza docs/vagas.json e docs/historico.json
npm install          # só para os testes de ponta a ponta
npx playwright install chromium
npm run test:e2e     # abre o site num navegador de verdade (Firebase simulado) e testa os fluxos principais
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

O workflow **Testes** roda a cada envio de código: os testes da lógica e os de ponta a ponta (Playwright).

## Firebase: contas, banco, IA e proteção

O site usa o projeto Firebase `radar-de-vagas-1f800` (plano gratuito):

- **Login** (Authentication): Google ou e-mail e senha. Quem não está logado vai para `login.html`.
- **Banco** (Firestore, São Paulo): a ficha de cada pessoa fica em `users/{uid}` e os dados em `users/{uid}/dados/*`. As regras ficam em `firestore.rules` (publicar com `firebase deploy --only firestore:rules`). Cada pessoa só vê o que é dela; só o super admin vê tudo.
- **IA** (Firebase AI Logic, Gemini Developer API): ninguém precisa de chave. Modelos, limite diário e liga/desliga ficam no painel do admin.
- **App Check** (reCAPTCHA Enterprise): exigido no banco e na IA, para ninguém usar a cota fora do site.
- **Super admin**: `nascimentohebo2@gmail.com` (em `docs/firebase.js` e em `firestore.rules`). Painel em `admin.html`: usuários, funil (cadastro → primeiro acesso → CV gerado → candidatura → entrevista), uso da IA por dia, alertas ativos e configuração da IA e do assistente.

## Alertas: e-mail e notificação

No primeiro acesso (ou em *Minhas preferências*), a pessoa diz o que procura e pode ligar:
- o **e-mail** diário;
- a **notificação** em cada aparelho (celular ou computador; também em *Minha área → Meus dados*).

Todo dia, depois da busca, `scripts/alertas.mjs` manda só as vagas novas que combinam com ela. Clicar na notificação abre o site já filtrado em "Para você".

Secrets do repositório (*Settings → Secrets and variables → Actions*):

| Secret | O que é |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | conta de serviço com acesso ao banco (lê quem tem alerta e tira aparelhos que não existem mais) |
| `MAIL_USERNAME` | o Gmail que envia os alertas |
| `MAIL_PASSWORD` | uma **senha de app** desse Gmail (não a senha normal). Crie em myaccount.google.com → Segurança → Senhas de app (precisa da verificação em duas etapas) |
| `VAPID_PRIVATE_KEY` | chave privada das notificações. A pública está em `docs/push.js` e em `scripts/alertas.mjs`; as duas formam um par |

Sem os secrets de um canal, aquele canal roda em modo de teste e não envia nada. O Gmail aceita cerca de 500 e-mails por dia. No iPhone, a notificação só funciona com o site adicionado à Tela de Início.

## Ajustar a busca

Tudo fica em `config.json`:

- `gupy.termos`: o que pesquisar na Gupy
- `github.repositorios`: repositórios de vagas no GitHub
- `greenhouse.empresas`: empresas que usam o Greenhouse (o nome que aparece em `boards.greenhouse.io/NOME`)
- `remotar.paginas`: quantas páginas (de 50 vagas, das mais novas) ler da Remotar
- `filtros.areas`: quais áreas aceitar
- `filtros.aceitarEstagio`: `true` para incluir estágio
- `filtros.estadoPresencial` e `cidadesPresencial`: onde aceitar vaga híbrida ou presencial
- `prioridade`: pesos que decidem quais vagas aparecem primeiro (júnior, PJ, remoto e Paraná sobem)
- `maxDiasPublicacao` e `limiteVagas`: ignora vagas antigas e limita o tamanho da lista

## Adaptar o CV (IA)

O botão **Adaptar meu CV** abre o adaptador dentro da própria página:

1. **A IA lê a vaga** e separa os requisitos obrigatórios, os desejáveis e as palavras-chave.
2. **Com o perfil completo (nome + CV), o CV sai direto.** As perguntas sobre o que a vaga pede e o CV não mostra ficam opcionais.
3. **O resultado tem 3 abas:**
   - **Meu CV:** editável, em 4 modelos.
     - A checagem antes de enviar mostra a nota ATS, as frases fracas para reescrever, se cabe em uma página ("Compactar") e a revisão de português.
     - Tem versão em inglês e download em **PDF e Word de verdade**.
     - As edições são salvas sozinhas.
   - **Revisar o que a IA fez:** cada mudança com o motivo, e o antes e depois.
   - **Preparar candidatura:**
     - carta e mensagens;
     - **sobre a empresa**: o que ela faz, como se posicionar e perguntas para o recrutador;
     - perguntas da entrevista;
     - **simulador de entrevista**: o recrutador pode fazer perguntas de aprofundamento, e o resultado mostra seu ritmo de fala e as palavras de apoio.

**Vaga de outro site:** há três jeitos.
- Cole o link na busca.
- Clique em "Achou a vaga no LinkedIn…?" e cole o texto.
- Use a **extensão do navegador** (`extensao/`, com página de instalação em `docs/extensao.html`). Ela manda o anúncio da página aberta para o adaptador com um clique.

A IA é instruída a não inventar empresas, cargos, datas ou tecnologias, mas leia o CV antes de enviar. Os modelos ficam no painel do admin. A página tenta o primeiro modelo e passa para o próximo se ele estiver sobrecarregado, sem cota ou demorar mais de 45 segundos.

## Minha área e painel do mercado

O botão **Mercado** mostra:
- as tecnologias mais pedidas, marcando as que estão no seu CV;
- as vagas por nível e por tipo de contratação;
- a mediana de salário em reais;
- as vagas abertas por dia (`historico.json`).

O botão **Minha área** guarda tudo na conta da pessoa, com uma cópia no navegador:

- **Candidaturas:**
  - quadro com as etapas *Candidatei → Entrevista → Teste técnico → Proposta → Não avançou*. Dá para arrastar os cartões entre as colunas;
  - data da entrevista com convite de agenda (.ics ou Google Agenda) e lembrete no topo da página no dia e na véspera;
  - aviso de follow-up depois de 7 dias sem resposta.
- **E-mails das empresas:** conecta o Gmail (só leitura) e mostra só as conversas com as empresas das candidaturas. A IA classifica cada e-mail e pode **atualizar a etapa sozinha**, com a data da entrevista citada no e-mail.
- **Evoluir:** compara o seu CV com as vagas do seu perfil.
  - Monta um **plano de estudos** com recursos gratuitos e um projeto para provar cada tecnologia. "Já aprendi" coloca a tecnologia no perfil.
  - **Revisa o LinkedIn e o GitHub** com textos prontos para colar.
- **CVs gerados** e **Meus dados:** texto do CV, notificações, backup, apagar dados e **Excluir minha conta**.

A **% de compatibilidade** de cada vaga é calculada na própria página, sem IA. Ela compara as tecnologias da vaga com o seu CV (3/4 da nota) e o nível, o local e a contratação com as suas preferências (1/4).

## Avisos

- A API da Gupy e a da Remotar são as mesmas que os sites usam, mas **não são oficiais**: podem mudar sem aviso. Se uma falhar, o script continua com as outras fontes e a execução do Action fica vermelha, para você saber.
- O salário só aparece quando o anúncio informa um valor. Benefícios (vale, auxílio, bônus) são ignorados.
- **Privacidade:** veja `docs/privacidade.html` e `docs/termos.html`. Os e-mails do Gmail nunca são guardados.
- **Gmail:** até o Google verificar o app, quem conecta o Gmail vê o aviso "app não verificado" (*Avançado → Acessar*), e o limite é de 100 pessoas.
- A classificação (área, nível, contrato) é feita por palavras-chave no título e na descrição. Ela acerta na maioria das vagas, mas pode errar em títulos genéricos. Os testes em `test/` mostram os casos cobertos.

## Estrutura

```
radar-vagas/
├─ .github/workflows/
│  ├─ buscar-vagas.yml                   roda todo dia, salva o resultado e manda os alertas
│  └─ testes.yml                         testes a cada envio de código
├─ config.json                           o que buscar e como filtrar
├─ scripts/
│  ├─ buscar-vagas.mjs                   chama as APIs e grava os JSON
│  ├─ vagas-core.mjs                     classificação, filtros e retrato do mercado (sem rede)
│  └─ alertas.mjs                        e-mail e notificação das vagas novas
├─ extensao/                             extensão do navegador (Chrome, Edge, Brave)
├─ test/
│  ├─ vagas-core.test.mjs                testes da lógica da busca
│  ├─ pagina.test.mjs                    testes da página (elementos, versões, arquivos)
│  └─ e2e/                               testes de ponta a ponta (Playwright, Firebase simulado)
└─ docs/                                 a página (GitHub Pages)
   ├─ index.html, style.css              página e tema escuro/claro
   ├─ app.js                             lista, filtros, radar, Minha área, candidaturas
   ├─ cv.js, cv-ferramentas.js           adaptador de CV, checagens, PDF e Word
   ├─ mercado.js                         painel do mercado
   ├─ evoluir.js                         plano de estudos e revisão do LinkedIn/GitHub
   ├─ email.js                           central de e-mail
   ├─ push.js                            notificações
   ├─ onboarding.js, suporte.js          primeiro acesso e assistente de suporte
   ├─ firebase.js                        login, banco e IA
   ├─ admin.html, admin.js               painel do super admin
   ├─ extensao.html, radar-vagas-extensao.zip
   ├─ sw.js, manifest.webmanifest        modo aplicativo e notificações
   ├─ vagas.json, historico.json         gerados pelo script
   └─ novas.md                           resumo do dia

Ao mudar um .js ou o style.css, aumente o número `?v=` nas páginas e o `VERSAO` no `sw.js` (o teste da página avisa se ficarem diferentes).
```
