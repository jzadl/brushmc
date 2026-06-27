# Brush

A minimalist mod manager for Minecraft. Built with Tauri 2 and Rust.

Scans your .minecraft directory and displays mods, resource packs, shaders, versions, and profiles.

## Features

- **Overview** -- see counts and recent items for all categories at a glance
- **Mods, Resource Packs, Shaders** -- list view with green/grey status dots, file size, badges
- **Enable/Disable** -- toggle items on and off (renames to .disabled)
- **Delete** -- with confirmation dialog
- **Import** -- add new files via native file picker
- **Search** -- filter the list in real time
- **Sort** -- by name, size, or status, with ascending/descending toggle
- **Batch select** -- Ctrl+click multiple items, then enable, disable, or delete all at once
- **Shift-select** -- click one item then Shift+click another to select a range
- **Context menu** -- right-click an item for Toggle, Delete, Open Folder, or Copy name
- **Drag and drop** -- drop files onto the window to import them
- **Export Brushpack** -- package mods, resource packs, shaders, and config into a .brushpack zip archive
- **Import Brushpack** -- extract a .brushpack archive into your .minecraft folder
- **Open folder** -- open the corresponding .minecraft subfolder in your file manager

## Build

Requires Rust and Node.js.

```sh
npm install
npm run tauri build
```

The binary will be at `src-tauri/target/release/brush-mc.exe` (Windows), `brush-mc` (macOS/Linux).

## Supported platforms

- Windows (primary target)
- macOS and Linux (the Rust backend uses conditional compilation for OS-specific paths and commands)
