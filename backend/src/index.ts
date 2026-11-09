import { createApp } from './app';
import { config } from './config';
import { prisma } from './lib/db';
import { startReminderWorker } from './services/reminderWorker';

async function main() {
  await prisma.$connect();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
  const stopWorker = startReminderWorker(config.reminderPollMs);

  const shutdown = async () => {
    stopWorker();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
