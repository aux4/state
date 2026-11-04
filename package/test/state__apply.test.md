# state apply

```file:empty.state.yaml
version: 1
resources: {}
```

## should apply an empty stack

```execute
aux4 state apply --yes true
```

```expect:partial
Plan: 0 create, 0 update, 0 replace, 0 destroy, 0 unchanged.
```

```afterAll
rm -rf .aux4-state
```
