import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWorkbenchTools } from "./companion/workbenchTools.js";
import { readWorkbenchState, WorkbenchStore } from "./server/workbenchStore.js";
import { WorkbenchText } from "./server/workbenchText.js";
import { LIBRARY_STATE_PATH } from "./domain/workbench.js";

export default function researchLibraryExtension(pi: ExtensionAPI): void {
  const text = new WorkbenchText(new WorkbenchStore());
  registerWorkbenchTools(pi, readWorkbenchState, text);
  pi.on("session_shutdown", async () => { await text.dispose(); });
  pi.registerCommand("research-library", {
    description: "Show research-library extension status for this workspace",
    async handler(_args, ctx) {
      try {
        const library = await readWorkbenchState(ctx.cwd);
        ctx.ui.notify(`Library tools are registered. ${String(library.references.filter(reference => reference.deletedAt === null).length)} references at ${LIBRARY_STATE_PATH}. Reads are local and do not create a catalog; result submission requires an explicitly admitted hosted task.`, "info");
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Library could not be read", "warning"); }
    },
  });
}
