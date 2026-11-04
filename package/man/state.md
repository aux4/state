#### Description

Manage resources declared in .state.yaml and .state.yml files using separate environment records and installed provider packages. Supports validation, planning, apply, destruction, inspection and explicit import. References determine dependency order; providers declare supported properties and immutable fields. See aux4/state-stripe for products and prices.

#### Usage

```bash
aux4 state <validate|plan|apply|destroy|inspect|import>
```

#### Example

```bash
aux4 state plan --config dev
aux4 state apply --config dev
```
