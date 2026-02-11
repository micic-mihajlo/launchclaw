# Skills

Skills are modular capabilities that can be installed into your OpenClaw agent.

## Skill Bundles

Bundles are pre-configured lists of skills grouped by use case:

| Bundle | File | Description |
|--------|------|-------------|
| Coding | `bundles/coding.txt` | Development tools, code review, git workflows |
| Business | `bundles/business.txt` | Productivity, communication, document handling |
| Research | `bundles/research.txt` | Web research, analysis, summarization |

## Installing a Bundle

```bash
# Install all skills in a bundle
while read -r skill; do
  openclaw skills install "$skill"
done < bundles/coding.txt
```

## Adding Custom Skills

1. Create a new `.txt` file in `bundles/` with one skill per line
2. Lines starting with `#` are comments
3. Empty lines are ignored
4. Run the install loop above with your bundle file

## Listing Installed Skills

```bash
openclaw skills list
```

## Removing Skills

```bash
openclaw skills remove <skill-name>
```
