# accsyn Javascript API

Currently designed to:

1. Drive file transfers from accsyn v3 frontend.
2. Support browser uploads for `webapi` type v3 workspaces.


## Build


Install dependencies:

```
npm install typescript terser
```

Compile .ts to js:

```
tsc
```


Minify:

```
node_modules/.bin/terser build/accsyn-javascript-client.js -o test/accsyn-javascript-client.min.js
```


## Testing

### Preparations

1. Create and spawn a new accsyn workspace, with "webapi" licensing option.
2. Create an API key for the user.
3. Spawn the file server
4. Make sure file server is reachable from test machine.
5. Install http-server: `npm install http-server`

### Test upload a file

1. Build JS (see above)
2. Copy js to test/ folder.
3. Start http-server within test/ folder: `../node_modules/.bin/http-server -p 8282 -c-1`
4. Open URL in a browser: `http://localhost:8282`
5. Enter your workspace credentials, and local destination path on file server.
6. Choose a file to upload.
7. Check to console for logs and progress feedback.

