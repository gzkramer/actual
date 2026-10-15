import { createApp } from './app';
import { createClaudeCliProvider } from './providers/claude-cli';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

// No credentials are configured here: each request carries the Claude token
// the sync server admin saved, so the service can start with nothing set.
const app = createApp({ provider: createClaudeCliProvider() });

app.listen(port, host, () => {
  console.info(`categorize-service listening on ${host}:${port}`);
});
