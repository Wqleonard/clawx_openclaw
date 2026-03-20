---
name: clawhub
description: Use the ClawHub CLI to search, install, update, and publish agent skills. Always install/update into the current workspace by passing explicit --workdir and --dir.
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["clawhub"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "clawhub",
              "bins": ["clawhub"],
              "label": "Install ClawHub CLI (npm)",
            },
          ],
      },
  }
---

# ClawHub CLI (Workspace-Scoped)

Use ClawHub to search/install/update/publish skills.

## Important Rule

Skill creation/installation location is mandatory:

- All new skills MUST be created under the current workspace.
- Never create or install skills into main/default/global workspaces unless the user explicitly requests it.
- Always use the current workspace absolute path as `--workdir`.

Always pass an explicit workspace path:

- `--workdir "<absolute-workspace-path>"`
- `--dir skills`

Do not rely on CLI defaults for install/update destination.
Target directory must be `<current-workspace>/skills/<slug>`.

## Install CLI

```bash
npm i -g clawhub
```

## Auth (publish)

```bash
clawhub login
clawhub whoami
```

## Search

```bash
clawhub search "postgres backups"
```

## Install (always workspace-scoped)

```bash
clawhub install my-skill --workdir "$PWD" --dir skills
clawhub install my-skill --version 1.2.3 --workdir "$PWD" --dir skills
```

If you already know the current workspace absolute path, use it directly:

```bash
clawhub install my-skill --workdir "/abs/path/to/workspace" --dir skills
```

## Update (always workspace-scoped)

```bash
clawhub update my-skill --workdir "$PWD" --dir skills
clawhub update my-skill --version 1.2.3 --workdir "$PWD" --dir skills
clawhub update --all --workdir "$PWD" --dir skills
clawhub update my-skill --force --workdir "$PWD" --dir skills
clawhub update --all --no-input --force --workdir "$PWD" --dir skills
```

## List

```bash
clawhub list --workdir "$PWD" --dir skills
```

## Publish

```bash
clawhub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs" --workdir "$PWD" --dir skills
```

## Notes

- Default registry: `https://clawhub.com` (override with `CLAWHUB_REGISTRY` or `--registry`)
- To avoid wrong install target, prefer explicit `--workdir` and `--dir` on every install/update/list command
- Before running install/update, verify that `--workdir` equals the current workspace path (not main/default/global path)
- Alternative: set `CLAWHUB_WORKDIR` before running commands, but explicit flag is preferred
