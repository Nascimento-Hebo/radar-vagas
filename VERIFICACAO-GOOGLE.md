# Verificação do Google para a central de e-mail (Gmail)

A central de e-mail lê o Gmail com a permissão `gmail.readonly`. O Google classifica essa permissão como **restrita**. Enquanto o app não for verificado:

- quem conecta vê a tela "O Google não verificou este app" (*Avançado → Acessar*);
- só **100 contas** podem conectar (os "usuários de teste" da tela de consentimento OAuth).

O resto do Radar não depende disso. Desde a versão 24 do site, a central também tem o modo **"cole um e-mail que você recebeu"**: a IA lê o texto colado e atualiza a candidatura, sem permissão do Gmail. Esse modo funciona para qualquer número de pessoas.

## Recomendação

**Fique no modo de teste** enquanto o Radar tiver poucas pessoas usando o Gmail conectado. Quem passar do limite usa o "cole o e-mail".

Só vale verificar quando muita gente pedir o Gmail conectado, porque a verificação de permissão restrita exige uma **avaliação de segurança paga (CASA), renovada todo ano**. O preço varia por laboratório e tipo de avaliação, e as fontes divergem bastante. Confira na página oficial do Google antes de decidir.

## Se decidir verificar: o que o Google pede

1. **Domínio próprio.** O endereço `nascimento-hebo.github.io` não é um domínio seu.
   - Compre um domínio (um `.com.br` custa por volta de R$ 40 por ano).
   - Aponte o domínio para o GitHub Pages em *Settings → Pages → Custom domain*.
   - Verifique o domínio no Google Search Console com a mesma conta Google dona do projeto do Firebase.
2. **Tela de consentimento OAuth** (Google Cloud → APIs e serviços → Tela de consentimento):
   - nome "Radar de Vagas", logo e e-mail de suporte;
   - página inicial, política de privacidade (`privacidade.html`) e termos (`termos.html`), todos no domínio verificado;
   - domínio autorizado: o seu domínio novo.
3. **Justificativa da permissão.** Explique por que `gmail.readonly` é necessário: "mostrar à pessoa só os e-mails das empresas onde ela se candidatou e atualizar o andamento das candidaturas; os e-mails são lidos no navegador e não são guardados". A política de privacidade já diz isso no item 5 ("Dados do Gmail: uso limitado").
4. **Vídeo de demonstração** (YouTube, pode ser "não listado"):
   - login e clique em "Conectar meu Gmail";
   - a tela de consentimento mostrando o ID do cliente OAuth;
   - os e-mails aparecendo na central;
   - o uso de cada dado.
5. **Avaliação de segurança (CASA)**, feita por um laboratório autorizado pelo Google, com renovação anual.
6. **Prazo:** várias semanas entre envio, perguntas do Google e avaliação.

## Alternativas mais baratas

- **Continuar com até 100 testadores.** Adicione as pessoas em *Tela de consentimento → Usuários de teste*. É grátis.
- **Colar o e-mail** (já pronto): funciona para todos e não precisa de permissão nenhuma.
