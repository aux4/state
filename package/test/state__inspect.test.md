# state inspect


## should show a new environment

```execute
aux4 state inspect | jq "{version, environment, serial}"
```

```expect:json
{
  "version": 1,
  "environment": "default",
  "serial": 0
}
```
