# Mudanças no site

Uma entrada por envio ao GitHub (cada envio vira um deploy no Render).
A mais recente fica no topo. Cada entrada diz **o que mudou para quem usa**,
**como foi feito**, **o que alguém precisa fazer** e **o que ainda não foi testado**.

Detalhes de bugs (causa e correção) ficam em [`BUGS.md`](BUGS.md).

---

## 29/11/2026 — Dub β não trava mais o filme

- **O que mudou:** em alguns navegadores e celulares, ligar a dublagem podia congelar o filme (e o play não destravava). Agora o site só usa o ajuste automático quando o navegador permite; se o áudio do navegador "dormir", qualquer toque na tela destrava, e o painel avisa "toque na tela para continuar".
- **Como:** proteções no motor de áudio do Dub β. Detalhes em BUGS.md (B40).
- **Precisa fazer:** nada. Recarregue a página. Se algum dia travar, toque na tela.
- **Não testado:** no celular de verdade (testado no navegador, suspendendo o áudio de propósito).

## 29/11/2026 — Dub β automático e sem cortes

- **O que mudou:** o "Dub β" agora acerta sozinho o atraso e a velocidade da dublagem, "ouvindo" os dois áudios (falas, música e efeitos caem nos mesmos momentos). Em uns 20–25 s ele mostra "auto ✓" no painel e continua conferindo durante o filme. O áudio dublado não é mais mexido: quem se ajusta é a imagem (até 3% mais rápida ou lenta, não dá para perceber), então o som não corta. Antes de trocar o som, ele carrega uns 15 s da dublagem com o áudio original ainda tocando. Os botões −0,5s/+0,5s continuam para ajuste fino; "Auto" volta ao automático.
- **Como:** comparação do volume dos dois áudios em vários atrasos e velocidades. Detalhes em BUGS.md (B39).
- **Precisa fazer:** nada. Recarregue a página.
- **Não testado:** com filme real do TorBox (testado com vídeos de teste: achou o atraso de 1,2 s e a velocidade certa, erro final de 0,035 s).

## 29/11/2026 — Dub β sem picotar

- **O que mudou:** com o "Dub β" ligado, o áudio dublado não deve mais ficar cortando. A sincronia agora é suave: só ajusta quando a diferença fica perceptível, devagar, e não pula o áudio por pouca coisa.
- **Como:** novas regras de correção da sincronia e mais dublagem carregada com antecedência. Detalhes em BUGS.md (B38).
- **Precisa fazer:** nada. Recarregue a página.
- **Não testado:** com filme real do TorBox (testado com vídeos de teste).

## 29/11/2026 — Beta: áudio dublado de outra fonte

- **O que mudou:** no navegador, quando o filme tocando não é dublado e existe uma fonte dublada na lista, aparece o botão **"Dub β"** no player. Ele toca o som dublado daquela outra fonte junto com a imagem da fonte boa, acertando o tempo sozinho (inclusive a diferença de velocidade comum das dublagens). Um painel pequeno no canto deixa adiantar/atrasar 0,5 s e desligar.
- **Como:** a fonte dublada é pedida ao TorBox em 144p (pouca internet) e só o áudio dela é usado. Detalhes e limites em BUGS.md (B37).
- **Precisa fazer:** nada. É beta: funciona melhor quando as duas fontes são do mesmo tipo (WEB-DL com WEB-DL). Se ficar fora de sincronia, use os botões de atraso ou desligue.
- **Não testado:** com filme real do TorBox (testado com vídeos de teste).

## 29/11/2026 — Fontes: português primeiro, depois a maior resolução

- **O que mudou:** nas listas de fontes, primeiro vêm as dubladas e, dentro delas, a maior resolução primeiro (4K, depois 1080p, 720p...). O topo da lista é a fonte em português de melhor qualidade.
- **Como:** a ordenação por idioma ganhou um segundo critério, a resolução. Detalhes em BUGS.md (B36).
- **Precisa fazer:** nada. Recarregue a página.
- **Não testado:** com a lista real depois do deploy (testado com fontes de teste).

## 29/11/2026 — Fontes dubladas sempre primeiro, sem janela de áudio

- **O que mudou:** as fontes com dublagem brasileira aparecem primeiro em todas as listas. Enquanto você olha a lista, o site pergunta ao TorBox quais fontes têm mesmo áudio em português: as confirmadas sobem para o topo, as que não têm português vão para o fim (o resultado fica guardado, então na próxima vez é instantâneo). A janela "Escolha o áudio" saiu: o site escolhe a faixa PT-BR sozinho, e o menu de áudio do player continua lá para trocar.
- **Como:** ordenação "dublado primeiro" e verificação em segundo plano só das fontes já prontas no TorBox. Detalhes em BUGS.md (B35).
- **Precisa fazer:** nada. Recarregue a página. As fontes verificadas aparecem na lista de torrents do TorBox, como quando se assiste.
- **Não testado:** com a lista real do TorBox depois do deploy.

## 29/11/2026 — Escolher o áudio antes do filme quando não há certeza

- **O que mudou:** no navegador, quando o site não tem certeza de qual faixa é a dublada (ou o arquivo não tem português), aparece uma janela "Escolha o áudio" antes do filme começar, com as faixas do arquivo e a sugerida marcada. Dá para tocar, clicar ou usar as setas. "← Escolher outra fonte" volta para a lista. Quando o site tem certeza, o filme começa direto, como antes.
- **Também chegou do Kiid:** menu de idioma do áudio no player que troca a faixa pelo TorBox, volume e mudo, filtro 🇧🇷 PT-BR e ordenação das fontes por tamanho, barra lateral e destaque do computador, botão de download e "manter o perfil ao atualizar a página".
- **Como:** o site lê a lista de faixas que o TorBox devolve e só pergunta quando precisa. Detalhes em BUGS.md (B34).
- **Precisa fazer:** nada. Recarregue a página.
- **Não testado:** escolher a faixa na janela num filme real.

## 28/11/2026 — Arrastar fileiras como carrossel, telas de filme/série e Descobrir

- **O que mudou:** dá para arrastar as fileiras de filmes para o lado com o dedo (celular) ou segurando o mouse (computador), e elas continuam deslizando ao soltar, como um carrossel. Arrastar não abre o filme sem querer. No celular, a parte de baixo das telas de filme e série (temporadas, episódios, elenco, avaliações, trailer) ficou no tamanho certo, e o Descobrir mostra 3 pôsteres por linha.
- **Como:** o site cuida do arraste das fileiras; a parte de baixo das telas de filme/série usa meia escala. Detalhes em BUGS.md (B32, B33).
- **Precisa fazer:** nada. Recarregue a página.
- **Não testado:** em celular de verdade (testado no simulador do navegador).

## 28/11/2026 — Destaque que desliza, séries no celular e PT-BR padrão

- **O que mudou:** na Início do celular, deslize o destaque para o lado para ver o próximo filme (ou o anterior). A tela de série no celular ficou no tamanho certo (temporadas, episódios e elenco). O áudio padrão agora é **português do Brasil** quando o filme tiver essa faixa.
- **Como:** o deslize move a seleção da fileira, e o destaque acompanha. A tela de série usa meia escala nas partes de TV. O idioma padrão mudou de "sistema" para "pt-br". Detalhes em BUGS.md (B29, B30, B31).
- **Precisa fazer:** nada. Recarregue a página. Quem já tinha escolhido outro idioma de áudio continua com a escolha.
- **Não testado:** em celular de verdade (testado no simulador do navegador).

## 28/11/2026 — Celular arrumado, toque no player e áudio em português

- **O que mudou no celular:** Busca, Biblioteca, Configurações, Addons, Descobrir e as outras telas agora cabem na tela com texto e botões no tamanho certo (antes estavam em tamanho de TV). Configurações mostram as seções numa fileira em cima. No player: tocar na imagem mostra/esconde os controles, os botões ficaram do tamanho do dedo, dá para tocar na barra para pular e há um botão de **tela cheia** (⛶) que deixa o filme deitado (no iPhone abre o player do próprio iPhone, que gira junto). Rolar com o dedo não dá mais "pulos". Com o celular deitado, a Início e a tela do filme se ajustam.
- **Também chegou do Kiid:** controles do player do computador mais confortáveis (botões Voltar e Início no topo, ícones novos, janelas de áudio e legendas ajustadas, tocar fora de uma janela aberta fecha a janela). O botão de tela cheia dele e o meu viraram um só.
- **Idioma do áudio:** com o TorBox Pro, o filme já começa na faixa do idioma escolhido em Configurações (por exemplo, português do Brasil), mesmo quando ela não é a primeira do arquivo.
- **Como:** `css/mobile.css` reduz as telas de TV para o celular; mudanças no toque do player e da navegação; o site pede ao TorBox a faixa de áudio certa. Detalhes em BUGS.md (B26, B27, B28).
- **Precisa fazer:** nada. Recarregue a página no celular. Para o português, deixe o idioma do áudio em Configurações > Reprodução como Português (ou "sistema", se o celular estiver em português).
- **Não testado:** em celular de verdade (testado no simulador do navegador, em pé e deitado) e o áudio em português com um filme real do TorBox Pro.

## 28/11/2026 — Som em qualquer aparelho com o TorBox Pro

- **O que mudou:** no navegador (Chrome, Brave, celular, iPhone), os filmes do TorBox passam a usar a versão convertida que o próprio TorBox gera, que toca com som em qualquer aparelho. Nas TVs nada muda.
- **Como:** o site pede ao TorBox o "stream" do arquivo (função de streaming do TorBox) e toca o link HLS que ele devolve. Detalhes em BUGS.md (B25).
- **Precisa fazer:** ter o TorBox no plano **Pro** (essa função só existe nele). Enquanto não for Pro, o site continua tocando o link direto, como antes.
- **Não testado:** com uma conta Pro de verdade (testado com um TorBox de mentira e com um vídeo HLS de teste no player).

## 28/11/2026 — Conversor de áudio (preparação, ainda desligado)

- **O que mudou:** nada para quem usa, por enquanto. Foi criado o conversor que vai dar som aos filmes com áudio Dolby/DTS em qualquer aparelho (Chrome, Brave, celular, iPhone).
- **Como:** novo programa `transcoder/server.mjs`, que mantém a imagem e converte só o áudio para AAC, em pedaços de 6 segundos. Vai rodar num servidor grátis da Oracle Cloud. Explicação e passo a passo em `docs/TRANSCODER.md`.
- **Precisa fazer:** criar a conta na Oracle Cloud (passo 1 do `docs/TRANSCODER.md`). Depois, criar o servidor junto comigo e ligá-lo ao player.
- **Não testado:** na Oracle e com filme real (testado no computador com um filme de teste de 40 min com áudio Dolby 5.1, pulando para vários pontos).

## 28/11/2026 — Vídeo centralizado no computador

- **O que mudou:** no computador, o vídeo do player ocupa a tela toda e fica centralizado (antes ficava menor e encostado à esquerda).
- **Como:** o vídeo passou a usar o tamanho da tela "virtual" do site e o próprio navegador centraliza a imagem. Detalhes em BUGS.md (B24).
- **Também chegou do Kiid:** ele desfez as mudanças recentes do player (troca automática de fonte sem som, filtro de fontes AAC, controle de volume, ajustes da barra do player). O filtro AAC fica fora, como combinado.
- **Precisa fazer:** nada. Recarregue a página.
- **Não testado:** com filme real do TorBox (testado com vídeo de teste em janelas de notebook e larga).

## 28/11/2026 — Início do celular no estilo do CineRotten

- **O que mudou:** no celular, a Início ficou parecida com a do CineRotten: barra de baixo com o nome de cada aba e a aba ativa em vermelho; destaque em um cartão arredondado com "Em destaque", descrição e botão vermelho "Ver detalhes" (tocar no cartão abre o filme); pôsteres maiores (118 px) com o título escrito no pôster; cores do CineRotten.
- **Como:** novo visual em `css/mobile.css` copiando as medidas do layout de celular do CineRotten; um pequeno código faz o toque no destaque abrir o filme.
- **Precisa fazer:** nada. Recarregue no celular.
- **Ainda falta:** Busca, Biblioteca e Configurações no celular; player; episódios de séries.
- **Não testado:** em celular de verdade.

## 28/11/2026 — Início do celular mais compacto e fácil de navegar

- **O que mudou:** no celular, a página Início inteira rola com o dedo, como num app de streaming: o destaque fica menor e sai de cena ao rolar, os pôsteres ficam menores (~3,5 por fileira) e as fileiras ficam mais juntas (2 inteiras na tela). As fileiras não "pulam" mais sozinhas.
- **Como:** ajustes em `css/mobile.css` e em três pontos da Home que rolavam as fileiras automaticamente (agora só fazem isso no celular quando se usa teclado).
- **Precisa fazer:** nada. Recarregue no celular.
- **Também chegou do Kiid:** botão "Voltar" maior no desktop, ajustes nos controles do player, novo ícone de áudio, controle de volume no desktop e janelas do player menores.
- **Não testado:** em celular de verdade.

## 28/11/2026 — Site no celular (fase 2, primeira parte)

- **O que mudou:** no celular (e tablet em pé) o menu virou uma barra de ícones embaixo; a tela Início mostra o destaque em cima com texto legível e fileiras com ~3 pôsteres que rolam com o dedo; a tela do filme ficou em uma coluna com botões do tamanho do dedo; a lista de fontes ocupa a largura toda; a tela de perfis mostra dois por linha.
- **Como:** novo arquivo `css/mobile.css`, que só vale quando a tela é pequena; computador e TV não mudam.
- **Precisa fazer:** nada. Recarregue no celular (se o navegador do celular guardar a versão antiga, feche a aba e abra de novo).
- **Ainda falta (próximas partes):** player (controles maiores, girar a tela), Configurações, Busca e Biblioteca no celular; episódios de séries; celular deitado.
- **Não testado:** em celular de verdade (só no simulador do navegador) e com fontes reais na lista (aqui não há TorBox).
- **Também chegou do Kiid:** botões "Voltar" visíveis nas telas internas e atalhos de teclado no player do desktop.

## 28/11/2026 — Addons carregam para os amigos mesmo se o Supabase bloquear a tabela

- **O que mudou:** os navegadores dos amigos passam a receber os addons do perfil principal mesmo quando o Supabase não libera a leitura direta da tabela. O `/__status` mostra se a tabela está liberada.
- **Como:** se a leitura da tabela for negada, o app busca a lista pela função `sync_pull_addons`. O SQL 04 libera as tabelas para usuários logados.
- **Precisa fazer:** rodar `docs/supabase/04-table-access.sql` no SQL Editor do Supabase; depois os amigos recarregam com Ctrl + F5.
- **Lembrete:** o celular ainda não tem layout próprio (isso é a fase 2 do responsivo); a fase 1 vale para computador, notebook e TV grande.

## 28/11/2026 — Tela se ajusta ao tamanho da janela (fase 1: desktop, notebook e TV grande)

- **O que mudou:** no computador, o site agora aumenta ou diminui inteiro para caber na janela, mantendo o mesmo desenho da TV. Notebook pequeno não fica mais apertado e TV/monitor 4K não fica mais minúsculo. Celular e tablet em pé continuam como estavam (fase 2).
- **Como:** um script trata a página como uma tela de 1920×1080 e aplica zoom proporcional; no build, as medidas proporcionais (vw/vh) passaram a seguir essa tela virtual. Os apps de TV (Samsung/LG) não são afetados.
- **Precisa fazer:** nada. Recarregue com Ctrl + F5.
- **Não testado:** apps empacotados de TV (Tizen/webOS) depois da mudança no CSS; em teoria o resultado é idêntico ao anterior.

## 27/11/2026 — Tema de cada perfil na tela de perfis (enviado por Kiid)

- **O que mudou:** a tela "Who's watching?" busca na nuvem as configurações de cada perfil, para mostrar o fundo/tema certo de cada um.
- **Arquivos:** `profileSelectionScreen.js`, `profileSelectionScreenMethods-01-mount.js`.
- **Compatível com a etapa 3:** tema é configuração pessoal, então cada perfil mostra o seu.

## 27/11/2026 — Tela de perfis para desktop (enviado por Kiid)

- **O que mudou:** a tela "Who's watching?" ficou mais compacta no navegador, sem o logo NUVIO, e o fundo ao passar o mouse segue o tema de cada perfil.
- **Arquivos:** `css/components-03.css`, `js/app.js` (classe `desktop-web`), telas de seleção de perfil.
- **Para combinar:** com a escala proporcional (fase 1), essa tela também é reduzida em notebooks; em 1366×768 os nomes dos perfis ficam bem pequenos. Vale o Kiid conferir se quer aumentar um pouco os tamanhos dela.

## 28/11/2026 — Análise para celular, tablet, desktop e TV

- **O que mudou:** nada no site ainda. Adicionada a análise `docs/ANALISE-RESPONSIVO.md` com o que quebra em cada tamanho de tela e o plano em fases.
- **Precisa fazer:** decidir por qual fase começar.

## 27/11/2026 — Spinner da Home travado (enviado por Kiid)

- **O que mudou:** o carregamento da Home não fica mais preso ao navegar ou quando a sincronização demora.
- **Arquivos:** barra lateral (`sidebarNavigationHelpers-02/03`) e Home (`homeScreenMethods-21-load-data.js`, `-30-cleanup.js`).
- **Precisa fazer:** nada.

## 28/11/2026 — `/__status` mostra addons e TorBox salvos no Supabase

- **O que mudou:** a página `/__status` agora diz quais addons estão salvos no banco (e se estão ligados) e se o TorBox/debrid está conectado. A chave do TorBox nunca aparece, só o nome do serviço.
- **Como:** o servidor consulta `sync_pull_addons` e `sync_pull_provider_credentials` com a conta da casa e mostra só nomes.
- **Precisa fazer:** nada.

## 28/11/2026 — Perfil principal controla o geral; cada perfil tem o pessoal (etapa 3)

- **O que mudou:** o perfil principal (o da estrela) é o único que muda addons, plugins, TorBox, conexões, catálogos e selos; isso vale para todo mundo. Nos outros perfis essas telas somem ou ficam só para ver, com um aviso. Cada perfil mantém as **suas** configurações pessoais: tema, layout, modo ambiente, Essencial/Avançado, player (legendas e áudio), trailers e Trakt.
- **Como:** o app separa configurações gerais e pessoais (`sharedProfileData.js`); na nuvem, cada perfil tem seu documento de configurações, mas a parte geral sempre vem do perfil principal, e só ele pode alterar o TorBox.
- **Precisa fazer:** rodar `docs/supabase/03-general-vs-personal.sql` no SQL Editor do Supabase (depois do 02).
- **Não testado:** o SQL no Supabase de verdade; a tela foi testada localmente (perfil secundário vê só as seções pessoais e o aviso nos addons).

## 27/11/2026 — Mouse no navegador e controles do trailer (enviado por Kiid)

- **O que mudou:** navegação com mouse no navegador e controles interativos no trailer da tela de detalhes (tocar/pausar, progresso).
- **Arquivos:** `focusEngine.js`, telas de detalhes (trailer e comentários), `css/components-40.css` e `components-41.css`.
- **Precisa fazer:** nada.

## 28/11/2026 — Este arquivo

- **O que mudou:** criado este registro de mudanças em português.
- **Precisa fazer:** nada.

## 28/11/2026 — Addons, plugins, TorBox e configurações gerais na nuvem (etapa 2)

- **O que mudou:** addons, plugins, conexão do TorBox e configurações (tema, layout, player, catálogos) ficam iguais para **todos os perfis em todos os aparelhos**. Muda em um lugar, vale para todo mundo.
- **Como:** o Nuvio sincroniza essas coisas "por perfil"; as funções novas do Supabase ignoram o perfil e guardam uma cópia única. No app, a sincronização de addons passou a usar sempre a lista geral, de qualquer perfil.
- **Precisa fazer:** rodar `docs/supabase/02-shared-addons-settings.sql` no SQL Editor do Supabase.
- **Atenção:** todo mundo passa a usar a conta do TorBox de quem conectou; os downloads contam nesse plano.
- **Não testado:** o SQL ainda não tinha rodado no Supabase de verdade quando foi enviado.

## 28/11/2026 — Histórico do login e botão "Conectar este navegador"

- **O que mudou:** a página `/__status` mostra o que aconteceu com o login naquele navegador e tem um botão para conectar o navegador à conta da casa.
- **Como:** o `nuvio.env.js` guarda um pequeno histórico do login no navegador.
- **Resultado:** resolveu o navegador do amigo que estava "não logado".

## 28/11/2026 — Página de diagnóstico `/__status`

- **O que mudou:** nova página `https://nuvio-web-lll8.onrender.com/__status` (pede a senha do site). Mostra se o Supabase está configurado, quais perfis estão no banco e em qual conta o navegador está. **Nunca mostra chaves.**
- **Precisa fazer:** nada; usar quando algo não sincronizar e mandar o print.

## 28/11/2026 — Login sem e-mail (conta da casa)

- **O que mudou:** ninguém digita e-mail. Entra com a senha do site e escolhe o perfil.
- **Como:** o servidor entra sozinho numa conta única do Supabase ("conta da casa") usando a chave secreta `SUPABASE_SERVICE_ROLE_KEY`, que fica só no Render.
- **Precisa fazer (feito):** colocar `SUPABASE_SERVICE_ROLE_KEY` no Environment do Render.

## 28/11/2026 — Supabase: contas e perfis (etapa 1)

- **O que mudou:** perfis (nome e foto) ficam salvos no Supabase e aparecem em todos os aparelhos. PIN de perfil funciona.
- **Como:** recriadas no Supabase as funções que o app do Nuvio já chamava (`sync_pull_profiles`, `sync_push_profiles`, `get_sync_owner`...). O site passou a ler a URL e a chave pública do Supabase do Environment do Render.
- **Precisa fazer (feito):** rodar `docs/supabase/01-accounts-profiles.sql`; colocar `NUVIO_SUPABASE_URL` e `NUVIO_SUPABASE_ANON_KEY` no Render.

## 28/11/2026 — Registro de bugs e verificação automática

- **O que mudou:** `docs/BUGS.md` lista todo bug corrigido; `scripts/check-regressions.mjs` confere se algum voltou. Roda antes de todo envio.

## 28/11/2026 — Configurações gerais entre perfis e foto de perfil

- **O que mudou:** no mesmo navegador, todos os perfis usam os mesmos addons e configurações. Editor de perfil ganhou "Enviar foto", "Trocar foto" e "Remover foto".
- **Como:** os armazenamentos de configurações passaram a usar sempre o perfil principal; a foto é cortada em quadrado e reduzida (256 px) antes de salvar.

## 28/11/2026 — Correção do "Login required" no TorBox

- **O que mudou:** conectar o TorBox e usar addons voltou a funcionar com a senha do site ativa.
- **Como:** as chamadas ao proxy passaram a enviar o cookie de login do site.

## 27/11/2026 — Primeira versão online

- **O que mudou:** o app roda no navegador e no Render, protegido por senha.
- **Como:** proxy no servidor para contornar CORS (addons, plugins, TorBox); correção do envio de formulário do TorBox; página de senha; configuração do Render (`render.yaml`).
- **Precisa fazer (feito):** criar o serviço no Render e definir `NUVIO_PASSWORD`.
