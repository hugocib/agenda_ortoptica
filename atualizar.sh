#!/bin/sh
# Atualiza a app para a última versão do repositório e reconstrói os contentores.
# Uso: ./atualizar.sh   (na pasta do projeto, no servidor)
# Antes de reconstruir faz uma cópia de segurança da base de dados. O .env e os dados não são tocados.
set -e
cd "$(dirname "$0")"
antes=$(git rev-parse --short HEAD)
git pull --ff-only
depois=$(git rev-parse --short HEAD)
if [ "$antes" = "$depois" ]; then
  echo "Já estava na versão mais recente ($depois)."
  exit 0
fi
echo "Alterações de $antes para $depois:"
git log --oneline "$antes..$depois"
if [ -n "$(docker compose ps -q app 2>/dev/null)" ]; then
  echo "Cópia de segurança antes de atualizar..."
  docker compose exec -T app node src/cli.js backup
fi
docker compose up -d --build
docker image prune -f >/dev/null
echo "Atualizado para $depois."
