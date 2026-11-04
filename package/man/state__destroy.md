#### Description

Destroy every tracked resource in the selected environment in reverse dependency order. Definition files are not required; saved provider descriptors and their credential environment variables are used. Only managed resources are affected. The Stripe provider archives products and prices. preventDestroy is honored. Acquire a local lock and checkpoint each completed operation. Without --yes true, type yes at the interactive prompt.

#### Usage

```bash
aux4 state destroy [--dir .] [--environment default] [--stateDir .aux4-state] [--recursive false] [--variables '{}'] [--format text] [--yes false]
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
aux4 state destroy --config dev --yes true
```
