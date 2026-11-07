#!/bin/sh
# Atualiza o jogo no servidor (opaviocurto.com.br).
# O endereço SSH do servidor fica no arquivo .deploy-host (fora do git), ex.: usuario@ip-do-servidor
# Envia o código, reconstrói o container e mantém os dados (data/) e o .env do servidor.
set -e
cd "$(dirname "$0")"
HOST=${DEPLOY_HOST:-$(cat .deploy-host 2>/dev/null)}
[ -n "$HOST" ] || { echo 'Crie o arquivo .deploy-host com usuario@servidor'; exit 1; }
cd "$(dirname "$0")"
COPYFILE_DISABLE=1 tar czf - --exclude=node_modules --exclude=data --exclude=.env --exclude=.claude \
  --exclude=arte --exclude=imagens --exclude=tiktok --exclude=.deploy-host --exclude=pavio-curto.html --exclude='*.log' --exclude=.git . 2>/dev/null \
  | ssh $HOST 'tar xzf - -C /opt/pavio-curto 2>/dev/null; cd /opt/pavio-curto &&
    docker build -q -t pavio-curto . >/dev/null &&
    docker rm -f pavio-curto >/dev/null 2>&1;
    docker run -d --name pavio-curto --network rotadevenda_default --restart unless-stopped \
      --env-file .env -v /opt/pavio-curto/data:/app/data pavio-curto >/dev/null &&
    sleep 2 && docker logs pavio-curto 2>&1 | tail -5'
echo "Pronto: https://opaviocurto.com.br/"
