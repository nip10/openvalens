# Exercise catalog sample: attribution

This folder is a small sample of the exercise catalog for the demo seed and
e2e (Issue #400). Running servers import the full catalog automatically; see
[`docs/exercise-catalog-assets.md`](../../../docs/exercise-catalog-assets.md).

- **`workout-guide/<exercise>/frame-<n>.png`**: illustrations from
  [Workout Guide](https://github.com/bryllim/workout-guide) by
  [Bryl Lim](https://bryllim.com), based on
  [Everkinetic](https://github.com/everkinetic/data), licensed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Copied
  unmodified from commit `aac599224bb9780305239607ef98540b7e0ce389`. Upstream
  changes to the Everkinetic drawings are listed per frame in
  `workout-guide-sample.json`. When the server publishes a frame it decodes,
  strips metadata and re-encodes it as PNG; that copy carries a modification
  notice and stays under CC BY-SA 4.0.
- **`workout-guide-sample.json`**: the matching entries of the Workout Guide
  manifest (package metadata, MIT, © 2026 Bryl Lim).
- **`wger-sample.json`**: 12 exercises from [wger](https://wger.de), trimmed to
  the fields the importer reads. Each record and translation keeps its own
  licence (CC BY-SA 3.0 or 4.0) and author, and the app shows them on every
  exercise.
