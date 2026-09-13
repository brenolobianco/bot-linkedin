# Agenda o bot no Agendador de Tarefas do Windows: todo dia, de hora em hora, dentro de uma janela de horario.
# Uso (dentro da pasta do projeto):
#   npm run agendar                                         -> todo dia das 08:00 as 22:00, a cada 60 min, ENVIANDO
#   npm run agendar -- -Inicio 08:00 -Fim 20:00 -IntervaloMin 90
#   npm run agendar -- -Simular                             -> agenda em modo simulacao (para testar)
#   npm run desagendar                                      -> remove o agendamento
# Quantas candidaturas por execucao e por dia: config.js > limites.
param(
  [string]$Inicio = '08:00',
  [string]$Fim = '22:00',
  [int]$IntervaloMin = 60,
  [switch]$Simular,
  [switch]$Remover
)
$ErrorActionPreference = 'Stop'
$nome = 'LinkedIn Easy Apply'

if ($Remover) {
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false
  Write-Host "Agendamento '$nome' removido."
  return
}

$pasta = $PSScriptRoot
$node = (Get-Command node).Source
$modo = if ($Simular) { '--simular' } else { '--enviar' }
$cultura = [Globalization.CultureInfo]::InvariantCulture
$duracao = [datetime]::ParseExact($Fim, 'HH:mm', $cultura) - [datetime]::ParseExact($Inicio, 'HH:mm', $cultura)
if ($duracao.TotalMinutes -le 0) { throw "O fim ($Fim) precisa ser depois do inicio ($Inicio)." }

# --janela: o bot nao roda fora desse horario, mesmo que o Windows dispare uma execucao perdida
$acao = New-ScheduledTaskAction -Execute $node -Argument "`"$pasta\src\bot.js`" $modo --automatico --janela $Inicio-$Fim" -WorkingDirectory $pasta
# Todo dia no inicio, repetindo a cada IntervaloMin ate o fim (+1 min para incluir o horario final)
$gatilho = New-ScheduledTaskTrigger -Daily -At $Inicio
$gatilho.Repetition = (New-ScheduledTaskTrigger -Once -At $Inicio -RepetitionInterval (New-TimeSpan -Minutes $IntervaloMin) `
  -RepetitionDuration ($duracao + (New-TimeSpan -Minutes 1))).Repetition
# StartWhenAvailable: se o PC estava desligado no horario, roda assim que possivel (o bot confere a janela).
# IgnoreNew: nao abre uma segunda execucao se a anterior ainda estiver rodando.
# WakeToRun: tira o PC da suspensao/hibernacao para rodar (desligado, nao).
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# Interactive: roda so com o seu usuario logado no Windows (o navegador abre com janela).
$usuario = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $opcoes -Principal $usuario -Force | Out-Null

$proxima = (Get-ScheduledTaskInfo -TaskName $nome).NextRunTime
Write-Host "Agendado: '$nome' ($modo) todo dia das $Inicio as $Fim, a cada $IntervaloMin min."
Write-Host "Proxima execucao: $proxima"
Write-Host "Tetos por execucao e por dia: config.js > limites. Logs em: $pasta\logs"
