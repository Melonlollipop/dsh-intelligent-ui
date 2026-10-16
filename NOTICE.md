# Third-party notice

## open-intelligent-ui

Parts of this repository are derived from:

- Project: `thesysdev/open-intelligent-ui`
- Repository: <https://github.com/thesysdev/open-intelligent-ui>
- Base commit: `6a4a0ba192ea285b3a5ed39dcc1295d7d4080d6f`
- Derived paths: `src/openui/**` and generated or bundled output based on those files

At the time the work was reused, the upstream repository did not contain a root license file. The upstream copyright holder subsequently gave the maintainer written permission to modify the material and publish the resulting derivative in this repository. The maintainer should retain the original permission record privately.

The upstream-derived material is not covered by the MIT grant for this repository's original DSH integration code. See [LICENSE](LICENSE) for the composite terms.

## Material changes from the referenced commit

- Adapted the component library and generated prompt for DeepSeek Harness.
- Added a DSH host tool and streaming client renderer.
- Rendered completed interfaces directly in the DSH answer column.
- Added DSH theme integration and responsive layout corrections.
- Removed the map component that required a separate frontend Worker.
- Added turn-conclusion behavior, tests, build tooling and publication documentation.

## No endorsement

This project is independently maintained. DeepSeek, DeepSeek Harness and thesysdev do not endorse or officially support this repository unless they explicitly state otherwise.

All other third-party dependencies are governed by the license information shipped with their respective packages.
