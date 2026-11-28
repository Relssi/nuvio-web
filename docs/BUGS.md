# Registro de bugs (web)

Todo bug corrigido entra aqui, com **sintoma**, **causa**, **correção** e **como verificar**.
Antes de qualquer mudança ou envio para o GitHub, rode:

```
node scripts/check-regressions.mjs
```

O script cobre automaticamente os itens marcados com **[auto]**. Os itens **[manual]** precisam ser conferidos no navegador quando a mudança mexer naquela parte.

---

## B01 — Addons e plugins bloqueados no navegador (CORS) [auto]

- **Sintoma:** addons não carregam ou não instalam no navegador; plugins dão "Plugin execution is TV-only".
- **Causa:** o app foi feito para TV, onde as requisições saem por um serviço Node sem CORS. No navegador, a maioria dos sites bloqueia por CORS, e os plugins estavam desativados de propósito no modo browser.
- **Correção:** proxy em `scripts/serve.mjs` (`/__nuvio_proxy?url=...`) e `js/core/network/browserProxy.js`. O `httpClient` tenta direto e cai no proxy se for bloqueado; os plugins usam sempre o proxy. O `nuvio.env.js` servido pelo `serve` liga `__NUVIO_WEB_PROXY__` e `__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__`.
- **Verificar:** o proxy busca um site sem CORS; o `nuvio.env.js` contém as duas flags.

## B02 — Proxy podia ser usado para acessar a própria máquina [auto]

- **Sintoma (risco):** qualquer pessoa com acesso ao site poderia pedir ao proxy `localhost`/`127.x`/`169.254.x`.
- **Correção:** `isBlockedProxyHost` em `scripts/serve.mjs` responde 403 para esses destinos.
- **Verificar:** o proxy recusa `http://127.0.0.1/...` com 403.

## B03 — Login do TorBox/Real-Debrid falhava no navegador (CORS) [auto]

- **Sintoma:** não dava para conectar o debrid no navegador.
- **Causa:** `js/data/remote/api/debridApi.js` usava `fetch` direto; as APIs do TorBox e do Real-Debrid não liberam CORS.
- **Correção:** `debridApi.js` usa `fetchWithBrowserCorsFallback`.
- **Verificar:** o bundle contém a chamada com fallback no `debridApi`.

## B04 — "Could not resolve this Debrid stream": formulário chegava ilegível [auto]

- **Sintoma:** ao dar Play com TorBox, erro `stream-resolve`.
- **Causa:** o TorBox recebe o torrent como `FormData`. O navegador põe o `Content-Type` (com o `boundary`) no pedido ao proxy, mas o proxy só repassava os cabeçalhos codificados, e o TorBox recebia um corpo que não conseguia ler.
- **Correção:** o proxy copia o `content-type` do pedido quando a página não definiu um.
- **Verificar:** um POST multipart pelo proxy chega ao destino com os campos e o `boundary` certos.

## B05 — "Login required" ao conectar o TorBox no site com senha [auto]

- **Sintoma:** no Render, com `NUVIO_PASSWORD` ativo, a conexão do TorBox e as chamadas de addons pelo proxy davam "Login required".
- **Causa:** `fetchViaBrowserProxy` usava `credentials: "omit"`, então o cookie de sessão do login não ia junto.
- **Correção:** `credentials: "same-origin"` em `browserProxy.js`.
- **Verificar:** com senha ativa, o proxy responde 401 sem cookie e 200 com o cookie de sessão; o bundle não tem `credentials:"omit"` no `fetchViaBrowserProxy`.

## B06 — Site público sem senha [auto]

- **Sintoma (risco):** sem senha, qualquer pessoa usaria o site e o proxy.
- **Correção:** `scripts/serveAuth.mjs`; com `NUVIO_PASSWORD` definido, tudo exige login (página `/__login`), com limite de tentativas.
- **Verificar:** sem cookie, `/` redireciona para `/__login` e o proxy responde 401; com a senha certa, tudo libera.

## B07 — Grade de avatares vazia, sem como pôr foto de perfil [manual]

- **Sintoma:** não dava para escolher foto no editor de perfil.
- **Causa:** o catálogo de avatares vem do servidor Supabase oficial do Nuvio, que não está configurado.
- **Correção:** botões "Enviar foto", "Trocar foto" e "Remover foto" (`js/core/profile/profileAvatarUpload.js`). A imagem é cortada em quadrado, reduzida para JPEG de 256 px e salva no `avatarUrl` do perfil.
- **Verificar (manual):** Settings → Profiles → Manage Profiles → editar ou criar perfil → Enviar foto → salvar; a foto aparece na tela de perfis e na barra lateral.

## B08 — Configurações e addons diferentes em cada perfil [auto]

- **Sintoma:** cada perfil tinha os próprios addons e configurações.
- **Pedido:** configurações gerais, iguais para todos os perfis.
- **Correção:** `js/core/profile/sharedProfileData.js`. `profileScopedStore`, `addonRepository` e `pluginStore` sempre usam o perfil "1". Apagar um perfil secundário não apaga as configurações compartilhadas. Histórico e biblioteca continuam por perfil.
- **Verificar:** `scripts/test-profile-scoped-store-cache.mjs`.

## B09 — Correção "não funcionou", mas era o servidor antigo rodando [manual]

- **Sintoma:** o erro persistia depois da correção.
- **Causa:** o `npm run serve` não tinha sido reiniciado e continuava rodando o código antigo.
- **Como evitar:** depois de mudar `scripts/serve.mjs` ou `scripts/serveAuth.mjs`, reinicie o servidor (Ctrl+C e rode de novo). Depois de mudar arquivos em `js/` ou `css/`, rode `npm.cmd run build`. No Render, confira em **Events** se o último deploy está "Live".

## B10 — `npm` bloqueado no PowerShell [manual]

- **Sintoma:** `npm.ps1 cannot be loaded because running scripts is disabled`.
- **Causa:** política de execução de scripts do Windows.
- **Como evitar:** use `npm.cmd` no lugar de `npm` (ex.: `npm.cmd run serve`).

## B11 — Login sem e-mail (entrada automática na conta da casa) [auto]

- **Pedido:** entrar só com a senha do site e escolher o perfil, sem digitar e-mail.
- **Como funciona:** `scripts/householdSession.mjs`. Depois da senha do site, o `nuvio.env.js` pede `/__auto_session` uma única vez por navegador; o servidor entra numa conta única do Supabase (`nuvio-household@example.com`) usando a chave `SUPABASE_SERVICE_ROLE_KEY`, que fica só no servidor, e devolve uma sessão normal.
- **Cuidados:** a `service_role` nunca pode aparecer no `nuvio.env.js` (o script verifica). `/__auto_session` exige o cookie da senha do site.
- **Verificar:** sem cookie, `/__auto_session` responde 401; com cookie, devolve tokens; o `nuvio.env.js` tem o trecho de login automático e não contém a chave secreta.

## B12 — Diagnóstico sem acesso aos logs: página `/__status` [auto]

- **Motivo:** amigos não viam os perfis uns dos outros, e não havia como saber se o problema era a configuração do Supabase, as chaves ou o navegador logado em outra conta.
- **O que faz:** `scripts/statusPage.mjs` mostra se a senha e as chaves estão configuradas (só o tipo da chave, nunca o valor), se o servidor consegue entrar na conta da casa, quais perfis existem no Supabase e em qual conta **aquele navegador** está logado.
- **Também mostra:** addons salvos no Supabase e se o TorBox/debrid está conectado (só o nome do serviço).
- **Verificar:** sem a senha do site, responde 401; com a senha, lista perfis, addons e TorBox e não contém nenhuma chave nem a credencial do TorBox.

## B13 — Navegador do amigo "não logado" mesmo com o servidor certo [resolvido]

- **Sintoma:** `/__status` mostrava o servidor todo ✅, mas "Logado no Supabase: não" no navegador do amigo, com perfis só locais (Profile 1, Luska). Por isso ninguém via o perfil do outro.
- **O que foi adicionado para descobrir a causa:** o `nuvio.env.js` agora guarda no navegador um histórico do login (`__nuvioAuthDebugLog`): login automático ok/falhou e **quando o app apaga a sessão e de onde** (qual código chamou). O `/__status` mostra esse histórico e tem o botão "Conectar este navegador à conta da casa".
- **Atenção:** ao conectar, o app baixa os perfis do Supabase e substitui os perfis locais daquele navegador; um perfil criado só localmente (ex.: Luska) precisa ser criado de novo depois de conectar.
- **Resultado:** com o botão "Conectar este navegador" funcionou. Causa provável: o navegador já estava aberto antes do login automático ser ativado no Render, então não pediu a sessão.
- **Verificar:** `nuvio.env.js` contém `__nuvioAuthDebugLog`.

## B14 — Addons/configurações salvos "no perfil" em vez de gerais (na nuvem) [auto]

- **Sintoma:** os addons e as configurações não eram iguais para todos; cada aparelho/perfil tinha os seus.
- **Causa:** a sincronização nativa do Nuvio é por perfil (`p_profile_id`). Com o perfil Luska ativo, o app buscaria "os addons do Luska" (vazio) e não enviaria mudanças feitas nele.
- **Correção:** `librarySyncService.js` sempre usa o perfil compartilhado ("1") e envia a lista a partir de qualquer perfil. No banco (`docs/supabase/02-shared-addons-settings.sql`), as funções de configurações, credenciais (TorBox) e plugins ignoram o perfil e guardam uma cópia única; addons e plugins gravados direto na tabela são forçados para o perfil 1 por um trigger.
- **Verificar:** checagens B14 no `check-regressions.mjs`.

## B15 — Configurações gerais só no perfil principal; pessoais por perfil [auto]

- **Pedido:** o perfil principal cuida de streaming, conexões e configurações gerais (valem para todos); os outros perfis só usam e mantêm apenas configurações pessoais.
- **Como:** `js/core/profile/sharedProfileData.js` define o que é geral (addons, plugins, TorBox/debrid, torrent, TMDB, MDBList, AnimeSkip, selos de stream, catálogos, coleções, servidores de mídia) e o que é pessoal (tema, layout, modo ambiente, modo Essencial/Avançado, player/legendas/áudio, trailers, Trakt). `profileScopedStore` só compartilha as gerais. Outros perfis: addons somente leitura (com aviso), seções Content & Discovery/Integrations/Plugins/selos escondidas, e não enviam addons/plugins à nuvem. No banco (`03-general-vs-personal.sql`): configurações por perfil, com a parte geral sempre vinda do perfil 1; credenciais só aceitas do perfil 1.
- **Verificar:** checagens B15 e `scripts/test-general-settings-store.mjs`; o teste original `test-profile-scoped-store-cache.mjs` voltou a valer para as configurações pessoais.

## B16 — Build travado para sempre ao reescrever vw/vh [auto]

- **Sintoma:** `npm run build` nunca terminava depois de adicionar a escala do navegador.
- **Causa:** a regra do build troca `12vw` por `calc(12 * var(--nuvio-vw, 1vw))`. O PostCSS visita a declaração de novo quando o valor muda, e o `1vw` do próprio resultado era reescrito outra vez, sem fim.
- **Correção:** `rewriteViewportUnits` ignora valores que já têm `var(--nuvio-vw/vh)`, e a troca roda numa única passada no fim (`OnceExit`), o que também cobre os blocos `:root` que outras etapas do build criam.
- **Verificar:** o bundle não tem nenhum `vw`/`vh` sem reescrever e o build mantém a proteção.

## B17 — Escala proporcional no navegador (fase 1 do responsivo) [auto + manual]

- **O que faz:** `assets/runtime/browser-viewport-scale.js` trata a página como uma tela virtual de 1920×1080 e aplica `zoom` para caber na janela (notebook 1366×768 = 0,71×; 4K = 2×). Não age em TV (Tizen/webOS) nem em telas menores que 1000×560 (celular e tablet em pé ficam para a fase 2).
- **Cuidados testados:** clique com mouse e foco por setas continuam alinhados; imagens carregam; sem rolagem lateral.
- **Verificar (manual):** abrir em 1366×768 e em 4K, clicar no menu e andar pelas fileiras com as setas.

## B18 — Addons no Supabase, mas não carregavam no navegador dos amigos [auto]

- **Sintoma:** os addons apareciam no Supabase e no `/__status`, mas os navegadores dos amigos (conta da casa certa) continuavam sem addons.
- **Causa provável:** o app lê os addons **direto da tabela** `addons`; projetos novos do Supabase podem não liberar tabelas para a API, e a leitura volta "permission denied" (403/42501). O app tratava isso como erro e mantinha a lista local vazia. O `/__status` funcionava porque usa a função `sync_pull_addons`, que não depende dessa liberação.
- **Correção:** `librarySyncService.js` tenta `sync_pull_addons` quando a leitura da tabela é negada; `docs/supabase/04-table-access.sql` libera as tabelas `addons`, `plugins` e `profiles` para usuários logados (a segurança por linha continua valendo). O `/__status` ganhou a linha "App consegue ler a tabela de addons".
- **Verificar:** checagem B18; teste local com o Supabase simulado negando a tabela: o perfil secundário recebeu os addons pela função.

## B19 — Layout de celular (fase 2 do responsivo) [auto + manual]

- **O que faz:** `css/mobile.css`, ativado por `html[data-layout="mobile"]` (o script de escala marca a página assim quando a tela é menor que 1000×560). Menu vira barra embaixo; Início com destaque em cima e pôsteres menores; tela do filme em uma coluna; lista de fontes em largura total; tela de perfis com dois por linha.
- **Cuidados:** todas as regras ficam dentro de `html[data-layout="mobile"]`, então computador e TV não mudam. Os tamanhos de pôster das configurações de Layout são escritos direto no elemento da tela, por isso são sobrescritos num elemento interno (`.home-main`).
- **Verificar (auto):** checagem B19 garante que nenhuma regra do arquivo escapa do escopo de celular.
- **Verificar (manual):** em 375×812, nenhuma tela passa da largura (Início, filme, fontes, perfis); tocar num pôster abre o filme; a barra de baixo troca de tela.
- **Nota de teste:** o navegador embutido do Claude Code corta a lateral direita das capturas em tamanho de celular; a largura foi conferida medindo os elementos.

## B20 — Início no celular grande demais e ruim de navegar [auto + manual]

- **Sintoma:** no celular, o destaque ocupava metade da tela e as fileiras ficavam numa janela pequena embaixo (só 1–2 visíveis); a primeira fileira às vezes abria já rolada, com o primeiro pôster cortado.
- **Causa:** o layout "moderno" da TV prende as fileiras numa área fixa sob o destaque. O app também rola as fileiras sozinho (câmera que segue o foco, expansão do card com trailer, foco ao passar o mouse/dedo), o que faz sentido com controle remoto, mas não com o dedo.
- **Correção:** no celular, a página inteira rola (destaque de ~44% da altura que sai de cena ao rolar), pôsteres de 100 px e menos espaço entre fileiras. Em JS: `animateScroll` não rola fileiras na horizontal no celular, a não ser logo após uma tecla de seta; o foco por "hover" fica desligado no celular; os alinhamentos automáticos de foco só rodam com tecla.
- **Limitação conhecida:** usando setas do teclado no layout de celular, o card focado pode não aparecer inteiro (as contas de margem são da TV). Com o dedo não acontece.
- **Verificar:** checagem B20; no simulador 375×812, 2 fileiras inteiras visíveis, fileiras começam no início após recarregar, rolar a página carrega as imagens de baixo.

## B21 — Início do celular no estilo do CineRotten [auto + manual]

- **Pedido:** o Início do celular ainda estava ruim; fazer algo inspirado no CineRotten (`rt-api/docs/index.html`, bloco `@media(max-width:700px)`).
- **O que mudou (`css/mobile.css`):** barra de baixo com nome embaixo do ícone, aba ativa com ícone e linha vermelhos; destaque em forma de cartão arredondado (≈58% da altura) com "Em destaque", descrição de 4 linhas e botão vermelho "Ver detalhes"; pôsteres de 118 px com o título escrito na parte de baixo do pôster (via `attr(data-item-title)`); cores do CineRotten (#e50914, fundo #0a0a0d).
- **Toque no destaque:** `browser-viewport-scale.js` encaminha o toque no cartão de destaque para o pôster em foco (o que o destaque mostra), abrindo o filme.
- **Verificar:** checagem B21; no simulador, tocar no destaque abre o filme certo; nada passa da largura na Início.
- **Ainda não feito:** Busca, Biblioteca e Configurações passam da largura no celular (próxima parte).

## B24 — Vídeo do player pequeno e encostado à esquerda no computador [auto + manual]

- **Sintoma:** no computador o vídeo aparecia menor que a tela e deslocado para a esquerda (faixa preta grande à direita).
- **Causa:** o site é ampliado/reduzido para caber na janela (`html.style.zoom`, B13/B14), mas o player calculava a posição do vídeo em pixels da janela. Com zoom 0,71 o vídeo ficava 71% do tamanho e puxado para a esquerda.
- **Correção (`playerScreenMethods-64`, `applyAspectMode`):** no navegador o vídeo ocupa a tela virtual inteira (`calc(100 * var(--nuvio-vw, 1vw))`, idem altura) e o `object-fit` do modo de tela centraliza a imagem. TVs não mudam.
- **Verificar:** checagem B24; em janelas 1366×768 e 1600×700 o vídeo cobre a janela inteira, com faixas pretas iguais dos dois lados.

## B25 — Som (Dolby/DTS) e iPhone: usar o stream convertido do TorBox [auto + manual]

- **Problema:** Chrome, Brave e celulares tocam a imagem mas não o áudio Dolby/DTS dos filmes do TorBox; o iPhone nem abre MKV. Edge e apps de TV tocam.
- **Correção:** no navegador, ao resolver um filme do TorBox, o site pede `GET /v1/api/stream/createstream` (`DebridApi.torboxCreateStream`, `requestTorboxWebStream` em `directDebridResolver.js`). Se o TorBox devolver `hls_url` e `needs_transcoding` não for `false`, o player toca esse HLS (marcado com `mimeType` HLS para não ser tratado como MKV). Senão, usa o link direto como antes.
- **Plano:** essa função do TorBox é só do plano **Pro**. Sem Pro, o TorBox responde 403/`PLAN_RESTRICTED_FEATURE`; o site para de pedir até recarregar a página e segue com o link direto.
- **TVs:** não muda nada (só vale no navegador).
- **Verificar:** checagem B25 e `torboxWebStream.test.mjs`; manualmente, com TorBox Pro, um filme DDP/DTS toca com som no Chrome e no iPhone.
- **Não testado:** com conta Pro de verdade (formato real do `hls_url`, CORS dos pedaços).

## B26 — Idioma do áudio: português selecionado, mas toca em outro idioma [auto + manual]

- **Causa:** o navegador só toca a primeira faixa de áudio de um MKV e não consegue trocar (o Chrome não expõe as outras). O idioma escolhido no app não tinha efeito.
- **Correção:** com a conversão do TorBox (B25), o site lê a lista de faixas que o TorBox devolve (`metadata.audios`), escolhe a do idioma preferido (Configurações > Reprodução > idioma do áudio; "sistema" usa o idioma do navegador) e pede o stream de novo com `chosen_audio_index`. Prefere português do Brasil ao de Portugal e pula faixas de comentário. Código: `js/core/debrid/torboxAudioChoice.js` e `requestTorboxWebStream`.
- **Verificar:** checagem B26, `torboxAudioChoice.test.mjs` e `torboxWebStream.test.mjs`; manualmente, um filme com faixa PT-BR que não é a primeira toca em português no Chrome.
- **Limite:** só vale para filmes que passam pela conversão do TorBox (Pro, link resolvido pelo próprio site). Trocar a faixa no meio do filme pelo menu de áudio ainda não usa o TorBox.

## B27 — Celular: telas e janelas em tamanho de TV, filme sem tela cheia [auto + manual]

- **Sintoma:** no celular, Busca, Biblioteca, Configurações, Addons, Descobrir e o player apareciam com texto e botões de TV (caixa de busca saindo da tela, menu de Configurações cortado, controles do player desproporcionais); não havia como deixar o filme em tela cheia para virar o celular.
- **Correção (`css/mobile.css`):** as telas sem layout próprio de celular são reduzidas à metade (`zoom: var(--mobile-ui-zoom)`), com `--nuvio-vw/vh` dobrados para `100vw` continuar sendo a largura real. Configurações viram uma fileira de seções em cima e o conteúdo embaixo. A camada do player (`#playerUiRoot`) também é reduzida, com botões de 42px. Ajustes no celular deitado (Início e detalhes), no elenco da tela do filme e nos filtros da Biblioteca/Descobrir.
- **Build:** o plugin que reescreve vw/vh não mexe mais nas próprias variáveis `--nuvio-vw/--nuvio-vh` (senão elas apontavam para si mesmas e ficavam vazias).
- **Tela cheia:** novo botão ⛶ no player do navegador (`browserFullscreen.js`): Android/computador entram em tela cheia e o celular trava deitado; no iPhone abre o player do sistema, que gira com o aparelho.
- **Verificar:** checagem B27; no simulador 375×812 e 812×375, nenhuma das 13 telas abertas tem texto saindo da tela; botões do player com 42px.

## B28 — Toque no celular: player não reagia, rolagem dava pulos [auto + manual]

- **Causa 1:** a camada de controles cobre o vídeo, mas o player só tratava toques no próprio `<video>`; com os controles escondidos, tocar na tela não fazia nada. A barra de progresso não recebia toques (`pointer-events: none`, 2px de altura).
- **Causa 2:** arrastar o dedo gera `pointermove`, que o app tratava como mouse passando: focava o item sob o dedo e rolava a lista até ele.
- **Correção:** `onPointerSurfaceActivate` aceita toques em qualquer parte do player que não seja botão/painel e alterna os controles (mostra/esconde). A barra de progresso recebe toques no celular, com área de ~26px. `FocusEngine.handlePointerMove` ignora `pointerType` "touch"/"pen". A Início não rola sozinha na vertical no celular (só com setas do teclado).
- **Verificar:** checagem B28; no simulador, tocar na imagem mostra/esconde os controles e o botão de pausar responde ao toque.

## B29 — Celular: não dava para trocar o filme do destaque [auto + manual]

- **Sintoma:** na Início do celular, o destaque ficava parado num filme; não havia como "passar para o lado" como no CineRotten.
- **Correção:** deslizar o destaque para a esquerda/direita (`assets/runtime/browser-viewport-scale.js`) dispara `nuvio:phone-hero-swipe`; a Início (`moveFocusFromHeroSwipe` em `homeScreenMethods-19`) move o foco para o próximo/anterior filme da fileira com `focusNode` (o destaque sempre segue o foco) e rola a fileira até ele. `touch-action: pan-y` no destaque mantém a rolagem vertical da página.
- **Teste:** no simulador o painel do navegador estava escondido, o que pausa `requestAnimationFrame`; para testar foi preciso trocá-lo por um timer. Em celular de verdade isso não acontece.
- **Verificar:** checagem B29; deslizar o destaque troca o filme e a fileira acompanha.

## B30 — Áudio em português do Brasil por padrão [auto]

- **Pedido:** o player deve tocar em PT-BR sempre que houver.
- **Correção:** o idioma de áudio padrão (`playerSettingsStore.js`) passou de "sistema" para `pt-br`. Quem já escolheu outro idioma continua com a escolha. No navegador, a troca de faixa vale para filmes convertidos pelo TorBox (B26); nas TVs o app já escolhe a faixa.
- **Verificar:** checagem B30.

## B31 — Celular: tela de série gigante [auto + manual]

- **Sintoma:** em séries, os botões de temporada, os cartões de episódio (560px) e o elenco (300px) apareciam em tamanho de TV.
- **Correção (`css/mobile.css`):** temporadas e episódios em meia escala (como as outras telas de TV); o elenco de séries (`.series-cast-track`) usa os mesmos tamanhos do elenco de filmes.
- **Verificar:** checagem B31; no simulador 375px, temporada 110×45, episódio 280×179, elenco 96px.

## B32 — Fileiras não arrastavam para o lado (carrossel) [auto + manual]

- **Sintoma:** no celular (e com o mouse no computador) não dava para arrastar as fileiras de filmes para o lado.
- **Correção:** `assets/runtime/browser-viewport-scale.js` faz o arraste ele mesmo: com o dedo (celular) ou com o botão do mouse segurado, a fileira acompanha e continua deslizando ao soltar. Vale para fileiras da Início, episódios e elenco. Um arraste não abre o pôster (o clique logo depois é ignorado). No celular essas fileiras têm `touch-action: pan-y` (o navegador cuida só da rolagem vertical).
- **Verificar:** checagem B32; no simulador, arrastar 200px move a fileira 200px, ela desliza até ~490px e o filme não abre.

## B33 — Parte de baixo das telas de filme/série e Descobrir ainda grandes [auto + manual]

- **Correção:** tudo abaixo do topo da tela do filme/série (temporadas, episódios, abas Elenco/Avaliações/Trailer) fica em meia escala, substituindo os ajustes peça por peça de B27/B31. Descobrir e "Ver tudo" mostram 3 pôsteres por linha no celular, e os filtros quebram linha se precisar.
- **Verificar:** checagens B31 e B33; no simulador nenhuma das três abas tem texto saindo da tela; Descobrir com cartões de 102px, 3 por linha.

## B34 — Janela "Escolha o áudio" (removida em B35)

- Uma janela pedia o idioma antes do filme quando o site não tinha certeza da faixa dublada. O usuário achou manual demais; substituída pelo fluxo automático de B35.

## B35 — Fontes dubladas primeiro, confirmadas no TorBox, áudio automático [auto + manual]

- **Pedido:** sem passos manuais; as fontes com dublagem brasileira devem ficar sempre em primeiro.
- **Ordem (`preferDubbedStreams` em `streamOrdering.js`, só quando o áudio preferido é português):** 0 confirmada pelo TorBox com português → 1 nome diz 🇧🇷/PT-BR/Dublado/Nacional → 2 nome diz só "Dual" → 3 nada → 4 confirmada sem português. Dentro de cada grupo mantém a ordem anterior (tamanho). Vale na tela de fontes (Todas e aba 🇧🇷 PT-BR), painel de fontes e episódios do player e seletor da tela de detalhes.
- **Pré-carregamento (`checkDubbedSourcesInBackground`, tela de fontes, só navegador):** quando a lista termina de carregar, o site pergunta ao TorBox (`DirectDebridResolver.probePreferredAudio`) as faixas reais das fontes prováveis, da melhor para a pior, até confirmar uma com português (no máximo 5). Só fontes já prontas no TorBox ("Ready"/cached; o TorBox só adiciona se estiver em cache), então nunca inicia download. Resultado guardado por 30 dias (`torboxDubProbeStore.js`, chave = infoHash + arquivo).
- **Áudio automático:** sem janela; `decideTorboxAudio` usa a faixa que diz ser a preferida, senão o palpite (Dual: segunda faixa sem idioma depois de inglês), senão a primeira. O menu de áudio do player (Kiid) continua para trocar.
- **Efeito colateral:** as fontes verificadas aparecem na lista de torrents da conta TorBox (como quando se assiste).
- **Verificar:** checagem B35, `dubbedStreamOrdering.test.mjs`, `torboxAudioChoice.test.mjs`.

## B36 — Dentro do idioma, a maior resolução primeiro [auto]

- **Pedido:** ordenar primeiro pelo idioma e depois pela resolução mais alta, para o topo ser a fonte em português de melhor qualidade.
- **Correção:** `preferDubbedStreams` (`streamOrdering.js`) ordena por grupo de idioma (B35), depois por `streamResolutionScore` (2160/4K/UHD, 1440/QHD, 1080/FHD, 720/HD, 576, 480/SD; sem resolução = 0, por último), depois pela ordem anterior (tamanho).
- **Verificar:** checagem B36 e `dubbedStreamOrdering.test.mjs` (dublado 4K → 1080p → 720p → sem resolução → inglês).

## B37 — Beta: imagem de uma fonte com o áudio dublado de outra [auto + manual]

- **Pedido:** tocar a fonte de melhor qualidade (mesmo sem dublagem) com o áudio dublado de outra fonte.
- **Como funciona:** botão "Dub β" no player (só navegador, quando a fonte tocando não é dublada e há fonte dublada na lista). `findDubSource` (`playerDubAudio.js`) escolhe a fonte dublada, preferindo o mesmo tipo de lançamento (WEB-DL com WEB-DL). `DirectDebridResolver.resolveDubbedAudioSource` pede ao TorBox essa fonte em 144p (`chosen_resolution_index=0`) com a faixa PT-BR. `DubAudioSync` (`dubAudioSync.js`) toca o som dela num segundo `<video>` escondido, com o vídeo principal mudo, e a cada 250 ms acerta: tempo_dub = tempo_principal × razão + atraso. A razão corrige 25 × 23,976 fps (durações 0,4%–6% diferentes); o atraso é ajustado no painel (−0,5s / +0,5s, Desligar), que aparece junto com os controles. Diferenças pequenas são corrigidas mudando a velocidade; grandes (pulo, travada), pulando.
- **Teste:** filme de teste 23,976 fps + dublagem HLS 25 fps: razão 0,959 detectada, diferença caiu de 0,17 s para ~0,005 s em 8 s; pausa/volta, atraso +1 s e desligar funcionaram. `dubAudioSync.test.mjs`.
- **Limites (beta):** só funciona bem quando as duas versões têm o mesmo corte (ex.: WEB-DL do mesmo serviço); versões com cenas diferentes saem de sincronia. Gasta a internet de duas transmissões (a dublada em 144p). Pode não funcionar no iPhone (dois áudios ao mesmo tempo). O botão de mudo age sobre a dublagem enquanto ela está ligada. Não testado com TorBox de verdade (qualidade do áudio em 144p ainda a medir).

## B38 — Dub β: áudio dublado cortando [auto + manual]

- **Sintoma:** com a dublagem ligada, o som picotava.
- **Causa:** a sincronia de B37 mudava a velocidade do áudio a cada 250 ms (~80 mudanças em 20 s) e pulava o áudio sempre que a diferença passava de 0,35 s — inclusive enquanto a dublagem (convertida na hora pelo TorBox) ainda carregava.
- **Correção (`dubAudioSync.js`, `planDubCorrection`):** diferença medida com média; velocidade só muda acima de 0,12 s, no máximo 1×/s e até 3%, e volta ao normal abaixo de 0,04 s; pulo só acima de 1 s, seguido de 2 s sem medir; nada é corrigido enquanto a dublagem carrega; buffer de 90 s.
- **Teste:** 20 s de reprodução (23,976 × 25 fps): 4 mudanças de velocidade, 2 pulos só no início, diferença máxima 0,118 s, dublagem nunca parou. `dubAudioSync.test.mjs`.
- **Não testado:** com TorBox real (onde a conversão em tempo real pode travar a dublagem).

## B39 — Dub β: sincronia automática, som sem cortes e pré-carregamento [auto + manual]

- **Pedido:** sincronia o mais automática possível e sem as "cortadinhas" restantes.
- **Atraso e velocidade automáticos (`dubOffsetEstimator.js`):** o site "ouve" os dois áudios pelo motor de áudio do navegador (o som da imagem vai só para um analisador, não para o alto-falante), guarda o volume dos dois a cada 50 ms e, a cada 5 s, compara os aumentos de volume (falas, música, efeitos) em atrasos de −8 a +8 s e nas velocidades comuns (1; 25↔23,976; 25↔24; 24↔23,976; e o palpite pela duração). Só aceita quando o encaixe é claramente melhor que qualquer outro. Depois de sincronizado, continua conferindo (±2 s) para cortes diferentes no meio do filme. Os botões −/+ passam para ajuste manual; "Auto" volta ao automático.
- **Som sem cortes (`dubAudioSync.js`):** a dublagem toca sempre na mesma velocidade; as correções mudam a velocidade da imagem (até 3%, imperceptível) ou movem a imagem — nunca o som. Se a imagem não conseguir pular (3 falhas em 15 s), passa a mover o som.
- **Pré-carregamento:** antes de trocar o som, carrega ~15 s da dublagem (até 25 s de espera) com o áudio original tocando.
- **Segurança:** só "ouve" a imagem quando o navegador permite (HLS do TorBox via hls.js, blob:); senão usa ajuste manual. Ao desligar, o som da imagem volta para o alto-falante. Volume e mudo continuam funcionando (testado: o volume do elemento é aplicado antes do motor de áudio).
- **Teste:** filme de teste HLS 23,976 + dublagem 25 fps com 1,2 s de atraso e som diferente (outra "língua"); começou com palpite errado (0,969, 0 s), em ~25 s achou 0,959 e 1,20 s; erro real 0,035 s estável, sem pular o som. `dubOffsetEstimator.test.mjs`, `dubAudioSync.test.mjs`.
- **Limites:** nos primeiros ~20–25 s ainda pode estar fora até achar o atraso; filmes com trechos muito silenciosos demoram mais; não testado com filme real do TorBox.

## B40 — Dub β: filme congelado ao ligar a dublagem [auto + manual]

- **Sintoma:** ao ligar a dublagem, o filme parava e não voltava nem apertando play.
- **Causa (reproduzida):** para achar o atraso sozinho (B39), o som do filme passa pelo motor de áudio do navegador (`createMediaElementSource`). Se esse motor fica suspenso (navegador sem toque recente, ligação no celular...), o filme congela — a imagem segue o relógio do áudio — e o play não adianta. A ligação é permanente, então continuava travado mesmo depois de desligar a dublagem. No teste: com o motor suspenso o filme avançou 0 s em 3 s; play não destravou; reativar o motor destravou.
- **Correção (`dubAudioSync.js`):** (1) só liga o som do filme ao motor se ele estiver realmente rodando (`ensureRunning`); senão usa ajuste manual; no iPhone/iPad sempre manual. (2) Qualquer toque, clique ou tecla reativa o motor (`installContextKeeper`). (3) Vigia no `tick`: motor suspenso → tenta reativar e o painel mostra "toque na tela para continuar".
- **Verificar:** checagem B40; no player, suspender o motor com a dublagem ligada: o filme seguiu (2 s em 2,5 s); depois de desligar, suspender + um toque: voltou a andar.

## B41 — Dub β: progresso do carregamento [auto + manual]

- **Pedido:** mostrar % e tempo restante enquanto a dublagem carrega.
- **Como (`playerDubAudio.js`, `dubAudioSync.js`):** o painel aparece assim que se aperta "Dub β" e fica visível durante o carregamento: 5→30% enquanto o TorBox prepara a fonte (sem progresso próprio, sobe devagar), 35% ao abrir, 40% com os dados do vídeo, 40→100% conforme carrega os ~15 s da dublagem (`preloadProgress`). O tempo restante (" · ~6s") vem da velocidade de carregamento medida, limitado aos 25 s máximos. Apertar "Dub β" ou "Desligar" durante o carregamento cancela ("Dublagem cancelada").
- **Verificar:** checagem B41 e `dubAudioSync.test.mjs`; no player, com o TorBox simulado (2 s): 5%→13%→35%→40%→100%→"sincronizando…"; cancelar no meio não deixa dublagem nem vídeo extra.

## B42 — Dub β muito fora de sincronia em versões com durações diferentes (ex.: Wicker) [auto + manual]

- **Sintoma:** em Wicker (2026) a dublagem ficava muito fora, piorando com o tempo.
- **Causas:** (1) a velocidade era chutada pela diferença de duração entre as versões; uma diferença de corte (créditos, cena a mais) virava uma velocidade errada e o áudio se afastava cada vez mais. (2) A conferência depois de sincronizado procurava ±2 s em volta de **zero**, não do atraso em uso, então nunca confirmava um atraso grande e chegava a aceitar um falso. (3) Mudanças no meio do filme demoravam a ser vistas (comparava os últimos 45 s). (4) Na lista do Wicker as primeiras fontes dubladas eram "A Ladra Solitária" (outro título/edição) e seriam escolhidas.
- **Correção:** `durationRatio` só aceita a diferença de duração quando bate com 25/24/23,976 fps (±0,15%); `estimateDubOffset` busca em volta do atraso atual (`center`); depois de sincronizado confere os últimos 20 s, e após 3 falhas faz busca larga (±20 s, todas as velocidades) nos últimos 30 s; mudança grande no meio do filme pula o som da dublagem (o filme não repete nem pula cena); sem encaixe por 1 min o painel avisa "versões diferentes?". `findDubSource` prefere fonte dublada com o mesmo nome do filme, depois o mesmo tipo de lançamento.
- **Teste:** filme 150 s + dublagem com 8 s a mais aos 50 s (158 s): velocidade ficou 1 (antes chutaria 1,053), sincronizou antes do corte (erro 0,01 s), depois do corte achou 8,00 s e ficou estável (erro 0,08 s). `dubOffsetEstimator.test.mjs`, `dubAudioSync.test.mjs`, `playerDubAudio.test.mjs`.
- **Limite:** depois de uma mudança de corte leva ~30 s para reencontrar o atraso.

## B43 — Dub β no Wicker usava o áudio de outro filme [auto + manual]

- **Sintoma:** mesmo depois do B42, a dublagem do Wicker continuava muito fora e o painel mostrava "não achei o atraso".
- **Causa (medida no site):** as únicas fontes "dubladas" do Wicker na lista eram "A.Ladra.Solitária.2026…DUAL" (TorBox). Esse arquivo tem 5765 s (96 min); o Wicker tem 6350 s (106 min). Pela duração e pelo nome, é outro filme (provavelmente _The Isolate Thief_, 95 min) listado errado pelo addon. Nenhum atraso sincroniza isso. O B42 só preferia o mesmo nome; quando nenhuma fonte tinha o nome, usava a primeira mesmo assim.
- **Correção (ideia do João: comparar a duração):** `dubDurationMatches` (`dubAudioSync.js`) aceita a dublagem só se a duração, nas velocidades conhecidas (25/24/23,976 fps), ficar a até 3 min (ou 3%) do filme; senão `start` recusa (`DubDurationMismatch`). `toggleDubAudio` tenta até 4 fontes dubladas em ordem (`findDubSources`) e marca as recusadas, que não aparecem mais (o botão some se não sobrar nenhuma). Se todas forem de outra versão, avisa "As fontes dubladas da lista são de outra versão do filme".
- **Teste:** `dubAudioSync.test.mjs` (6350 × 5765 recusado; créditos +2 min e PAL aceitos), `playerDubAudio.test.mjs` (lista e fontes recusadas).
- **Limite:** a duração só é conhecida depois de pedir a fonte ao TorBox (alguns segundos por fonte). A lista de fontes ainda mostra "A Ladra Solitária" no topo como dublada.

## B44 — Interface quebrada no iPhone (todas as telas e o player) [auto + manual]

- **Pedido:** "conserte toda a UI no iPhone, toda a interface sem exceção, até o player". Revisão tela por tela com a skill design-critique, com fotos em tamanho de iPhone (390×664 em pé e 844×390 deitado).
- **Achados e correções:**
  - **Destaque da home invisível no celular:** a regra de computador do Kiid (destaque só aparece ao passar o mouse, `.desktop-web`) também valia no celular, onde não há mouse. Agora `desktop-web` só fica ligado fora do layout de celular (`app.js` marca `data-desktop-web`; `browser-viewport-scale.js` liga/desliga junto com o layout).
  - **Primeira visita:** a janela "App Update" e a tela de login apareciam no tamanho de TV (uma palavra por linha). Janelas (`NuvioDialog`) agora em meio tamanho, com a largura certa e rolagem; login em uma coluna.
  - **Telas sem barra de baixo** (Addons, Discover, páginas de ajuste): no celular não há botão Voltar do controle, a pessoa ficava presa. Botão flutuante "← Voltar" nessas telas.
  - **Detalhes:** separadores "|" soltos e linhas com 40px de altura nas informações; elenco/episódios fora da margem; título em texto (sem logo) com 64px; "Read more" maior que a sinopse; aviso "Press back…" de TV.
  - **Home deitado:** a página abria rolada (o `focus()` do primeiro cartaz rola a página; agora `focusWithoutScroll` no celular), o cartão do destaque tinha altura mínima de 400px (texto e botão caíam fora) e a descrição tinha 4 linhas fixadas por script.
  - **Player:** barra de volume por cima do botão de legenda, "…" por cima do tempo e tela cheia fora da tela em pé; ícones SVG com metade do tamanho; título, relógio e textos com 4–10px; aviso de classificação por cima de "Voltar/Início". Agora: sem barra de volume (o iPhone usa os botões do aparelho), botões quebram em 2 linhas em pé, tempo acima dos botões, tamanhos fixos.
  - **Menus do player:** legendas/áudio com texto de 5–7px e 3ª coluna cortada; faixa de áudio escolhida com texto escuro em fundo escuro; menus de áudio e velocidade sem como fechar no celular. Agora ocupam a tela, legendas em 3 colunas deitado e 2 + estilo embaixo em pé, e áudio/velocidade ganharam "✕".
  - Discover deitado com 5 pôsteres por linha.
- **Verificar:** checagem B44; fotos de todas as telas em pé e deitado no Edge com perfil de iPhone (Playwright).
- **Limite:** testado com o motor do Chrome/Edge no tamanho do iPhone, não no Safari de um iPhone de verdade.

## B45 — Notas do Rotten Tomatoes (CineRotten) no Nuvio [auto + manual]

- **Pedido:** trazer as notas e os filtros do CineRotten para o Nuvio: nota nos pôsteres, as duas notas com contagens nos detalhes e filtros no Discover.
- **Como funciona:**
- `scripts/buildRtScores.mjs` lê `rt-api/docs/data` (enrich_core + scores_bulk**) e grava `assets/data/rt-scores.json` no formato `{ imdb: [crítica, público, nº críticas, nº notas] }`. O site do CineRotten na Vercel pede login, então o Nuvio não busca de lá: usa esta cópia.
  \-`js/core/rt/rtScores.js`: carrega o arquivo no início (`app.js`), guarda no `localStorage` por 1 dia, acha o IMDb do item (`id`, `imdb_id`, `externalIds`…) e desenha os selos. Se a tela desenhar antes do arquivo chegar, fica um espaço vazio (`data-rt-slot`) que é preenchido quando as notas chegam.
- `js/core/rt/rtFilters.js`: filtros e ordenação (funções puras, com testes). O Discover filtra os itens já carregados do catálogo e, com filtro de nota, carrega até 8 páginas a mais para achar títulos.
- Pôsteres: Popcornmeter; sem ele, Tomatometer. Fresh/Hot = 60% ou mais.`- **Limites:** só ~1.400 títulos têm o número de críticas; títulos sem IMDb (só TMDB) não têm nota.
- **Verificar:** checagem B45 (arquivo existe, tem mais de 1.000 títulos, menos de 600 KB; Discover tem os 5 filtros; `app.js`carrega as notas); testes`js/core/rt/_.test.mjs`. Manual: no iPhone, Discover → Crítica mín. 80% → aparece "1 filtro ativo · Limpar".

## B46 — Tela de perfis quebrada no iPhone [auto + manual]

- **Sintoma:** em "Who's watching?" o círculo do perfil escolhido ficava com 220px e cobria "Add Profile", o subtítulo era maior que o título, o nome quebrava em duas linhas e, com o celular deitado, título e subtítulo sumiam (altura zero) por cima dos perfis.
- **Causa:** o visual compacto dessa tela vinha das regras de computador (`.desktop-web .profile-grid-compact`), que desde o B44 não valem mais no celular; sobraram os tamanhos de TV. Deitado, a coluna era mais alta que a tela e o flex encolhia título e subtítulo.
- **Correção (`css/mobile.css`):** tamanhos próprios de celular para título, subtítulo, círculos (104px, também no escolhido), nome, selo e botão de editar; perfis lado a lado quebrando linha; a página rola em vez de encolher (`flex-shrink: 0`).
- **Verificar:** checagem B46; fotos 390×664 e 844×390.

## B47 — Dub β: botões −0,5s / +0,5s não faziam nada [auto + manual]

- **Sintoma:** o ajuste manual da dublagem não funcionava; num filme 1080p a dublagem ficou fora de sincronia.
- **Causa (reproduzida no navegador):** o FocusEngine captura todo clique da página e entrega botões ao `onPointerActivate` da tela. No player esse método é `async`, então sempre devolve uma Promise e o FocusEngine cancela o clique, qualquer que seja a resposta. Os botões do painel (fora do player) nunca recebiam o toque. Sem os botões, quando o ajuste automático não é possível (arquivo direto em vez de HLS, iPhone), não havia como acertar o atraso, e a dublagem ficava fora.
- **Também:** ao virar "manual" aparecia o botão "Auto" e os outros mudavam de lugar (o 2º toque caía no "Auto" e voltava ao automático); o painel sumia junto com os controles ~3 s depois e cobria "Voltar / Início" e o relógio.
- **Correção:** o painel tem `data-native-click` e o FocusEngine deixa esses cliques passarem; o "Auto" só fica invisível (não muda o lugar dos outros) e o texto de estado tem largura fixa; cada toque mantém o painel por 8 s e reinicia o tempo dos controles; o painel fica abaixo da linha de cima do player.
- **Verificar:** checagem B47; no player com TorBox simulado, 4 toques em "+0,5s" levaram o atraso a +2,0 s e a dublagem acompanhou (diferença medida 1,98 s).

## B48 — Listas do Rotten Tomatoes como fileiras da Home [auto + manual]

- **Pedido:** "na aba home onde ficam os catálogos dos filmes coloque listas recomendadas do rotten tomatoes por gênero ou recomendação da semana".
- **Como funciona:**
  - `scripts/buildRtLists.mjs` lê do CineRotten `rt_lists.json` (16 listas de filmes do RT), `rt_lists_serie.json` (12 de séries) e `hype.json` (populares nos cinemas) e grava `assets/data/rt-lists.json`. Só entram listas que o CineRotten realmente tem e títulos com IMDb.
  - `js/core/rt/rtLists.js` transforma as listas num addon interno só de catálogo (`baseUrl nuvio-rt://lists`). O `addonRepository` o acrescenta junto com os servidores de mídia (`includeMediaServers`), e a Home também no caminho de cache. O `catalogRepository` responde a esses catálogos localmente, sem rede.
  - 10 listas têm `showInHome`; as outras ficam só no Discover. Não é salvo na conta (não aparece em Addons).
- **Verificar:** checagem B48; testes `js/core/rt/rtLists.test.mjs`. Manual: no iPhone, a Home mostra "RT · Certified Fresh · os mais populares" e as outras 9 fileiras com selos 🍿; abrir um título abre os detalhes normais.

## B49 — Fontes sem som no navegador (FrostStream e outros links diretos com áudio Dolby) [auto + manual]

- **Sintoma:** fontes do addon FrostStream tocavam a imagem sem som (ou nem abriam) no Chrome.
- **Causa (testada):** o FrostStream entrega links diretos de arquivo (`notWebReady`). As versões 4K HDR / 1080p têm áudio Dolby (E-AC-3), que Chrome, Brave e Opera jogam fora: no teste, um vídeo com E-AC-3 tocou com **0 bytes de áudio decodificado**, enquanto um com AAC decodificou normalmente (mesmo no mudo). O site do FrostStream fica atrás do Cloudflare e recusa servidores (página "Just a moment…" para o proxy do Render), então não dá para converter o áudio no servidor nem mandar para o TorBox.
- **Correção (`silentAudioWatch.js`):** em cada fonte, o player mede o áudio decodificado (`webkitAudioDecodedByteCount`, Chrome/Edge). Se o filme anda 6 s e nenhum byte de áudio foi decodificado, aparece "Fonte sem som neste navegador (áudio Dolby). Trocando para outra…" e o player passa para a próxima fonte da lista, no mesmo ponto do filme (até 4 trocas; fontes já sem som não voltam). Sem outra fonte, avisa para escolher outra, usar o Dub β ou abrir no Edge. Safari e Firefox não informam isso, então lá nada muda (o Safari toca Dolby). Com o Dub β ligado, não troca.
- **Verificar:** checagem B49 e `silentAudioWatch.test.mjs`; no player, fonte com E-AC-3 + fonte com AAC: depois de ~6 s trocou sozinho para a com AAC, que tocou com som.
- **Limite:** no Edge as fontes Dolby tocam com som e ficam (é o desejado). Uma fonte que realmente não tem áudio também seria trocada.

## Teste que já falhava

- `js/ui/screens/home/homeHeroBackdropBitmap.test.mjs` (2 testes de troca suave da imagem do destaque) falha também na versão do GitHub antes destas mudanças. Não investigado.

## Não são bugs do código (para não perder tempo de novo)

- **"No streams found" com Torrentio sem debrid:** o navegador não toca torrent; é preciso um debrid conectado.
- **TorBox `PLAN_RESTRICTED_FEATURE`:** o plano grátis do TorBox não libera a API para apps; precisa do plano pago.
- **"FrostStream - Não autenticado":** é um aviso do addon, não um vídeo; faça login no site do addon ou ignore.
- **`Media code 4 / source not supported`:** o arquivo não é vídeo ou o formato (MKV com AC3/DTS/HEVC) não toca no navegador; escolha outra fonte.
- **Requisições `/rest/v1/rpc/...` com 401/404:** o app tentando falar com o backend Nuvio, que ainda não está configurado. Não quebram nada.
