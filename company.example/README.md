# company.example

The private half of tepui, as a runnable example.

Copy it and make it yours:

```bash
cp -r company.example company
```

`company/` is gitignored in this template. In real use it lives in a **private
repo** that adds this repo as `upstream`:

```bash
git remote add upstream git@github.com:<org>/tepui.git
git pull upstream main        # core improvements flow down
```

Your context lives in paths this template does not have, so upstream merges
never touch it. Conflicts only occur where you edited core — which is exactly
what you would want to contribute back.
