#### Description

Print the saved environment record as JSON without accessing providers. Includes managed IDs, properties, provider descriptors, pending retirement and interrupted operation details. Missing state returns an empty record with serial zero. No file is created. Back up records; never put credentials in resource properties or provider configuration.

#### Usage

```bash
aux4 state inspect [--dir .] [--environment default] [--stateDir .aux4-state] [--recursive false] [--variables '{}'] [--format text]
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
aux4 state inspect --config dev
```
