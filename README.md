# Bot de Candidatura Simplificada — LinkedIn

Busca vagas com **Candidatura Simplificada** (Easy Apply), preenche os formulários com as respostas
que você configurar e envia. Usa o navegador instalado no seu PC (Edge, Chrome ou Chrome Dev, via Playwright).

Também procura **recrutadores de tecnologia** e manda convite de conexão **sem nota** — veja a seção
"Conexões com recrutadores" mais abaixo.

## Instalação (uma vez)

```powershell
cd C:\Users\Cliente\linkedin-easy-apply
npm install
```

## Uso

1. **Edite o `config.js`**: termos de busca, localização, filtros e, principalmente, a lista `respostas`
   com seus dados (telefone, cidade, pretensão salarial, inglês...). Resposta vazia = o bot não inventa nada.
2. **Teste em modo simulação** (preenche tudo mas descarta antes de enviar):
   ```powershell
   npm run simular
   ```
   Antes, na primeira vez, rode `npm run login`: abre o navegador normal (sem automação) com o perfil do
   bot. Entre no LinkedIn (pode usar "Continuar com o Google") e feche a janela quando o feed aparecer.
   A sessão fica salva em `perfil-navegador/`, então nas próximas vezes o login já está feito. O bot nunca
   vê sua senha. (Na janela do bot o login com Google é bloqueado — por isso o `npm run login`.)
3. **Veja o `perguntas_pendentes.csv`**: são as perguntas que o bot não soube responder. Adicione regras
   em `respostas` e rode de novo.
4. **Envie de verdade**:
   ```powershell
   npm run enviar
   ```

## Rodar automaticamente (Agendador de Tarefas do Windows)

Depois que a simulação estiver dando certo e o login estiver salvo:

```powershell
npm run agendar                              # todo dia das 08:00 às 22:00, de hora em hora (+ até 10 min aleatórios), enviando
npm run agendar -- -Inicio 09:00 -Fim 20:00 -IntervaloMin 90    # outro horário/frequência
npm run agendar -- -Simular                  # agenda em modo simulação, para testar
npm run desagendar                           # remove o agendamento
```

- A execução agendada usa `--automatico`: se a sessão do LinkedIn expirar, o bot **não fica esperando** —
  encerra e escreve o erro no log. Aí é só rodar `npm run login` e entrar de novo.
- Tudo que o bot faz fica em `logs/AAAA-MM-DD.log`. Dê uma olhada de vez em quando.
- Fora da janela de horário o bot não roda (nem se o PC ligar tarde e o Windows disparar uma execução
  atrasada), e para de enviar ao atingir `limites.maxCandidaturasPorDia`, somando todas as execuções do dia.
- O PC precisa estar ligado **ou em suspensão/hibernação** (a tarefa acorda o PC), com seu usuário logado
  no Windows (pode estar com a tela bloqueada). Desligado não: a execução perdida roda quando o PC ligar,
  se ainda estiver dentro do horário.
- Para rodar na hora e acompanhar, dê dois cliques em **`Bot de vagas.cmd`** (candidaturas) ou
  **`Bot de recrutadores.cmd`** (convites). Cada um abre um terminal com o andamento e o navegador
  visível. Se já houver um bot rodando — qualquer um dos dois —, a janela só mostra o log ao vivo
  (duas execuções ao mesmo tempo não são possíveis: usam o mesmo perfil do navegador).

## Como as respostas funcionam

Para cada pergunta, o bot procura **na ordem** a primeira regra em `respostas` cujo `contem` aparece no
texto da pergunta (sem diferenciar maiúsculas e acentos):

```js
{ contem: ['pretensao salarial', 'salary'], resposta: '6000' },
{ contem: ['react'], resposta: '3' },   // "Quantos anos de experiência com React?"
```

- Serve para campos de texto, listas e botões de opção. `'Sim'`/`'Não'` também casam com `Yes`/`No`.
- Nas listas, a resposta precisa ser igual (ou estar contida) em uma das opções, ex.: `'Avançado'`.
  Níveis em português também casam com o equivalente em inglês (`'Avançado'` escolhe `Advanced`,
  `'Conversacional'` escolhe `Conversational`).
- A resposta pode ser uma **lista de alternativas**: o bot usa a primeira que existir entre as opções
  (campos de texto usam a primeira). Ex.: `resposta: ['Intermediário', 'Conversacional', 'Sim']` responde
  "Intermediário" numa lista de níveis e "Sim" em "Você fala inglês?".
- Sem regra: perguntas de "quantos anos de experiência" usam `padroes.anosExperiencia`, e perguntas
  Sim/Não usam `padroes.simNao`. Coloque regras específicas (ex.: visto/patrocínio → Não) **antes**.
- Currículo: o LinkedIn reaproveita o último currículo enviado. Faça uma candidatura manual antes
  para deixá-lo selecionado.
- `pausarEmPerguntasDesconhecidas: true` faz o bot parar e esperar você responder no navegador.

## Conexões com recrutadores

Busca pessoas no LinkedIn pelos termos de `config.js > conexoes.termos` e manda convite **sem nota**
(clica em "Conectar" e depois em "Enviar sem nota").

```powershell
npm run conectar                 # respeita o modoSimulacao do config.js
npm run conectar -- --simular    # abre o convite e cancela, sem enviar nada
npm run conectar -- --enviar     # envia os convites de verdade
```

É um bot **separado** do de vagas: rodar um não roda o outro, e um erro aqui não atrapalha suas
candidaturas. Como os dois usam a mesma pasta `perfil-navegador/`, eles nunca rodam ao mesmo tempo —
se você abrir um com o outro em execução, a janela mostra o log ao vivo em vez de abrir um segundo
navegador. O agendamento (`npm run agendar`) cuida **só das vagas**; os convites são sempre manuais.

- Só convida quem tem o botão **Conectar** no resultado da busca e cujo **cargo** casa com
  `cargoDeveConter` — a linha que aparece embaixo do nome. Quem não casa vai para o `conexoes.csv`
  como `pulado`, com o motivo.
- Perfis de **3º grau** quase sempre exigem nota ou o e-mail da pessoa, e aí o convite sem nota não sai.
  Por isso o padrão é `apenasSegundoGrau: true`. Quando o LinkedIn pede e-mail, o bot cancela e anota.
- **Convite é mais arriscado que candidatura.** O LinkedIn corta em torno de **100–200 convites por
  semana** e convite recusado/ignorado demais derruba sua taxa. Está **sem teto diário**
  (`maxPorDia: null`), com `maxPorExecucao: 5` e pausa de 25–70s entre convites. Mesmo sem teto seu,
  o bot encerra sozinho se o **próprio LinkedIn** avisar que o limite dele foi atingido.
- Convites já enviados não se repetem. Se você mudar o `cargoDeveConter`, quem tinha sido pulado por
  filtro volta a ser avaliado (igual às vagas).

## Arquivos gerados

| Arquivo | Conteúdo |
|---|---|
| `candidaturas.csv` | Histórico: enviada, simulada, pendente, ignorada, erro. Abre no Excel. |
| `perguntas_pendentes.csv` | Perguntas que impediram uma candidatura. |
| `conexoes.csv` | Convites a recrutadores: convidado, simulado, pulado, erro. |
| `perfil-navegador/` | Sessão do navegador (seu login). Não compartilhe. |

Vagas com status `enviada` ou `ignorada` não são visitadas de novo — exceto as ignoradas por filtro de
título/empresa que o `config.js` atual já não barra (se você mudar os filtros, elas voltam a ser avaliadas). Apague o `candidaturas.csv` para zerar.

## Avisos

- **Automação viola os Termos de Uso do LinkedIn** e pode levar a restrição da conta. Para reduzir o
  risco: mantenha as pausas aleatórias, não passe de ~25–50 candidaturas por dia e não rode o tempo todo.
- O LinkedIn muda o HTML com frequência. Se o bot parar de achar botões ou campos, os seletores ficam
  em `src/bot.js` (constantes `SEL_*` e funções `processarVaga` / `botaoPrincipal`).
- Candidatura em massa sem critério costuma dar pouco resultado: use os filtros de título e as
  palavras-chave para focar em vagas que realmente combinam com você.
# bot-linkedin
