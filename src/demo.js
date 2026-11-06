// Arranca VENTAX con la base de DEMOSTRACIÓN (data/demo.db). La base real es `npm start`.
import path from 'node:path';
process.env.POS_DB ||= path.join(import.meta.dirname, '..', 'data', 'demo.db');
const { server } = await import('./server.js');
const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`VENTAX (DEMO) en http://localhost:${PORT}  (BD: ${process.env.POS_DB})`));
