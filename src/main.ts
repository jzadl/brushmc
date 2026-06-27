import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ModEntry { name: string; size_kb: number; is_jar: boolean; enabled: boolean; filename: string; }
interface PackEntry { name: string; size_kb: number; enabled: boolean; filename: string; }
interface VersionEntry { name: string; entry_type: string; }
interface ProfileInfo { name: string; last_version: string; type_name: string; icon: string; }
interface McData { mods: ModEntry[]; resourcepacks: PackEntry[]; shaders: PackEntry[]; versions: VersionEntry[]; profiles: ProfileInfo[]; }
type Tab = "overview" | "mods" | "resourcepacks" | "shaders" | "versions" | "profiles";
type SortKey = "name" | "size" | "status";

const CMDS: Record<string, Record<string, string>> = {
  mods: { toggle: "toggle_mod", delete: "delete_mod", import: "import_mod" },
  resourcepacks: { toggle: "toggle_resourcepack", delete: "delete_resourcepack", import: "import_resourcepack" },
  shaders: { toggle: "toggle_shader", delete: "delete_shader", import: "import_shader" },
};

let data: McData;
let currentTab: Tab = "overview";
let search = "";
let sortKey: SortKey = "name";
let sortAsc = true;
let selected = new Set<number>();
let lastOrig = -1;
let content: HTMLElement;

function fmtSize(kb: number): string {
  if (kb > 1024) return (kb / 1024).toFixed(1) + " MB";
  return kb + " KB";
}

function esc(s: string) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function load() {
  content.innerHTML = `<div class="loading"><div class="spinner"></div>Scanning...</div>`;
  selected.clear(); lastOrig = -1;
  invoke<McData>("scan").then(d => { data = d; render(currentTab); });
}

function act(cmd: string, name: string) {
  return invoke(cmd, { name }).then(load).catch(() => load());
}

const SORT_LABELS: Record<SortKey, string> = { name: "Name", size: "Size", status: "Status" };

function renderToolbar() {
  return `<div class="toolbar">
    <div class="search-wrap"><input class="search" placeholder="Filter..." value="${esc(search)}" spellcheck="false"></div>
    <div class="toolbar-right">
      <span class="sort-lbl">Sort</span>
      ${(["name", "size", "status"] as SortKey[]).map(k =>
        `<button class="btn sort-btn${sortKey === k ? " active" : ""}" data-sort="${k}">${SORT_LABELS[k]}</button>`
      ).join("")}
      <button class="btn refresh-btn" data-action="refresh" title="Rescan">↻</button>
      <button class="btn export-btn" data-action="export-brushpack" title="Export as .brushpack">📦</button>
    </div>
  </div>`;
}

function getItemsForTab(tab: Tab) {
  if (tab === "overview" || tab === "versions" || tab === "profiles") return null;
  return data[tab] as unknown as Array<{ name: string; filename: string; enabled: boolean; size_kb?: number; is_jar?: boolean }>;
}

function render(tab: Tab) {
  currentTab = tab;
  if (!data) return load();
  const h = renderToolbar();
  switch (tab) {
    case "overview": renderOverview(h); break;
    case "mods": renderPlugin(h, data.mods, "Mods", m => [m.enabled ? "ON" : "OFF", fmtSize(m.size_kb)]); break;
    case "resourcepacks": renderPlugin(h, data.resourcepacks, "Resource Packs", r => [r.enabled ? "ON" : "OFF"]); break;
    case "shaders": renderPlugin(h, data.shaders, "Shaders", s => [s.enabled ? "ON" : "OFF"]); break;
    case "versions": renderVersions(h); break;
    case "profiles": renderProfiles(h); break;
  }
  const inp = content.querySelector<HTMLInputElement>(".search");
  if (inp) inp.addEventListener("input", () => { search = inp.value; selected.clear(); lastOrig = -1; render(currentTab); });
}

function renderOverview(h: string) {
  const en = data.mods.filter(m => m.enabled).length;
  const vn = data.versions.filter(v => v.entry_type === "vanilla").length;
  const md = data.versions.filter(v => v.entry_type === "modded").length;
  content.innerHTML = h + `
    <div class="stats">
      <div class="stat"><div class="stat-num">${data.mods.length}</div><div class="stat-label">Mods (${en} active)</div></div>
      <div class="stat"><div class="stat-num">${data.resourcepacks.length}</div><div class="stat-label">Packs</div></div>
      <div class="stat"><div class="stat-num">${data.shaders.length}</div><div class="stat-label">Shaders</div></div>
      <div class="stat"><div class="stat-num">${vn}</div><div class="stat-label">Vanilla</div></div>
      <div class="stat"><div class="stat-num">${md}</div><div class="stat-label">Modded</div></div>
      <div class="stat"><div class="stat-num">${data.profiles.length}</div><div class="stat-label">Profiles</div></div>
    </div>
    <div class="section"><h2>Mods</h2>${preview(data.mods, m => [m.enabled ? "ON" : "OFF", fmtSize(m.size_kb)])}</div>
    <div class="section"><h2>Packs</h2>${preview(data.resourcepacks, r => [r.enabled ? "ON" : "OFF"])}</div>
    <div class="section"><h2>Shaders</h2>${preview(data.shaders, s => [s.enabled ? "ON" : "OFF"])}</div>`;
}

function renderVersions(h: string) {
  content.innerHTML = h + `
    <div class="stats"><div class="stat"><div class="stat-num">${data.versions.length}</div><div class="stat-label">Versions</div></div></div>
    <div class="section"><h2>All Versions</h2><div class="card-list">${data.versions.map(v =>
      `<div class="card"><span class="card-name">${esc(v.name)}</span><span class="card-meta"><span class="badge ${v.entry_type === "modded" ? "badge-modded" : ""}">${esc(v.entry_type)}</span></span></div>`
    ).join("")}</div></div>`;
}

function renderProfiles(h: string) {
  content.innerHTML = h + `
    <div class="stats"><div class="stat"><div class="stat-num">${data.profiles.length}</div><div class="stat-label">Profiles</div></div></div>
    <div class="section"><h2>All Profiles</h2><div class="card-list">${data.profiles.map(p =>
      `<div class="card"><span class="card-name">${esc(p.name)}</span><span class="card-meta"><span class="badge">${esc(p.last_version)}</span><span class="badge ${p.type_name === "latest-release" || p.type_name === "latest-snapshot" ? "badge-modded" : ""}">${esc(p.type_name)}</span></span></div>`
    ).join("")}</div></div>`;
}

function renderPlugin<T extends { name: string; filename: string; enabled: boolean; size_kb?: number; is_jar?: boolean }>(
  h: string, items: T[], header: string, badges: (i: T) => string[],
) {
  const all = items;
  const filtered: Array<{ item: T; origIdx: number }> = [];
  for (let i = 0; i < all.length; i++) {
    if (!search || all[i].name.toLowerCase().includes(search.toLowerCase()))
      filtered.push({ item: all[i], origIdx: i });
  }
  const cmp = sortAsc ? 1 : -1;
  filtered.sort((a, b) => {
    if (sortKey === "name") return a.item.name.localeCompare(b.item.name) * cmp;
    if (sortKey === "size") return ((a.item.size_kb || 0) - (b.item.size_kb || 0)) * cmp;
    return (Number(a.item.enabled) - Number(b.item.enabled)) * cmp;
  });
  const en = filtered.filter(f => f.item.enabled).length;
  const imp = `<button class="btn btn-import" data-action="import">+ Import</button>`;
  const rows = filtered.length ? filtered.map((f, dispIdx) => {
    const item = f.item;
    const dot = item.enabled ? `<span class="dot dot-on"></span>` : `<span class="dot dot-off"></span>`;
    const b = badges(item).map(x => `<span class="badge">${esc(x)}</span>`).join("");
    const sel = selected.has(f.origIdx) ? " selected" : "";
    return `<div class="card${sel}" data-idx="${dispIdx}" data-orig="${f.origIdx}">
      <span class="sel-box">${selected.has(f.origIdx) ? "✓" : ""}</span>
      ${dot}
      <span class="card-name ${item.enabled ? "" : "disabled"}">${esc(item.name)}</span>
      <span class="card-meta">${b}
        <button class="btn btn-toggle" data-action="toggle">${item.enabled ? "Disable" : "Enable"}</button>
        <button class="btn btn-del" data-action="delete">Delete</button>
      </span>
    </div>`;
  }).join("") : `<div class="empty">${search ? "No matches" : "Nothing here"}</div>`;
  const selCount = selected.size;
  const batchBar = selCount > 0 ? `<div class="batch-bar">
    <span>${selCount} selected</span>
    <button class="btn" data-action="batch-enable">Enable All</button>
    <button class="btn" data-action="batch-disable">Disable All</button>
    <button class="btn btn-del" data-action="batch-delete">Delete All</button>
    <button class="btn" data-action="batch-clear">Clear</button>
  </div>` : "";
  const filterInfo = search ? `<span class="filter-info">${filtered.length} / ${all.length}</span>` : "";
  content.innerHTML = h + `
    <div style="display:flex;gap:10px;margin-bottom:20px;align-items:stretch">
      <div class="stat" style="flex:1;margin:0"><div class="stat-num">${all.length}</div><div class="stat-label">${header} ${filterInfo}</div></div>
      <div class="stat" style="flex:1;margin:0"><div class="stat-num">${en}</div><div class="stat-label">Active</div></div>
      ${imp}
    </div>
    <div class="section"><h2>All ${header}</h2><div class="card-list">${rows}</div></div>
    ${batchBar}`;
}

function preview<T extends { name: string; enabled: boolean }>(items: T[], badges: (i: T) => string[]): string {
  if (!items.length) return `<div class="empty">Nothing here</div>`;
  return `<div class="card-list">${items.slice(0, 5).map(i => {
    const dot = i.enabled ? `<span class="dot dot-on"></span>` : `<span class="dot dot-off"></span>`;
    return `<div class="card">${dot}<span class="card-name ${i.enabled ? "" : "disabled"}">${esc(i.name)}</span><span class="card-meta">${badges(i).map(x => `<span class="badge">${esc(x)}</span>`).join("")}</span></div>`;
  }).join("")}</div>`;
}

// --- Context menu ---
let ctxEl: HTMLElement | null = null;
function showCtx(x: number, y: number, items: { label: string; action: string }[]) {
  hideCtx();
  ctxEl = document.createElement("div");
  ctxEl.className = "ctx";
  ctxEl.style.cssText = `left:${x}px;top:${y}px`;
  ctxEl.innerHTML = items.map(i => `<div class="ctx-item" data-action="${i.action}">${esc(i.label)}</div>`).join("");
  document.body.appendChild(ctxEl);
  setTimeout(() => document.addEventListener("click", hideCtx, { once: true }), 0);
}
function hideCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }

// --- Event delegation ---
content = document.getElementById("content")!;

document.addEventListener("click", async e => {
  const sidebarBtn = (e.target as HTMLElement).closest("[data-action='import-brushpack']");
  if (sidebarBtn) {
    try { await invoke("import_brushpack"); load(); notify("Brushpack imported"); } catch (_) { notify("Import failed"); }
    return;
  }
});

content.addEventListener("click", async e => {
  hideCtx();
  const target = e.target as HTMLElement;
  const btn = target.closest("[data-action]") as HTMLElement;
  if (btn) {
    const action = btn.dataset.action!;
    const card = btn.closest(".card") as HTMLElement;
    if (action === "import") {
      const kind = currentTab;
      if (kind === "overview") return;
      await act(CMDS[kind].import, "");
      return;
    }
    if (action === "refresh") { load(); return; }
    if (action === "export-brushpack") {
      try { await invoke("export_brushpack"); notify("Brushpack exported"); } catch (e) { notify("Export failed"); }
      return;
    }
    if (action === "import-brushpack") {
      try { await invoke("import_brushpack"); load(); notify("Brushpack imported"); } catch (e) { notify("Import failed"); }
      return;
    }
    if (action === "batch-clear") { selected.clear(); lastOrig = -1; render(currentTab); return; }
    if (action === "batch-enable" || action === "batch-disable") {
      const kind = currentTab;
      const all = getItemsForTab(kind);
      if (!all) return;
      const cmd = CMDS[kind].toggle;
      const on = action === "batch-enable";
      for (const origIdx of selected) {
        if (all[origIdx] && all[origIdx].enabled !== on)
          await act(cmd, all[origIdx].filename);
      }
      return;
    }
    if (action === "batch-delete") {
      if (!confirm("Delete selected items?")) return;
      const kind = currentTab;
      const all = getItemsForTab(kind);
      if (!all) return;
      const cmd = CMDS[kind].delete;
      for (const origIdx of [...selected].sort((a, b) => b - a)) {
        if (all[origIdx]) await act(cmd, all[origIdx].filename);
      }
      return;
    }
    if (action === "toggle") {
      if (!card) return;
      const origIdx = parseInt(card.dataset.orig!);
      const kind = currentTab;
      if (kind === "overview" || kind === "versions" || kind === "profiles") return;
      const all = getItemsForTab(kind)!;
      await act(CMDS[kind].toggle, all[origIdx].filename);
      return;
    }
    if (action === "delete") {
      if (!card) return;
      const origIdx = parseInt(card.dataset.orig!);
      const kind = currentTab;
      if (kind === "overview" || kind === "versions" || kind === "profiles") return;
      const all = getItemsForTab(kind)!;
      if (!confirm(`Delete "${all[origIdx].name}"?`)) return;
      await act(CMDS[kind].delete, all[origIdx].filename);
      return;
    }
    if (action === "open-folder") {
      invoke("open_folder", { kind: currentTab });
      return;
    }
    return;
  }
  // Sort button
  const sortBtn = target.closest("[data-sort]") as HTMLElement;
  if (sortBtn) {
    const key = sortBtn.dataset.sort as SortKey;
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = true; }
    render(currentTab);
    return;
  }
  // Card click for selection
  const card = target.closest(".card") as HTMLElement;
  if (card && currentTab !== "overview" && currentTab !== "versions" && currentTab !== "profiles") {
    const origIdx = parseInt(card.dataset.orig!);
    if (e.ctrlKey || e.metaKey) {
      if (selected.has(origIdx)) selected.delete(origIdx);
      else selected.add(origIdx);
      lastOrig = origIdx;
      render(currentTab);
    } else if (e.shiftKey) {
      if (selected.size === 0 && lastOrig === -1) {
        // select from first visible to clicked
        const cards = content.querySelectorAll<HTMLElement>(".card[data-orig]");
        const arr = Array.from(cards).map(c => parseInt(c.dataset.orig!));
        const hi = arr.indexOf(origIdx);
        for (let i = 0; i <= hi; i++) selected.add(arr[i]);
      } else if (lastOrig >= 0) {
        const cards = content.querySelectorAll<HTMLElement>(".card[data-orig]");
        const arr = Array.from(cards).map(c => parseInt(c.dataset.orig!));
        const anchor = selected.size > 0 ? lastOrig : arr[0];
        const anchorIdx = arr.indexOf(anchor);
        const clickIdx = arr.indexOf(origIdx);
        if (anchorIdx >= 0 && clickIdx >= 0) {
          selected.clear();
          const lo = Math.min(anchorIdx, clickIdx), hi = Math.max(anchorIdx, clickIdx);
          for (let i = lo; i <= hi; i++) selected.add(arr[i]);
        }
      }
      lastOrig = origIdx;
      render(currentTab);
    } else {
      if (selected.size > 0) { selected.clear(); lastOrig = -1; render(currentTab); }
      else { lastOrig = origIdx; }
    }
  }
});

content.addEventListener("contextmenu", e => {
  e.preventDefault();
  const card = (e.target as HTMLElement).closest(".card") as HTMLElement;
  if (!card) {
    showCtx(e.clientX, e.clientY, [
      { label: "Refresh", action: "refresh" },
      { label: "Import", action: "import" },
    ]);
    return;
  }
  const name = card.querySelector(".card-name")?.textContent || "";
  showCtx(e.clientX, e.clientY, [
    { label: "Toggle", action: "toggle" },
    { label: "Delete", action: "delete" },
    { label: "Open Folder", action: "open-folder" },
    { label: `Copy "${name}"`, action: "copy-name" },
  ]);
  const handler = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement;
    if (t.dataset?.action === "copy-name") navigator.clipboard.writeText(name).then(() => notify("Copied"));
    document.removeEventListener("click", handler);
  };
  setTimeout(() => document.addEventListener("click", handler), 0);
});

// --- Drag & Drop via Tauri window event ---
getCurrentWindow().onDragDropEvent((event) => {
  if (event.payload.type === "over") {
    content.classList.add("drop-zone");
  } else if (event.payload.type === "leave") {
    content.classList.remove("drop-zone");
  } else if (event.payload.type === "drop") {
    content.classList.remove("drop-zone");
    if (currentTab === "overview" || currentTab === "versions" || currentTab === "profiles") return;
    const kind = currentTab;
    const paths = event.payload.paths;
    Promise.all(paths.map((p: string) => invoke("import_file", { path: p, kind }).catch(() => {})))
      .then(() => { load(); notify(`Imported ${paths.length} file(s)`); });
  }
});

// --- Nav ---
document.querySelectorAll("nav a").forEach(a => {
  a.addEventListener("click", e => {
    e.preventDefault();
    document.querySelectorAll("nav a").forEach(x => x.classList.remove("active"));
    a.classList.add("active");
    search = ""; selected.clear(); lastOrig = -1;
    render(a.getAttribute("data-tab") as Tab);
  });
});

// --- Notification ---
let notifTimeout: number;
function notify(msg: string) {
  const el = document.getElementById("notif") || (() => {
    const n = document.createElement("div"); n.id = "notif"; document.body.appendChild(n); return n;
  })();
  el.textContent = msg;
  el.className = "notif show";
  clearTimeout(notifTimeout);
  notifTimeout = window.setTimeout(() => el.className = "notif", 2000);
}

load();
