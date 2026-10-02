# Changelog

## 0.1.0

First release.

- `npx @nerdstackgrp/nex-wizard -i <framework>`: detect, sign in through the
  browser, pick or create the project, create its credentials, install the
  SDK, configure the framework, verify with a test event.
- Integrations: Next.js, React, Vue, Angular, Svelte/SvelteKit, Solid, Astro,
  JavaScript (Vite), Node.js, Python (FastAPI, Flask, Django). React Native,
  Flutter, Go, Swift, Ruby, PHP, Laravel and Spring Boot are detected and
  reported as not available yet.
- `doctor`, `test`, `uninstall`, `login`, `logout`; `--dry-run`, `--yes`,
  `--no-browser`, monorepo app selection, CI mode with `NEX_TOKEN`.
