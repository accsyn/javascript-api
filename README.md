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
tsc src/accsyn-javascript-client.ts --outDir build/
```


Minify:

```
node_modules/.bin/terser build/accsyn-javascript-client.js --mangle reserved=['accsynSession'] -o build/accsyn-javascript-client.min.js
```


## Testing

### Preparations

1. Create and spawn a new accsyn workspace, with "webapi" licensing option.
2. Create an API key for the user.
3. Spawn the file server
4. Edit index html, entering the workspace code, admin user email, the API key and the absolute destination folder path for upload on file server.
5. Make sure file server is reachable from test machine.

### Test upload a file

1. Open index.html in your web browser.
2. Choose one(1) file to upload.
3. It should upload to the file server at the given path.

