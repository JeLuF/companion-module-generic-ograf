# companion-module-generic-ograf

[Bitfocus Companion](https://bitfocus.io/companion) module for the [EBU OGraf](https://ograf.ebu.io) Server API: control OGraf graphics on any compliant server from a Stream Deck or any other Companion surface. See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE).

The module uses only the standard endpoints of the OGraf Server API v1 (`/graphics`, `/renderers`, `/renderers/{id}`, `…/target/graphicInstance/load|playAction|stopAction|updateAction|customActions/{id}|clear`, `/renderers/{id}/customActions/{id}`). Vendor extensions are optional: group actions (`/x-actions`) are offered when a server provides them, and `playing`/`ended` flags on graphic instances are used when a server reports them.

## Getting started

Executing a `yarn` command should perform all necessary steps to develop the module, if it does not then follow the steps below.

The module can be built once with `yarn build`. This should be enough to get the module to be loadable by companion.

While developing the module, by using `yarn dev` the compiler will be run in watch mode to recompile the files on change.
