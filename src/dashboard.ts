import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { SCLIndex } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadIndex(indexPath: string): SCLIndex {
  if (!fs.existsSync(indexPath)) throw new Error(`Index not found. Run: cortex index`);
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SCLIndex;
}

export function createDashboard(indexPath: string) {
  const app = express();
  app.use(express.json());

  // Serve API data for the dashboard
  app.get("/api/index", (_req, res) => {
    try {
      const index = loadIndex(indexPath);
      res.json(index);
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
    }
  });

  // Serve the dashboard HTML
  app.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(dashboardHTML());
  });

  return app;
}

function dashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cortex Dashboard</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #7d8590; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace; font-size: 14px; }
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
  .logo { font-size: 18px; font-weight: 700; color: var(--accent); }
  .badge { background: var(--border); border-radius: 12px; padding: 2px 8px; font-size: 11px; color: var(--muted); }
  .stats-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--border); border-bottom: 1px solid var(--border); }
  .stat { background: var(--surface); padding: 16px 24px; }
  .stat-val { font-size: 28px; font-weight: 700; color: var(--accent); }
  .stat-lbl { font-size: 11px; color: var(--muted); margin-top: 2px; text-transform: uppercase; letter-spacing: .05em; }
  .layout { display: grid; grid-template-columns: 280px 1fr; height: calc(100vh - 107px); overflow: hidden; }
  .sidebar { background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; }
  .sidebar-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .file-item { padding: 6px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid transparent; }
  .file-item:hover { background: var(--bg); }
  .file-item.active { background: var(--bg); border-left: 2px solid var(--accent); }
  .file-name { color: var(--text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .file-count { font-size: 11px; color: var(--muted); flex-shrink: 0; }
  .main { overflow-y: auto; padding: 24px; }
  .search-bar { display: flex; gap: 8px; margin-bottom: 20px; }
  .search-bar input { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 13px; outline: none; }
  .search-bar input:focus { border-color: var(--accent); }
  .search-bar input::placeholder { color: var(--muted); }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; }
  .panel-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; display: flex; justify-content: space-between; }
  .panel-body { padding: 16px; }
  .fn-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .fn-row:last-child { border-bottom: none; }
  .fn-name { color: var(--accent); font-family: monospace; font-size: 13px; }
  .fn-line { color: var(--muted); font-size: 11px; }
  .tag { font-size: 10px; padding: 1px 6px; border-radius: 10px; }
  .tag-exported { background: rgba(63,185,80,.15); color: var(--green); }
  .tag-internal { background: rgba(125,133,144,.1); color: var(--muted); }
  .import-row { font-size: 12px; padding: 3px 0; color: var(--muted); }
  .import-mod { color: var(--text); }
  .import-syms { color: var(--accent); }
  .caller-row { font-size: 12px; padding: 3px 0; }
  .caller-file { color: var(--text); }
  .caller-fn { color: var(--muted); }
  .empty { color: var(--muted); font-size: 12px; padding: 8px 0; }
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
  .tab { padding: 8px 16px; cursor: pointer; font-size: 13px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .arch-row { display: flex; gap: 8px; padding: 4px 0; font-size: 12px; }
  .arch-dir { color: var(--accent); font-family: monospace; min-width: 140px; }
  .arch-arrow { color: var(--muted); }
  .search-results .fn-row { cursor: pointer; }
  .search-results .fn-row:hover .fn-name { text-decoration: underline; }
  #loading { text-align: center; padding: 48px; color: var(--muted); }
</style>
</head>
<body>

<header>
  <span class="logo">◆ cortex</span>
  <span class="badge">v0.2.0</span>
  <span id="root-label" style="color:var(--muted);font-size:12px;margin-left:8px;"></span>
  <span style="margin-left:auto;font-size:11px;color:var(--muted)" id="generated-at"></span>
</header>

<div class="stats-bar">
  <div class="stat"><div class="stat-val" id="s-files">–</div><div class="stat-lbl">Files indexed</div></div>
  <div class="stat"><div class="stat-val" id="s-fns">–</div><div class="stat-lbl">Functions</div></div>
  <div class="stat"><div class="stat-val" id="s-calls">–</div><div class="stat-lbl">Call sites</div></div>
  <div class="stat"><div class="stat-val" id="s-imports">–</div><div class="stat-lbl">Imports</div></div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="sidebar-header">Files</div>
    <div id="file-list"><div style="padding:16px;color:var(--muted);font-size:12px;">Loading…</div></div>
  </div>
  <div class="main">
    <div class="tabs">
      <div class="tab active" onclick="switchTab('explorer')">Explorer</div>
      <div class="tab" onclick="switchTab('search')">Search</div>
      <div class="tab" onclick="switchTab('arch')">Architecture</div>
    </div>

    <div id="tab-explorer">
      <div id="file-detail" style="color:var(--muted);font-size:13px;">← Select a file from the sidebar</div>
    </div>

    <div id="tab-search" style="display:none">
      <div class="search-bar">
        <input id="search-input" placeholder="Search functions, symbols…" oninput="doSearch(this.value)" />
      </div>
      <div id="search-results" class="search-results"></div>
    </div>

    <div id="tab-arch" style="display:none">
      <div id="arch-content"></div>
    </div>
  </div>
</div>

<script>
let DATA = null;
let activeFile = null;

async function init() {
  const res = await fetch('/api/index');
  DATA = await res.json();

  document.getElementById('s-files').textContent = DATA.symbols.length;
  document.getElementById('s-fns').textContent = DATA.functions.length;
  document.getElementById('s-calls').textContent = DATA.callSites.length;
  document.getElementById('s-imports').textContent = DATA.imports.length;
  document.getElementById('root-label').textContent = DATA.root;
  document.getElementById('generated-at').textContent = 'Indexed ' + new Date(DATA.generatedAt).toLocaleString();

  renderFileList();
  renderArch();
}

function renderFileList() {
  const list = document.getElementById('file-list');
  const sorted = [...DATA.symbols].sort((a,b) => b.exported.length - a.exported.length);
  list.innerHTML = sorted.map(s => \`
    <div class="file-item" onclick="selectFile('\${s.file.replace(/'/g,"\\\\'")}', this)">
      <span class="file-name" title="\${s.file}">\${s.file.split('/').pop()}</span>
      <span class="file-count">\${s.exported.length + s.internal.length}</span>
    </div>
  \`).join('');
}

function selectFile(file, el) {
  document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  activeFile = file;
  renderFileDetail(file);
}

function renderFileDetail(file) {
  const symbols = DATA.symbols.find(s => s.file === file) || { exported: [], internal: [] };
  const imports = DATA.imports.filter(i => i.from === file);
  const importedBy = DATA.imports.filter(i => {
    const r = i.to.startsWith('.') ? resolvePath(i.from, i.to) : i.to;
    return r === file || r === file.replace(/\\.(ts|tsx|js|jsx|py)$/, '');
  });
  const fns = DATA.functions.filter(f => f.file === file);
  const exportedNames = new Set(fns.filter(f=>f.exported).map(f=>f.name));
  const callers = DATA.callSites.filter(c => [...exportedNames].some(fn => c.callee === fn || c.callee.endsWith('.'+fn)));

  document.getElementById('file-detail').innerHTML = \`
    <h2 style="font-size:15px;margin-bottom:16px;color:var(--text)">\${file}</h2>

    <div class="panel">
      <div class="panel-header"><span>Functions (\${fns.length})</span></div>
      <div class="panel-body">
        \${fns.length ? fns.map(f => \`
          <div class="fn-row">
            <span class="fn-name">\${f.name}</span>
            <span class="fn-line">:\${f.line}</span>
            <span class="tag \${f.exported ? 'tag-exported' : 'tag-internal'}">\${f.exported ? 'exported' : 'internal'}</span>
          </div>
        \`).join('') : '<div class="empty">No functions</div>'}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="panel">
        <div class="panel-header">Imports (\${imports.length})</div>
        <div class="panel-body">
          \${imports.length ? imports.map(i => \`
            <div class="import-row">
              <span class="import-mod">\${i.to}</span>
              \${i.symbols.length ? \`<span class="import-syms"> { \${i.symbols.join(', ')} }</span>\` : ''}
            </div>
          \`).join('') : '<div class="empty">No imports</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">Imported by (\${importedBy.length})</div>
        <div class="panel-body">
          \${importedBy.length ? importedBy.map(i => \`<div class="import-row"><span class="import-mod">\${i.from}</span></div>\`).join('') : '<div class="empty">Not imported by any file</div>'}
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-header">Callers of exported functions (\${callers.length})</div>
      <div class="panel-body">
        \${callers.length ? callers.slice(0,30).map(c => \`
          <div class="caller-row">
            <span class="caller-file">\${c.file}:\${c.line}</span>
            <span class="caller-fn"> ← \${c.caller}</span>
          </div>
        \`).join('') : '<div class="empty">No external callers</div>'}
      </div>
    </div>
  \`;
}

function doSearch(q) {
  if (!q || q.length < 2) { document.getElementById('search-results').innerHTML = ''; return; }
  const ql = q.toLowerCase();
  const matches = DATA.functions.filter(f => f.name.toLowerCase().includes(ql)).slice(0, 40);
  document.getElementById('search-results').innerHTML = matches.length
    ? \`<div class="panel"><div class="panel-header">Functions (\${matches.length})</div><div class="panel-body">
        \${matches.map(f => \`<div class="fn-row" onclick="goToFile('\${f.file}')">
          <span class="fn-name">\${f.name}</span>
          <span class="fn-line"> \${f.file}:\${f.line}</span>
          <span class="tag \${f.exported?'tag-exported':'tag-internal'}">\${f.exported?'exported':'internal'}</span>
        </div>\`).join('')}
      </div></div>\`
    : '<div style="color:var(--muted);font-size:13px">No matches</div>';
}

function goToFile(file) {
  switchTab('explorer');
  const items = document.querySelectorAll('.file-item');
  for (const item of items) {
    if (item.querySelector('.file-name')?.title === file) {
      item.click(); item.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
  }
}

function renderArch() {
  const dirMap = {};
  for (const imp of DATA.imports) {
    const fromDir = imp.from.split('/').slice(0,-1).join('/') || '.';
    const toDir = imp.to.startsWith('.') ? resolvePath(imp.from, imp.to).split('/').slice(0,-1).join('/') || '.' : imp.to.split('/')[0];
    if (fromDir === toDir) continue;
    if (!dirMap[fromDir]) dirMap[fromDir] = new Set();
    dirMap[fromDir].add(toDir);
  }
  const rows = Object.entries(dirMap).sort().map(([dir, deps]) =>
    \`<div class="arch-row"><span class="arch-dir">\${dir || '.'}</span><span class="arch-arrow">→</span><span>\${[...deps].join(', ')}</span></div>\`
  ).join('');
  document.getElementById('arch-content').innerHTML = \`
    <div class="panel">
      <div class="panel-header">Module dependency map</div>
      <div class="panel-body">\${rows || '<div class="empty">No cross-module dependencies</div>'}</div>
    </div>\`;
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['explorer','search','arch'][i]===name));
  document.getElementById('tab-explorer').style.display = name==='explorer' ? '' : 'none';
  document.getElementById('tab-search').style.display = name==='search' ? '' : 'none';
  document.getElementById('tab-arch').style.display = name==='arch' ? '' : 'none';
  if (name==='search') document.getElementById('search-input').focus();
}

function resolvePath(from, to) {
  const parts = from.split('/'); parts.pop();
  for (const seg of to.split('/')) {
    if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

init();
</script>
</body>
</html>`;
}
