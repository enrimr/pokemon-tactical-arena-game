import { createGameServer } from './server.js';

const PORT = Number(process.env.PORT ?? 8080);
void createGameServer(PORT);
