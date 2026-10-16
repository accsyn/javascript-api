# accsyn JavaScript API

Programmable file delivery for accsyn. Version 3.4.0 matches the [accsyn Python API](https://github.com/accsyn/accsyn-python-api) session: create and query entities, grant access, list files, and read settings and logs.

## Install

```bash
npm install accsyn
```

Node.js 18 or newer. The client uses `fetch`, so the same build also runs in browsers.

```javascript
import { Session } from "accsyn";

const session = await Session.connect({
  workspace: "acmefilm",
  username: "john@user.com",
  apiKey: process.env.ACCSYN_API_KEY,
});

const job = await session.create("transfer", {
  source: "volume=projects/clip.mov",
  destination: "client=664f53b16aa9149860da9d9c:/tmp/clip.mov",
});
```

`Session.connect` reads `ACCSYN_WORKSPACE`, `ACCSYN_API_USER`, `ACCSYN_API_KEY`, and `ACCSYN_PROXY` when those arguments are omitted. Reuse one session. Workspace backends rate-limit REST calls per IP.

The API queues transfers. It does not move the file bytes itself.

Reference: <https://support.accsyn.com/developer/javascript-api/>

## Develop

```bash
npm install
npm test
npm run build
npm run smoke
```

`npm run build` writes ESM, CommonJS, and TypeScript declarations to `dist/`. `prepublishOnly` runs the build.

Generate the API reference and append it to the JavaScript API page in the docs site:

```bash
ACCSYN_DOC_ROOT=/path/to/doc/git npm run docs:api
```

`ACCSYN_DOC_ROOT` is the docs repository. The script stops if it is missing.

## Interactive test

Build the client, then open the local test page. If a `.env` file in this directory defines `ACCSYN_WORKSPACE`, `ACCSYN_API_USER`, and `ACCSYN_API_KEY`, those values fill the form and can be edited before connecting. `AS_DEV=true` checks the Dev box, which connects to `127.0.0.1:8181`.

```bash
npm run build
npm run test:ui
```

Open <http://127.0.0.1:8282/>. CONNECT stores a session. RUN executes one expression on that session, for example `session.find("Job")`.

## Publish

Releases go to npm as the public package `accsyn`. GitHub Actions publishes when a `v*` tag is pushed. The workflow runs `npm ci`, `npm test`, `npm run build`, `npm run smoke`, then `npm publish --access public`.

Once, on the GitHub repository, add an Actions secret named `NPM_TOKEN`. Use an npm granular access token that can publish this package. The workflow passes it as `NODE_AUTH_TOKEN`.

To release:

1. Set the same version in `package.json` and `src/version.ts`. npm publishes the `package.json` version. `src/version.ts` is the version the session reports.
2. Commit that change.
3. Tag the commit and push the tag. The tag must start with `v` and should match the package version.

```bash
git tag v3.4.0
git push origin v3.4.0
```

npm rejects a version that is already published. Bump the version before tagging the next release.

## License

Apache-2.0
