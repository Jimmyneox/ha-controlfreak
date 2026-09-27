# Community submission kit

Nothing here has been done yet. Every step is the owner's click. Work through them in order.

## 1. Publish the GitHub repository

```sh
gh repo create Jimmyneox/ha-controlfreak --public --source . --remote origin \
  --description "Unofficial local Home Assistant integration for the Control Freak pool controller"
git push -u origin main
gh repo edit Jimmyneox/ha-controlfreak --add-topic home-assistant --add-topic hacs \
  --add-topic pool --add-topic home-assistant-custom-component --add-topic mqtt
gh repo edit Jimmyneox/ha-controlfreak --enable-issues
```

Once pushed, check that the **Validate** workflow is green. It runs hassfest, the HACS
action and pytest + ruff.

## 2. Tag the first release

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --notes-file CHANGELOG.md
```

`manifest.json` `version` must match the tag without the `v` (it's already `0.1.0`).

## 3. Brand images (in-repo)

`home-assistant/brands` no longer accepts new custom integrations (its PR template
points at the Brands Proxy API announcement, 2026-02-24). Since Home Assistant
2026.3 a custom integration ships its own images in a `brand/` folder, and HACS's
"Check brands" accepts that folder. So the images live here:

- `custom_components/controlfreak/brand/icon.png` — 256×256, square, transparent, trimmed
- `custom_components/controlfreak/brand/icon@2x.png` — 512×512

They are the Control Freak mark, supplied by the repository owner. The `ignore: brands`
key is gone from `.github/workflows/validate.yml`; the HACS action checks the folder.

## 4. HACS default repository (`hacs/default`)

Prerequisites (per HACS "include" rules):

- [ ] Public repo with a description and topics (step 1)
- [ ] At least one GitHub **release** (step 2), not just a tag
- [ ] `hacs.json` in the root (present) and `README.md` with usage (present)
- [ ] `manifest.json` with `domain`, `documentation`, `issue_tracker`, `codeowners`,
      `name`, `version` (present)
- [ ] Brand images present under `custom_components/controlfreak/brand/` (step 3)
- [ ] Validate workflow green: HACS action **without** `ignore: brands`, and hassfest
- [ ] Owner is the PR author and the repo isn't archived

Then:

1. Fork `hacs/default` and create a branch from `master`.
2. Edit the file named `integration` and add `"Jimmyneox/ha-controlfreak"` **in
   alphabetical order**.
3. Open the PR using the template and fill in every checkbox. The HACS bot runs its checks
   against the repo, so wait for them before asking for review.

## 5. Announce

Post `docs/forum-post.md` in the Home Assistant Community forum under
**Share your Projects → Custom Integrations**. Include the repo link and the HACS
custom-repository instructions until the default PR is merged.
