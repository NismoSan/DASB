import { Client } from './index';

const username = process.env.BOT_USERNAME || '';
const password = process.env.BOT_PASSWORD || '';

if (!username || !password) {
  console.error('Set BOT_USERNAME and BOT_PASSWORD environment variables');
  process.exit(1);
}

const client = new Client(username, password);

client.connect();
