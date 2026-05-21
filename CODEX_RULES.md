# CODEX Rules

## Development Principles

- Keep the architecture split cleanly between `src/` for React UI and `src-tauri/` for Rust backend capabilities.
- Prefer strict TypeScript typing and small, focused Zustand stores over large shared mutable objects.
- Route server and native side effects through TanStack Query or explicit service modules instead of embedding them deeply inside components.
- Preserve Apple-inspired flat, calm, high-clarity UI patterns: soft neutrals, restrained accent colors, and spacious layout rhythm.
- Add comments only when a block is genuinely non-obvious.

## Frontend Conventions

- Build UI with composable React function components and colocate small presentational pieces under `src/components/`.
- Keep global styling tokens in one place and favor CSS variables or shared class patterns before one-off overrides.
- Ensure desktop-first layouts gracefully adapt to tablet and mobile widths.
- Keep placeholders and demo content obviously synthetic so they are easy to replace during later feature work.

## Tauri And Rust Conventions

- Keep Tauri commands narrow, typed, and easy to test.
- Avoid blocking work on the main thread; prefer async APIs when native functionality grows.
- Add new permissions, plugins, and capabilities deliberately and document why they are needed.

## Quality Gates

- `npm run build` must pass before finishing a task.
- `npm run tauri dev` should start successfully for local development verification.
- Prefer incremental, reviewable changes and keep repository instructions in sync when workflows evolve.
