# Análise: site se adaptando a celular, tablet, desktop e TV

Data: 28/11/2026. Testado no navegador em 375×812 (celular), 768×1024 (tablet),
1366×768 (notebook), 1920×1080 (desktop/TV Full HD) e 3840×2160 (TV 4K sem escala).

## Resumo

O Nuvio foi desenhado para **uma tela de TV de 1920×1080 controlada por controle
remoto**. No navegador ele funciona bem perto desse tamanho, mas **quebra no celular**,
fica **apertado no tablet em pé** e fica **minúsculo em telas 4K**. Para ficar bom em
todos, são dois trabalhos diferentes:

1. **Desktop, notebook e TV:** escalar a tela inteira proporcionalmente (o layout já
   é o certo, só o tamanho que não acompanha a janela). Trabalho **pequeno**.
2. **Celular e tablet:** precisa de um **layout próprio** (menu embaixo, uma coluna,
   arrastar com o dedo). Trabalho **grande**, feito tela por tela.

## O que encontrei

### Como o layout é feito hoje

- Cerca de **6.100 medidas fixas em pixels** e só **870 proporcionais** (vw) no CSS.
- Só **12 regras de tamanho de tela** (media queries), todas para ajustes finos de TV
  (ex.: `max-height: 760px`), nenhuma para celular.
- Na TV Samsung (Tizen) o app força a tela para 1920 de largura. No navegador não
  existe nada parecido: o layout fica em pixels fixos qualquer que seja a janela.
- Navegação pensada para **setas do controle** (foco). O Kiid já adicionou mouse no
  navegador. **Toque (dedo) não tem tratamento**: as fileiras de filmes rolam pelo
  código de foco, não pelo arrastar.

### Resultado por tamanho

| Tela                                               | Situação         | Principais problemas                                                                                                                                                                         |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Celular** (375×812)                              | Quebrado         | Menu lateral ocupa quase metade da tela; texto do destaque cortado ("A…"); cards enormes; na tela do filme a descrição vira uma coluna de ~100 px com palavras partidas; botão Play cortado. |
| **Tablet em pé** (768×1024)                        | Usável, mas ruim | Destaque com texto espremido; muito espaço vazio embaixo; tudo pensado para paisagem.                                                                                                        |
| **Tablet deitado / notebook** (1024–1366)          | Bom              | Pequenos apertos de texto.                                                                                                                                                                   |
| **Desktop / TV Full HD** (1920×1080)               | Ótimo            | É o tamanho para o qual foi desenhado.                                                                                                                                                       |
| **TV 4K ou monitor grande sem escala** (3840×2160) | Ruim             | Tudo fica com metade do tamanho: textos e cards minúsculos. (TVs reais costumam se apresentar como 1920×1080, então isso aparece mais em PC ligado na TV.)                                   |

## Como resolver

### Detectar o tipo de aparelho

Marcar a página com o tipo de tela, e atualizar ao girar ou redimensionar:

- **TV:** quando o app roda no Tizen/webOS, ou numa tela grande sem mouse.
- **Desktop:** tela larga com mouse.
- **Tablet:** tela média com toque.
- **Celular:** tela estreita com toque.

O CSS e o código passam a saber em que tipo de tela estão.

### Fase 1 — Desktop, notebook e TV: escala proporcional (pequeno)

Manter o desenho de 1920×1080 e **aumentar ou diminuir tudo junto** conforme a
janela (ex.: numa tela 4K tudo fica 2× maior; num notebook de 1366, ~0,7×). Resolve
4K, monitores grandes e notebooks pequenos de uma vez, sem mexer em cada tela.

- **Risco:** o código de foco e o do mouse calculam posições na tela; a escala pode
  desalinhar cliques ou o foco. Precisa testar bem (Home, detalhes, player, ajustes).
- **TV de verdade não muda:** no Tizen/webOS a escala fica desligada.

### Fase 2 — Celular e tablet: layout próprio (grande)

Prioridade pelas telas mais usadas:

1. **Navegação:** menu lateral vira **barra de ícones embaixo** (Início, Busca,
   Biblioteca, Addons, Ajustes).
2. **Início:** destaque em cima com texto completo; fileiras de cards menores que
   **rolam com o dedo** (arrastar para o lado).
3. **Tela do filme/série:** uma coluna — imagem, título, Play, descrição,
   temporadas e episódios em lista.
4. **Lista de fontes (streams):** cartões em largura total, fáceis de tocar.
5. **Busca, biblioteca, perfis.**

### Fase 3 — Player e ajustes no celular (médio)

- Player: botões maiores para o dedo, tocar para mostrar/esconder controles,
  tela cheia e girar para deitado.
- Ajustes: uma coluna (lista → abre a seção).

### Fase 4 — Verificação

- Registrar no `BUGS.md` e no script de verificação o que der para automatizar
  (ex.: "nenhuma tela passa da largura no celular").
- A cada fase, testar os 5 tamanhos acima antes de enviar.

## Recomendação

Começar pela **Fase 1** (rápida e melhora desktop, notebook e TV grande de uma vez) e,
em seguida, a **Fase 2** começando por **navegação + Início + tela do filme**, que é o
caminho de assistir algo pelo celular. Player e ajustes no celular vêm depois.

Antes da Fase 2, vale combinar com o Kiid, porque ela mexe em muitas telas e ele está
mexendo em navegação/mouse ao mesmo tempo.
