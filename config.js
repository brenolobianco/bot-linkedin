// Configuração do bot de Candidatura Simplificada do LinkedIn.
// Depois de editar, rode:
//   npm run simular   -> percorre os formulários mas DESCARTA no final (teste seguro)
//   npm run enviar    -> envia as candidaturas de verdade

export default {
  // true = nunca envia (descarta no último passo). "npm run enviar" ignora este valor.
  modoSimulacao: true,

  // 'msedge' (Microsoft Edge), 'chrome' (Google Chrome) ou 'chrome-dev' (Google Chrome Dev)
  navegador: 'chrome-dev',

  busca: {
    // Cada termo vira uma busca separada no LinkedIn
    palavrasChave: ['desenvolvedor javascript', 'desenvolvedor pleno', 'desenvolvedor front-end', 'desenvolvedor front end', 'desenvolvedor web',
      'desenvolvedor python', 'desenvolvedor odoo', 'desenvolvedor php', 'desenvolvedor laravel', 'desenvolvedor node',
      'desenvolvedor react'],
    localizacao: 'Brasil',
    // '24h' | 'semana' | 'mes' | null (qualquer data)
    periodo: 'semana',
    // Qualquer combinação de: 'remoto', 'hibrido', 'presencial'. Vazio = todas.
    modalidade: ['remoto'],
    // Qualquer combinação de: 'estagio', 'assistente', 'junior', 'pleno_senior', 'diretor', 'executivo'. Vazio = todos.
    nivel: [],
    // Páginas de resultado por termo (25 vagas por página)
    maxPaginas: 3,
  },

  filtros: {
    // Pula a vaga se o título contiver alguma destas PALAVRAS INTEIRAS (sem diferenciar maiúsculas/acentos):
    // 'java' pula "Desenvolvedor Java" mas não "JavaScript"
    tituloNaoPodeConter: ['senior', 'sr', 'lead', 'gerente', 'manager', 'head', 'principal', 'staff', 'especialista',
      // fora da stack
      'java', 'kotlin', 'ruby', 'rails', '.net', 'c#', 'data scientist', 'cientista de dados',
      // plataformas/legado que os títulos genéricos ("Developer", "Software Engineer") trouxeram junto
      'cobol', 'mainframe', 'abap', 'sap', 'power bi', 'power apps', 'outsystems', 'apex', 'kernel',
      'android', 'ios', 'flutter', 'salesforce', 'devops', 'sre',
      // inglês conversacional
      'fluente', 'fluent'],
    // Se preenchido, só se candidata se o título contiver pelo menos uma destas
    tituloDeveConter: ['front', 'javascript', 'react', 'web', 'full stack', 'full-stack', 'fullstack', 'node', 'typescript',
      'angular', 'vue', 'python', 'django', 'odoo', 'next', 'php', 'laravel', 'nest',
      // títulos genéricos de desenvolvimento (sem stack no nome): "Desenvolvedor Pleno", "Software Engineer"
      'desenvolvedor', 'desenvolvedora', 'developer', 'programador', 'programadora',
      'software engineer', 'engenheiro de software', 'engenheira de software', 'backend', 'back-end', 'back end'],
    empresasBloqueadas: [],
  },

  limites: {
    // Rodando de hora em hora (8h–22h): poucas por execução espalham as candidaturas ao longo do dia
    maxCandidaturasPorExecucao: 20,
    // Teto do dia (só as enviadas de verdade). Volume alto faz o LinkedIn restringir a conta: fique entre 25 e 50.
    maxCandidaturasPorDia: 40,
    // Pausa aleatória entre candidaturas, em segundos [mínimo, máximo]
    pausaEntreCandidaturasSeg: [20, 60],
  },

  // Convites de conexão para recrutadores de tecnologia, SEM nota.
  // Bot SEPARADO do de vagas: rode por "Bot de recrutadores.cmd" ou "npm run conectar".
  // (Os dois nunca rodam ao mesmo tempo: compartilham a mesma pasta de perfil do navegador.)
  conexoes: {
    // Cada termo vira uma busca de PESSOAS no LinkedIn
    termos: ['tech recruiter', 'recrutador de tecnologia', 'talent acquisition tech', 'it recruiter',
      'recrutamento e seleção ti', 'tech talent'],
    // Código da região no LinkedIn: 106057199 = Brasil. '' = qualquer lugar.
    geoUrn: '106057199',
    // Só 2º grau: perfis de 3º grau costumam exigir nota ou o e-mail da pessoa, aí o convite sem nota não sai
    apenasSegundoGrau: true,
    maxPaginas: 3,
    // Quantos convites por execução (cada dois cliques no "Bot de recrutadores.cmd")
    maxPorExecucao: 5,
    // null = SEM teto diário. O freio do próprio LinkedIn continua valendo: se ele avisar que o
    // limite dele foi atingido, o bot encerra sozinho (status "limite") e não tenta mais hoje.
    // Convite é mais arriscado que candidatura — o LinkedIn corta em torno de 100-200 por SEMANA.
    maxPorDia: null,
    pausaEntreConvitesSeg: [25, 70],
    // Só convida se o cargo (a linha embaixo do nome) contiver alguma destas
    cargoDeveConter: ['recruit', 'recrutad', 'recrutamento', 'talent', 'headhunter', 'hunter',
      'r&s', 'people', 'recursos humanos', 'human resources'],
    // Ex.: 'estágio', 'aposentado' — ou cargos de outras áreas que passarem pelo filtro acima
    cargoNaoPodeConter: [],
  },

  // A execução agendada abre o navegador fora da tela, para não aparecer por cima do seu trabalho
  esconderJanelaNoAgendamento: true,

  // Desmarca "Seguir empresa" antes de enviar
  naoSeguirEmpresa: true,

  // false = se aparecer uma pergunta sem resposta configurada, descarta a vaga e anota a
  //         pergunta em perguntas_pendentes.csv (100% automático).
  // true  = pausa, você responde na janela do navegador e aperta ENTER no terminal.
  pausarEmPerguntasDesconhecidas: false,

  // Respostas de último recurso, usadas SÓ quando nenhuma regra de "respostas" casa com a pergunta.
  // São o que evita que a vaga vire "pendente" por causa de uma pergunta que você nunca viu antes.
  padroes: {
    // Usado em "Quantos anos de experiência você tem com X?"
    anosExperiencia: '2',
    // Usado em perguntas Sim/Não. '' = não responder (vira pendente)
    simNao: 'Sim',
    // Qualquer outro campo numérico (o LinkedIn marca esses campos com id terminado em "-numeric")
    numero: '2',
    // Qualquer outro campo de texto livre. '' = não responder (vira pendente)
    textoLivre: 'N/A',
    // true = em listas e botões de opção sem regra, escolhe uma opção em vez de deixar pendente.
    // false = comportamento antigo (só responde o que você configurou).
    chutarOpcao: true,
    // Ordem de preferência ao chutar. Se nenhuma existir na lista, fica com a PRIMEIRA opção.
    preferenciaOpcoes: ['Sim', 'Yes', 'Concordo', 'Agree', 'Intermediário', 'Intermediate'],
    // Perguntas que o bot NUNCA chuta (nem texto livre, nem opção): ficam pendentes de propósito,
    // porque um chute aqui é mentira ou compromisso — responda você mesmo na janela do navegador.
    naoChutar: [
      'ingles avancado', 'ingles fluente', 'fluencia em ingles', 'advanced english', 'fluent english',
      'english fluency', 'native speaker',
      'pretensao', 'salario', 'remuneracao', 'expectativa', 'salary', 'compensation',
      'pcd', 'deficiencia', 'disability', 'genero', 'gender', 'raca', 'etnia', 'race', 'ethnicity',
      'cpf', 'rg ', 'cnpj', 'data de nascimento', 'date of birth',
    ],
  },

  // Caixas de seleção cujo texto contém alguma destas palavras são marcadas (termos, consentimento...)
  marcarCaixasQueContem: ['concordo', 'aceito', 'declaro', 'agree', 'accept', 'acknowledge', 'consent'],

  // Respostas para as perguntas dos formulários.
  // O bot procura, NA ORDEM, a primeira regra cujo "contem" aparece no texto da pergunta.
  // Serve para campos de texto, listas (select) e botões de opção. "Sim"/"Não" casam com "Yes"/"No".
  // Resposta vazia ('') = o bot não responde e a vaga vira pendente — preencha com seus dados!
  respostas: [
    // --- dados pessoais (PREENCHA) ---
    // O LinkedIn pede o código do país numa lista separada ("Phone country code" também contém "phone", por isso vem antes)
    { contem: ['codigo do pais', 'country code'], resposta: '(+55)' },
    { contem: ['celular', 'telefone', 'phone', 'mobile'], resposta: '16997642652' },
    { contem: ['cidade', 'city', 'localizacao', 'location'], resposta: 'Ribeirão Preto' },
    { contem: ['perfil do linkedin', 'linkedin profile', 'linkedin url'], resposta: 'https://www.linkedin.com/in/breno-lobianco' },
    // PREENCHA: sem isto, perguntas de e-mail viram pendente (o bot não chuta e-mail)
    { contem: ['e-mail', 'email', 'correio eletronico'], resposta: '' },
    { contem: ['current company', 'current employer', 'empresa atual', 'empresa em que trabalha', 'empresa em que voce trabalha',
      'company where you work'], resposta: 'Clickideia' },
    { contem: ['portfolio', 'github', 'website', 'site pessoal'], resposta: '' },
    // Valor por hora = 7000 ÷ 160 h (vem antes da regra de salário)
    { contem: ['valor/hora', 'valor hora', 'valor por hora', 'por hora', 'hourly', 'per hour'], resposta: '44' },
    // Mesmo valor para CLT e PJ
    { contem: ['pretensao salarial', 'expectativa salarial', 'remuneracao', 'salario', 'salary', 'compensation'], resposta: '7000' },
    // Inglês conversacional: perguntas que EXIGEM avançado/fluente/C1+ -> Não (antes da regra geral de inglês)
    { contem: ['ingles avancado', 'ingles fluente', 'fluencia em ingles', 'ingles nativo', 'ingles c1', 'c1/c2', 'c1 ou c2',
      'advanced english', 'fluent english', 'english fluency', 'native english', 'native speaker', 'english c1', 'c1 or c2'], resposta: 'Não' },
    // Lista = alternativas, na ordem: listas de nível ("Intermediário" ou "Conversational"); em Sim/Não ("Você fala inglês?"), "Sim"
    { contem: ['ingles', 'english'], resposta: ['Intermediário', 'Conversacional', 'Sim'] },
    { contem: ['espanhol', 'spanish'], resposta: 'básico' },
    { contem: ['carta de apresentacao', 'cover letter', 'mensagem ao recrutador'], resposta: '' },

    // --- anos de experiência com tecnologias específicas (antes da regra genérica) ---
    // { contem: ['react'], resposta: '3' },
    // { contem: ['python'], resposta: '2' },

    // --- perguntas comuns ---
    { contem: ['patrocinio', 'sponsorship', 'visto', 'visa'], resposta: 'Não' },
    { contem: ['autorizado a trabalhar', 'autorizacao para trabalhar', 'authorized to work', 'legally authorized', 'work authorization'], resposta: 'Sim' },
    { contem: ['located in brazil', 'based in brazil', 'live in brazil', 'reside no brasil', 'mora no brasil'], resposta: 'Sim' },
    { contem: ['how did you hear', 'como ficou sabendo', 'como soube'], resposta: 'LinkedIn' },
    { contem: ['disponibilidade para inicio', 'quando pode comecar', 'notice period', 'aviso previo', 'start date'], resposta: 'Imediata' },
    { contem: ['nivel de escolaridade', 'formacao academica', 'ensino superior', "bachelor", 'degree'], resposta: 'Sim' },
  ],
};
