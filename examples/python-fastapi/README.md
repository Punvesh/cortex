# Example: Python FastAPI

Index a Python FastAPI project:

```bash
cortex index /path/to/fastapi-app

# Find all route handlers (typically named with route_ prefix)
cortex query search route_

# What does app/routers/users.py import?
cortex query deps app/routers/users.py

# Who calls get_db?
cortex query callers get_db

# Open the dashboard
cortex dashboard
```

## Notes on Python indexing

- Public functions (no leading `_`) are marked as `exported`
- `__all__` lists are respected — if present, only listed names are exported
- Class methods are tracked as `ClassName.method_name`
- `import x` and `from x import y` are both captured
