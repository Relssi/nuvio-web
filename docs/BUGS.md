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

## Teste que já falhava

- `js/ui/screens/home/homeHeroBackdropBitmap.test.mjs` (2 testes de troca suave da imagem do destaque) falha também na versão do GitHub antes destas mudanças. Não investigado.

## Não são bugs do código (para não perder tempo de novo)

- **"No streams found" com Torrentio sem debrid:** o navegador não toca torrent; é preciso um debrid conectado.
- **TorBox `PLAN_RESTRICTED_FEATURE`:** o plano grátis do TorBox não libera a API para apps; precisa do plano pago.
- **"FrostStream - Não autenticado":** é um aviso do addon, não um vídeo; faça login no site do addon ou ignore.
- **`Media code 4 / source not supported`:** o arquivo não é vídeo ou o formato (MKV com AC3/DTS/HEVC) não toca no navegador; escolha outra fonte.
- **Requisições `/rest/v1/rpc/...` com 401/404:** o app tentando falar com o backend Nuvio, que ainda não está configurado. Não quebram nada.
