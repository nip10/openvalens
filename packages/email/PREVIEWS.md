# Email previews

From the repository root, render representative HTML and plain-text examples:

```sh
bun packages/email/scripts/render-previews.ts
```

The script writes `.html` and `.txt` examples for every current template family
to `packages/email/previews/generated/`. It includes a multi-category daily
reminder digest and English and Portuguese weekly insight digests. These
generated files are local preview artifacts and are not source files.
