'use strict';

// Cria (ou promove) a conta mestre: node seed-admin.js
// Automação: ADMIN_USERNAME e ADMIN_PASSWORD no ambiente. No terminal, a senha é pedida sem aparecer na tela.
const readline = require('node:readline');
const bcrypt = require('bcrypt');
const { db } = require('./src/db');
const { rest } = require('./src/schemas');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      rl._writeToOutput = () => {}; // não ecoa o que é digitado
      rl.question('', (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

(async () => {
  const username = process.env.ADMIN_USERNAME || (await ask('Nome do administrador: '));
  const password = process.env.ADMIN_PASSWORD || (await ask('Senha (mín. 8 caracteres): ', { hidden: true }));

  const parsed = rest.register.safeParse({ username, password });
  if (!parsed.success) {
    console.error(`Erro: ${parsed.error.issues[0].message}`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(parsed.data.password, 12);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.data.username);
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', status = 'approved', password = ? WHERE id = ?").run(hash, existing.id);
    console.log(`Usuário "${parsed.data.username}" promovido a administrador (senha atualizada).`);
  } else {
    db.prepare("INSERT INTO users (username, password, role, status) VALUES (?, ?, 'admin', 'approved')").run(
      parsed.data.username,
      hash,
    );
    console.log(`Administrador "${parsed.data.username}" criado.`);
  }
})();
