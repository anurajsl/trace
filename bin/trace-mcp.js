#!/usr/bin/env node

/**
 * TRACE MCP Server
 *
 * Exposes TRACE verification tools to AI assistants via the
 * Model Context Protocol. AI tools call these functions automatically
 * during conversations, making TRACE proactive instead of reactive.
 *
 * Usage:
 *   trace-mcp                  Start the MCP server (stdio transport)
 *
 * Configuration for Claude Code (~/.claude.json or project .claude.json):
 *   {
 *     "mcpServers": {
 *       "trace": {
 *         "command": "trace-mcp"
 *       }
 *     }
 *   }
 *
 * Configuration for Cursor (.cursor/mcp.json):
 *   {
 *     "mcpServers": {
 *       "trace": {
 *         "command": "trace-mcp"
 *       }
 *     }
 *   }
 *
 * Configuration for Kiro (.kiro/settings.json):
 *   Add trace-mcp as an MCP server in Kiro's MCP settings.
 */

import { startServer } from '../src/mcp-server.js';
startServer();
