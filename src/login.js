// Abre o navegador do bot SEM automação, só para você entrar no LinkedIn.
// O Google bloqueia "Continuar com o Google" no navegador controlado pelo bot; aqui ele funciona.
// A sessão fica salva em perfil-navegador/ e o bot passa a usá-la.
// Uso: npm run login  (com o bot parado; feche a janela quando o feed do LinkedIn aparecer)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { PASTA_PERFIL } from './bot.js';

const EXECUTAVEIS = {
  chrome: 'Google\\Chrome\\Application\\chrome.exe',
  'chrome-dev': 'Google\\Chrome Dev\\Application\\chrome.exe',
  msedge: 'Microsoft\\Edge\\Application\\msedge.exe',
};

const canal = config.navegador || 'msedge';
const relativo = EXECUTAVEIS[canal];
const executavel = relativo && [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
  .filter(Boolean)
  .map(base => path.join(base, relativo))
  .find(p => fs.existsSync(p));

if (!executavel) {
  console.error(`Não encontrei o navegador "${canal}" (config.js > navegador).`);
  process.exit(1);
}

console.log('Entre no LinkedIn na janela que abriu (pode usar "Continuar com o Google").');
console.log('Quando o feed aparecer, FECHE a janela. O bot passa a usar essa sessão.');
spawn(executavel, [`--user-data-dir=${PASTA_PERFIL}`, '--no-first-run', '--no-default-browser-check', 'https://www.linkedin.com/login'], { stdio: 'ignore' })
  .on('exit', () => console.log('Janela fechada. Agora rode "npm run simular".'));
