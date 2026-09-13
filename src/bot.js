import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQ_HISTORICO = process.env.BOT_ARQ_HISTORICO || path.join(RAIZ, 'candidaturas.csv'); // o teste usa outro arquivo
const ARQ_PENDENTES = process.env.BOT_ARQ_PENDENTES || path.join(RAIZ, 'perguntas_pendentes.csv'); // o teste usa outro arquivo
const PASTA_PERFIL = path.join(RAIZ, 'perfil-navegador');
const PASTA_LOGS = path.join(RAIZ, 'logs');
const ARQ_TRAVA = path.join(RAIZ, '.bot-rodando'); // PID da execução em andamento

const args = process.argv.slice(2);
const SIMULAR = args.includes('--simular') || (config.modoSimulacao && !args.includes('--enviar'));
// --automatico: execução agendada, sem ninguém olhando. Nunca espera login nem ENTER no terminal.
const AUTOMATICO = args.includes('--automatico');

const SEL_MODAL = '.jobs-easy-apply-modal, div[role="dialog"]';
const SEL_ERRO = '.artdeco-inline-feedback--error';
const SEL_GRUPO = '.fb-dash-form-element, .jobs-easy-apply-form-element, .jobs-easy-apply-form-section__grouping';
const PLACEHOLDER = /selecion|select an option|escolha uma/i;
const PERGUNTA_ANOS = /quantos anos|anos de experiencia|tempo de experiencia|quanto tempo (atua|trabalha|tem|possui)|how many years|years of (work )?experience/;
const NEGACAO = /\b(nao|no|not|discordo|disagree)\b|don'?t/;
// Cada termo casa com o seu par em português/inglês ("Avançado" escolhe "Advanced")
const SINONIMOS = Object.fromEntries([
  ['sim', 'yes'], ['nao', 'no'], ['basico', 'basic'], ['intermediario', 'intermediate'],
  ['avancado', 'advanced'], ['fluente', 'fluent'], ['nativo', 'native'], ['conversacional', 'conversational'],
].flatMap(par => par.map(p => [p, par])));

// ---------- utilitários ----------

const norm = (s = '') => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const esperar = (min, max = min) => new Promise(r => setTimeout(r, (min + Math.random() * (max - min)) * 1000));
// Escreve no terminal e em logs/AAAA-MM-DD.log
function log(...a) {
  const linha = `[${new Date().toLocaleTimeString('pt-BR')}] ${a.join(' ')}`;
  console.log(linha);
  try {
    fs.mkdirSync(PASTA_LOGS, { recursive: true });
    fs.appendFileSync(path.join(PASTA_LOGS, `${new Date().toLocaleDateString('sv-SE')}.log`), linha + '\n');
  } catch {}
}
const visivel = loc => loc.isVisible().catch(() => false);

async function primeiroVisivel(loc) {
  for (const el of await loc.all()) if (await visivel(el)) return el;
  return null;
}

async function textoDe(page, seletor) {
  try { return (await page.locator(seletor).first().innerText({ timeout: 3000 })).trim(); } catch { return ''; }
}

async function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(texto);
  rl.close();
  return r.trim().toLowerCase();
}

const csvLinha = campos => campos.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';') + '\n';

function anexarCsv(arquivo, cabecalho, campos) {
  if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, '\uFEFF' + csvLinha(cabecalho));
  fs.appendFileSync(arquivo, csvLinha(campos));
}

// Linhas do candidaturas.csv como objetos
function lerHistorico() {
  if (!fs.existsSync(ARQ_HISTORICO)) return [];
  return fs.readFileSync(ARQ_HISTORICO, 'utf8').split('\n').slice(1).filter(l => l.trim()).map(linha => {
    const c = linha.split('";"').map(x => x.replace(/^\uFEFF?"|"\s*$/g, ''));
    const [data, id, titulo, empresa, status, detalhe = ''] = c;
    return { data, id, titulo, empresa, status, detalhe };
  });
}

const hoje = () => new Date().toLocaleDateString('pt-BR');

// Não visita de novo: vagas enviadas; na execução agendada, pendentes/erros de hoje (tenta de novo amanhã,
// em vez de reabrir o formulário a cada execução); ignoradas, exceto as barradas por filtro de
// título/empresa que o config.js atual já não barra (os filtros mudaram).
function idsParaPular(historico) {
  const ids = new Set();
  for (const { data, id, titulo, empresa, status, detalhe } of historico) {
    const porFiltro = /^(título|empresa bloqueada)/.test(detalhe);
    const tentouHoje = AUTOMATICO && ['pendente', 'erro'].includes(status) && data.startsWith(hoje());
    if (status === 'enviada' || tentouHoje || (status === 'ignorada' && (!porFiltro || motivoParaIgnorar({ titulo, empresa })))) ids.add(id);
  }
  return ids;
}

const registrar = r => anexarCsv(ARQ_HISTORICO,
  ['data', 'id', 'titulo', 'empresa', 'status', 'detalhe', 'url'],
  [new Date().toLocaleString('pt-BR'), r.id, r.titulo, r.empresa, r.status, r.detalhe, r.url]);

const registrarPendentes = (vaga, perguntas) => perguntas.forEach(p => anexarCsv(ARQ_PENDENTES,
  ['data', 'id', 'titulo', 'empresa', 'pergunta'],
  [new Date().toLocaleString('pt-BR'), vaga.id, vaga.titulo, vaga.empresa, p]));

// ---------- respostas ----------

function buscarResposta(pergunta) {
  const p = norm(pergunta);
  const regra = config.respostas.find(r => r.contem.some(k => p.includes(norm(k))));
  return regra ? regra.resposta : null;
}

function respostaPara(pergunta, opcoes) {
  const r = buscarResposta(pergunta);
  if (r != null) return r;
  const ehSimNao = opcoes.length > 0 && opcoes.every(o => ['sim', 'nao', 'yes', 'no'].includes(norm(o)));
  if (ehSimNao) return config.padroes.simNao;
  // Termos/consentimento com opções como "Li e concordo": escolhe a de concordância
  const aceite = t => config.marcarCaixasQueContem.some(k => norm(t).includes(norm(k)));
  return aceite(pergunta) ? opcoes.find(o => aceite(o) && !NEGACAO.test(norm(o))) ?? null : null;
}

// resposta pode ser uma lista de alternativas: usa a primeira que existir entre as opções
function escolherOpcao(opcoes, resposta) {
  if (Array.isArray(resposta)) return resposta.map(r => escolherOpcao(opcoes, r)).find(Boolean) ?? null;
  if (!resposta) return null;
  const alvos = SINONIMOS[norm(resposta)] || [norm(resposta)];
  return opcoes.find(o => alvos.includes(norm(o)))
    ?? opcoes.find(o => alvos.some(a => a.length >= 3 && norm(o).includes(a)))
    ?? null;
}

// Texto da pergunta associada a um campo (label, legend do fieldset, aria-label...)
function rotulo(loc) {
  return loc.evaluate((e, selGrupo) => {
    const texto = n => {
      if (!n) return '';
      const oculto = n.querySelector?.('span[aria-hidden="true"]');
      const base = oculto && oculto.innerText.trim().length > 2 ? oculto : n;
      let s = (base.innerText || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
      const m = s.length / 2;
      if (s.length > 1 && s.length % 2 === 0 && s.slice(0, m) === s.slice(m)) s = s.slice(0, m);
      return s.replace(/\s*\*\s*$/, '').trim();
    };
    if (e.tagName === 'FIELDSET') return texto(e.querySelector('legend')) || texto(e);
    if (e.id) {
      const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
      if (l && texto(l)) return texto(l);
    }
    if (e.getAttribute('aria-label')) return e.getAttribute('aria-label').trim();
    const fs = e.closest('fieldset');
    if (fs) return texto(fs.querySelector('legend'));
    return texto(e.closest(selGrupo));
  }, SEL_GRUPO).catch(() => '');
}

async function marcar(input) {
  try { await input.check({ force: true, timeout: 3000 }); }
  catch { await input.evaluate(e => (e.labels?.[0] || e).click()).catch(() => {}); }
}

// Preenche o que for possível na etapa atual. Devolve as perguntas que ficaram sem resposta.
async function preencherCampos(page, modal) {
  const naoRespondidas = [];

  const camposTexto = modal.locator('input[type="text"], input[type="number"], input[type="tel"], input[type="email"], input[type="url"], input:not([type]), textarea');
  for (const campo of await camposTexto.all()) {
    if (!(await visivel(campo))) continue;
    if ((await campo.inputValue().catch(() => 'x')).trim()) continue;
    const pergunta = await rotulo(campo);
    let resposta = [buscarResposta(pergunta)].flat()[0]; // lista de alternativas: campo de texto usa a primeira
    if (resposta == null && PERGUNTA_ANOS.test(norm(pergunta))) resposta = config.padroes.anosExperiencia;
    if (!resposta) { naoRespondidas.push(pergunta); continue; }
    await campo.fill(String(resposta));
    await esperar(0.8, 1.5);
    // Campos com autocompletar (ex.: cidade) exigem escolher uma sugestão
    const sugestao = page.locator('[role="listbox"] [role="option"], .basic-typeahead__selectable').first();
    if (await visivel(sugestao)) await sugestao.click().catch(() => {});
  }

  for (const sel of await modal.locator('select').all()) {
    if (!(await visivel(sel))) continue;
    const { indice, opcoes } = await sel.evaluate(s => ({ indice: s.selectedIndex, opcoes: [...s.options].map(o => o.text.trim()) }));
    if (indice >= 0 && !PLACEHOLDER.test(opcoes[indice] || '')) continue;
    const pergunta = await rotulo(sel);
    const validas = opcoes.filter(o => !PLACEHOLDER.test(o));
    const escolha = escolherOpcao(validas, respostaPara(pergunta, validas));
    if (!escolha) { naoRespondidas.push(pergunta); continue; }
    await sel.selectOption({ index: opcoes.indexOf(escolha) });
  }

  for (const grupo of await modal.locator('fieldset').all()) {
    const radios = grupo.locator('input[type="radio"]');
    const qtd = await radios.count();
    if (!qtd || await grupo.locator('input[type="radio"]:checked').count()) continue;
    if (!(await visivel(grupo))) continue;
    const pergunta = await rotulo(grupo);
    const opcoes = [];
    for (let i = 0; i < qtd; i++) opcoes.push(await rotulo(radios.nth(i)));
    const escolha = escolherOpcao(opcoes, respostaPara(pergunta, opcoes));
    if (!escolha) { naoRespondidas.push(pergunta); continue; }
    await marcar(radios.nth(opcoes.indexOf(escolha)));
  }

  for (const caixa of await modal.locator('input[type="checkbox"]').all()) {
    const id = (await caixa.getAttribute('id')) || '';
    if (/follow-company/i.test(id) || await caixa.isChecked().catch(() => true)) continue;
    const grupo = caixa.locator('xpath=ancestor::fieldset[1]');
    const texto = norm(`${await rotulo(caixa)} ${(await grupo.count()) ? await rotulo(grupo) : ''}`);
    if (config.marcarCaixasQueContem.some(k => texto.includes(norm(k)))) await marcar(caixa);
  }

  return [...new Set(naoRespondidas.filter(Boolean))];
}

// ---------- formulário ----------

const perguntasComErro = modal => modal.evaluate((m, [selErro, selGrupo]) =>
  [...m.querySelectorAll(selErro)].filter(e => e.offsetParent !== null).map(err => {
    const g = err.closest(selGrupo) || err.closest('fieldset') || err.parentElement?.parentElement;
    const l = g?.querySelector('legend, label');
    return ((l || g)?.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '(pergunta sem rótulo)';
  }), [SEL_ERRO, SEL_GRUPO]).catch(() => []);

async function botaoPrincipal(modal) {
  const candidatos = modal.locator('footer button, button.artdeco-button--primary')
    .filter({ hasText: /avan[cç]ar|pr[oó]xim|continuar|next|continue|revis|review|enviar|submit/i });
  const visiveis = [];
  for (const b of await candidatos.all()) if (await visivel(b)) visiveis.push(b);
  return visiveis.at(-1) ?? null;
}

async function limiteAtingido(page) {
  const textos = norm((await page.locator('div[role="dialog"], [role="alert"], .artdeco-toast-item').allInnerTexts().catch(() => [])).join(' '));
  return /(limite|limit).{0,60}(candidatura|application|apply)|(candidatura|application|apply).{0,60}(limite|limit)/.test(textos);
}

async function descartar(page) {
  const fechar = await primeiroVisivel(page.locator('button[aria-label="Fechar"], button[aria-label="Dismiss"], button[data-test-modal-close-btn]'));
  if (fechar) await fechar.click().catch(() => {});
  else await page.keyboard.press('Escape');
  await esperar(1, 1.5);
  const confirmar = await primeiroVisivel(page.locator('button').filter({ hasText: /^\s*(descartar|discard)\s*$/i }));
  if (confirmar) await confirmar.click().catch(() => {});
  await esperar(1, 1.5);
}

async function desmarcarSeguirEmpresa(modal) {
  if (!config.naoSeguirEmpresa) return;
  const caixa = modal.locator('#follow-company-checkbox, input[id*="follow-company"]').first();
  if (await caixa.count() && await caixa.isChecked().catch(() => false)) {
    await caixa.uncheck({ force: true, timeout: 3000 })
      .catch(() => caixa.evaluate(e => (e.labels?.[0] || e).click()))
      .catch(() => {});
  }
}

async function preencherFormulario(page, modal, vaga) {
  for (let etapa = 0; etapa < 20; etapa++) {
    await esperar(1, 2);
    const naoRespondidas = await preencherCampos(page, modal);
    const botao = await botaoPrincipal(modal);
    if (!botao) throw new Error('botão de avançar/enviar não encontrado');
    const textoBotao = norm((await botao.innerText().catch(() => '')) || (await botao.getAttribute('aria-label')) || '');

    if (/enviar|submit/.test(textoBotao)) {
      await desmarcarSeguirEmpresa(modal);
      if (SIMULAR) {
        await descartar(page);
        return { status: 'simulada', detalhe: 'chegou até o botão de envio (modo simulação)' };
      }
      await botao.click();
      await esperar(2.5, 4);
      if (await limiteAtingido(page)) return { status: 'limite', detalhe: 'limite de candidaturas simplificadas atingido' };
      const erros = await perguntasComErro(modal);
      if (erros.length) {
        registrarPendentes(vaga, erros);
        await descartar(page);
        return { status: 'pendente', detalhe: erros.join(' | ') };
      }
      const textos = norm((await page.locator('div[role="dialog"], [role="alert"], .artdeco-toast-item').allInnerTexts().catch(() => [])).join(' '));
      const confirmada = /candidatura (foi )?enviada|enviamos sua candidatura|application (was )?sent/.test(textos);
      const fechar = await primeiroVisivel(page.locator('button[aria-label="Fechar"], button[aria-label="Dismiss"]'));
      if (fechar) await fechar.click().catch(() => {});
      return { status: 'enviada', detalhe: confirmada ? '' : 'envio clicado, mas confirmação não detectada' };
    }

    const antes = await modal.innerText().catch(() => '');
    await botao.click();
    await esperar(1.5, 2.5);
    const erros = await perguntasComErro(modal);
    const travou = erros.length > 0 || (await modal.innerText().catch(() => '')) === antes;
    if (!travou) continue;

    const perguntas = erros.length ? erros : (naoRespondidas.length ? naoRespondidas : ['(não foi possível avançar)']);
    if (config.pausarEmPerguntasDesconhecidas && !AUTOMATICO) {
      log('Perguntas sem resposta configurada:');
      perguntas.forEach(p => console.log(`   - ${p}`));
      const r = await perguntar('   Responda na janela do navegador e aperte ENTER aqui (ou digite "p" para pular a vaga): ');
      if (r !== 'p') continue;
    }
    registrarPendentes(vaga, perguntas);
    await descartar(page);
    return { status: 'pendente', detalhe: perguntas.join(' | ') };
  }
  await descartar(page);
  return { status: 'erro', detalhe: 'formulário com etapas demais' };
}

// ---------- busca e vagas ----------

function urlBusca(palavra, pagina) {
  const { localizacao, periodo, modalidade = [], nivel = [] } = config.busca;
  const p = new URLSearchParams({ keywords: palavra, location: localizacao, f_AL: 'true', sortBy: 'DD', start: String(pagina * 25) });
  const periodos = { '24h': 'r86400', semana: 'r604800', mes: 'r2592000' };
  const modalidades = { presencial: 1, remoto: 2, hibrido: 3 };
  const niveis = { estagio: 1, assistente: 2, junior: 3, pleno_senior: 4, diretor: 5, executivo: 6 };
  if (periodos[periodo]) p.set('f_TPR', periodos[periodo]);
  if (modalidade.length) p.set('f_WT', modalidade.map(m => modalidades[m]).filter(Boolean).join(','));
  if (nivel.length) p.set('f_E', nivel.map(n => niveis[n]).filter(Boolean).join(','));
  return `https://www.linkedin.com/jobs/search/?${p}`;
}

async function coletarVagas(page, palavra, pagina) {
  await page.goto(urlBusca(palavra, pagina), { waitUntil: 'domcontentloaded' });
  const achou = await page.waitForSelector('[data-occludable-job-id], [data-job-id]', { timeout: 15000 }).then(() => true).catch(() => false);
  if (!achou) return [];
  await esperar(2, 4);
  // Rola a lista de resultados para carregar todos os cards
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      let el = document.querySelector('[data-occludable-job-id], [data-job-id]')?.parentElement;
      while (el && el.scrollHeight <= el.clientHeight + 10) el = el.parentElement;
      (el || document.scrollingElement).scrollBy(0, 800);
    });
    await esperar(0.4, 0.9);
  }
  return page.evaluate(() => [...new Set(
    [...document.querySelectorAll('[data-occludable-job-id], [data-job-id]')]
      .map(e => e.getAttribute('data-occludable-job-id') || e.getAttribute('data-job-id'))
      .filter(id => /^\d+$/.test(id || '')),
  )]);
}

// Palavra inteira: 'java' não pega "javascript", 'sr' pega "Pl/Sr", 'head' não pega "headless"
const escaparRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const temPalavra = (texto, termo) => new RegExp('(^|[^a-z0-9])' + escaparRegex(norm(termo)) + '($|[^a-z0-9])').test(texto);

function motivoParaIgnorar({ titulo, empresa }) {
  const t = norm(titulo), e = norm(empresa);
  const { tituloDeveConter = [], tituloNaoPodeConter = [], empresasBloqueadas = [] } = config.filtros;
  const proibida = tituloNaoPodeConter.find(p => temPalavra(t, p));
  if (proibida) return `título contém "${proibida}"`;
  if (tituloDeveConter.length && !tituloDeveConter.some(p => t.includes(norm(p)))) return 'título sem nenhuma palavra obrigatória';
  const bloqueada = empresasBloqueadas.find(b => e.includes(norm(b)));
  if (bloqueada) return `empresa bloqueada (${bloqueada})`;
  return null;
}

// A página da vaga usa classes embaralhadas e não tem <h1>; o título da aba é estável: "Título | Empresa | LinkedIn"
async function tituloEEmpresa(page) {
  const partes = (await page.title().catch(() => '')).replace(/^\(\d+\+?\)\s*/, '').split(' | ').map(s => s.trim());
  if (partes.at(-1) === 'LinkedIn') partes.pop();
  const empresa = partes.length > 1 ? partes.pop() : '';
  return { titulo: partes.join(' | '), empresa };
}

async function processarVaga(page, id) {
  const vaga = { id, url: `https://www.linkedin.com/jobs/view/${id}/`, titulo: '', empresa: '' };
  await page.goto(vaga.url, { waitUntil: 'domcontentloaded' });
  await esperar(2.5, 4.5);
  const aba = await tituloEEmpresa(page);
  vaga.titulo = aba.titulo || await textoDe(page, '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1');
  vaga.empresa = aba.empresa || await textoDe(page, '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name');
  // Sem título os filtros não funcionam: melhor não se candidatar ("erro" = tenta de novo na próxima execução)
  if (!vaga.titulo) return { ...vaga, status: 'erro', detalhe: 'título da vaga não encontrado (filtros não aplicados)' };

  const motivo = motivoParaIgnorar(vaga);
  if (motivo) return { ...vaga, status: 'ignorada', detalhe: motivo };

  const botao = await primeiroVisivel(page.locator('button, a').filter({ hasText: /^\s*(candidatura simplificada|easy apply)\s*$/i }));
  if (!botao) return { ...vaga, status: 'ignorada', detalhe: 'sem candidatura simplificada (ou já candidatado)' };

  log(`Candidatando: ${vaga.titulo} | ${vaga.empresa}`);
  await botao.click();
  await esperar(1.5, 3);
  if (await limiteAtingido(page)) return { ...vaga, status: 'limite', detalhe: 'limite de candidaturas simplificadas atingido' };

  // Aviso de segurança que o LinkedIn às vezes mostra antes do formulário
  const aviso = await primeiroVisivel(page.locator('button').filter({ hasText: /continuar candidatura|continue applying/i }));
  if (aviso) { await aviso.click(); await esperar(1, 2); }

  const modal = page.locator(SEL_MODAL).filter({ visible: true }).first();
  const abriu = await modal.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  if (!abriu) return { ...vaga, status: 'erro', detalhe: 'formulário não abriu' };

  return { ...vaga, ...(await preencherFormulario(page, modal, vaga)) };
}

async function garantirLogin(page) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/feed')) {
    if (AUTOMATICO) throw new Error('Sessão do LinkedIn expirada. Rode "npm run login" e entre na sua conta.');
    log('Faça login no LinkedIn na janela que abriu, com e-mail e senha. O bot continua sozinho depois do login...');
    log('(O login com Google é bloqueado nesta janela. Para usar o Google, feche-a e rode "npm run login".)');
    await page.waitForURL(/linkedin\.com\/feed/, { timeout: 0 });
  }
  log('Login OK.');
}

// --janela 09:00-22:00: execução agendada fora desse horário não roda
// (o Windows pode disparar uma execução perdida quando o PC liga, ex.: às 7h ou às 23h)
const JANELA = args.includes('--janela') ? args[args.indexOf('--janela') + 1] : null;
function foraDaJanela(janela = JANELA, agora = new Date()) {
  if (!janela) return false;
  const [inicio, fim] = janela.split('-').map(h => { const [hh, mm = 0] = h.split(':').map(Number); return hh * 60 + mm; });
  const minuto = agora.getHours() * 60 + agora.getMinutes();
  return minuto < inicio || minuto > fim;
}

// Candidaturas enviadas hoje e se o LinkedIn já avisou do limite diário dele
function resumoDeHoje() {
  const dia = `"${new Date().toLocaleDateString('pt-BR')},`;
  const resumo = { enviadas: 0, limite: false };
  if (!fs.existsSync(ARQ_HISTORICO)) return resumo;
  for (const linha of fs.readFileSync(ARQ_HISTORICO, 'utf8').split('\n')) {
    if (!linha.startsWith(dia)) continue;
    const status = linha.split('";"')[4];
    if (status === 'enviada') resumo.enviadas++;
    if (status === 'limite') resumo.limite = true;
  }
  return resumo;
}

// Uma execução por vez, somando vagas e recrutadores: as duas usariam o mesmo perfil do navegador
// (ex.: "Bot de vagas.cmd" + agendamento, ou "Bot de recrutadores.cmd" rodando em paralelo)
function travar() {
  try { process.kill(Number(fs.readFileSync(ARQ_TRAVA, 'utf8')), 0); return false; } catch {} // PID vivo = outra execução
  fs.writeFileSync(ARQ_TRAVA, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(ARQ_TRAVA); } catch {} });
  return true;
}

// ---------- principal ----------

async function main() {
  log(SIMULAR
    ? 'MODO SIMULAÇÃO: preenche os formulários mas descarta antes de enviar. Use "npm run enviar" para valer.'
    : 'MODO REAL: as candidaturas serão ENVIADAS.');

  if (!travar()) { log('Outra execução do bot já está rodando. Nada a fazer.'); return; }
  // Checagens antes de abrir o navegador: execução sem nada a fazer termina sem abrir janela
  if (foraDaJanela()) { log(`Fora do horário (${JANELA}). Nada a fazer.`); return; }
  const resumo = resumoDeHoje();
  const maxDia = config.limites.maxCandidaturasPorDia ?? Infinity;
  if (!SIMULAR && resumo.limite) { log('O LinkedIn já avisou do limite de candidaturas hoje. Nada a fazer até amanhã.'); return; }
  if (!SIMULAR && resumo.enviadas >= maxDia) { log(`Teto do dia atingido (${resumo.enviadas}/${maxDia}). Nada a fazer até amanhã.`); return; }
  // Agendado: começa alguns minutos depois, para não rodar sempre no mesmo minuto
  if (AUTOMATICO) {
    const atraso = Math.round(Math.random() * 600);
    log(`Começando em ${Math.round(atraso / 60)} min (atraso aleatório). Enviadas hoje: ${resumo.enviadas}/${maxDia}.`);
    await esperar(atraso);
  }

  const historico = lerHistorico();

  // Na execução agendada a janela abre fora da tela, para não aparecer por cima do que você estiver fazendo
  const foraDaTela = AUTOMATICO && config.esconderJanelaNoAgendamento;
  const contexto = await chromium.launchPersistentContext(PASTA_PERFIL, {
    channel: config.navegador || 'msedge',
    headless: false,
    viewport: null,
    args: foraDaTela ? ['--window-position=-3000,-3000', '--window-size=1366,900'] : ['--start-maximized'],
  });
  const page = contexto.pages()[0] || await contexto.newPage();

  const contagem = {};
  try {
    await garantirLogin(page);
    const pular = idsParaPular(historico);
    const vistos = new Set();
    let candidaturas = 0;

    busca: for (const palavra of config.busca.palavrasChave) {
      for (let pagina = 0; pagina < config.busca.maxPaginas; pagina++) {
        const ids = await coletarVagas(page, palavra, pagina);
        log(`Busca "${palavra}", página ${pagina + 1}: ${ids.length} vagas`);
        if (!ids.length) break;

        for (const id of ids) {
          if (foraDaJanela()) { log('Passou do horário da janela. Encerrando.'); break busca; }
          if (vistos.has(id) || pular.has(id)) continue;
          vistos.add(id);

          let r;
          try {
            r = await processarVaga(page, id);
          } catch (erro) {
            await descartar(page).catch(() => {});
            r = { id, url: `https://www.linkedin.com/jobs/view/${id}/`, titulo: '', empresa: '', status: 'erro', detalhe: erro.message.split('\n')[0] };
          }
          registrar(r);
          contagem[r.status] = (contagem[r.status] || 0) + 1;
          // Ignoradas entram com o título junto: a linha "Candidatando:" só sai para as que passam nos filtros
          if (r.status === 'ignorada') log(`  -> ignorada: ${r.titulo} | ${r.empresa} (${r.detalhe})`);
          else log(`  -> ${r.status}${r.detalhe ? ` (${r.detalhe})` : ''}`);

          if (r.status === 'limite') { log('O LinkedIn bloqueou novas candidaturas por hoje. Encerrando.'); break busca; }
          if (r.status === 'enviada' || r.status === 'simulada') {
            if (r.status === 'enviada' && ++resumo.enviadas >= maxDia) { log(`Teto do dia atingido (${maxDia}).`); break busca; }
            if (++candidaturas >= config.limites.maxCandidaturasPorExecucao) { log('Limite de candidaturas desta execução atingido.'); break busca; }
            await esperar(...config.limites.pausaEntreCandidaturasSeg);
          }
        }
      }
    }
  } finally {
    log('Resumo:', Object.entries(contagem).map(([k, v]) => `${k}=${v}`).join(', ') || 'nenhuma vaga processada');
    if (contagem.pendente) log('Veja perguntas_pendentes.csv e adicione as respostas em config.js > respostas.');
    await contexto.close();
  }
}

export { preencherCampos, preencherFormulario, escolherOpcao, urlBusca, tituloEEmpresa, motivoParaIgnorar, lerHistorico, idsParaPular, foraDaJanela, resumoDeHoje, PASTA_PERFIL };

// Só executa quando chamado diretamente (permite importar as funções nos testes)
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch(erro => { log('ERRO:', erro.stack || erro); process.exit(1); });
}
