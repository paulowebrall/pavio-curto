# Pavio Curto Online (português)

> English version: [README.md](README.md)

Batalha de bombas multiplayer (até 4 jogadores) com login Google, nick único, ranking, torneios com barra de apoio, doações por Pix, selo de apoiador e figurinhas.

## Rodar

```bash
npm install
cp .env.example .env   # e preencha
npm start
```

Abra http://localhost:3000.

## Configuração (.env)

| Chave | Para quê |
|---|---|
| `GOOGLE_CLIENT_ID` | Login com Google. Crie em Google Cloud Console > APIs e serviços > Credenciais > ID do cliente OAuth (tipo "Aplicativo da Web") e adicione o endereço do site em "Origens JavaScript autorizadas" (ex.: `http://localhost:3000` e o seu domínio `https://...`). |
| `ADMIN_EMAILS` | E-mails dos organizadores (criam torneios e confirmam doações). |
| `PIX_KEY` | Sua chave Pix, mostrada para quem for doar no modo manual. |
| `MP_ACCESS_TOKEN` | Opcional. Access Token do Mercado Pago: o Pix vira QR Code automático e a doação é confirmada sozinha. |
| `DEV_LOGIN` | `1` liga o login de teste (sem Google). Deixe `0` quando for jogar de verdade. |

O Google só aceita login em `localhost` ou em endereço `https://`. Para amigos de fora, publique o jogo num serviço com HTTPS (Render, Railway, Fly.io) ou use um túnel como `ngrok http 3000`.

## Regras

- **Nick:** 3 a 14 letras, números ou `_`. Cada nick é de uma pessoa só (sem diferenciar maiúsculas) e não dá para trocar depois.
- **Pontos (vão para quem vence a partida):** bots no fácil 1, normal 2, difícil 3. Torneio de 2 vitórias 3, de 3 vitórias 5, de 5 vitórias 10. Vale também contra bots, mas só para quem vence e fica na sala até o fim da partida; quem sai no meio não ganha.
- **Bomba começa fraca:** o fogo da bomba começa com 1 casa para cada lado; cada item de fogo aumenta 1 (até 8).
- **Caixa do pet queima:** se uma explosão de bomba pegar a caixa-surpresa já aberta no chão, o pet queima e some (o fogo do vulcão não queima).
- **Fogo que sobrou:** bomba que encosta no fogo ainda aceso de outra explosão (colocada, chutada, levada pelo rio ou arremessada) explode também.
- **Quem cria torneio:** quem tem 500 pontos ou mais, ou administradores. Os donos (e-mails em `ADMIN_EMAILS`) tornam alguém administrador pelo nick na aba Torneios. Administradores também confirmam doações e apagam torneios.
- **Luvinha (item):** em cima da sua bomba, ou com uma bomba logo à frente, aperte a tecla de bomba para arremessar 3 casas. Se cair em bloco ou bomba, quica 1 casa por vez; se bater na parede de fora, sai do outro lado.
- **Acessórios (só enfeite):** na sala, cada um veste o que já liberou: **Botinha alada** (10 pontos), **Escudo do Herói** (20) e **Máscara do Herói** (30). Administrador tem todos. Fica salvo na conta e aparece para todo mundo, na sala e na partida.
- **Bots com pet:** usam a arrancada do gato para fugir ou perseguir, o pulo do canguru para escapar de explosão ou quando travam, a fila de bombas do tanque em quem está na frente, o escudo do leão quando o fogo vai pegar ou alguém chega perto, e o fogo do dragão em quem está na mira.
- **Poder do pet não atravessa bomba:** o canguru não pula por cima de bomba (só de bloco), o fogo do dragão para na bomba e o tanque só solta bombas até a primeira que já estiver na frente.
- **Celular:** analógico flutuante (encoste o dedo em qualquer lugar da área da esquerda e arraste; muda de direção sem tirar o dedo), botões BOMBA e PET à direita.
- **Salas abertas:** a aba Jogar lista as salas (menos as de torneio) com código, quem criou, jogadores, bots, fase e se está esperando ou em partida. **Entrar** com um toque, ou **Assistir** se estiver cheia ou jogando.
- **Explosão:** estrondo grave de bomba (abafado, com soco, eco e ronco longo, do lado da tela onde explodiu), com clarão, onda de choque, bolas de fogo, faíscas, fumaça subindo, pedrinhas, marca de queimado no chão, sem tremer a tela.
- **Fim da partida:** o campeão aparece levantando a taça com confete e torcida; embaixo vêm as fotos de todos (personagem com acessórios), as rodadas de cada um e os pontos no ranking, com o vencedor recebendo os pontos na hora. **Enter** (ou Esc) sai da tela.
- **Pets por rodada:** quem cria a sala escolhe de Nenhum a 4 caixas-surpresa por rodada (padrão 1).
- **Pets novos:** **Leão** levanta um escudo com cara de leão por 2,5 s (o fogo das bombas e do dragão não pega; o trem continua atropelando), recarga 7 s. **Dragão** cospe fogo até 3 casas à frente (para em parede, bloco e bomba) e deixa quem pegar atordoado por 2 s, sem andar nem soltar bomba, recarga 4 s. A caixa-surpresa sorteia entre gato, canguru, tanque, leão e dragão.
- **Morreu, perdeu:** ao morrer, todos os itens (e o pet) se espalham em casas aleatórias do campo. Nada passa para a próxima rodada; a caixa-surpresa do pet aparece em toda rodada.
- **Bomba na cabeça:** se a bomba arremessada com a luvinha cair na cabeça de alguém, ela quica e a pessoa perde 1 poder, que cai num lugar aleatório.
- **Pré-inscrição em torneio:** até 48 por torneio. Quem não é administrador só pode estar pré-inscrito em 1 torneio por vez, até ele acabar. Cada pré-inscrito tem um link "Convidar amigo"; quem se pré-inscreve por esse link ganha o selo ★ Apoiador.
- **Rodadas e final:** ao criar o torneio escolhe-se de 1 a 12 rodadas. Cada rodada é uma batalha de até 4 jogadores; os vencedores vão para a final (se forem mais de 4, há uma fase no meio). Quem criou o torneio, ou um administrador, escolhe quem joga cada batalha (mover, tirar, "Distribuir automaticamente") e pode dar W.O. Só joga quem está escalado; qualquer um pode assistir. As batalhas só abrem com a barra de apoio cheia. Os pontos vão só para o campeão.
- **Texto do torneio:** prêmios e regras (até 600 caracteres, com ícones) aparecem no card e ficam fixados no topo do chat das batalhas.
- **Figurinhas:** apoiadores e administradores.
- **Torneios:** quem pode criar escolhe com nome, valor (R$), pontos mínimos e vitórias. A entrada é grátis. A barra enche com as doações confirmadas para o torneio; quando chega no valor, a sala do torneio abre para quem tem os pontos mínimos. Torneio é sem bots.
- **Apoio:** quem tem uma doação confirmada ganha o selo ★ Apoiador e pode mandar figurinhas na partida (teclas 1 a 4: zangado, sorrindo, dedo, dormindo).

## Fases

Padrão, Fogo (vulcões), Água (cachoeiras e correnteza), Trem (5 traçados com curvas), **Deserto**, **Mata**, **Fundo do Mar**, **Céu** e **Gelo**, ou Sorteio.
- **Deserto:** de tempos em tempos um redemoinho avisa no chão e cai um tornado de 1 casa que anda por uns 6 s. Quem ele pega é arremessado para longe (sem morrer); bombas e itens que ele pega vão para outro lugar.
- **Mata:** 2 ou 3 túneis de folhas de 5 ou 6 casas, sorteados a cada rodada. Quem passa por baixo some da vista dos outros (você vê seu contorno), e as bombas também.
- **Fundo do Mar:** de tempos em tempos sobem bolhas e aparece uma sombra no chão (perto de alguém); 1,6 s depois uma baleia do tamanho de uma casa surge, engole quem estiver ali, nada por baixo da arena e, 3 s depois, reaparece numa casa livre sorteada e cospe, sem matar. Dentro dela ninguém age nem leva dano.
- **Céu:** arena no alto do céu, com colunas de mármore e nuvens de algodão como blocos.
- **Gelo:** 2 casas de gelo rachado, sorteadas a cada rodada. Cada passada racha mais (3 marquinhas mostram quantas faltam); na 3ª o gelo quebra assim que a casa fica vazia e vira um buraco: gente e bomba não passam mais ali, o fogo passa por cima.

## Replays

- No fim de cada partida aparece **⏺ Gravar esta partida**. Cada pessoa guarda até 3; com 3, escolhe qual substituir.
- Aba **Replays**: assistir (pausar, 1x/2x/4x), apagar e **baixar vídeo** (.webm, gravado enquanto o replay toca, sem som).
- Como funciona: a partida usa um sorteio com semente e passo fixo de 1/60 s; a gravação guarda só a semente e os comandos dos jogadores (poucos KB). Para assistir, o servidor joga a partida de novo, igual. Arquivos em `data/replays/`.

## Música

O jogo toca uma trilha de heavy metal instrumental **original**, gerada no navegador (guitarra distorcida, baixo e bateria): "Pavio Aceso" na sala, "Arena em Chamas" na batalha e "Tempo Esgotado" quando a arena começa a fechar, com um acorde de vitória no fim. O botão "Música" liga e desliga.

Para usar músicas próprias, coloque `sala.mp3`, `batalha.mp3` e `final.mp3` em `public/musica/`. Use só músicas que vocês têm direito de usar (compostas por vocês ou com licença livre). Música de banda famosa, mesmo instrumental ou em cover, precisa de licença.

## Publicado

- Endereço: **https://opaviocurto.com.br/** (também responde em https://rotadevenda.com.br/pavio-curto/).
- Roda num container Docker atrás do Caddy (HTTPS automático). O jogo usa `BASE_PATH=/pavio-curto` por dentro; no domínio próprio o Caddy reescreve os caminhos para essa pasta.
- Configuração de produção fica no `.env` do servidor; os dados (contas, pontos, torneios, doações) ficam na pasta `data/`. Faça backup dela.
- Atualizar: crie o arquivo `.deploy-host` com `usuario@servidor` e rode `./deploy.sh`.

## Arquivos

- `server.js`: contas, ranking, torneios, doações, salas e partidas.
- `game.js`: regras do jogo e bots (roda só no servidor).
- `db.js`: banco de dados em arquivo (`data/db.json`). Faça backup dessa pasta.
- `payments.js`: Pix pelo Mercado Pago.
- `public/index.html`: telas e desenho do jogo.
