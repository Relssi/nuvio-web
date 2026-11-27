# Conversor de áudio (som em qualquer aparelho)

## Por que existe

Quase todo filme do TorBox vem com áudio Dolby (AC-3/E-AC-3), DTS ou TrueHD.
Chrome, Brave e Firefox mostram a imagem e jogam esse áudio fora (fica mudo);
o iPhone nem abre arquivos MKV. O Edge no Windows e os apps de TV tocam.

O conversor (`transcoder/server.mjs`) recebe o link direto do filme, **mantém
a imagem como está** e converte **só o áudio** para AAC estéreo, entregando o
filme em pedaços de 6 segundos (HLS). Isso toca em qualquer navegador,
celular e TV.

- Pular para outro ponto do filme reinicia a conversão naquele ponto.
- Só aceita links assinados pelo site (segredo `TRANSCODER_SECRET`), então
  estranhos não conseguem usar o servidor.
- Para não lotar o disco, a conversão fica no máximo ~2 minutos à frente de
  quem assiste e apaga os pedaços já vistos.
- No máximo 4 filmes ao mesmo tempo (`TRANSCODER_MAX_SESSIONS`).
- Legendas embutidas no MKV não passam pelo conversor; as legendas dos
  addons continuam funcionando.

Roda num servidor grátis da Oracle Cloud (o Render grátis é fraco demais e tem
pouco tráfego por mês).

## Testado

Localmente com ffmpeg 9: filme de teste de 40 min com áudio E-AC-3 5.1 em MKV
tocando com som no Chrome (hls.js), pulando para 25 e 35 min; link
falsificado recusado (403). Ainda não testado na Oracle nem com filme real.

## Passo 1 — criar a conta na Oracle (você faz)

1. Abra **cloud.oracle.com** e clique em **Start for free** / "Comece
   gratuitamente".
2. Preencha nome, e-mail e país (Brasil).
3. **Home Region:** escolha **Brazil East (São Paulo)**. Não dá para trocar
   depois.
4. Confirme o e-mail e crie a senha da conta.
5. Cadastre o cartão. É só verificação: a Oracle pode reservar um valor
   pequeno e devolve. Os recursos "Always Free" não cobram.
6. Espere o e-mail dizendo que a conta está pronta (pode levar de minutos a
   algumas horas).

Não mande a senha nem dados do cartão no chat. Quando a conta estiver pronta,
avise e seguimos para o passo 2.

## Passo 2 — criar o servidor (faremos juntos)

Máquina **VM.Standard.A1.Flex** (ARM, Always Free), Ubuntu 22.04,
2 OCPU / 12 GB, porta 8090 liberada. Eu gero a chave SSH no seu computador e
passo os cliques um por um.

## Passo 3 — instalar o conversor (eu faço pelo SSH)

```
sudo apt-get update && sudo apt-get install -y docker.io git
git clone <repositório> && cd nuvio-web
sudo docker build -t nuvio-transcoder transcoder
sudo docker run -d --restart unless-stopped --name nuvio-transcoder \
  -p 8090:8090 -e TRANSCODER_SECRET=<segredo> nuvio-transcoder
```

Depois um endereço HTTPS na frente (os navegadores exigem HTTPS numa página
HTTPS) e, no Render, `NUVIO_TRANSCODER_URL` e `NUVIO_TRANSCODER_SECRET`.

## Passo 4 — ligar ao player (eu faço)

O site toca o link direto primeiro. Se o navegador não tocar o áudio (fica
mudo) ou não abrir o arquivo (iPhone), o player troca para o link do
conversor e continua do mesmo ponto. TV e Edge seguem tocando direto.
