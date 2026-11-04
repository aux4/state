# aux4/state

Manage resources declared in `.state.yaml` and `.state.yml` files. Preview changes, apply them in dependency order, and keep an independent resource record for each environment. Provider packages supply resource schemas and lifecycle operations.

## Installation

Requires Node.js 22 or later.

```bash
aux4 aux4 pkger install aux4/state
aux4 aux4 pkger install aux4/state-stripe
```

## Package responsibilities

| Package | Responsibility |
|---|---|
| `aux4/state` | Parse declarations, validate inputs, compare desired and actual resources, order changes and save environment records |
| `aux4/state-stripe` | Define Stripe resource schemas, defaults, immutable fields and lifecycle behavior |
| `community/stripe` | Perform Stripe API communication, authenticate requests, encode data and retry idempotent requests |

For Stripe, the call chain is `aux4/state` → `aux4/state-stripe` → `community/stripe`. The engine contains no Stripe-specific API behavior. Other resource providers can implement the same provider contract.

## Quick Start

Create `billing.state.yaml`:

```yaml
version: 1
providers:
  stripe:
    package: aux4/state-stripe
    config:
      apiKeyEnv: ${var.stripeKeyEnv}
      mode: ${var.stripeMode}
resources:
  pro:
    type: stripe/product
    properties:
      name: "${var.productName}"
      description: Pro subscription
      metadata:
        team: billing
      images:
        - https://example.com/pro.png
      marketing_features:
        - name: Unlimited projects
  proMonthly:
    type: stripe/price
    properties:
      product: ${resources.pro.id}
      currency: usd
      unit_amount: "${var.monthlyAmount}"
      recurring:
        interval: month
      lookup_key: pro_monthly
  proYearly:
    type: stripe/price
    properties:
      product: ${resources.pro.id}
      currency: usd
      unit_amount: "${var.yearlyAmount}"
      recurring:
        interval: year
      lookup_key: pro_yearly
```

Create `config.yaml` using `aux4/config`:

```yaml
config:
  dev:
    environment: dev
    variables:
      stripeKeyEnv: STRIPE_DEV_API_KEY
      stripeMode: test
      productName: Pro Development
      monthlyAmount: 500
      yearlyAmount: 5000
  staging:
    environment: staging
    variables:
      stripeKeyEnv: STRIPE_STAGING_API_KEY
      stripeMode: test
      productName: Pro Staging
      monthlyAmount: 1000
      yearlyAmount: 10000
  prod:
    environment: prod
    variables:
      stripeKeyEnv: STRIPE_PROD_API_KEY
      stripeMode: live
      productName: Pro
      monthlyAmount: 2000
      yearlyAmount: 20000
```

Populate those environment variables through your normal secret management, then run:

```bash
aux4 state validate --config dev
aux4 state plan --config dev
aux4 state apply --config dev
aux4 state plan --config prod
aux4 state apply --config prod
```

`apply` displays a fresh plan and asks for `yes`. For automation, use `--yes true`. Planning and validation never write resources or state files. Validation checks schemas without accessing Stripe; planning reads actual remote resources.

## Configuration

The complete definition envelope is:

```yaml
version: 1
providers:
  stripe:
    package: aux4/state-stripe
    command: [aux4, state, stripe, resource] # default for provider named stripe
    config:
      apiKeyEnv: ${var.stripeKeyEnv}
      mode: ${var.stripeMode}
      # account: acct_connectedAccount # optional connected account
resources:
  pro:
    type: stripe/product
    dependsOn: [] # optional explicit resource dependencies
    lifecycle:
      preventDestroy: false # default: false
    properties:
      name: ${var.productName}
```

The provider's schema determines which properties are valid. The engine supports nested objects, arrays, strings, numbers, booleans and null; providers can constrain these types. Stripe metadata values must be strings. Use Stripe's snake_case property names, such as `unit_amount` and `marketing_features`.

Set `variables` through `--config <environment>` or `--variables '<JSON object>'`. References such as `${var.productName}` support nested paths. A reference occupying an entire value preserves its type, including arrays and objects. Embedded references produce strings. Unresolved references are errors.

`variables` remains the key in `config.yaml`; `${var.name}` is the reference syntax in a state file. `aux4/config` reads the selected config section and aux4 passes its `variables` object to the engine. The engine parses the state YAML first and then resolves those references; it does not rewrite either file. Quoting a whole-value reference is valid YAML and still preserves the config value's number, boolean, object or array type. For example, `unit_amount: "${var.monthlyAmount}"` receives the number `500` in dev, rather than the string `"500"`.

Use `${var.billing.amount}` for nested variables. A value such as `name: "Pro ${var.region}"` interpolates a scalar into a string. Object or array references must occupy the entire value.

`package` documents which provider package to install; it does not install or execute it automatically. `command` is an argument array executed without a shell. Resource files and providers are executable configuration: use definitions from trusted sources.

## Files and environments

All matching files in `--dir` (default `.`) form one stack. Both suffixes are recognized. Use `--recursive true` to include subdirectories; hidden directories and `node_modules` are excluded. Duplicate resource/provider names, duplicate YAML keys, unknown fields, missing dependencies and cycles are errors. Declare each provider once across the stack.

`--environment` defaults to `default`. With `--config dev`, set `environment: dev` in the config section as shown above. Environment names allow letters, numbers, underscores and dashes. Files, remote IDs and execution journals are separate for every environment:

```text
.aux4-state/dev.json
.aux4-state/staging.json
.aux4-state/prod.json
```

Use `--stateDir` to choose another directory; relative paths resolve from `--dir`. Back up these files and add `.aux4-state/` to your project's `.gitignore`. They contain resource properties, IDs and provider configuration; put credentials in environment variables, not resource definitions or provider config. Stripe stores the API key variable name, never the API key.

**Use a different Stripe account or sandbox for dev and staging when both use test mode.** Environment names isolate tracking; they do not partition resources inside a shared Stripe account. Reusing lookup keys in the same account/mode can conflict. An environment's recorded account and test/live mode must match on every subsequent plan/apply/import/destroy; rotating a key for the same account and mode is supported.

## Changes and dependencies

`${resources.pro.id}` references the ID managed in the selected environment. `${resources.pro.properties.name}` references declared properties. References and `dependsOn` determine creation order; destruction runs in reverse dependency order. Array order is significant. Object key order is not.

Provider schemas supply defaults and immutable property paths. Supported properties, including defaults, are reconciled against actual remote values. A nested value change produces a path such as `metadata.team`; a change to an immutable path causes replacement. Unknown remote fields outside the provider's supported property surface are ignored. Removing optional properties resets them to schema defaults where supplied; providers define any other clearing behavior.

Replacements create the new resource first, update dependents, and then retire the old resource. A resource removed from the definitions is destroyed only if tracked in this environment. The engine never deletes untracked resources. To remove all resources after deleting the definition files, use `destroy`.

`lifecycle.preventDestroy: true` protects both removal and replacement. To disable previously recorded protection, set it to `false` and apply that change before removing or replacing the resource.

## Existing resources

Adopt existing resources by explicit ID, importing dependencies first:

```bash
aux4 state import --resource pro --id prod_existing --config dev
aux4 state import --resource proMonthly --id price_existing --config dev
aux4 state plan --config dev
```

Import changes only local tracking. The next plan compares the declaration against the remote object. Resources are not automatically adopted by display name.

## Execution and recovery

Apply/import/destroy acquire a local lock for the selected environment. Remote changes are checkpointed individually and files are replaced atomically. An interrupted operation retains its request and idempotency key; restore the same definitions and rerun the same command to resume. Do not run a different resource change while that request is pending.

Automatic retries stop after 23 hours to avoid replaying a create after Stripe's idempotency retention window. Beyond that window, inspect the remote account and reconcile the pending journal manually before continuing. If a process was killed, remove its `.lock` file only after confirming no process is still using this environment.

**State storage is local.** Use one writer and a shared, properly locked filesystem if multiple machines operate on the same environment. There is no remote backend, distributed locking, or automatic rollback of a partially completed apply.

## Commands

| Command | Behavior |
|---|---|
| `aux4 state validate` | Check definitions and provider schemas without remote reads |
| `aux4 state plan` | Read remote resources and preview changes |
| `aux4 state apply` | Reconcile the selected environment |
| `aux4 state destroy` | Destroy all tracked resources in reverse order |
| `aux4 state inspect` | Print the saved environment record as JSON |
| `aux4 state import --resource <name> --id <id>` | Adopt an existing remote resource |

Common options: `--dir .`, `--environment default`, `--stateDir .aux4-state`, `--recursive false`, `--variables '{}'`, `--format text`. Use `--format json` for machine-readable plans and results. `inspect` always returns JSON. `apply` and `destroy` support `--yes true`.

## Provider contract

See `aux4/state-stripe` as a working provider. A provider command receives one JSON request on stdin and returns one JSON object on stdout. Diagnostics go to stderr and failures use a nonzero exit code. Protocol version is `1`.

| Action | Request fields beyond `version`, `action`, `config` | Response |
|---|---|---|
| `schema` | None | `version: 1`, `resources` mapping resource type names to `schema` and `immutable` paths |
| `identity` | None | Stable nonempty JSON identity, such as account ID and mode; never credentials |
| `read` | `type`, `id` | `exists: false`, or `exists: true`, `id`, canonical `properties` |
| `create` | `type`, `properties`, `resource`, `stackId`, `idempotencyKey`; optional `replaces`, `previous` | `id`, optional `properties` |
| `update` | `type`, `id`, `properties`, `previous`, `resource`, `stackId`, `idempotencyKey` | `id`, optional `properties` |
| `delete` | `type`, `id`, `idempotencyKey` | JSON object acknowledging completion |

`type` omits the provider prefix. Schemas support `type` (including a list of types), `properties`, `required`, `additionalProperties`, `items`, `enum`, `default`, `minimum`, and `minLength`. Other JSON Schema features and unordered/keyed array semantics are not implemented. Immutable paths apply to a whole property or nested subtree. `read` must return canonical supported properties with defaults; it must distinguish not-found from permission/network failures.

Mutation requests must be idempotent for repeated identical keys; deletion of an already absent resource must succeed. `previous` is the read snapshot saved before mutation, so providers can construct deterministic field-clearing requests. Reads, identity and schema must be side-effect free. Providers have a two-minute request timeout and a 16 MiB response limit.
