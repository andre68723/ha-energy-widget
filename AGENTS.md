# Agent guide

HA Energy Widget is a Home Assistant Lovelace card (custom element `ha-energy-widget`), written in TypeScript with
Lit 3 and built with Vite into one ES module. It is the Home Assistant counterpart of
[aharren/ios-energy-widget](https://github.com/aharren/ios-energy-widget) (local copy `~/Projects/ios-energy-widget`).
Target: Home Assistant 2026.10 or newer. Remote: `https://github.com/andre68723/ha-energy-widget`.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev page with a synthetic Home Assistant | `npm run dev`, open `/dev/index.html` (`?theme=dark`) |
| Types, lint, tests and build | `npm run check` |
| Single steps | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| Fix formatting | `npm run format` |

## Layout

| Path | Responsibility |
| --- | --- |
| `src/ha-energy-widget.ts` | Card element: Home Assistant card API (`setConfig`, `getGridOptions`, `getStubConfig`), refresh timer, rendering |
| `src/editor.ts` | Visual editor on `ha-form` (`ha-energy-widget-editor`) |
| `src/config.ts` | YAML shape, defaults, `resolveConfig()` |
| `src/data.ts` | WebSocket calls: Energy preferences, statistics, solar forecast; maps them to channels |
| `src/model.ts` | Pure model: 96 quarter-hour slots, mix rules, totals, forecast spreading, timeline columns |
| `src/view.ts` | Pure: ring specs and timeline bars from the model |
| `src/templates.ts`, `src/styles.ts` | SVG/Lit templates and CSS |
| `src/time.ts` | Time zone aware "start of day" without `Temporal` (not available in the iOS/Android apps' WebViews yet) |
| `src/localize.ts` | English and German strings |
| `dev/` | Dev page and `mock-hass.ts`, shared with the tests |
| `test/` | Vitest, runs in Node |

## Rules

* Keep `model.ts`, `view.ts`, `time.ts` and `config.ts` free of DOM and network code; test logic there.
* Do not use decorators or class fields for Lit properties: `useDefineForClassFields` is off and properties are
  declared with `static properties` plus `declare`. This keeps the build independent of decorator transforms.
* Never depend on Home Assistant frontend internals beyond the documented card API, `ha-card`, `ha-form` and the
  `hass` object. `src/types.ts` holds the few types that are needed; do not add `custom-card-helpers`.
* The mix is an estimate (see README, "How it works"). Never present estimated values as measured.
* A new option needs: `src/config.ts` (type, default, `resolveConfig`), the editor schema and labels in
  `src/localize.ts` (English and German), a test and the README table.
* Colors default to the Energy dashboard's theme variables (`--energy-*-color`), with fixed fallbacks.
* Read Home Assistant only; the dev page uses synthetic data, never real entity ids or personal data.
* Do not commit `dist/`, `node_modules/` or local notes; screenshots in `docs/` come from the dev page.

## Verification

`npm run check` must pass. It does not prove the card in a real Home Assistant: after a change to `data.ts`
check the WebSocket calls against a real instance (`energy/get_prefs`, `recorder/statistics_during_period` with
`units: {energy: "kWh"}`, `energy/solar_forecast`; shapes were last confirmed against a live 2026.10 system).
For visual changes run the dev page and look at the light and dark theme at 340 px and wider.

## Release

1. Update the version in `package.json` (and `package-lock.json`: `npm install --package-lock-only`).
2. `npm run check`, commit `chore(release): vX.Y.Z`.
3. `git tag vX.Y.Z && git push origin main vX.Y.Z`.
4. `.github/workflows/release.yml` builds the card and attaches `ha-energy-widget.js` to the GitHub release;
   HACS installs that file. The workflow refuses a tag that differs from `package.json`.

`.github/workflows/ci.yml` runs the checks and the HACS validation on every push and pull request.

## Commits

Conventional Commit subjects, English body explaining the reason, one logical change per commit, author
`andre68723`. Do not push unless the owner asks.
