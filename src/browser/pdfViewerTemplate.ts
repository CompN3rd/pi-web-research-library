// PDF.js positions text spans; the text-layer scale rules match bundled PDF.js 6.
export function pdfViewerTemplate(): string {
  return `
    <style>
      :host { display:block; min-width:0; color:var(--pi-fg, #24292f); font:14px/1.5 system-ui,sans-serif; }
      * { box-sizing:border-box; } [hidden] { display:none !important; }
      .reader { position:relative; display:flex; flex-direction:column; width:100%; max-width:none; max-height:none; padding:0; margin:0; border:1px solid var(--pi-border, #ccd0d7); border-radius:12px; color:inherit; background:var(--pi-bg, #fff); overflow:hidden; }
      .reader:modal { position:fixed; inset:0; width:100vw; height:100dvh; border:0; border-radius:0; }
      .reader::backdrop { background:#141820c9; }
      .toolbar { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--pi-border, #ccd0d7); flex-wrap:wrap; }
      .pages { display:flex; align-items:center; gap:4px; margin-right:auto; }
      button, a, input, select, summary { color:inherit; font:inherit; border:1px solid transparent; border-radius:6px; padding:6px 10px; background:transparent; text-decoration:none; }
      button, summary, select { cursor:pointer; } button, summary, a { min-height:36px; }
      button:hover:not(:disabled), summary:hover, a:hover { background:var(--pi-bg-secondary, #8882); }
      :focus-visible { outline:2px solid var(--pi-accent, #2965cc); outline-offset:2px; }
      button:disabled, select:disabled, input:disabled { opacity:.4; cursor:default; }
      input, select { background:var(--pi-bg, #fff); border-color:var(--pi-border, #ccd0d7); min-height:36px; }
      [data-page-number] { width:4.2rem; text-align:center; appearance:textfield; }
      [data-page-number]::-webkit-inner-spin-button { appearance:none; }
      .page-total { opacity:.65; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .icon { font-size:20px; line-height:1; width:36px; padding:4px; }
      [aria-pressed=true] { background:var(--pi-bg-secondary, #2965cc22); color:var(--pi-accent, #2965cc); }
      .more { position:relative; } summary { list-style:none; } summary::-webkit-details-marker { display:none; }
      .menu { position:absolute; right:0; top:calc(100% + 8px); z-index:5; width:min(290px, 85vw); padding:12px; border:1px solid var(--pi-border, #ccd0d7); border-radius:10px; background:var(--pi-bg, #fff); box-shadow:0 10px 35px #0003; }
      .menu > button, .menu > a { display:block; width:100%; text-align:left; }
      .menu label, .zoom { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
      .menu hr { border:0; border-top:1px solid var(--pi-border, #ccd0d7); margin:8px 0; }
      .help { font-size:12px; line-height:1.6; opacity:.75; margin:8px 0 0; }
      .findbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:8px 12px; border-bottom:1px solid var(--pi-border, #ccd0d7); }
      .findbar input { flex:1; min-width:120px; width:160px; } [data-find-status] { flex-basis:100%; font-size:12px; opacity:.8; }
      .viewport { overflow:auto; overscroll-behavior:contain; height:clamp(320px, 72dvh, 1100px); background:#e5e7eb; scrollbar-gutter:stable; outline-offset:-3px; }
      .reader:modal .viewport { height:auto; flex:1; min-height:0; }
      .stage { min-width:100%; width:max-content; min-height:100%; display:flex; justify-content:center; align-items:flex-start; padding:20px; }
      .page { position:relative; flex:none; line-height:0; box-shadow:0 2px 5px #0002,0 12px 36px #0001; background:white; }
      canvas { display:block; max-width:none; background:white; }
      .reader[data-tone=warm] .viewport { background:#d9d3c6; }
      .reader[data-tone=warm] canvas { filter:sepia(.2); }
      .reader[data-tone=night] .viewport { background:#171b22; }
      .reader[data-tone=night] canvas { filter:invert(.88) hue-rotate(180deg); }
      .textLayer { position:absolute; inset:0; text-align:initial; overflow:clip; line-height:1; letter-spacing:normal; word-spacing:normal; text-size-adjust:none; forced-color-adjust:none; transform-origin:0 0; caret-color:CanvasText; --min-font-size:1; --text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv:calc(1 / var(--min-font-size)); }
      .textLayer :is(span, br) { color:transparent; position:absolute; white-space:pre; cursor:text; transform-origin:0 0; user-select:text; }
      .textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) { z-index:1; --font-height:0; font-size:calc(var(--text-scale-factor) * var(--font-height)); --scale-x:1; --rotate:0deg; transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
      .textLayer .markedContent { display:contents; }
      .textLayer ::selection { background:#2980ff66; }
      .textLayer mark { color:transparent; background:#ffc40066; padding:0; }
      .textLayer mark[data-current] { background:#ff8c0099; outline:1px solid #ad5600; }
      .overlay { position:absolute; inset:0; pointer-events:none; }
      .overlay[data-marking=on] { pointer-events:auto; cursor:crosshair; touch-action:none; }
      .marker, .marquee { position:absolute; box-sizing:border-box; padding:0; min-height:0; }
      .marquee { border:2px dashed var(--pi-accent, #58a6ff); background:#58a6ff33; }
      .marker { border:1px solid var(--pi-warning, #d29922); background:#d299221a; cursor:pointer; pointer-events:auto; }
      .marker[data-kind=note] { border-color:var(--pi-purple, #a371d1); background:#d2a8ff26; }
      .marker[data-evidence-status=resolved] { border-style:dashed; opacity:.65; }
      .marker[data-active=true] { border:2px solid var(--pi-accent, #58a6ff); background:#58a6ff40; }
      .overlay[data-marking=on] .marker { pointer-events:none; }
      footer { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:6px 12px; font-size:12px; border-top:1px solid var(--pi-border, #ccd0d7); }
      [data-status] { font-variant-numeric:tabular-nums; } [data-state=error], [data-text-status] { color:var(--pi-danger, #b42318); }
      [data-text-status]:empty { display:none; } [data-text-status] { padding:6px 12px; font-size:12px; }
      progress { width:70px; height:3px; accent-color:var(--pi-accent, #2965cc); }
      .mark-hint { position:absolute; bottom:40px; left:12px; right:12px; z-index:4; padding:8px 12px; border:1px solid var(--pi-accent, #2965cc); border-radius:8px; background:var(--pi-bg, #fff); box-shadow:0 3px 12px #0002; font-size:13px; }
      .mark-hint button { float:right; min-height:0; padding:0 6px; }
      @media(prefers-color-scheme:dark) { :host { color:var(--pi-fg, #e6edf3); } .reader, .menu, input, select { background:var(--pi-bg, #161b22); } .viewport { background:#252a33; } }
      @media(max-width:500px) { .toolbar { gap:4px; padding:6px; } .toolbar select { max-width:105px; } .toolbar > button { padding:6px; } .stage { padding:20px; } .focus-label { display:none; } }
    </style>
    <dialog open class="reader" role="region" aria-label="PDF reader" data-tone="paper">
      <div class="toolbar" aria-label="PDF controls">
        <div class="pages">
          <button class="icon" type="button" data-previous aria-label="Previous PDF page" title="Previous page (←)">‹</button>
          <input data-page-number type="number" min="1" step="1" value="1" aria-label="PDF page number" title="Go to page (G)">
          <span class="page-total">/ <span data-page-count>0</span></span>
          <button class="icon" type="button" data-next aria-label="Next PDF page" title="Next page (→)">›</button>
        </div>
        <select data-fit aria-label="PDF zoom" title="Page sizing"><option value="width">Fit width</option><option value="page">Fit page</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option><option value="custom" hidden>Custom</option></select>
        <button type="button" data-find-toggle aria-expanded="false" aria-controls="pdf-find" title="Find in PDF (Ctrl/⌘ F)">Find</button>
        <button type="button" data-focus aria-pressed="false" aria-label="Reading focus" title="Distraction-free reading (F)">⛶ <span class="focus-label">Focus</span></button>
        <details class="more" data-more><summary aria-label="More reader options" title="More reader options">•••</summary><div class="menu">
          <div class="zoom"><span data-zoom-label>100%</span><div><button type="button" data-zoom-out aria-label="Zoom PDF out">−</button><button type="button" data-zoom-in aria-label="Zoom PDF in">+</button></div></div>
          <label>Page tone<select data-page-tone aria-label="Page tone"><option value="paper">Paper</option><option value="warm">Warm</option><option value="night">Night</option></select></label>
          <button type="button" data-mark aria-pressed="false">Mark region</button>
          <label><input type="checkbox" data-markers checked> Show evidence markers</label>
          <hr><button type="button" data-reload>Reload PDF</button>
          <a data-open-pdf target="_blank" rel="noopener noreferrer" hidden aria-disabled="true" tabindex="-1">Open PDF</a>
          <p class="help">← / → pages · Space scrolls, then turns page<br>G go to page · + / − zoom · 0 fit width<br>F focus · Esc close / cancel<br>Select text to copy. Mark a region to save evidence.<br>Page tones alter colors, not the original file.</p>
        </div></details>
      </div>
      <form id="pdf-find" class="findbar" data-find-bar hidden role="search" aria-label="Find in this PDF">
        <input data-find-input type="search" maxlength="200" placeholder="Find in this PDF…" aria-label="Find in PDF" autocomplete="off">
        <button type="submit" data-find-submit>Search</button>
        <button type="button" data-find-previous aria-label="Previous match">↑</button><button type="button" data-find-next aria-label="Next match">↓</button>
        <button type="button" data-find-close aria-label="Close PDF search">×</button>
        <span data-find-status role="status" aria-live="polite">Search this PDF without creating an index.</span>
      </form>
      <div class="mark-hint" data-mark-hint hidden>Drag over a passage to save evidence. Esc cancels.<button type="button" data-mark-cancel>Cancel</button></div>
      <div data-text-status role="status"></div>
      <div class="viewport" tabindex="0" role="region" aria-label="PDF page. Select text to copy; use arrow keys to change pages.">
        <div class="stage"><div class="page">
          <canvas aria-label="PDF visual preview. No page rendered; use Open PDF when available for the complete document."></canvas>
          <div class="textLayer" data-text-layer></div>
          <div class="overlay" data-overlay data-marking="off"><div class="marquee" data-marquee hidden></div></div>
        </div></div>
      </div>
      <footer><span data-status role="status" aria-live="polite">No PDF selected.</span><progress data-progress max="1" value="0" aria-label="Document progress"></progress></footer>
    </dialog>
  `;
}
