#### Description

Read actual resources, display a fresh plan and apply changes in dependency order. Replacements create first and retire old resources after dependents are updated. Acquire an environment lock and checkpoint each mutation. An interrupted operation is resumed with the same request and idempotency key when rerunning with unchanged definitions within 23 hours. preventDestroy blocks removal and replacement. Without --yes true, type yes at the interactive prompt; non-interactive execution requires --yes true.

#### Usage

```bash
aux4 state apply [--dir .] [--environment default] [--stateDir .aux4-state] [--recursive false] [--variables '{}'] [--format text] [--yes false]
```

--dir  Directory containing the definitions (default: `.`).
--environment  Independent environment name (default: `default`).
--stateDir  Record directory relative to dir (default: `.aux4-state`).
--recursive  Include non-hidden subdirectories except node_modules (default: `false`).
--variables  JSON object used by `${var.name}` references (default: `{}`).
--format  Output format, `text` or `json` (default: `text`). Inspect always returns JSON.

Use `--config dev` with a config section containing `environment: dev` and `variables` to select credentials and values together. The config key is `variables`; references use `${var.name}` and can use nested paths. The engine resolves them after parsing YAML; whole-value references preserve their types even when quoted. Definitions are combined across both `.state.yaml` and `.state.yml` suffixes; names must be unique. Provider packages must already be installed.

--yes  Apply without prompting (default: `false`).

#### Example

```bash
aux4 state apply --config dev --yes true
```
