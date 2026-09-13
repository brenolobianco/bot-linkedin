// Teste offline do bot de conexões: lê um HTML falso no estilo do LinkedIn e confere os filtros.
// Não abre o LinkedIn nem envia convite nenhum.
// Uso: node test/teste-conexoes.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import config from '../config.js';

// O histórico do teste vai para um arquivo temporário, não para o seu conexoes.csv
process.env.BOT_ARQ_CONEXOES = path.join(os.tmpdir(), 'teste-conexoes.csv');
const { urlBuscaPessoas, motivoParaPular, perfisParaPular, convitesDeHoje, extrairPerfis, lerPerfil,
  indiceDoConviteClicavel } = await import('../src/conectar.js');

// O teste usa filtros próprios, independentes do que você preencheu no config.js
config.conexoes = {
  ...config.conexoes,
  geoUrn: '106057199',
  apenasSegundoGrau: true,
  cargoDeveConter: ['recruit', 'recrutad', 'talent'],
  cargoNaoPodeConter: ['estagi'],
};

const checar = (nome, ok) => { console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}`); if (!ok) process.exitCode = 1; };

// --- busca ---
const url = urlBuscaPessoas('tech recruiter', 1);
checar('urlBuscaPessoas: termo, página e região', url.includes('keywords=tech+recruiter') && url.includes('page=2') && url.includes('106057199'));
checar('urlBuscaPessoas: filtra 2º grau', decodeURIComponent(url).includes('network=["S"]'));

// --- filtro de cargo ---
checar('cargo de recrutador passa', motivoParaPular({ cargo: 'Tech Recruiter na Acme' }) === null);
checar('cargo em português passa', motivoParaPular({ cargo: 'Recrutadora de Tecnologia' }) === null);
checar('cargo de dev é pulado', motivoParaPular({ cargo: 'Desenvolvedor Full Stack' }) !== null);
checar('cargo vazio é pulado (sem cargo não dá para filtrar)', motivoParaPular({ cargo: '' }) === 'cargo não identificado');
checar('cargoNaoPodeConter vence o cargoDeveConter', motivoParaPular({ cargo: 'Estagiária de Talent Acquisition' }) === 'cargo contém "estagi"');

// --- histórico ---
const historico = [
  { perfil: 'https://www.linkedin.com/in/ja-convidada', cargo: 'Tech Recruiter', status: 'convidado', detalhe: '' },
  { perfil: 'https://www.linkedin.com/in/pediu-email', cargo: 'Tech Recruiter', status: 'pulado', detalhe: 'o LinkedIn exigiu o e-mail da pessoa' },
  { perfil: 'https://www.linkedin.com/in/dev-qualquer', cargo: 'Desenvolvedor Java', status: 'pulado', detalhe: 'cargo sem nenhuma palavra obrigatória' },
  { perfil: 'https://www.linkedin.com/in/virou-recrutadora', cargo: 'Talent Acquisition', status: 'pulado', detalhe: 'cargo sem nenhuma palavra obrigatória' },
  { perfil: 'https://www.linkedin.com/in/deu-erro', cargo: 'Tech Recruiter', status: 'erro', detalhe: 'janela do convite não abriu' },
  { perfil: 'https://www.linkedin.com/in/so-simulado', cargo: 'Tech Recruiter', status: 'simulado', detalhe: 'modo simulação' },
];
const pular = perfisParaPular(historico);
checar('não convida quem já foi convidado', pular.has('https://www.linkedin.com/in/ja-convidada'));
checar('não tenta de novo quem exigiu e-mail', pular.has('https://www.linkedin.com/in/pediu-email'));
checar('continua pulando quem o filtro atual ainda barra', pular.has('https://www.linkedin.com/in/dev-qualquer'));
checar('reavalia quem o filtro atual já não barra', !pular.has('https://www.linkedin.com/in/virou-recrutadora'));
checar('erro é falha passageira: tenta de novo', !pular.has('https://www.linkedin.com/in/deu-erro'));
checar('simulado não conta como convidado', !pular.has('https://www.linkedin.com/in/so-simulado'));

const hojeBR = new Date().toLocaleString('pt-BR'), ontemBR = new Date(Date.now() - 864e5).toLocaleString('pt-BR');
const comData = [
  { data: hojeBR, status: 'convidado' }, { data: hojeBR, status: 'convidado' },
  { data: hojeBR, status: 'pulado' }, { data: ontemBR, status: 'convidado' },
];
checar('teto do dia conta só os convites de hoje', convitesDeHoje(comData).convidados === 2);
checar('aviso de limite do LinkedIn hoje é detectado', convitesDeHoje([...comData, { data: hojeBR, status: 'limite' }]).limite === true);

// Mesmo navegador do outro teste: usa o Edge do PC, sem baixar o Chromium do Playwright
const navegador = await chromium.launch({ channel: 'msedge', headless: true });
const page = await navegador.newPage();

// --- links de perfil na página de busca ---
// Reproduz o que o LinkedIn entrega hoje: cartão inteiro é um <a>, classes ofuscadas,
// nome e foto apontando para o mesmo perfil, e links de "conexões em comum" no meio.
await page.setContent(`
<main>
  <div class="_4a74b613">
    <a class="ec6af1f0" href="https://www.linkedin.com/in/ana-recrutadora/"><img alt=""></a>
    <a class="_07f3436c" href="https://www.linkedin.com/in/ana-recrutadora/?miniProfile=urn%3Ali">Ana Souza</a>
    <a href="https://www.linkedin.com/in/amigo-em-comum/">Fulano e mais 22 conexões em comum</a>
  </div>
  <div class="_4a74b613">
    <a class="ec6af1f0" href="/in/bruno-dev"><img alt=""></a>
    <a class="_07f3436c" href="/in/bruno-dev">Bruno Lima</a>
  </div>
  <a href="https://www.linkedin.com/company/acme/">Acme</a>
  <a href="https://www.linkedin.com/in/ana-recrutadora/detail/contact-info/">Dados de contato</a>
</main>`);
const perfis = await extrairPerfis(page);
console.log('perfis lidos:', perfis);
checar('colhe os links de perfil da busca', perfis.includes('https://www.linkedin.com/in/ana-recrutadora'));
checar('deduplica foto e nome do mesmo perfil', perfis.filter(p => p.endsWith('/ana-recrutadora')).length === 1);
checar('normaliza href relativo para URL absoluta', perfis.includes('https://www.linkedin.com/in/bruno-dev'));
checar('descarta links que não são de perfil', !perfis.some(p => p.includes('/company/') || p.includes('contact-info')));
checar('traz também as conexões em comum (a triagem é no perfil)', perfis.includes('https://www.linkedin.com/in/amigo-em-comum'));

// --- leitura da página de perfil ---
await page.setContent(`
<title>Ana Souza | LinkedIn</title>
<main>
  <div>Ana Souza</div>
  <div>• 2º</div>
  <div>Tech Recruiter na Acme</div>
  <div>São Paulo, Brasil</div>
  <a aria-label="Convidar Ana Souza para se conectar" href="#">Conectar</a>
</main>`);
const perfilAna = await lerPerfil(page);
console.log('perfil lido:', perfilAna);
checar('nome vem do título da aba', perfilAna.nome === 'Ana Souza');
checar('cargo é a linha abaixo do nome, pulando o grau', perfilAna.cargo === 'Tech Recruiter na Acme');
checar('grau de conexão é lido', perfilAna.grau === 2);
checar('o controle Conectar é encontrado (é <a>, não <button>)',
  await page.locator('a[aria-label^="Convidar"], button[aria-label^="Convidar"]').count() === 1);

// --- escolha do controle "Conectar" clicável ---
// Reproduz a página real: um controle no cabeçalho fixo (coberto), o bom no cartão do topo,
// e um de tamanho zero. Só o do meio pode ser clicado.
await page.setContent(`
<title>Teste | LinkedIn</title>
<body style="margin:0">
  <div style="position:relative;height:48px">
    <a aria-label="Convidar Coberto para se conectar" style="position:absolute;left:0;top:0;width:100px;height:48px">Conectar</a>
    <div style="position:absolute;left:0;top:0;width:100px;height:48px;background:#f00"></div>
  </div>
  <a aria-label="Convidar Bom para se conectar" style="display:block;width:100px;height:48px">Conectar</a>
  <a aria-label="Convidar Zero para se conectar" style="display:block;width:0;height:0;overflow:hidden"></a>
</body>`);
const iBom = await indiceDoConviteClicavel(page);
console.log('indice do controle clicavel:', iBom);
checar('ignora o controle coberto por outro elemento e escolhe o clicável', iBom === 1);
checar('o escolhido é mesmo o do cartão (aria-label "Bom")',
  (await page.locator('a[aria-label^="Convidar"]').nth(iBom).getAttribute('aria-label')) === 'Convidar Bom para se conectar');

await page.setContent(`<body style="margin:0">
  <div style="position:relative;height:48px">
    <a aria-label="Convidar So Coberto para se conectar" style="position:absolute;left:0;top:0;width:100px;height:48px">Conectar</a>
    <div style="position:absolute;left:0;top:0;width:100px;height:48px;background:#f00"></div>
  </div></body>`);
checar('sem nenhum controle clicável, devolve -1', (await indiceDoConviteClicavel(page)) === -1);

// Perfil de 1º grau: já conectado, não deve ser convidado
await page.setContent(`
<title>Carlos Mendes | LinkedIn</title>
<main><div>Carlos Mendes</div><div>• 1º</div><div>Tech Recruiter</div></main>`);
const perfil1g = await lerPerfil(page);
checar('1º grau é reconhecido (já é conexão)', perfil1g.grau === 1);

// O selo "está contratando" não pode virar o cargo
await page.setContent(`
<title>Dora Lima | LinkedIn</title>
<main><div>Dora Lima</div><div>está contratando</div><div>• 2º</div><div>Talent Acquisition</div></main>`);
checar('selo "está contratando" não é confundido com o cargo', (await lerPerfil(page)).cargo === 'Talent Acquisition');

await navegador.close();
try { fs.unlinkSync(process.env.BOT_ARQ_CONEXOES); } catch {}
