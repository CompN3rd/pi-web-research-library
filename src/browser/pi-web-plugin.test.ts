// @vitest-environment happy-dom
import { html, svg, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import plugin from "./pi-web-plugin.js";
import { LibraryWorkbenchElement } from "./workbenchElement.js";
import { workbenchHost } from "./workbench.testSupport.js";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

describe("greenfield browser contributions", () => {
  it("exposes only Library and Discover without probing historical source files", async () => {
    const signal = new AbortController().signal;
    const activation = await plugin.activate({ apiVersion: 4, pluginId: "research-library", runtimePluginId: "research-library", html, svg, signal, lifetimeSignal: signal });
    const panels = activation.contributions.workspacePanels ?? [];
    expect(panels.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "workspace.research-library.native", title: "Library" },
      { id: "workspace.research-library.discovery", title: "Discover" },
    ]);
    const host = workbenchHost();
    const library = panels[0]; if (library === undefined) throw new Error("No Library panel");
    render(library.render(host.context), document.body);
    const element = document.querySelector("pi-web-library-workbench");
    if (!(element instanceof LibraryWorkbenchElement)) throw new Error("No Library element");
    await element.updateComplete;
    expect(host.files.readFile).not.toHaveBeenCalled();
    expect(host.files.listFiles).not.toHaveBeenCalled();
    expect(host.files.writeFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("citeproc-js implements the Citation Style Language");
    expect(customElements.get("pi-web-research-library-panel")).toBeUndefined();
    expect(host.request.mock.calls.every(([operation]) => ["library.list", "collections.list"].includes(operation))).toBe(true);
  });
});
