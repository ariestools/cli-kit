# @ariestools/cli-kit-yargs

Yargs adapter for reusable actor command-line applications.

The package keeps Yargs out of `@ariestools/cli-kit` while routing parser help, version, validation errors, asynchronous failures, and exits through the core `ProcessHost` boundary. This makes a configured CLI safe to exercise with a recording host instead of allowing Yargs to write to the ambient console or terminate the test process.

Use `environmentToYargsConfig` when an application owns config-file loading and wants to replace Yargs' process-global `.env()` lookup with an explicitly supplied environment. The resulting flat dotted object preserves Yargs' environment key normalization and can be passed to `.config()` before parsing:

```ts
await runYargsApplication({
  host,
  configure: parser => parser
    .config(environmentToYargsConfig(host.environment, 'XL1'))
    .scriptName('xl1')
    .command(commands)
    .help()
    .version(version),
})
```

This conversion preserves command-line-over-environment precedence, but it is not a general substitute for `.env()` in applications that also use Yargs-native config-file options: Yargs ranks config objects below config files, and treats a top-level `extends` key in a config object specially. Such applications should resolve those precedence and reserved-key rules before passing the object to `.config()`.

## License

LGPL-3.0-only
