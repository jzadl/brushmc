# Brush

A minimalist mod manager for Minecraft. Built with Tauri 2 and Rust.

Scans your .minecraft directory and displays mods, resource packs, shaders, versions, and profiles. Supports enabling/disabling, deletion, import, search, sort, batch selection, drag-and-drop, and brushpack export/import.

## Build

Requires Rust and Node.js.

```
npm install
npm run tauri build
```

The binary will be at `src-tauri/target/release/brush-mc.exe`.
