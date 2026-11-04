#### Description

Validate the definition envelope, references, dependency graph and provider schemas. This command does not access remote accounts or write state. Missing variables, invalid properties, duplicate names and dependency cycles fail validation.

#### Usage

```bash
aux4 state validate [--dir .] [--environment default] [--stateDir .aux4-state] [--recursive false] [--variables '{}'] [--format text]
```

--dir  Directory containing the definitions (default: `.`).
--environment  Independent environment name (default: `default`).
--stateDir  Record directory relative to dir (default: `.aux4-state`).
--recursive  Include non-hidden subdirectories except node_modules (default: `false`).
--variables  JSON object used by `${var.name}` references (default: `{}`).
--format  Output format, `text` or `json` (default: `text`). Inspect always returns JSON.

Use `--config dev` with a config section containing `environment: dev` and `variables` to select credentials and values together. The config key is `variables`; references use `${var.name}` and can use nested paths. The engine resolves them after parsing YAML; whole-value references preserve their types even when quoted. Definitions are combined across both `.state.yaml` and `.state.yml` suffixes; names must be unique. Provider packages must already be installed.

#### Example

```bash
aux4 state validate --config dev
```
