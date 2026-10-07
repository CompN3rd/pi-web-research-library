import { css } from "lit";

export const workbenchStyles = css`
  :host { display:block; color:var(--pi-fg, #24292f); background:var(--pi-bg, #fff); font:14px/1.5 system-ui,sans-serif; color-scheme:light dark; }
  * { box-sizing:border-box; } [hidden] { display:none !important; }
  header, nav, .row, .actions { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; }
  header { justify-content:space-between; padding:1.1rem 1.4rem; border-bottom:1px solid var(--pi-border, #8886); }
  header .muted { display:block; margin-top:.15rem; }
  h1 { font-size:1.3rem; margin:0; } h2 { font-size:1.1rem; } h3 { font-size:1rem; margin:.4rem 0; }
  p { margin:.5rem 0; } button, input, select, textarea { font:inherit; color:inherit; }
  button, input, select, textarea { border:1px solid var(--pi-border, #8888); border-radius:.35rem; background:var(--pi-bg, #fff); padding:.45rem .65rem; }
  button { cursor:pointer; } button:hover:not(:disabled) { border-color:var(--pi-accent, #0969da); }
  button[aria-pressed=true], .primary { background:var(--pi-accent, #0969da); color:var(--pi-accent-fg, #fff); }
  :focus-visible { outline:3px solid var(--pi-accent, #0969da); outline-offset:2px; }
  :disabled { opacity:.6; cursor:not-allowed; } input[type=checkbox] { accent-color:var(--pi-accent, #0969da); }
  label { display:flex; flex-direction:column; gap:.2rem; min-width:0; } label.check { flex-direction:row; align-items:center; }
  input:not([type=checkbox]), select, textarea { width:100%; } textarea { min-height:6rem; resize:vertical; }
  .layout { display:grid; grid-template-columns:minmax(230px, 280px) minmax(0, 1fr); }
  .layout.reading:not(.with-library) { grid-template-columns:minmax(0, 1fr); }
  aside { padding:1rem; border-right:1px solid var(--pi-border, #8886); background:var(--pi-bg-secondary, #88808); }
  main { min-width:0; padding:1rem 1.25rem; } section { margin-bottom:1rem; }
  nav { margin-bottom:1.1rem; gap:.2rem; border-bottom:1px solid var(--pi-border, #8884); }
  nav button { border:0; border-radius:0; padding:.65rem .85rem; background:transparent; border-bottom:2px solid transparent; opacity:.7; }
  nav button[aria-pressed=true] { background:transparent; color:var(--pi-accent, #0969da); border-bottom-color:currentColor; opacity:1; }
  .reading main { padding:.5rem 1rem; }
  .reading nav { margin-bottom:.6rem; }
  .reader-heading { display:flex; align-items:center; gap:1rem; margin:.6rem 0 1rem; }
  .reader-title { flex:1; min-width:0; } .reader-title h2 { margin:0; font-size:1.1rem; line-height:1.4; overflow-wrap:anywhere; }
  .reader-title .muted { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .reader-heading select { max-width:220px; }
  .library-toggle { font-size:.85rem; border-color:transparent; background:var(--pi-bg-secondary, #8881); }
  .reader-tools { padding:.5rem 0; border-top:1px solid var(--pi-border, #8884); }
  .reader-tools > summary { color:var(--pi-fg-muted, #667085); font-size:.9rem; }
  .reader-tools[open] > summary { margin-bottom:1rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:.7rem; }
  .wide { grid-column:1/-1; } fieldset { border:0; padding:0; margin:0; min-width:0; }
  .cards { list-style:none; padding:0; margin:.6rem 0; } .card { border:1px solid var(--pi-border, #8886); border-radius:.5rem; padding:.7rem; margin:.5rem 0; overflow-wrap:anywhere; }
  .card.active { border-color:var(--pi-accent, #0969da); } .title { text-align:left; border:0; padding:0; background:none; color:var(--pi-accent, #0969da); font-weight:600; }
  .muted { opacity:.75; font-size:.9em; } .status { padding:.5rem 1rem; } .status:empty { display:none; } [role=alert] { color:var(--pi-danger, #b42318); }
  .notice { border-left:3px solid var(--pi-warning, #b58105); padding:.6rem; background:var(--pi-bg-secondary, #8881); }
  pre, .prose { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; max-height:28rem; overflow:auto; }
  code { overflow-wrap:anywhere; } blockquote { margin:.7rem 0; border-left:3px solid var(--pi-border, #8888); padding-left:.8rem; white-space:pre-wrap; }
  .editor { min-height:24rem; font-family:ui-monospace,monospace; } .scroll { overflow:auto; } table { width:100%; border-collapse:collapse; } th,td { padding:.5rem; border:1px solid var(--pi-border, #8886); text-align:left; vertical-align:top; }
  details { margin:.6rem 0; } summary { cursor:pointer; } .badge { border-radius:1rem; background:var(--pi-bg-secondary, #8882); padding:.1rem .5rem; }
  .reader-annotations summary { min-height:44px; padding:.5rem 0; }
  .annotation-list { display:flex; flex-direction:column; max-height:180px; overflow:auto; gap:.35rem; }
  .annotation-list button { min-height:44px; text-align:left; overflow-wrap:anywhere; }
  .reader-session { display:grid; grid-template-columns:minmax(0,1fr); gap:.75rem; align-items:start; }
  .reader-session.annotating { grid-template-columns:minmax(0,1fr) minmax(260px,320px); }
  .reader-annotation { max-height:72dvh; overflow:auto; border:1px solid var(--pi-border, #8886); border-radius:.5rem; padding:.75rem; }
  .reader-annotation .actions { margin-top:.6rem; }
  .reader-annotation button, .reader-annotation summary { min-height:44px; }
  .reader-annotation summary { padding:.5rem 0; }
  @media(max-width:800px) { .reader-session.annotating { grid-template-columns:minmax(0,1fr); } .reader-annotation { max-height:36dvh; } }
  #reader:empty { display:none; } a { color:var(--pi-accent, #0969da); }
  @media(prefers-color-scheme:dark) { :host { color:var(--pi-fg, #e6edf3); background:var(--pi-bg, #161b22); } button,input,select,textarea { background:var(--pi-bg, #161b22); } [role=alert] { color:var(--pi-danger, #ff938a); } }
  @media(max-width:800px) { .layout { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--pi-border, #8886); } aside .cards { max-height:22rem; overflow:auto; } main, .reading main { padding:.5rem; } nav { flex-wrap:nowrap; overflow-x:auto; } nav button { white-space:nowrap; padding:.6rem; } .reader-heading { gap:.5rem; flex-wrap:wrap; } .reader-heading select { max-width:100%; } }
`;
