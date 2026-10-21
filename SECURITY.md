# Security

Aftertake runs a local server that only accepts requests addressed to
`127.0.0.1` or `localhost` and rejects cross-origin writes. API keys for cloud
rendering stay in the server's memory and are never written to disk.

If you find a vulnerability, please report it privately through
[GitHub's security advisories](https://github.com/ItsSNOWMOBILE/aftertake/security/advisories/new)
rather than in a public issue. Include the steps to reproduce it and the
version or commit you tested.
