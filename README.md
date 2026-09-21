# PI WEB Research Library

Local research papers, a PDF reader with region annotations, and bounded Pi research tools. Standalone package **`@compn3rd/pi-web-research-library`**—no PI WEB fork or host patches required.

**Unreleased.** Targets PI WEB source [`60a29acb`](https://github.com/jmfederico/pi-web/commit/60a29acbfc710908e73b0df9857cb63b53b672d3), browser API v4/server API v3, and Pi `^0.85.1`. Do not substitute the registry's similarly numbered PI WEB package; see [compatibility and development setup](docs/development.md).

## Try it locally

1. Use Node.js 22.19+ and [bootstrap the pinned host](docs/development.md), then run `npm ci && npm run verify`.
2. Install this **built directory** through the target machine's **Settings → Pi packages**. Enable its Research Library PI WEB plugin and trust its Pi companion.
3. Restart the target session daemon **when safe, from outside its hosted sessions**, then reload the browser. Existing idle Pi sessions need `/reload` for the companion.
4. Open a workspace containing a [pilot manifest](docs/usage.md), then open **Research**. Browse PDFs, mark questions/notes, and use the read tools from an ordinary Pi conversation.

PDFs and source notes are not modified. Annotations stay in the workspace. Viewing does not submit prompts or call model providers; invoking a research tool in an agent conversation can send returned content to that conversation's provider.

Read [usage and data migration](docs/usage.md), [architecture and limits](docs/architecture.md), and [verification evidence](docs/verification.md). Plugins run with your account permissions, not in a sandbox. Daemon restarts interrupt active sessions and terminals.

MIT; see [LICENSE](LICENSE) and [provenance](NOTICE).
