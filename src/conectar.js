// Busca recrutadores de tecnologia no LinkedIn e envia convites de conexão SEM nota.
// Bot SEPARADO do de vagas (src/bot.js): nenhum dos dois chama o outro. Formas de rodar:
//   "Bot de recrutadores.cmd"     -> dois cliques, envia de verdade
//   npm run conectar              -> respeita config.modoSimulacao
//   npm run conectar -- --enviar  -> envia os convites de verdade
//   npm run conectar -- --simular -> abre o convite e cancela (teste seguro)
//
// POR QUE ABRIR CADA PERFIL, em vez de clicar "Conectar" na lista de resultados:
// a busca de pessoas do LinkedIn foi reescrita e os cartões não têm mais controle de conexão
// nenhum (93 elementos clicáveis na página, zero com "conectar/convidar"), além de usarem classes
// ofuscadas que mudam a cada deploy. Na página do perfil o controle existe e é estável:
//   <a aria-label="Convidar Fulano para se conectar">Conectar</a>
// Da busca só aproveitamos os links de perfil (href), que são URL e não dependem de classe.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import {
  RAIZ, norm, esperar, log, primeiroVisivel, anexarCsv, lerCsv, hoje,
  travar, foraDaJanela, abrirNavegador, garantirLogin,
} from './comum.js';

const ARQ_CONEXOES = process.env.BOT_ARQ_CONEXOES || path.join(RAIZ, 'conexoes.csv'); // o teste usa outro arquivo
const COLUNAS = ['data', 'perfil', 'nome', 'cargo', 'status', 'detalhe'];

const args = process.argv.slice(2);
const SIMULAR = args.includes('--simular') || (config.modoSimulacao && !args.includes('--enviar'));
const AUTOMATICO = args.includes('--automatico');
const JANELA = args.includes('--janela') ? args[args.indexOf('--janela') + 1] : null;

// O controle "Conectar" do perfil: <a> ou <button> cujo aria-label começa com Convidar/Invite
const SEL_CONVITE = 'a[aria-label^="Convidar"], button[aria-label^="Convidar"], a[aria-label^="Invite"], button[aria-label^="Invite"]';
// A janela do convite: o LinkedIn alterna entre marcações, então aceita as três
const SEL_MODAL = '[role="dialog"], [aria-modal="true"], .artdeco-modal';
const SEM_NOTA = /enviar sem nota|send without a note/i;
const SO_ENVIAR = /^\s*(enviar|send|enviar convite|send invitation)\s*$/i;
const PEDE_EMAIL = /e-?mail/i;
const LIMITE = /limite semanal|weekly invitation limit|atingiu o limite|reached the weekly|too many invitation/i;
const SO_PERFIL = /^https:\/\/www\.linkedin\.com\/in\/[^/?#]+$/;
// Quantas ações de convite a página disparou no perfil atual (zerado a cada perfil).
// Em simulação elas são abortadas; em modo real servem para parar a varredura na PRIMEIRA.
const acoesDeConvite = { n: 0 };

// ---------- busca ----------

export function urlBuscaPessoas(termo, pagina) {
  const { geoUrn, apenasSegundoGrau = true } = config.conexoes;
  const p = new URLSearchParams({ keywords: termo, origin: 'FACETED_SEARCH', page: String(pagina + 1) });
  // O LinkedIn espera esses dois como array JSON: geoUrn=["106057199"], network=["S"]
  if (geoUrn) p.set('geoUrn', `["${geoUrn}"]`);
  if (apenasSegundoGrau) p.set('network', '["S"]'); // S = 2º grau
  return `https://www.linkedin.com/search/results/people/?${p}`;
}

export function motivoParaPular({ cargo }) {
  const c = norm(cargo);
  const { cargoDeveConter = [], cargoNaoPodeConter = [] } = config.conexoes;
  if (!c) return 'cargo não identificado';
  const proibido = cargoNaoPodeConter.find(p => c.includes(norm(p)));
  if (proibido) return `cargo contém "${proibido}"`;
  if (cargoDeveConter.length && !cargoDeveConter.some(p => c.includes(norm(p)))) return 'cargo sem nenhuma palavra obrigatória';
  return null;
}

// Só os links de perfil da página de busca. Vêm junto os links de "conexões em comum" de cada
// cartão — não dá para separar pelo HTML (classes ofuscadas), então a triagem é feita no perfil.
export function extrairPerfis(page) {
  return page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/in/"]')]
    .map(a => {
      const href = a.getAttribute('href') || '';
      const absoluto = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
      return absoluto.split('?')[0].split('#')[0].replace(/\/$/, '');
    })
    .filter(u => /^https:\/\/www\.linkedin\.com\/in\/[^/?#]+$/.test(u)))]);
}

async function coletarPerfis(page, termo, pagina) {
  await page.goto(urlBuscaPessoas(termo, pagina), { waitUntil: 'domcontentloaded' });
  const achou = await page.waitForSelector('main', { timeout: 15000 }).then(() => true).catch(() => false);
  if (!achou) return [];
  await esperar(5, 8); // a lista é renderizada bem depois do "main" aparecer
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, 700));
    await esperar(0.4, 0.9);
  }
  return extrairPerfis(page);
}

// ---------- perfil ----------

// Nome, cargo (a linha logo abaixo do nome) e grau de conexão, sem depender de classe nenhuma
export function lerPerfil(page) {
  return page.evaluate(() => {
    const nome = (document.title || '').split(' | ')[0].replace(/^\(\d+\+?\)\s*/, '').trim();
    const grauEm = t => (/(^|[^0-9])1(º|°|st)([^0-9]|$)/.test(t) ? 1 : /(^|[^0-9])2(º|°|nd)([^0-9]|$)/.test(t) ? 2 : /(^|[^0-9])3(º|°|rd)([^0-9]|$)/.test(t) ? 3 : 0);
    const ruido = /^(•|·)?\s*(1|2|3)(º|°|st|nd|rd)?\+?\s*(grau|degree)?$/i;
    const topo = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 40);
    const iNome = topo.findIndex(l => nome && l.startsWith(nome));
    // Primeira linha útil depois do nome: pula o marcador de grau e o selo "está contratando"
    const cargo = topo.slice(iNome + 1).find(l => !ruido.test(l) && !/^(está contratando|is hiring)$/i.test(l)) || '';
    return { nome, cargo, grau: grauEm(topo.slice(iNome, iNome + 3).join(' ')) };
  });
}

async function fecharModal(page) {
  const fechar = await primeiroVisivel(page.locator('button[aria-label="Fechar"], button[aria-label="Dismiss"], button[aria-label="Cancelar"]'));
  if (fechar) await fechar.click().catch(() => {});
  else await page.keyboard.press('Escape');
  await esperar(0.8, 1.5);
}

// A página do perfil traz VÁRIOS controles "Conectar" iguais: o do cabeçalho fixo, o do cartão do
// topo e alguns de tamanho zero. O do cabeçalho fica SEMPRE coberto por outro elemento — o
// click() do Playwright se recusa a clicar nele e estoura timeout, e era nele que o bot batia.
// Em vez de adivinhar, pergunta ao navegador quem realmente recebe o clique no centro de cada um.
export function indiceDoConviteClicavel(page) {
  return page.evaluate(sel => {
    return [...document.querySelectorAll(sel)].findIndex(e => {
      const r = e.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) return false;                 // controles de tamanho zero
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return false; // fora da tela
      const noPonto = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!noPonto && (noPonto === e || e.contains(noPonto));    // coberto por outro = descartado
    });
  }, SEL_CONVITE);
}

// Dispara o clique no próprio elemento. Funciona mesmo quando o controle está coberto por outro
// ou fora da tela — os dois casos em que o click() do Playwright se recusa a agir. Comprovado:
// abre a janela do convite e o LinkedIn responde 200 na API.
const despachar = el => el.evaluate(e =>
  e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));

async function abrirJanelaDeConvite(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await esperar(0.8, 1.4);
  const modal = page.locator(SEL_MODAL).filter({ visible: true }).first();
  const abriu = () => modal.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);

  // 1) Clique de verdade, quando o navegador confirma que algum controle recebe o clique:
  //    é o caminho mais parecido com o de uma pessoa.
  const i = await indiceDoConviteClicavel(page);
  if (i >= 0) {
    await page.locator(SEL_CONVITE).nth(i).click({ timeout: 6000 }).catch(() => {});
    if (await abriu()) return modal;
  }
  // 2) Perfis variam: em alguns o controle bom nasce fora da tela (cartão mais alto por causa do
  //    selo "está contratando") ou sob outro elemento. Aí despacha o evento, candidato a candidato.
  //
  //    CUIDADO: o botão "Enviar sem nota" DENTRO da janela também casa com SEL_CONVITE. Despachar
  //    às cegas já enviou um convite real em modo simulação. Por isso, duas travas:
  //    (a) para o laço assim que qualquer janela estiver aberta;
  //    (b) nunca despacha em elemento que esteja dentro de uma janela.
  for (const candidato of await page.locator(SEL_CONVITE).all()) {
    if (await modal.isVisible().catch(() => false)) return modal;
    // A ação de convite já disparou (aqui ou no clique real acima): não aciona de novo
    if (acoesDeConvite.n) break;
    const dentroDaJanela = await candidato.evaluate((e, sel) => !!e.closest(sel), SEL_MODAL).catch(() => true);
    if (dentroDaJanela) continue;
    if (!(await despachar(candidato).then(() => true).catch(() => false))) continue;
    if (await abriu()) return modal;
  }
  return null;
}

// Abre o perfil, confere os filtros e manda o convite sem nota
async function visitarEConvidar(page, perfil) {
  await page.goto(perfil, { waitUntil: 'domcontentloaded' });
  await esperar(3, 5);
  const dados = await lerPerfil(page);
  const vaga = { perfil, nome: dados.nome, cargo: dados.cargo };

  if (dados.grau === 1) return { ...vaga, status: 'pulado', detalhe: 'já é conexão de 1º grau' };
  const motivo = motivoParaPular(dados);
  if (motivo) return { ...vaga, status: 'pulado', detalhe: motivo };

  const quantos = await page.locator(SEL_CONVITE).count();
  if (!quantos) return { ...vaga, status: 'pulado', detalhe: 'perfil sem opção de conectar (ou convite já enviado)' };

  log(`Conectando: ${dados.nome} | ${dados.cargo}`);
  acoesDeConvite.n = 0;
  const modal = await abrirJanelaDeConvite(page);
  if (!modal) {
    // Em alguns perfis a janela é montada por POST (SDUI). Em simulação o POST é abortado, então ela
    // não abre — e o próprio bloqueio vira a prova de que o clique acertou a ação de convite.
    if (SIMULAR && acoesDeConvite.n) {
      return { ...vaga, status: 'simulado', detalhe: `clique acionou o convite; ${acoesDeConvite.n} POST bloqueado(s) pela simulação` };
    }
    return { ...vaga, status: 'erro', detalhe: `janela do convite não abriu (${quantos} controles tentados)` };
  }
  await esperar(1, 1.8); // deixa o conteúdo da janela terminar de renderizar antes de ler os botões
  const texto = (await modal.innerText().catch(() => '')) || '';
  if (LIMITE.test(norm(texto))) { await fecharModal(page); return { ...vaga, status: 'limite', detalhe: 'limite de convites do LinkedIn atingido' }; }
  // Alguns perfis só aceitam convite com o e-mail da pessoa: aí não dá para enviar sem nota
  if (PEDE_EMAIL.test(texto) && await modal.locator('input[type="email"], input[name*="email"]').count()) {
    await fecharModal(page);
    return { ...vaga, status: 'pulado', detalhe: 'o LinkedIn exigiu o e-mail da pessoa' };
  }

  // Na simulação, anota o que o modal oferece: é assim que se confere o "Enviar sem nota" sem enviar
  if (SIMULAR) {
    const opcoes = (await modal.locator('button, a, [role="button"]').allInnerTexts().catch(() => []))
      .map(t => t.trim().split('\n')[0]).filter(Boolean);
    await fecharModal(page);
    const achou = opcoes.some(o => SEM_NOTA.test(o)) ? '' : ' [ATENÇÃO: "Enviar sem nota" NÃO encontrado]';
    return { ...vaga, status: 'simulado', detalhe: `modal abriu; opções: ${opcoes.join(' / ')}${achou}` };
  }

  // A UI nova mistura <a> e <button>: procura os dois
  const acoes = modal.locator('button, a, [role="button"]');
  const semNota = await primeiroVisivel(acoes.filter({ hasText: SEM_NOTA }));
  const enviar = semNota || await primeiroVisivel(acoes.filter({ hasText: SO_ENVIAR }));
  if (!enviar) { await fecharModal(page); return { ...vaga, status: 'erro', detalhe: 'botão "Enviar sem nota" não encontrado' }; }
  await enviar.click();
  await esperar(1.5, 2.5);

  const aviso = norm((await page.locator('div[role="dialog"], [role="alert"], .artdeco-toast-item').allInnerTexts().catch(() => [])).join(' '));
  if (LIMITE.test(aviso)) return { ...vaga, status: 'limite', detalhe: 'limite de convites do LinkedIn atingido' };
  return { ...vaga, status: 'convidado', detalhe: semNota ? '' : 'enviado pelo botão "Enviar" (sem opção de nota)' };
}

// ---------- histórico ----------

const registrar = r => anexarCsv(ARQ_CONEXOES, COLUNAS, [new Date().toLocaleString('pt-BR'), r.perfil, r.nome, r.cargo, r.status, r.detalhe]);

// Perfis que não devem ser visitados de novo: os já convidados, e os pulados por um filtro de cargo
// que o config.js atual CONTINUA barrando (mudou o filtro, eles voltam a ser avaliados).
// 'erro' e 'limite' ficam de fora de propósito: são falhas passageiras, a próxima execução tenta de novo.
export function perfisParaPular(historico) {
  const perfis = new Set();
  for (const { perfil, cargo, status, detalhe } of historico) {
    // Pulado por e-mail/1º grau/sem opção não é filtro de cargo: mudar o filtro não muda o resultado
    const aindaBarrado = /^cargo/.test(detalhe) ? Boolean(motivoParaPular({ cargo })) : true;
    if (status === 'convidado' || (status === 'pulado' && aindaBarrado)) perfis.add(perfil);
  }
  return perfis;
}

export function convitesDeHoje(historico) {
  const resumo = { convidados: 0, limite: false };
  for (const { data, status } of historico) {
    if (!data.startsWith(hoje())) continue;
    if (status === 'convidado') resumo.convidados++;
    if (status === 'limite') resumo.limite = true;
  }
  return resumo;
}

// ---------- principal ----------

// Recebe a página já logada (bot.js reaproveita a dele) e envia os convites.
export async function rodarConexoes(page, { simular = SIMULAR, janela = JANELA } = {}) {
  const cfg = config.conexoes;
  const historico = lerCsv(ARQ_CONEXOES, COLUNAS);
  const resumo = convitesDeHoje(historico);
  const maxDia = cfg.maxPorDia ?? Infinity;
  if (!simular && resumo.limite) { log('O LinkedIn já avisou do limite de convites hoje. Nada a fazer até amanhã.'); return {}; }
  if (!simular && resumo.convidados >= maxDia) { log(`Teto de convites do dia atingido (${resumo.convidados}/${maxDia}).`); return {}; }

  const teto = maxDia === Infinity ? 'sem teto diário' : maxDia;
  log(`Conexões: procurando recrutadores. Convites hoje: ${resumo.convidados} (${teto}).`);

  // Em simulação, TODO POST ao LinkedIn é abortado na camada de rede. Assim "simular" deixa de
  // depender de o código clicar no lugar certo: mesmo um clique errado não consegue enviar nada.
  // (Sem isso, uma varredura de cliques enviou um convite real com --simular em 11/09/2026.)
  // Predicado de hostname, não glob: um padrão que não casa viraria um bloqueio silenciosamente
  // inexistente — ou seja, falsa segurança.
  // A rota fica SEMPRE ativa. Em simulação aborta todo POST (enviar vira impossível); em modo real
  // apenas conta as ações de convite, para a varredura parar assim que uma disparar — sem depender
  // de a janela aparecer a tempo, que foi o que deixou 3 ações dispararem no mesmo perfil.
  await page.route(u => /(^|\.)linkedin\.com$/.test(u.hostname), rota => {
    if (rota.request().method() !== 'POST') return rota.continue();
    const url = rota.request().url();
    // Só conta o que parece ação de convite: a página dispara POSTs de telemetria o tempo todo,
    // e contá-los daria falso positivo de "o clique acertou".
    if (/rsc-action|invit|relationship/i.test(url)) {
      acoesDeConvite.n++;
      if (simular) log(`  (simulação) POST de convite bloqueado, nada enviado: ${url.slice(0, 80)}`);
    }
    return simular ? rota.abort() : rota.continue();
  });
  const pular = perfisParaPular(historico);
  const vistos = new Set();
  const contagem = {};
  let convites = 0;

  busca: for (const termo of cfg.termos) {
    for (let pagina = 0; pagina < (cfg.maxPaginas ?? 3); pagina++) {
      if (foraDaJanela(janela)) { log('Passou do horário da janela. Encerrando as conexões.'); break busca; }
      const perfis = await coletarPerfis(page, termo, pagina);
      log(`Conexões "${termo}", página ${pagina + 1}: ${perfis.length} perfis`);
      if (!perfis.length) break;

      for (const perfil of perfis) {
        if (vistos.has(perfil) || pular.has(perfil)) continue;
        vistos.add(perfil);

        let r;
        try { r = await visitarEConvidar(page, perfil); }
        catch (erro) { await fecharModal(page).catch(() => {}); r = { perfil, nome: '', cargo: '', status: 'erro', detalhe: erro.message.split('\n')[0] }; }
        registrar(r);
        contagem[r.status] = (contagem[r.status] || 0) + 1;
        if (r.status === 'pulado') log(`  -> pulado: ${r.nome || perfil} | ${r.cargo} (${r.detalhe})`);
        else log(`  -> ${r.status}${r.detalhe ? ` (${r.detalhe})` : ''}`);

        if (r.status === 'limite') { log('O LinkedIn bloqueou novos convites. Encerrando as conexões.'); break busca; }
        if (r.status === 'convidado' || r.status === 'simulado') {
          if (r.status === 'convidado' && ++resumo.convidados >= maxDia) { log(`Teto de convites do dia atingido (${maxDia}).`); break busca; }
          if (++convites >= (cfg.maxPorExecucao ?? 5)) { log('Limite de convites desta execução atingido.'); break busca; }
          await esperar(...(cfg.pausaEntreConvitesSeg ?? [25, 70]));
        } else {
          await esperar(3, 7); // mesmo pulando, não abre um perfil atrás do outro sem respirar
        }
      }
    }
  }
  log('Resumo das conexões:', Object.entries(contagem).map(([k, v]) => `${k}=${v}`).join(', ') || 'nenhum perfil novo');
  return contagem;
}

async function main() {
  log(SIMULAR
    ? 'CONEXÕES — MODO SIMULAÇÃO: abre o convite e cancela. Use "npm run conectar -- --enviar" para valer.'
    : 'CONEXÕES — MODO REAL: os convites serão ENVIADOS (sem nota).');
  if (!travar()) { log('Outra execução do bot já está rodando. Nada a fazer.'); return; }
  if (foraDaJanela(JANELA)) { log(`Fora do horário (${JANELA}). Nada a fazer.`); return; }

  const { contexto, page } = await abrirNavegador(AUTOMATICO && config.esconderJanelaNoAgendamento);
  try {
    await garantirLogin(page, AUTOMATICO);
    await rodarConexoes(page);
  } finally {
    await contexto.close();
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch(erro => { log('ERRO:', erro.stack || erro); process.exit(1); });
}
