# Safe extraction

Run from the Aftertake checkout root:

```sh
python examples/make-the-next-take/unpack.py aftertake-product-film-inputs.zip --root .
python examples/make-the-next-take/verify.py
```

The standalone unpack.py is supplied with the repository example as well as inside the archive. It checks every archive path and checksum before writing, reuses identical existing files, and refuses to replace any existing file with different bytes. Use a matching checkout or a new empty destination if an earlier edited file conflicts; do not overwrite it blindly. No existing older example directory is touched.
