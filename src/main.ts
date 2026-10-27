// stdio entry point: node dist/main.js

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

await buildServer().connect(new StdioServerTransport());
