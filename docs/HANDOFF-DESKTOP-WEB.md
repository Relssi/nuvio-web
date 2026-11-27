# Handoff — Melhorias de Navegação Desktop, Trailer, Perfis e Player Web

Este documento resume todas as alterações feitas nesta sessão no repositório `Relssi/nuvio-web` para facilitar a continuidade por outro desenvolvedor ou I.A.

---

## Contexto e Regras do Repositório

- **Sync obrigatório:** sempre rodar `git fetch origin` (e `git pull --rebase origin main` se houver commits novos) antes de editar e antes de dar `git push`, pois há outro colaborador (`Relssi`) trabalhando na `main`.
- **Verificação obrigatória antes do push:**
  ```bash
  node scripts/check-regressions.mjs
  npm run lint
  npm run format:check
  ```
- **Escala no navegador:** o `Relssi` implementou `assets/runtime/browser-viewport-scale.js` (`html.style.zoom = scale` para janelas `>= 1000x560`, tratando o viewport como um canvas virtual de `1920x1080` e convertendo `vw/vh` para `--nuvio-vw`/`--nuvio-vh` no build).
- **Classe de desktop:** `js/app.js` adiciona `desktop-web` em `document.documentElement` quando `Platform.isBrowser()` é `true`. Todas as regras CSS de ergonomia desktop usam `.desktop-web` para não afetar TVs Tizen/webOS nem a fase 2 mobile.

---

## Resumo do que já foi implementado e commitado

### 1. Mouse no site + Controles clicáveis no Trailer (`68dfdbc`)

- `js/ui/navigation/focusEngine.js`: habilitado `mousemove`, `pointermove` e `click` (`handlePointerClick`) também para `Platform.isBrowser()` via `isPointerNavigationEnabled()`. A classe `webos-pointer-remote` continua restrita ao webOS.
- `js/ui/screens/detail/metaDetailsScreenMethods-19-toggle-active-trailer-playback.js`, `...18...`, `...27...`, `css/components-40.css`, `css/components-41.css`:
  - Botões clicáveis no trailer manual (`-10s`, `Play/Pause`, `+10s`, `Mute/Unmute`, `Fechar ✕`), barra de progresso clicável (`seekTrailerToSeconds`), e clique na área do vídeo pausa/retoma em vez de fechar.
- `js/ui/screens/detail/metaDetailsScreenMethods-16-render-comments-section.js`: `detailClickHandler` só interrompe o trailer em `autoplay` se o clique for em um elemento interativo (`button, [role='button'], a[href], .focusable, [data-action]`).

### 2. Correção de travamento no spinner da Home (`2a19df9`)

- `js/ui/screens/home/homeScreenMethods-21-load-data.js`: chama `releaseInitialHomeLoading({ force: true })` assim que chegam os catálogos iniciais ou o snapshot em cache, sem ficar preso aguardando `continueWatchingInitialResolved`.
- `js/ui/screens/home/homeScreenMethods-30-cleanup.js`: reseta `this.isInitialHomeLoading = false` no `cleanup()`.
- `js/ui/components/sidebarNavigationHelpers-02...js` e `...03...js`: evita re-navegar para `"home"` se já estiver em `"home"` e bloqueia clique duplo em rápida sucessão (`data-navigating`).

### 3. Tela de seleção de perfis ergonômica + Temas por perfil (`2cbeb52`, `1ea32b9`, `7d0afb3`)

- `js/core/profile/profileSelectionScreenMethods-01-mount.js` & `...03...`: removido o wordmark `NUVIO` (`.profile-brand-lockup`), adicionado botão `✎` (`.profile-manage-btn`) para gerenciar perfil com 1 clique no mouse, e ajustada a escala `.desktop-web` em `css/components-03.css`.
- `js/core/profile/profileSelectionScreen.js` & `...04...`: ao passar o mouse (`mouseenter`) ou focar em um perfil, o fundo anima para as cores do tema daquele perfil (`ThemeStore.getForProfile(profile.id)` + `ThemeColors.getPalette(...)`, respeitando `amoledMode`).
- `syncVisibleProfileThemes()` em `profileSelectionScreenMethods-01-mount.js`: faz `ProfileSettingsSyncService.pull(profile.id)` em background para todos os perfis visíveis ao abrir a tela de perfis, permitindo que PCs diferentes enxerguem os temas uns dos outros.

### 4. Botões de Voltar nas telas internas + Atalhos no Player (`07d8b33`, `9bd262c`)

- `css/base.css`: `.nuvio-web-back-btn` (pílula `← Voltar` no topo esquerdo, oculta em `.tizen-tv` / `.webos-tv`) adicionada em Detalhes (Séries e Filmes), Streams, Elenco e Ver Tudo (`CatalogSeeAll`).
- `js/ui/screens/player/playerScreenMethods-71-on-key-down.js`: atalhos de navegador (`Espaço` = Play/Pause, `F` = Fullscreen, `M` = Mute).
- `js/ui/screens/player/playerScreenMethods-15...`, `...28...`, `...68...`, `...70...`, `css/components-31.css`, `css/components-35.css`:
  - Barra superior no player com botões **← Voltar** e **⌂ Início**.
  - Botão de **Fullscreen (`⛶`)** na barra de controles, troca de `>` / `<` para `•••` / `×`.
  - **WatchParty (`ic_player_party.svg`):** já existe em `playerScreenMethods-28-unbind-video-events.js`, mas só aparece quando `PartyRepository.isAvailable()` for `true` (depende do backend WatchParty no Supabase estar ativo).

### 5. Correções do Player, Volume, Áudio e Legendas (`812e6db` + commit atual)

- `assets/icons/ic_player_audio_filled.svg` e `ic_player_audio_outline.svg`: ícone trocado para alto-falante com ondas sonoras.
- `js/ui/screens/player/playerScreenMethods-64-move-sources-focus.js`: incluído `Environment.isBrowser()` em `useFullViewport` para `#videoPlayer` preencher `100vw × 100vh` da escala virtual do navegador em vez de encolher e deslocar para a esquerda por causa do `html.style.zoom`.
- `js/ui/screens/player/playerScreenMethods-15-apply-manifest-track-selection.js`:
  - Slider de volume + botão de mudo conectados ao `#videoPlayer` (corrigido seletor para `this.container?.querySelector?.("#videoPlayer") || PlayerController?.video`).
  - Desmuta automaticamente no evento `playing` no navegador caso não tenha sido mutado pelo usuário e `startupAudioGateActive` esteja falso.
- `js/ui/screens/player/playerScreenMethods-69-sync-pointer-focus.js`: implementado `onPointerMove()` no Player para revelar controles e reiniciar `resetControlsAutoHide()` ao mover o mouse (evitando que a HUD suma durante o uso), e fechar modais ao clicar no backdrop.
- `css/components-35.css`, `css/components-36.css`, `js/ui/screens/player/playerScreenMethods-58...`, `...70...`:
  - Redimensionadas as variáveis e modais de **Legendas**, **Áudio** (`.player-audio-overlay-grid`, `.player-audio-track-list`, `.player-audio-controls-list`) e **Velocidade** em `.desktop-web`.
  - Liberado scroll do mouse (`min-height: 0; overflow-y: auto; overscroll-behavior: contain`) nas colunas do modal de legendas, classe `.is-off-only` quando legendas estão desligadas, e botão **✕** para fechar.

---

## Observações / Próximos passos conhecidos

- **Áudio em filmes MKV/Debrid no navegador:** navegadores desktop (Chrome/Edge/Firefox) não decodificam nativamente faixas **AC-3 / E-AC-3 (Dolby Digital) / DTS / TrueHD**. Se uma stream específica tocar sem som mesmo com volume 100% e sem mudo, o motivo é o codec da faixa — selecionar uma stream com áudio **AAC / MP3 / Opus** resolve.
- **Deploy no Render:** `render.yaml` usa `plan: free` (`npm ci && npm run build`), levando ~2–4 minutos após cada `git push` para atualizar no ar.
