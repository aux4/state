# state import

```file:empty.state.yaml
version: 1
resources: {}
```

## should reject an unknown resource

```execute
aux4 state import --resource missing --id prod_existing
```

```error:partial
Unknown resource: missing
```
