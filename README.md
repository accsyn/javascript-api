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


## Setup

To utilise an accsyn API workspace, you need to download and install the accsyn server/daemon:

1. Download the installer for your platform here: [https://www.accsyn.com/download3](https://www.accsyn.com/download3)
2. (Unix) Run chmod ugo+x ./accsyn-daemon-unix.sh
3. Run the installer.
4. When prompted, enter the on time burner server ID provided by accsyn staff in onboarding email.
5. If not situated directly on the Internet, configure your firewall to NAT forward TCP traffic on ports 45190-45209 to the server LAN ip.
6. Make sure the server has a static LAN IP, and incoming TCP traffic on ports 45190-45209 is blocked.

### Backup/migrate server

The accsyn server stores it's relevant configuration in this folder:

 - Linux; /var/lib/accsyn
 - Windows; C:\Programdata
 - Mac: /Library/Application Support/com.accsyn


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

