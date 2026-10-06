# Offline stream-mapping regression tests

From the repository root, with Node.js 18 or later:

```sh
node --test tests/mapping-persistence.test.cjs
```

No dependencies or OBS installation are required. Tests load each dock's actual
inline script and execute its startup and UI event registrations in a Node VM.
They exercise the shipped mapping/settings change, remove, refresh, and Add-to-OBS
handlers with an inert DOM, synthetic localStorage, translation stubs, and an
in-memory OBS request double. Sockets, fetch, and external script injection are
blocked. External libraries and timer callbacks are not run.

Coverage is limited to stream-mapping rules: saved targets, matching precedence,
clone/switch flags, repeated save/reload, disconnected edit/remove, incomplete
rows, intentional clearing, successful empty or failed scene discovery, and the
actual mapped Add-to-OBS destination. The existing generated obs2 mapping ID is
ignored when comparing routing semantics.

These tests do not assert fixes to the separate persistence behavior of main,
screen-share, highlight or other scene selectors, source-creation checkboxes, or
layout configurations. Those behaviors are unchanged by this routing patch.
This is local-state coverage, not browser rendering, OBS integration, transport,
authentication, layout-math, or live-stream validation. The minimal DOM implements
only the benign fixture selectors and select behavior needed by the tests.

To compare another directory containing both dock files:

```sh
DOCK_SOURCE_DIR=/path/to/source node --test tests/mapping-persistence.test.cjs
```
