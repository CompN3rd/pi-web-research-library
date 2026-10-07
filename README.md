# PI WEB Research Library

Native reference management, PDF evidence, agent-assisted research, and citation-aware manuscripts. Standalone package **`@compn3rd/pi-web-research-library`**—no reference-manager accounts, vendor MCP, PI WEB fork, or host patches required.

**Unreleased.** Targets published PI WEB **`1.202609.1`**, browser API v4/server API v3 with public sessions and session-events v1, and Pi **0.87.1**. See [compatibility and development setup](docs/development.md).

## Try it locally

1. Use Node.js 22.19+ and run `npm ci && npm run verify`. No host source build is needed.
2. Install this **built directory** through the target machine's **Settings → Pi packages**. Enable its Research Library PI WEB plugin and trust its Pi companion.
3. Restart the target session daemon **when safe, from outside its hosted sessions**, then reload the browser. Existing idle Pi sessions need `/reload` for the companion.
4. Open **Library** in any workspace. Create/import references, attach PDFs, collect evidence, explicitly run research tasks, and prepare manuscripts. **Discover** offers local connections and optional consented public metadata searches.

One workspace catalog owns the workflow; source PDFs are never rewritten. Model runs, external discovery, and previewed manuscript-file application require separate explicit actions. Ordinary Pi tools are not sandboxed and research-tool output can reach the configured model provider.

Read [usage and greenfield cutover](docs/usage.md), [architecture and limits](docs/architecture.md), and [verification evidence](docs/verification.md). Plugins run with your account permissions, not in a sandbox. Daemon restarts interrupt active sessions and terminals.

MIT; see [LICENSE](LICENSE) and [provenance](NOTICE).
