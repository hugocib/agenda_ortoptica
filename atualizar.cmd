@echo off
rem Atualiza a app para a última versão do repositório e reconstrói os contentores.
rem Uso: duplo clique em atualizar.cmd, ou "atualizar" na Linha de comandos, na pasta do projeto.
rem Antes de reconstruir faz uma cópia de segurança da base de dados. O .env e os dados não são tocados.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
for /f %%i in ('git rev-parse --short HEAD') do set ANTES=%%i
git pull --ff-only || goto erro
for /f %%i in ('git rev-parse --short HEAD') do set DEPOIS=%%i
if "%ANTES%"=="%DEPOIS%" (
  echo Já estava na versão mais recente ^(%DEPOIS%^).
  goto fim
)
echo Alterações de %ANTES% para %DEPOIS%:
git log --oneline %ANTES%..%DEPOIS%
set APP=
for /f %%i in ('docker compose ps -q app 2^>nul') do set APP=%%i
if defined APP (
  echo Cópia de segurança antes de atualizar...
  docker compose exec -T app node src/cli.js backup || goto erro
)
docker compose up -d --build || goto erro
docker image prune -f >nul
echo Atualizado para %DEPOIS%.
goto fim
:erro
echo.
echo A atualização parou por causa de um erro (ver acima). A versão anterior continua a correr.
:fim
echo.
pause
