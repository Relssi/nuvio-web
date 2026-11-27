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

## Não são bugs do código (para não perder tempo de novo)

- **"No streams found" com Torrentio sem debrid:** o navegador não toca torrent; é preciso um debrid conectado.
- **TorBox `PLAN_RESTRICTED_FEATURE`:** o plano grátis do TorBox não libera a API para apps; precisa do plano pago.
- **"FrostStream - Não autenticado":** é um aviso do addon, não um vídeo; faça login no site do addon ou ignore.
- **`Media code 4 / source not supported`:** o arquivo não é vídeo ou o formato (MKV com AC3/DTS/HEVC) não toca no navegador; escolha outra fonte.
- **Requisições `/rest/v1/rpc/...` com 401/404:** o app tentando falar com o backend Nuvio, que ainda não está configurado. Não quebram nada.
