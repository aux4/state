# state destroy


## should leave an empty environment unchanged

```execute
aux4 state destroy --yes true
```

```expect:partial
Plan: 0 create, 0 update, 0 replace, 0 destroy, 0 unchanged.
```

```afterAll
rm -rf .aux4-state
```
