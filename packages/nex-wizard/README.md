# `@nerdstackgrp/nex-wizard`

Connect an application to Nex with one command.

```bash
npx @nerdstackgrp/nex-wizard@latest -i nextjs
```

From your app's folder, the wizard:

1. **Detects** the framework, TypeScript and package manager (and, in a monorepo, asks which app).
2. **Signs you in** through your browser. You never type a password or paste a key in the terminal.
3. **Picks the Nex project** (or creates one) and its environment.
4. **Creates the credentials** the app needs: an SDK token for server code and/or a browser key for web code.
5. **Installs** the right Nex SDK with your package manager.
6. **Configures** the framework: instrumentation, error handlers, environment variables.
7. **Verifies** the setup and sends a real test event.

Leave out `-i` and the wizard detects the framework, asking when it isn't sure. It never guesses between two frameworks.

## Frameworks

| `-i` | For | SDK | What it sets up |
| --- | --- | --- | --- |
| `nextjs` | Next.js 15+ | `@nerdstackgrp/nex-js` | `instrumentation.ts` (server errors, heartbeats, traces), `instrumentation-client.ts` (browser errors, Next.js 15.3+), `app/global-error.tsx`; env in `.env.local` |
| `react` | React 17+ (Vite, Create React App) | `@nerdstackgrp/nex-js` | browser init at the top of `src/main` / `src/index`; `VITE_` or `REACT_APP_` env |
| `vue` | Vue 3 (Vite, Vue CLI) | `@nerdstackgrp/nex-js` | browser init in `src/main`, plus `app.config.errorHandler` |
| `angular` | Angular 15+ | `@nerdstackgrp/nex-js` | `src/nex.ts` and an `ErrorHandler` provider in `app.config.ts` / `app.module.ts` |
| `svelte` | Svelte, SvelteKit 2 | `@nerdstackgrp/nex-js` | SvelteKit: `hooks.client` + `hooks.server` (both `handleError`); Svelte: browser init |
| `solid` | Solid, SolidStart | `@nerdstackgrp/nex-js` | browser init in `src/index` / `src/entry-client` |
| `astro` | Astro 4+ | `@nerdstackgrp/nex-js` | `src/nex.client.ts` loaded on every page by a local integration in `astro.config` |
| `javascript` | Vite apps without a framework | `@nerdstackgrp/nex-js` | browser init in `src/main` / `main` |
| `nodejs` | Node.js 20+, Bun (Express, Fastify, Koa, Hono, NestJS, …) | `@nerdstackgrp/nex-js` | init at the top of the entry file; Express request tracing and error handler |
| `python` | Python 3.10+ (FastAPI, Starlette, Flask, Django, scripts) | `nex-python` | `nex.init()` plus the ASGI/WSGI middleware; `nex-python` added to your dependencies |

**Planned:** `react-native`, `flutter`, `go`, `swift`, `ruby`, `php`, `laravel`, `spring-boot`. The wizard recognises them and says plainly that their SDK isn't out yet. It installs nothing for them. See [Planned integrations](#planned-integrations).

Known gaps, which the wizard states when it meets them: Nuxt, Remix, Gatsby and Expo aren't set up automatically; SolidStart's and Astro's server side aren't instrumented yet; Next.js before 15.3 gets server instrumentation only.

## Commands

```text
npx @nerdstackgrp/nex-wizard@latest [command] [options]

Commands
  init          Set up Nex in this app (default)
  doctor        Check the setup and what's wrong with it
  test          Send a test event with the app's configuration
  uninstall     Remove what the wizard added
  login         Sign in to Nex
  logout        Sign out and forget the saved sign-in

Options
  -i, --integration <id>   Framework integration (detected when omitted)
      --dry-run            Show what would change, change nothing
  -y, --yes                Accept safe defaults, don't ask
      --org <slug>         Nex organization
      --project <slug>     Nex project
      --environment <slug> Project environment (default: production)
      --cwd <dir>          The app's directory (default: here)
      --api-url <url>      Another Nex server (default: Nex cloud)
      --no-browser         Print the sign-in link instead of opening a browser
      --debug              Show details of unexpected errors
  -h, --help / -v, --version
```

- **Run it twice:** nothing changes. If Nex is already set up, the wizard offers to verify, reconfigure or exit.
- **`--dry-run`** shows the packages it would install, the files it would create or change (with diffs) and the env variables it would set (names only). It changes nothing in the app or in Nex.
- **`doctor`** checks the framework, the SDK and its version, the instrumentation, the variables, that Nex is reachable, that the credentials are valid, and sends a test event. For anything that fails, it says what to do.
- **`uninstall`** removes the wizard's blocks, the env variables it set (restoring any it replaced), and the files it created, but only if you haven't changed them since. It offers to uninstall the SDK. The SDK token and browser key stay in Nex until you revoke them there.

## How it edits your files

Everything the wizard adds is fenced:

```ts
// nex:begin init (added by the Nex wizard)
import * as nex from "@nerdstackgrp/nex-js/client";
// …
// nex:end init
```

- **Changes are previewed.** Before it changes a file you wrote, it lists the files and can show the diff, or you can cancel. Nothing is written until you agree.
- **Your code is kept.** It inserts into what's there: inside an existing `register()`, after `createApp(...)`, into a `providers: [...]` array. It never replaces a file. If it can't place something safely (say, you already have an `onRequestError`), it leaves the file alone and tells you the one line to add.
- **Removal is exact.** Blocks are inserted without extra blank lines, so `uninstall` leaves each file byte for byte as it was.
- **Init comes after `.env` loading.** SDK init goes after your app's own `.env` loading (`load_dotenv()`, `require("dotenv").config()`); otherwise the SDK would start without its token.

`.nex-wizard.json` records what was set up: the project, the files and the package. It contains no secrets and is safe to commit.

## Credentials and security

- **Sign-in** reuses Nex's native-app flow: authorization code with PKCE, on a loopback port (`http://127.0.0.1:{port}/callback`, RFC 8252). The code lasts two minutes and works once. A wrong verifier burns it, so an intercepted code is useless.
- **Saved sign-in.** Only the refresh token is kept, in `~/.config/nex/credentials.json` (mode 0600; `NEX_CONFIG_DIR` overrides). `logout` revokes it on the server and deletes it.
- **Secrets go in env files only.** The SDK token goes only in the env file, and the wizard makes sure git ignores it, adding it to `.gitignore` when needed. It never goes into source, the manifest or the terminal. Previews list variable names, never values.
- **The browser key is public.** It can only send error events, for one frontend service. Angular, which has no build-time env variables, keeps it in `src/nex.ts`.
- **Only what's needed is sent.** The wizard sends Nex only what it needs: sign-in, the project list, credential creation and one test event. It collects no telemetry and uploads no code.

## CI

```bash
NEX_TOKEN=nsk_live_… NEX_BROWSER_KEY=nex_pub_… npx @nerdstackgrp/nex-wizard@latest -i nextjs --yes
```

With `NEX_TOKEN` in the environment, the wizard doesn't sign in, and it writes no secrets to files: your CI keeps them. Create the token (and browser key) in Nex under **Application → SDK keys**. Without credentials, a non-interactive run stops and says what to set. After `login`, `--yes` also works without prompts.

## Troubleshooting

| You see | Do |
| --- | --- |
| `Could not reach Nex` | Check the connection; for your own Nex server pass `--api-url` or set `NEX_API_URL`. |
| `Sign-in timed out` | Finish signing in within 5 minutes; over SSH use `--no-browser` and open the link on your machine. |
| `You can't create SDK keys in …` | An owner or admin must run it, or give you `tokens.manage`. |
| `Multiple applications found` | Run it from the app's folder, or pass `--cwd apps/web`. |
| `… version isn't supported` | Upgrade the framework to the version shown. |
| A check fails after setup | `npx @nerdstackgrp/nex-wizard@latest doctor` |

## Adding an integration

The wizard's core never changes for a new framework. An integration is a folder:

```text
src/integrations/<id>/index.ts   export const <id>: Integration = { … }
src/integrations/registry.ts     one line: add it
src/integrations/types.ts        add the id to INTEGRATION_IDS
src/sdks.ts                      the SDK package, if it's a new one
```

An `Integration` defines:

- **Metadata:** `id`, `name`, `ecosystem`, and `status: "available"`.
- **The SDK:** `sdk`, an entry from `sdks.ts`. Package names live only there.
- **`compatibility`:** the framework versions it supports. Anything else is refused, with the supported range shown.
- **`detect(context)`:** a confidence from 0 to 100, plus the signals shown to the developer. The most specific framework should score highest: Next.js scores 95, React 70.
- **`needs(context)`:** whether it needs a server token, a browser key, or both.
- **`configure(context, setup)`:** stages its edits through `context.files` and returns the env variables, the manual steps, and a line each on source maps and releases. Use the helpers in `shared.ts` (`prependOnce`, `writeBlockFile`, `insertIntoArray`, `ensureIgnored`). Everything goes in fenced blocks, so the core gets idempotency, dry runs, diffs, the manifest and uninstall for free.
- **`instrumentationFiles(context)`:** where its blocks live, for `doctor`.

Installation, sign-in, project selection, verification and rollback are shared; an integration doesn't implement them. Test it like `tests/integrations.test.ts` does: a fixture app in, assertions on the staged files out, including `removeBlocks(after) === before`.

## Planned integrations

These are detected today. Each needs a Nex SDK before it can become `available`.

| `-i` | Detected by | What the SDK needs |
| --- | --- | --- |
| `react-native` | `react-native` dependency | `nex-js/client` relies on `window` and `document`. React Native needs its own entry for global errors (`ErrorUtils`), promise rejections, and native crashes (iOS/Android modules). |
| `flutter` | `pubspec.yaml` | A Dart package on pub.dev: `FlutterError.onError`, `PlatformDispatcher.onError`, zones. The wizard would use `flutter pub add`. |
| `go` | `go.mod` | A Go module: panics recovered in HTTP middleware (`net/http`, Gin, Echo), heartbeats, dependency checks. `go get`. |
| `swift` | `Package.swift`, `.xcodeproj` | A Swift package: `NSException` and signal handlers, and SwiftUI/UIKit lifecycles. Swift Package Manager. |
| `ruby` | `Gemfile` | A gem with Rack middleware and a Rails railtie. `bundle add`. |
| `php` | `composer.json` | A Composer package with error and exception handlers. `composer require`. |
| `laravel` | `artisan` + `laravel/framework` | The PHP SDK, plus a Laravel service provider and an exception reporter. |
| `spring-boot` | `pom.xml` / `build.gradle` with spring-boot | A Maven artifact: a Spring Boot starter with auto-configuration, `@ControllerAdvice`, Actuator health. |

All of them report to the same API (`/events`, `/heartbeat`, `/spans`, `/releases`) with an SDK token. The [API reference](https://nex.nerdstackgrp.com/docs/sdk) describes the payloads the JavaScript and Python SDKs send.

## Development

```bash
npm install            # from the repository root
cd packages/nex-wizard
bun test tests         # 102 tests: detection, edits, every command against a fake Nex
npx tsc --noEmit -p .
bun src/bin.ts --help  # run from source
```
