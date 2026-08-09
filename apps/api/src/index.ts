import { createApp } from "./server.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await createApp();

try {
  await app.listen({ host: config.host, port: config.port });
  process.stdout.write(
    `Decision Inbox BFF listening on ${config.host}:${config.port}\n`,
  );
} catch (error) {
  process.stderr.write("Decision Inbox BFF failed to start.\n");
  process.exitCode = 1;
}
