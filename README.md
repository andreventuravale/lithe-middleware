### Notes

- When using bundlers, e.g esbuild, make sure the bundler is configured to keep function names untouched. This is critical if you use named-function middlewares.
  - use `--keep-names` in esbuild for example
