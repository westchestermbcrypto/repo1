import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { router as apiRouter } from './routes/api.js';
import { startPolling } from './services/poller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.use('/api', apiRouter);
app.use(express.static(publicDir));

app.listen(config.port, () => {
  console.log(`XPL dashboard running at http://localhost:${config.port}`);
  startPolling();
});
