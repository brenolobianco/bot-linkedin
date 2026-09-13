@echo off
rem Bot de VAGAS: candidatura simplificada. Mostra o andamento nesta janela.
rem Nao abre um segundo bot se ja houver um rodando (vagas ou recrutadores usam o mesmo
rem perfil do navegador): nesse caso so mostra o log ao vivo.
title LinkedIn - Bot de vagas
chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*bot.js*' -or $_.CommandLine -like '*conectar.js*' }) { exit 1 }"
if errorlevel 1 goto acompanhar

echo ================================================
echo   BOT DE VAGAS - as candidaturas serao ENVIADAS
echo ================================================
echo Para parar, feche esta janela.
echo.
node src\bot.js --enviar
echo.
pause
exit /b

:acompanhar
echo Ja existe um bot rodando (vagas ou recrutadores).
echo Os dois usam o mesmo perfil do navegador, entao nao podem rodar juntos.
echo Mostrando o log ao vivo - fechar esta janela NAO para o bot.
echo.
powershell -NoProfile -Command "Get-Content -Path ('logs\' + (Get-Date -Format 'yyyy-MM-dd') + '.log') -Tail 30 -Wait -Encoding UTF8"
