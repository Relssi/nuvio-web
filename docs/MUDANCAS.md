# Mudanças no site

Uma entrada por envio ao GitHub (cada envio vira um deploy no Render).
A mais recente fica no topo. Cada entrada diz **o que mudou para quem usa**,
**como foi feito**, **o que alguém precisa fazer** e **o que ainda não foi testado**.

Detalhes de bugs (causa e correção) ficam em [`BUGS.md`](BUGS.md).

---

## 28/11/2026 — Perfil principal controla o geral; cada perfil tem o pessoal (etapa 3)

- **O que mudou:** o perfil principal (o da estrela) é o único que muda addons, plugins, TorBox, conexões, catálogos e selos; isso vale para todo mundo. Nos outros perfis essas telas somem ou ficam só para ver, com um aviso. Cada perfil mantém as **suas** configurações pessoais: tema, layout, modo ambiente, Essencial/Avançado, player (legendas e áudio), trailers e Trakt.
- **Como:** o app separa configurações gerais e pessoais (`sharedProfileData.js`); na nuvem, cada perfil tem seu documento de configurações, mas a parte geral sempre vem do perfil principal, e só ele pode alterar o TorBox.
- **Precisa fazer:** rodar `docs/supabase/03-general-vs-personal.sql` no SQL Editor do Supabase (depois do 02).
- **Não testado:** o SQL no Supabase de verdade; a tela foi testada localmente (perfil secundário vê só as seções pessoais e o aviso nos addons).

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
