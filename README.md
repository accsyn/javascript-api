# accsyn Javascript API

---
**NOTE**

The API is currently in beta/testing phase and not suitable for production.

---


Currently designed to:

1. Drive file transfers from with the accsyn v3 frontend.
2. Support browser uploads for `api` type v3 workspaces.


## Developing

The Javascript API is currently closed source.


## Building


### Build from source (internal)

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
terser build/accsyn-javascript-client.js -o test/accsyn-javascript-client.min.js
```

### Download minified artifeact 


Download the latest release of `accsyn-javascript-client.min.js` from [Git hub releases](https://github.com/accsyn/javascript-api/releases/latest).



## Testing

### Preparations

1. Create and spawn a new accsyn workspace, with an "api" capable BYOS storage server license.
2. Create an API key for the user.
3. Spawn the file server
4. Make sure file server is reachable from test machine, standard TCP ports 45190-45209
5. Install http-server: `npm install http-server`

### Test upload a file

1. Build JS (see above)
2. Copy js to test/ folder.
3. Start http-server within test/ folder: `../node_modules/.bin/http-server -p 8282 -c-1`
4. Open URL in a browser: `http://localhost:8282`
5. Enter your workspace credentials, and local destination path on file server.
6. Choose a file to upload.
7. Click upload.
8. Check to console for logs and progress feedback.

