// Docker-free local Postgres 17 on the same port and credentials as docker-compose.yml.
// Runs the official server binaries from the embedded-postgres package; data lives in
// .pgdata/. Keeps running until Ctrl+C. Use `docker compose up -d` instead where Docker works.

import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = '.pgdata';
const server = new EmbeddedPostgres({
  databaseDir,
  port: 5433,
  user: 'postgres',
  password: 'makabl',
  persistent: true,
  onLog: () => {},
});

if (!existsSync(databaseDir)) await server.initialise();
await server.start();
try {
  await server.createDatabase('makabl');
} catch {
  // already exists
}
console.log('postgres 17 ready on postgres://postgres:makabl@localhost:5433/makabl');

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
