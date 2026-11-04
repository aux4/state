# state plan

```file:empty.state.yaml
version: 1
resources: {}
```

## should show no changes

```execute
aux4 state plan
```

```expect:partial
Plan: 0 create, 0 update, 0 replace, 0 destroy, 0 unchanged.
```
