# Radar de Vagas

Busca todo dia vagas de **front-end, full-stack e back-end** nas APIs do GitHub e da Gupy, descarta as fechadas e mostra tudo numa página com filtros (área, nível, contrato, remoto).

Feito com **Node.js** (script de busca) e **HTML, CSS e JavaScript puro** (página). Sem dependências.

## Como funciona

```
GitHub Actions (todo dia 7h15)
   └─ scripts/buscar-vagas.mjs
        ├─ API do GitHub: issues abertas de frontendbr/vagas, backend-br/vagas e react-brasil/vagas
        ├─ API do portal da Gupy: busca por termos (desenvolvedor react, java, python…)
        ├─ classifica área, nível, contrato e modelo (scripts/vagas-core.mjs)
        ├─ filtra: remoto em qualquer lugar, ou híbrido/presencial só no Paraná
        └─ grava docs/vagas.json (e docs/novas.md com o resumo do dia)
GitHub Pages
   └─ docs/index.html lê o vagas.json e mostra as vagas
```

**Como uma vaga é marcada como encerrada?** No GitHub, a vaga aberta é a issue aberta: quando a empresa fecha a issue, ela some da API e o script marca a vaga como encerrada. Na Gupy, a vaga some da busca quando fecha, e o script também descarta vagas com prazo de inscrição vencido.

## Rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm test          # testa a lógica de classificação
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
4. **Sai o CV adaptado**, com a lista do que foi mudado e dos requisitos que você não comprovou. O botão *Baixar PDF* abre a impressão do navegador (escolha "Salvar como PDF").

O Gemini é instruído a não inventar empresas, cargos, datas ou tecnologias, mas leia o CV antes de enviar.

**Chave do Gemini:** cada pessoa usa a própria chave gratuita, criada em [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Na primeira vez a página pede a chave e guarda só no navegador de quem usa. Ela nunca vai para o repositório, porque o site é público. O modelo fica em `GEMINI_MODELO`, no começo de `docs/cv.js` (padrão: `gemini-flash-latest`, que o Google aponta sempre para o Flash mais novo).

## Avisos

- A API da Gupy usada aqui é a mesma que o site da Gupy usa, mas **não é oficial**: pode mudar sem aviso. Se ela falhar, o script avisa no log e continua só com o GitHub.
- A classificação (área, nível, contrato) é feita por palavras-chave no título e na descrição. Ela acerta na maioria das vagas, mas pode errar em títulos genéricos. Os testes em `test/` mostram os casos cobertos.

## Estrutura

```
radar-vagas/
├─ .github/workflows/buscar-vagas.yml   roda todo dia e salva o resultado
├─ config.json                           o que buscar e como filtrar
├─ scripts/
│  ├─ buscar-vagas.mjs                   chama as APIs e grava o JSON
│  └─ vagas-core.mjs                     classificação e filtros (sem rede)
├─ test/vagas-core.test.mjs              testes da lógica
└─ docs/                                 a página (GitHub Pages)
   ├─ index.html
   ├─ style.css
   ├─ app.js
   ├─ vagas.json                         gerado pelo script
   └─ novas.md                           resumo do dia (vai no e-mail)
```
