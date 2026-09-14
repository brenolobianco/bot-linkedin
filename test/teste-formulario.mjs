// Teste offline: roda o preenchimento contra um formulário falso no estilo do LinkedIn.
// Uso: node test/teste-formulario.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import config from '../config.js';

// Histórico e pendentes do teste vão para arquivos temporários, não para os seus CSVs
process.env.BOT_ARQ_PENDENTES = path.join(os.tmpdir(), 'teste-perguntas-pendentes.csv');
process.env.BOT_ARQ_HISTORICO = path.join(os.tmpdir(), 'teste-candidaturas.csv');
const { preencherCampos, preencherFormulario, escolherOpcao, urlBusca, ordenacoes, tituloEEmpresa, motivoParaIgnorar, foraDaJanela, resumoDeHoje } =
  await import('../src/bot.js');

// O teste usa respostas e filtros próprios, independentes do que você preencheu no config.js
config.filtros = { tituloNaoPodeConter: ['java', 'sr', 'head'], tituloDeveConter: [], empresasBloqueadas: [] };
config.respostas = [
  { contem: ['patrocinio', 'sponsorship', 'visto', 'visa'], resposta: 'Não' },
  { contem: ['ingles', 'english'], resposta: ['Avançado', 'Sim'] },
];
config.padroes = { anosExperiencia: '2', simNao: 'Sim' };

const HTML = `
<div class="jobs-easy-apply-modal" role="dialog">
  <button aria-label="Fechar">x</button>
  <form>
    <div class="fb-dash-form-element">
      <label for="anos"><span aria-hidden="true">Quantos anos de experiência você tem com JavaScript?</span><span class="visually-hidden">Quantos anos de experiência você tem com JavaScript?</span></label>
      <input id="anos-numeric" type="text">
    </div>
    <div class="fb-dash-form-element">
      <label for="tempo">Há quanto tempo atua com desenvolvimento em Java?</label>
      <input id="tempo" type="text">
    </div>
    <div class="fb-dash-form-element">
      <label for="ingles">Qual seu nível de inglês?</label>
      <select id="ingles"><option>Selecione uma opção</option><option>Básico</option><option>Avançado</option></select>
    </div>
    <div class="fb-dash-form-element">
      <label for="english">What is your English level?</label>
      <select id="english"><option>Select an option</option><option>Basic</option><option>Advanced</option></select>
    </div>
    <fieldset>
      <legend>Você fala inglês avançado?</legend>
      <input type="radio" id="i1" name="i"><label for="i1">Sim</label>
      <input type="radio" id="i2" name="i"><label for="i2">Não</label>
    </fieldset>
    <fieldset>
      <legend><span aria-hidden="true">Do you require visa sponsorship?</span><span class="visually-hidden">Do you require visa sponsorship?</span></legend>
      <input type="radio" id="r1" name="v"><label for="r1">Yes</label>
      <input type="radio" id="r2" name="v"><label for="r2">No</label>
    </fieldset>
    <fieldset>
      <legend>Você possui CNH?</legend>
      <input type="radio" id="c1" name="c"><label for="c1">Sim</label>
      <input type="radio" id="c2" name="c"><label for="c2">Não</label>
    </fieldset>
    <fieldset>
      <legend>Declaro que li os termos e consinto com o tratamento dos meus dados pessoais.</legend>
      <input type="radio" id="t1" name="t"><label for="t1">Não concordo</label>
      <input type="radio" id="t2" name="t"><label for="t2">Li e concordo</label>
    </fieldset>
    <div class="fb-dash-form-element">
      <label for="cor">Qual sua cor favorita?</label>
      <input id="cor" type="text">
    </div>
    <input type="checkbox" id="termos"><label for="termos">Li e concordo com a política de privacidade</label>
    <input type="checkbox" id="follow-company-checkbox" checked><label for="follow-company-checkbox">Seguir empresa</label>
  </form>
  <footer><button class="artdeco-button--secondary">Voltar</button><button class="artdeco-button--primary" id="prox">Avançar</button></footer>
</div>
<script>
  document.getElementById('prox').onclick = e => {
    e.preventDefault();
    const cor = document.getElementById('cor');
    if (!cor.value && !document.querySelector('.artdeco-inline-feedback--error')) {
      cor.insertAdjacentHTML('afterend', '<div class="artdeco-inline-feedback--error">Obrigatório</div>');
    }
  };
</script>`;

const b = await chromium.launch({ channel: 'msedge', headless: true });
const page = await b.newPage();
await page.setContent(HTML);
const modal = page.locator('.jobs-easy-apply-modal');

const pendentes = await preencherCampos(page, modal);
const marcado = nome => page.evaluate(n => document.querySelector(`input[name=${n}]:checked`)?.nextElementSibling.textContent, nome);
const estado = {
  ...await page.evaluate(() => ({
    anos: document.getElementById('anos-numeric').value,
    tempo: document.getElementById('tempo').value,
    ingles: document.getElementById('ingles').value,
    english: document.getElementById('english').value,
    termos: document.getElementById('termos').checked,
  })),
  inglesSimNao: await marcado('i'),
  visto: await marcado('v'),
  cnh: await marcado('c'),
  aceite: await marcado('t'),
};
console.log('estado:', estado);
console.log('perguntas sem resposta:', pendentes);

const checar = (nome, ok) => { console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}`); if (!ok) process.exitCode = 1; };
checar('anos de experiência = padrão (2)', estado.anos === '2');
checar('"há quanto tempo atua" = padrão de anos (2)', estado.tempo === '2');
checar('inglês (lista em português) -> Avançado', estado.ingles === 'Avançado');
checar('inglês (lista em inglês) -> Advanced', estado.english === 'Advanced');
checar('inglês Sim/Não -> Sim (2ª alternativa da lista)', estado.inglesSimNao === 'Sim');
checar('visto -> No (sinônimo de Não)', estado.visto === 'No');
checar('CNH -> Sim (padrão Sim/Não)', estado.cnh === 'Sim');
checar('termos com opções -> "Li e concordo", não "Não concordo"', estado.aceite === 'Li e concordo');
checar('caixa de termos marcada', estado.termos === true);
checar('só a pergunta desconhecida ficou pendente', pendentes.length === 1 && pendentes[0] === 'Qual sua cor favorita?');
checar('escolherOpcao Fluente/Avançado', escolherOpcao(['Básico', 'Avançado (C1)'], 'Avançado') === 'Avançado (C1)');
checar('escolherOpcao lista de alternativas', escolherOpcao(['Yes', 'No'], ['Avançado', 'Sim']) === 'Yes');
checar('escolherOpcao Conversacional -> Conversational', escolherOpcao(['None', 'Conversational', 'Professional'], ['Intermediário', 'Conversacional', 'Sim']) === 'Conversational');
checar('urlBusca filtra Easy Apply', urlBusca('dev', 1).includes('f_AL=true') && urlBusca('dev', 1).includes('start=25'));
checar('ordenação: recentes -> sortBy=DD, relevância -> sortBy=R, padrão -> DD',
  urlBusca('dev', 0, 'recentes').includes('sortBy=DD') && urlBusca('dev', 0, 'relevancia').includes('sortBy=R')
  && urlBusca('dev', 0).includes('sortBy=DD'));
config.busca.ordenacao = ['relevancia', 'inexistente'];
checar('ordenacoes() descarta valor inválido do config', JSON.stringify(ordenacoes()) === '["relevancia"]');
config.busca.ordenacao = [];
checar('ordenacoes() vazio volta para recentes', JSON.stringify(ordenacoes()) === '["recentes"]');
await page.evaluate(() => { document.title = '(3) 🚀 Lead Dev (.NET | Angular) | Luxoft | LinkedIn'; });
const aba = await tituloEEmpresa(page);
checar('título e empresa lidos do título da aba', aba.titulo === '🚀 Lead Dev (.NET | Angular)' && aba.empresa === 'Luxoft');
const pula = titulo => Boolean(motivoParaIgnorar({ titulo, empresa: '' }));
checar('filtro por palavra inteira: "java" pula Java, não JavaScript', pula('Desenvolvedor(a) Full Stack Java Pleno') && !pula('Desenvolvedor JavaScript'));
checar('filtro por palavra inteira: "sr" pega "Pl/Sr", "head" não pega "Headless"', pula('Dev React Pl/Sr') && !pula('Headless CMS Frontend'));

const hora = (h, m) => new Date(2026, 0, 1, h, m);
checar('janela 09:00-22:00: 08:59 e 22:01 fora; 09:00 e 22:00 dentro',
  foraDaJanela('09:00-22:00', hora(8, 59)) && foraDaJanela('09:00-22:00', hora(22, 1))
  && !foraDaJanela('09:00-22:00', hora(9, 0)) && !foraDaJanela('09:00-22:00', hora(22, 0)));
checar('sem --janela: roda a qualquer hora', !foraDaJanela(null, hora(3, 0)));

const hojeBR = new Date().toLocaleString('pt-BR'), ontemBR = new Date(Date.now() - 864e5).toLocaleString('pt-BR');
fs.writeFileSync(process.env.BOT_ARQ_HISTORICO, [
  '"data";"id";"titulo";"empresa";"status";"detalhe";"url"',
  `"${hojeBR}";"1";"A";"X";"enviada";"";""`,
  `"${hojeBR}";"2";"B";"X";"enviada";"";""`,
  `"${hojeBR}";"3";"C";"X";"simulada";"";""`,
  `"${ontemBR}";"4";"D";"X";"enviada";"";""`,
  `"${ontemBR}";"5";"E";"X";"limite";"";""`,
].join('\n') + '\n');
const resumo = resumoDeHoje();
checar('teto do dia conta só as enviadas de hoje', resumo.enviadas === 2 && resumo.limite === false);
fs.appendFileSync(process.env.BOT_ARQ_HISTORICO, `"${hojeBR}";"6";"F";"X";"limite";"";""\n`);
checar('aviso de limite do LinkedIn hoje é detectado', resumoDeHoje().limite === true);

// Etapa travada por pergunta obrigatória: deve descartar e marcar como pendente
const r = await preencherFormulario(page, modal, { id: 'teste', titulo: 'Teste', empresa: 'Teste' });
console.log('resultado do formulário:', r);
checar('formulário travado vira pendente só com a pergunta que deu erro', r.status === 'pendente' && r.detalhe === 'Qual sua cor favorita?');

// ---------- modo chute: perguntas que antes viravam pendente ----------
// Perguntas reais tiradas do log de uma execução (o erro de digitação "comapny" é do anúncio).
config.padroes = {
  anosExperiencia: '2', simNao: 'Sim', numero: '2', textoLivre: 'N/A', chutarOpcao: true,
  preferenciaOpcoes: ['Sim', 'Yes', 'Concordo', 'Agree', 'Intermediário', 'Intermediate'],
  naoChutar: ['pretensao', 'salario', 'fluent english'],
};
const page2 = await b.newPage();
await page2.setContent(`
<div class="jobs-easy-apply-modal" role="dialog">
  <form>
    <fieldset>
      <legend>Which best describes you?</legend>
      <input type="radio" id="w1" name="w"><label for="w1">Individual developer</label>
      <input type="radio" id="w2" name="w"><label for="w2">Company</label>
    </fieldset>
    <fieldset>
      <legend>Would you be interested in non-exclusive licensing?</legend>
      <input type="radio" id="n1" name="n"><label for="n1">No</label>
      <input type="radio" id="n2" name="n"><label for="n2">Yes</label>
    </fieldset>
    <fieldset>
      <legend>¿Esta de acuerdo en la prestación de servicios a plazo fijo de 3 meses?</legend>
      <input type="radio" id="e1" name="e"><label for="e1">No</label>
      <input type="radio" id="e2" name="e"><label for="e2">Sí</label>
    </fieldset>
    <fieldset>
      <legend>Qual sua pretensão salarial?</legend>
      <input type="radio" id="s1" name="s"><label for="s1">Até R$ 3.000</label>
      <input type="radio" id="s2" name="s"><label for="s2">R$ 7.000 a R$ 9.000</label>
    </fieldset>
    <div class="fb-dash-form-element">
      <label for="lic">If a comapny, please write the comapny name that will license the code.</label>
      <input id="lic" type="text">
    </div>
    <div class="fb-dash-form-element">
      <label for="qtd">Quantos projetos você entregou?</label>
      <input id="qtd-numeric" type="text">
    </div>
  </form>
</div>`);
const modal2 = page2.locator('.jobs-easy-apply-modal');
const pendentes2 = await preencherCampos(page2, modal2);
const marcado2 = nome => page2.evaluate(n => document.querySelector(`input[name=${n}]:checked`)?.nextElementSibling.textContent, nome);
const estado2 = {
  ...await page2.evaluate(() => ({ lic: document.getElementById('lic').value, qtd: document.getElementById('qtd-numeric').value })),
  quemEhVoce: await marcado2('w'), licenciamento: await marcado2('n'), salario: await marcado2('s'),
  espanhol: await marcado2('e'),
};
console.log('estado (modo chute):', estado2);
console.log('perguntas sem resposta (modo chute):', pendentes2);
checar('opção sem regra -> 1ª opção em vez de pendente', estado2.quemEhVoce === 'Individual developer');
checar('Yes/No sem regra -> Yes (padrão Sim/Não)', estado2.licenciamento === 'Yes');
checar('texto livre sem regra -> padroes.textoLivre', estado2.lic === 'N/A');
checar('campo -numeric sem regra -> padroes.numero', estado2.qtd === '2');
checar('lista em espanhol: Sí conta como Sim/Não', estado2.espanhol === 'Sí');
checar('pergunta de naoChutar continua pendente e em branco', !estado2.salario && pendentes2.includes('Qual sua pretensão salarial?'));
checar('só a pergunta protegida ficou pendente', pendentes2.length === 1);

await b.close();
