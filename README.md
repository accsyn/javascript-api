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
node_modules/.bin/terser build/accsyn-javascript-client.js --mangle reserved=['Client'] -o build/accsyn-javascript-client.min.js
```


## Testing

