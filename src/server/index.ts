/** Lancement du serveur : `npm run server` (développement) ou `npm start` (pages compilées dans dist/). */
import { fileURLToPath } from 'node:url';
import { createGameServer } from './app';

const port = Number(process.env.PORT ?? 3001);
const staticDir = fileURLToPath(new URL('../../dist', import.meta.url));
const server = createGameServer({ staticDir });
server.http.listen(port, () => console.log(`The Village Is Lying — serveur sur http://localhost:${port}`));
