// Utilidades do bot de conexões (conectar.js).
// Repete de propósito alguns ajudantes do bot.js (log, esperar, norm...): são poucas linhas e não
// valia mexer no bot.js, que já está rodando. O que os dois PRECISAM compartilhar de verdade são o
// arquivo de trava e a pasta do perfil — e esses apontam para os mesmos caminhos aqui e lá.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_PERFIL = path.join(RAIZ, 'perfil-navegador');
const PASTA_LOGS = path.join(RAIZ, 'logs');
const ARQ_TRAVA = path.join(RAIZ, '.bot-rodando'); // mesmo arquivo do bot.js: uma execução por vez
const BOM = String.fromCharCode(0xFEFF); // faz o Excel abrir o CSV com os acentos certos

// Sem acentos, minúsculas, espaços normalizados. \p{M} = os acentos que o NFD separa das letras.
export const norm = (s = '') => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const esperar = (min, max = min) => new Promise(r => setTimeout(r, (min + Math.random() * (max - min)) * 1000));
export const hoje = () => new Date().toLocaleDateString('pt-BR');

// Escreve no terminal e em logs/AAAA-MM-DD.log (o mesmo log do bot de candidaturas)
export function log(...a) {
  const linha = `[${new Date().toLocaleTimeString('pt-BR')}] ${a.join(' ')}`;
  console.log(linha);
  try {
    fs.mkdirSync(PASTA_LOGS, { recursive: true });
    fs.appendFileSync(path.join(PASTA_LOGS, `${new Date().toLocaleDateString('sv-SE')}.log`), linha + '\n');
  } catch {}
}

export const visivel = loc => loc.isVisible().catch(() => false);

export async function primeiroVisivel(loc) {
  for (const el of await loc.all()) if (await visivel(el)) return el;
  return null;
}

const csvLinha = campos => campos.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';') + '\n';

export function anexarCsv(arquivo, cabecalho, campos) {
  if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, BOM + csvLinha(cabecalho));
  fs.appendFileSync(arquivo, csvLinha(campos));
}

// Linhas de um CSV escrito por anexarCsv, como objetos {coluna: valor}
export function lerCsv(arquivo, colunas) {
  if (!fs.existsSync(arquivo)) return [];
  const texto = fs.readFileSync(arquivo, 'utf8').split(BOM).join('');
  return texto.split('\n').slice(1).filter(l => l.trim()).map(linha => {
    const c = linha.split('";"').map(x => x.replace(/^"|"\s*$/g, ''));
    return Object.fromEntries(colunas.map((nome, i) => [nome, c[i] ?? '']));
  });
}

// --janela 09:00-22:00: execução agendada fora desse horário não roda
export function foraDaJanela(janela, agora = new Date()) {
  if (!janela) return false;
  const [inicio, fim] = janela.split('-').map(h => { const [hh, mm = 0] = h.split(':').map(Number); return hh * 60 + mm; });
  const minuto = agora.getHours() * 60 + agora.getMinutes();
  return minuto < inicio || minuto > fim;
}

// Uma execução por vez, somando candidaturas e conexões: as duas abririam o mesmo perfil do navegador
export function travar() {
  try { process.kill(Number(fs.readFileSync(ARQ_TRAVA, 'utf8')), 0); return false; } catch {} // PID vivo = outra execução
  fs.writeFileSync(ARQ_TRAVA, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(ARQ_TRAVA); } catch {} });
  return true;
}

// foraDaTela: execução agendada abre a janela fora da tela, para não cobrir o que você está fazendo
export async function abrirNavegador(foraDaTela = false) {
  const contexto = await chromium.launchPersistentContext(PASTA_PERFIL, {
    channel: config.navegador || 'msedge',
    headless: false,
    viewport: null,
    args: foraDaTela ? ['--window-position=-3000,-3000', '--window-size=1366,900'] : ['--start-maximized'],
  });
  return { contexto, page: contexto.pages()[0] || await contexto.newPage() };
}

export async function garantirLogin(page, automatico = false) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/feed')) {
    if (automatico) throw new Error('Sessão do LinkedIn expirada. Rode "npm run login" e entre na sua conta.');
    log('Faça login no LinkedIn na janela que abriu. O bot continua sozinho depois do login...');
    await page.waitForURL(/linkedin\.com\/feed/, { timeout: 0 });
  }
  log('Login OK.');
}
