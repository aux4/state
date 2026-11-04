# state validate

```file:empty.state.yaml
version: 1
resources: {}
```

## should accept an empty stack

```execute
aux4 state validate
```

```expect
Valid: 0 resources.
```
