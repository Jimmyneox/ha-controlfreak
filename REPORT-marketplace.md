# Marketplace wave report: modular dashboard, docs, catalog readiness (2026-10-13)

Branch `marketplace-0.2.0` in worktree `sharp-einstein-da1d44`. **Not committed and not
pushed yet:** the commit and push step was declined at the approval prompt. All changes
are staged in the worktree. No hacs/default PR, no release, no tag. The live Home Assistant
install was not touched.

## What changed

**1. Dashboard strategy.** The new file is
`custom_components/controlfreak/frontend/controlfreak-strategy.js`.
- **Loading.** It is served with `async_register_static_paths` and loaded with
  `add_extra_js_url` (`?v=<version>` busts the browser cache). It also registers in
  `window.customStrategies`, so it appears in **Add dashboard**.
- **API.** Built against the current custom-strategy docs and the frontend source
  (`ll-strategy-{dashboard,view,section}-controlfreak`, `registryDependencies: ["entities"]`).
- **What it renders.** Entities come from `hass.entities`, filtered by platform
  `controlfreak` and grouped by `translation_key`. No entity ids are hard-coded. Sections
  only appear for equipment that exists:
  - Pumps: tile with `fan-speed` (and `fan-preset-modes` when supported). Each mode select
    sits under its own pump, paired by longest name prefix.
  - Heating and cooling.
  - Lights and relays: lights get `light-effect`; relays get `toggle`.
  - Valves: read-only, with icon tap opening more-info. A native `valve` entity would get
    `valve-open-close`.
  - Temperature and flow: temperatures get `trend-graph`. `pressure` is recognised, ready
    for when it becomes an entity.
  - Controller health.
  - Other equipment: anything unrecognised lands here instead of being dropped.
- **Options and cards.** Options are `hide`, `order`, `titles` and `device_id`. The section
  strategy takes `equipment: <type>` for dropping a single block into an existing view. Only
  core cards are used (heading, tile, markdown).
- **Backend change.** Only translation keys were added: `pump`, `light`, `relay`, `valve`,
  `temperature`, `flow`, plus `heater` and `chiller`. Names and unique ids are unchanged.
  `manifest.json` gains `dependencies: [frontend, http]`.
- **Heaters and chillers (teammate review).** A relay's role is now decided by a pure
  function, `mapping.relay_role`, from the setting's `connection_type.name`, never from its
  port. The captured catalogue has Gas Heater, Heat Pump, Chiller and General on the
  low-voltage relays. ⚠ The field and its values come from captured API shapes, but **no
  live controller has had a heater or chiller configured**, so a live panel still needs to
  confirm them.
- **Pressure.** The panel publishes `controller/pressure/status`, but device-settings has
  no pressure type, so **no pressure entity exists** today.

**2. Docs.**
- `docs/controlfreak.md` follows the home-assistant.io integration template: front matter,
  then every section the brief listed. It uses plain Markdown tables, because GitHub doesn't
  render the Jekyll tags, and `UPPER_CASE` placeholders.
- Board facts are paraphrased from the owner's manual. The outputs are described as
  flexible, with heater or chiller as one optional role of a low-voltage relay.
- The README is shorter and links to the docs page.
- The CHANGELOG and the version are bumped to **0.2.0**, in both `manifest.json` and
  `pyproject.toml`.

**3. Catalog readiness.**
- `docs/SUBMISSION.md` was re-checked against today's HACS include rules and PR template,
  and now holds the drafted PR text.
- **0 runs:** Actions is enabled and the workflow is active, but the 2026-09-27 pushes
  produced no check suites at all. A manual dispatch on `main` ran all 3 jobs green: hassfest,
  HACS action, pytest + ruff ([run 38463348446](https://github.com/Jimmyneox/ha-controlfreak/actions/runs/38463348446)).
  The jobs work; only the push trigger never fired. That isn't proven fixed until the branch
  is pushed.
- The run the closed PR #11349 linked (`36357415290`) returns **404**.
- v0.1.0 and v0.1.1 releases already exist, but both predate any green run. The v0.2.0
  release must follow a green run.
- CI now also runs `node --test` and a Playwright render job that uploads screenshots.

## Tests
- **pytest:** 48 passed (38 → 48).
  - New tests check that the strategy is served over HTTP.
  - Every entity's translation key must be in the strategy's table.
  - Relay roles are tested on both low- and high-voltage ports.
  - The JS fixtures are **generated from the integration's real entities**, and a stale
    fixture fails the test.
- **node --test:** 24 passed. Shapes covered: full five-pump pool, lighting-only, valves and
  skimmers, empty, plus unknown equipment, hidden entities and the options.
- **ruff:** check and format are clean.
- **Made red once:**
  - Broke the "Other equipment" fallback, the platform filter, `hide`, the valve
    no-toggle rule, pump pairing (after I added a test that catches it), the heater key,
    and heat-pump-means-heater: each turned tests red.
  - Removed a backend translation key: pytest went red.
- **No link to the app code:** `grep -rnI "ControlFreak[P]ool\b" --exclude-dir=.git --exclude-dir=.venv .`
  returns nothing (exit 1), and returns a hit when an app-code path is planted. The `[P]`
  matches the same text but stops this line from matching itself.
  The check as originally specified (`-i`) also matches the requested
  `https://controlfreakpool.com` links, so it can't pass alongside them. The case-sensitive
  form separates the two; the owner accepted it as the standing check on 2026-10-13. There is no remote other than `origin`, no submodule, and no
  mention in any commit message.
- **Site links:** README, the docs intro and supported-devices sections, and the PR text link
  only `https://controlfreakpool.com` (root URL). `manifest.json` `documentation` still points
  at the repo docs.
- **Leak scan:** 27 changed files, 0 hits for IPs (loopback aside), emails, the pool name or
  controller ids.

## Screenshots (static harness `tests/frontend/harness.html`, Playwright)
`docs/images/dashboard-full-pool.png`, `-lighting-only.png`, `-valves-skimmers.png`,
`-empty.png`. The harness runs the real strategy module but draws simplified stand-ins for
the core cards: it checks structure, **not** Home Assistant's own rendering. Nothing has been
rendered in a real HA frontend yet.

## Blocked or left for you
- **Commit and push** were declined, so the branch CI and the push-trigger test haven't run.
- **Brand icons:** new 256/512 PNGs rendered from your `logo-mark-small.svg`, plus
  `dark_icon` variants, are in the session scratchpad. Overwriting the committed icons was
  blocked by the permission classifier.
- **Disclaimer:** the README still says "Unofficial. Not affiliated with … Control Freak
  Pool Tech". The teammate relayed that you designed the board. The docs page now credits
  Control Freak as the maker and makes no affiliation claim either way; the README needs
  your wording.

## Next step
Approve the commit and push of `marketplace-0.2.0` (one approval, about 10 min of CI). It
runs all 5 CI jobs on the branch and answers whether push triggers work now. One decision
to make alongside it: replace the brand icons with the SVG renders, and change the README
disclaimer to your own wording.
