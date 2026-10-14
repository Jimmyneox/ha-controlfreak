# Catalog submission kit

Home Assistant 2026.11 folds HACS into Core as **Marketplace**. Marketplace reads the same
catalog as HACS, so getting listed is still a pull request to
[`hacs/default`](https://github.com/hacs/default) from this repository. Every step that
publishes something is the owner's click.

Checked against the HACS publishing docs and the `hacs/default` PR template on 2026-10-13.

## State on 2026-10-13

| Requirement (HACS "include" + integration rules) | State |
|---|---|
| Public GitHub repo, owner submits | ✅ `Jimmyneox/ha-controlfreak`, public |
| Repo has a description | ✅ |
| Issues enabled | ✅ |
| Topics defined | ✅ `hacs`, `hacs-integration`, `home-assistant`, `mqtt`, `pool` |
| Not archived | ✅ |
| One integration under `custom_components/` | ✅ `controlfreak` |
| `manifest.json` has `domain`, `documentation`, `issue_tracker`, `codeowners`, `name`, `version` | ✅ |
| `hacs.json` with at least `name` | ✅ (`country` not needed: not region-specific) |
| Brand images: `custom_components/controlfreak/brand/icon.png` (HACS "Check brands") | ✅ icon, icon@2x, dark_icon, dark_icon@2x |
| HACS action passes **without** an `ignore` key | ✅ on `main` (run linked below); re-run on the release commit |
| hassfest passes | ✅ on `main`; re-run on the release commit |
| A full GitHub release **created after** the actions passed | ❌ v0.1.0 and v0.1.1 exist, but both predate any green run. Cut v0.2.0 after CI is green on it |
| Links to the release and to both green action runs in the PR | ❌ needs the v0.2.0 run |

## Why CI had 0 runs

The Validate workflow is active and Actions is enabled with "all actions allowed", yet
GitHub had no run and no check suite at all for the two pushes on 2026-09-27. The workflow
file was valid: a manual `workflow_dispatch` on `main` on 2026-10-13 ran all three jobs green
([run 38463348446](https://github.com/Jimmyneox/ha-controlfreak/actions/runs/38463348446)).
So the jobs work, and the gap was only that push events didn't start the workflow. Push
triggers work now: both pushes of the `marketplace-0.2.0` branch on 2026-10-13 started runs
on their own, and the second was green on all 5 jobs
([run 38486604696](https://github.com/Jimmyneox/ha-controlfreak/actions/runs/38486604696)).
The September gap can't be diagnosed after the fact.

The earlier PR (hacs/default#11349) linked run `36357415290` as its green HACS and hassfest
run. That run returns 404 on this repository, so don't reuse those links.

## Steps (owner)

1. Merge `marketplace-0.2.0` into `main` and wait for **Validate** to go green on that
   commit (hassfest, HACS action, pytest + ruff, dashboard strategy, render check).
2. Tag and release **v0.2.0** (manifest `version` is `0.2.0`):

   ```sh
   gh release create v0.2.0 -R Jimmyneox/ha-controlfreak --target main --title "v0.2.0" --notes-file /Users/jimmy/ha-controlfreak/CHANGELOG.md
   ```

3. Fork `hacs/default`, branch from `master`, and add `"Jimmyneox/ha-controlfreak"` to the
   file named `integration` in alphabetical order (`lint sorted` checks it).
4. Open the PR with the text below, filling in the three links. Don't request reviews, don't
   comment while it's queued; the bot's checks (brands, manifest, hacs-validation, HACS
   manifest, archived, releases, owner, repository, lint) must all pass.

## Draft PR text

Title: `Adds new integration [Jimmyneox/ha-controlfreak]`

```markdown
## Checklist

- [x] I've read the [publishing documentation](https://hacs.xyz/docs/publish/start).
- [x] I've added the [HACS action](https://hacs.xyz/docs/publish/action) to my repository.
- [x] (For integrations only) I've added the [hassfest action](https://developers.home-assistant.io/blog/2020/04/16/hassfest/) to my repository.
- [x] The actions are passing without any disabled checks in my repository.
- [x] I've added a link to the action run on my repository below in the links section.
- [x] I've created a new release of the repository after the validation actions were run successfully.

## Links

Link to current release: <https://github.com/Jimmyneox/ha-controlfreak/releases/tag/v0.2.0>
Link to successful HACS action (without the `ignore` key): <RUN_URL/job/HACS_JOB_ID>
Link to successful hassfest action (if integration): <RUN_URL/job/HASSFEST_JOB_ID>

## About the repository

Control Freak Automated Pool System: a local-push integration for the Control Freak pool
automation controller (<https://controlfreakpool.com>). It discovers the configured equipment from the controller's own REST
API and takes live values from the controller's MQTT broker over WebSockets. No cloud, and
it doesn't depend on Home Assistant's MQTT integration. Pumps, heaters and chillers, lights
and relays, valves, temperatures, flow and controller health; entities follow the
controller's configuration without a restart.

It also ships a dashboard strategy (`custom:controlfreak`, core cards only) that builds a
section per equipment type the controller actually has. Brand images ship in-repo under
`custom_components/controlfreak/brand/`. I am the repository owner, and this is Control
Freak's official integration for its controller.
```

## After the PR is merged

Post `docs/forum-post.md` in the Home Assistant Community forum under **Share your
Projects → Custom Integrations**, linking the repository and `docs/controlfreak.md`.
