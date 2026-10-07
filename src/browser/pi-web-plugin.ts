import type { PiWebPlugin } from "@jmfederico/pi-web/plugin-api";
import { defineResearchLibraryPdfViewerElement } from "./pdfViewerElement.js";
import { defineLibraryWorkbenchElement } from "./workbenchElement.js";
import { defineLibraryDiscoveryElement } from "./discoveryElement.js";

const plugin: PiWebPlugin = {
  apiVersion: 4,
  name: "Research Library",
  activate: ({ html, svg }) => {
    defineResearchLibraryPdfViewerElement();
    defineLibraryWorkbenchElement();
    defineLibraryDiscoveryElement();
    // citeproc-js CPAL Exhibit B attribution applies to the larger work as well.
    // Source/license links stay within the published browserRoot, not host internals.
    const attribution = html`<p style="font:inherit;color:var(--pi-text);padding:.5rem;border-bottom:1px solid var(--pi-border)">(c) Frank Bennett · <a href="https://citationstyles.org/" target="_blank" rel="noopener noreferrer">citeproc-js implements the Citation Style Language</a> · <a href=${new URL("./licenses/citeproc/source.txt", import.meta.url).href} download>CSL engine source</a> · <a href=${new URL("./licenses/citeproc/CPAL-1.0.txt", import.meta.url).href} download>CPAL license</a></p>`;

    return {
      contributions: {
        workspacePanels: [
          {
            id: "workspace.research-library.native",
            title: "Library",
            icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h5v16H4zM10 4h5v16h-5zM16 5l4-1 3 15-4 1z"></path></svg>`,
            order: 55,
            render: context => html`${attribution}<pi-web-library-workbench .context=${context}></pi-web-library-workbench>`,
          },
          {
            id: "workspace.research-library.discovery",
            title: "Discover",
            icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="6"></circle><path d="m15 15 6 6"></path></svg>`,
            order: 56,
            render: context => html`${attribution}<pi-web-library-discovery .context=${context}></pi-web-library-discovery>`,
          },
        ],
      },
    };
  },
};

export default plugin;
