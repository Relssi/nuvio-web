# Sobre o projeto — Nuvio Web

Este repositório é a **versão para navegador** do [Nuvio TV](https://github.com/NuvioMedia/NuvioTVSmart), um app de código aberto (GPL-3.0) para assistir filmes e séries.

O Nuvio original foi feito para TVs Samsung (Tizen) e LG (webOS). Aqui ele foi adaptado para abrir em qualquer navegador (computador, celular e tablet) e ficar hospedado na internet, para ser usado por um grupo de amigos.

O `README.md` em inglês é o do projeto original e explica o app de TV. Este arquivo explica o que muda nesta versão.

---

## O que é, em uma frase

Um "Netflix pessoal": você traz suas próprias fontes (addons no padrão Stremio e uma conta de debrid como o TorBox), e o Nuvio organiza tudo numa interface com:

- capas, notas e trailers;
- legendas;
- perfis;
- "continuar assistindo".

O Nuvio não hospeda nem distribui filmes: ele só mostra e toca o que os addons e o serviço de debrid de cada um entregam.

## Como funciona

```
Navegador (celular / PC / TV)
   │
   ▼
Site no Render (scripts/serve.mjs)
   ├─ entrega o app (pasta dist/, gerada pelo build)
   ├─ proxy para addons e para o TorBox (evita bloqueio de CORS)
   ├─ senha do site (NUVIO_PASSWORD)
   └─ login automático na "conta da casa" (Supabase)
   │
   ├─► Supabase ......... contas, perfis, addons e configurações em comum
   ├─► Addons ........... catálogos (Cinemeta etc.) e fontes (Torrentio etc.)
   ├─► TorBox ........... transforma a fonte em um link que toca no navegador
   └─► CineRotten ....... notas do Rotten Tomatoes
```

- **Site:** hospedado no Render (`render.yaml`). Cada push na branch `main` do GitHub gera um build novo e publica sozinho.
- **Dados em comum:** ficam no Supabase. As tabelas estão em `docs/supabase/*.sql`. Os amigos entram sem e-mail: o servidor conecta cada navegador à "conta da casa" e cada pessoa escolhe o seu perfil.
- **Configurações:** o perfil principal controla as configurações gerais (addons, TorBox, plugins). Cada perfil tem as suas configurações pessoais (tema, idioma, progresso).

## O que esta versão tem a mais que o app de TV

**Site e contas**

- **Navegador:** roda no navegador, com proxy próprio para addons e debrid.
- **Acesso:** senha para abrir o site e login automático dos amigos, sem e-mail.
- **Diagnóstico:** página `/__status`, protegida pela senha do site.

**Tela e navegação**

- **Computador:** a tela se ajusta ao tamanho da janela, de notebook a monitor grande.
- **Celular (iPhone e Android), em pé e deitado:** barra de navegação embaixo, destaque deslizante na home, fileiras que arrastam como carrossel, toque no player e tela cheia.

**Áudio e dublagem**

- **Áudio sempre audível:** com o TorBox Pro, o filme é entregue em formato que toca em qualquer navegador, mesmo quando o áudio original é Dolby ou DTS.
- **Português primeiro:** a lista de fontes coloca as dubladas no topo, depois a maior resolução, e o áudio em português já vem escolhido.
- **Dub β (beta):** toca a imagem de uma fonte de alta qualidade com o áudio dublado de outra fonte. O site sincroniza sozinho e há ajuste manual de ±0,5s.

**Notas do Rotten Tomatoes**

- **Onde aparecem:** nos pôsteres, nos detalhes e nos filtros do Discover.
- **De onde vêm:** do projeto CineRotten.

A lista completa, em português, está em [`docs/MUDANCAS.md`](docs/MUDANCAS.md).

## Onde fica cada coisa

| Pasta / arquivo                            | O que tem                                                         |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `js/`                                      | O app inteiro (telas, player, addons, debrid, perfis)             |
| `css/`                                     | Estilos. `css/mobile.css` é o layout de celular                   |
| `assets/runtime/browser-viewport-scale.js` | Decide se a tela é de computador ou de celular e ajusta o tamanho |
| `scripts/serve.mjs`                        | O servidor do site (proxy, senha, login da casa)                  |
| `scripts/build.mjs`                        | Gera a pasta `dist/` que vai para o ar                            |
| `scripts/check-regressions.mjs`            | Verificação automática dos bugs já corrigidos                     |
| `transcoder/`                              | Conversor de áudio opcional (ver `docs/TRANSCODER.md`)            |
| `docs/supabase/`                           | Tabelas do Supabase                                               |
| `docs/BUGS.md`                             | Todo bug corrigido: sintoma, causa, correção e como verificar     |
| `docs/MUDANCAS.md`                         | O que mudou em cada envio, em português                           |
| `render.yaml`                              | Configuração da hospedagem no Render                              |

## Como rodar no computador

Precisa do Node.js 22. No Windows, use `npm.cmd` em vez de `npm` no PowerShell.

```bash
npm ci
npm run build
node scripts/serve.mjs
```

Depois, abra `http://localhost:4173`.

## Regras do projeto

1. **Antes de mudar qualquer coisa,** rode `node scripts/check-regressions.mjs`. Todas as verificações precisam passar.
2. **Todo bug corrigido** entra em `docs/BUGS.md` com um número (B1, B2…) e ganha uma verificação em `scripts/check-regressions.mjs`.
3. **Todo envio para o GitHub** ganha uma entrada em português em `docs/MUDANCAS.md`.
4. **Antes de mudar e antes de enviar,** puxe o que os outros já enviaram (`git fetch` / `git pull`), para não apagar o trabalho de ninguém.
5. **Chaves secretas** (TorBox, `service_role` do Supabase, senha do site) **nunca** vão para o código. Ficam só nas variáveis de ambiente do Render.

## Créditos e licença

- **Base:** [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart), sob licença GPL-3.0 (ver `LICENSE`). Esta versão segue a mesma licença.
- **Adaptação para a web e celular:** feita por João, com contribuições do Kiid.
