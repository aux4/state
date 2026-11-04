#### Description

Adopt a remote resource by explicit ID without modifying it. The named resource must exist in the definitions and must not already be managed. The provider reads it and saves its canonical properties. Import dependencies first, then review plan for differences from the declaration. Acquire an environment lock and verify account identity. Import is blocked while an interrupted mutation is pending.

#### Usage

```bash
aux4 state import [--dir .] [--environment default] [--stateDir .aux4-state] [--recursive false] [--variables '{}'] [--format text] --resource <name> --id <remoteId>
```

--dir  Directory containing the definitions (default: `.`).
--environment  Independent environment name (default: `default`).
--stateDir  Record directory relative to dir (default: `.aux4-state`).
--recursive  Include non-hidden subdirectories except node_modules (default: `false`).
--variables  JSON object used by `${var.name}` references (default: `{}`).
--format  Output format, `text` or `json` (default: `text`). Inspect always returns JSON.

Use `--config dev` with a config section containing `environment: dev` and `variables` to select credentials and values together. The config key is `variables`; references use `${var.name}` and can use nested paths. The engine resolves them after parsing YAML; whole-value references preserve their types even when quoted. Definitions are combined across both `.state.yaml` and `.state.yml` suffixes; names must be unique. Provider packages must already be installed.

--resource  Resource name from the definitions (required).
--id  Existing remote ID (required).

#### Example

```bash
aux4 state import --resource pro --id prod_existing --config dev
```
