# Contributing to Aftertake

Thanks for helping. Aftertake is a local studio, so the most useful
contributions improve a real workflow and come with something that proves it.

## Before you start

- Open an issue for anything larger than a small fix, so the approach can be
  agreed first.
- Search the [studio guide](docs/studio-guide.md) and [MCP reference](docs/mcp.md);
  many behaviors are documented with their reasons.

## Set up

```sh
pnpm install
node scripts/aftertake.mjs doctor   # checks Node, Python and the media runtime
pnpm dev                            # the studio server, reloading on change
```

GPU generation needs Windows or Linux with an NVIDIA GPU; see the
[hardware guide](docs/hardware.md). Editing, Film, finishing and every test
below run without one.

## Checks

Run these before opening a pull request:

```sh
pnpm lint      # Prettier
pnpm test      # TypeScript tests
pnpm build     # typecheck and production build
python -m unittest discover -s tests -p "test_*.py"   # in .runtime/film-venv or .runtime/venv
```

## Pull requests

- Keep each pull request to one change, and describe the workflow it improves.
- Add or update tests next to the code you change.
- For a generation change, include a small reproducible recipe or project, the
  hardware it ran on, and the executed graph from the result.
- Only add media you have permission to share, with its source and license in
  [media attribution](docs/media-attribution.md).
- Model weights are never committed. Pin new models in a `docs/models-*.json`
  manifest with revision, size, SHA-256 and license.

## License

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
