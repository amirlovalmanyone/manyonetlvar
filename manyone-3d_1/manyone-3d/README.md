# Manyone 3D

A very small, clean web app for sharing and viewing GLB 3D models — with true‑scale AR on iPhone.

**The flow:** upload a `.glb` on desktop → inspect it in a large 3D viewer → **Create Link** → open the link on a phone → view the model → tap **AR** to place it in your space at real 1:1 size.

Everything is self‑contained. There are no runtime CDN calls: the 3D engine, viewer, fonts and Draco decoder are all vendored locally, so the tool works offline and behind a strict firewall — the way an internal tool should.

---

## Quick start (local)

```bash
npm install      # installs express + multer only
npm start        # serves on http://localhost:3000
```

Open `http://localhost:3000`, upload a GLB, and click **Create Link**.

To try the phone flow on the same Wi‑Fi, find your computer's LAN IP (e.g. `192.168.1.20`) and open the generated link with that host on your phone, for example `http://192.168.1.20:3000/v/<id>`. For reliable AR, deploy behind HTTPS (see below).

---

## How it works

**Desktop (`/`)** renders the upload zone and, once a GLB is chosen, a large `<model-viewer>` you can orbit, zoom and inspect. **Create Link** does two things in the browser: it generates a `.usdz` copy of the model (via three.js' `USDZExporter`) so Apple AR Quick Look can show it at real size, then uploads both the `.glb` and `.usdz` to the server, which stores them under a unique id and returns a shareable link (plus a QR code).

**Mobile (`/v/:id`)** shows a clean white loading screen with the Manyone logo, then reveals the model on white. One finger rotates, pinch zooms. The **AR** button is model‑viewer's native AR trigger — on iPhone it opens **AR Quick Look**, on Android it opens **Scene Viewer**. `ar-scale="fixed"` keeps the object at its true physical dimensions from the original model (glTF units are metres, so a model authored to scale appears 1:1).

Files are served at `/m/:id/model.glb` and `/m/:id/model.usdz`. The USDZ is served as `model/vnd.usdz+zip`, which is what iOS needs to launch Quick Look.

---

## Deploy (so links open on any phone, anywhere)

A public HTTPS URL is what makes the link work on someone else's phone and makes iOS AR fully reliable. Any Node host works — the link in the QR uses whatever host serves the page, so nothing is hard‑coded.

**Render / Railway / Fly.io:** point it at this repo. Build command `npm install`, start command `npm start`. These give you HTTPS automatically.

**Docker (any VPS):**

```bash
docker build -t manyone-3d .
docker run -p 3000:3000 -v $(pwd)/uploads:/app/uploads manyone-3d
```

Put it behind a reverse proxy (Caddy/Nginx) or Cloudflare for HTTPS.

**Storage note:** uploaded models are written to `uploads/`. Mount a persistent volume there (as in the Docker command above) so links survive restarts — some free tiers use ephemeral disks that reset on redeploy. For large scale, swap the disk writes in `server.js` for object storage (S3/R2).

---

## Customising

**Logo.** The wordmark is plain text (`manyone`) so it's crisp and swappable. To use the official Manyone SVG, replace the `<div class="logo">manyone</div>` (and the `.loader .logo` markup in `public/view.html`) with an inline `<svg>` or an `<img src="/assets/logo.svg">`.

**Upload size.** Default limit is 150 MB per file — change `MAX_BYTES` in `server.js`.

---

## Notes & limits

Client‑side USDZ generation covers the vast majority of GLBs, including Draco‑compressed ones (the decoder is bundled). Models using KTX2/Basis compressed textures aren't converted to USDZ in‑browser; those still view fine everywhere and get Android AR, just not iOS Quick Look. There's no authentication — anyone with a link can view that model, which suits an internal sharing tool; add a check in `server.js` if you need access control.

## Rebuilding the desktop bundle (optional)

`public/assets/vendor/desktop.js` is prebuilt from `src/desktop.js`. You only need this if you change that source:

```bash
npm install three@0.160.0 qrcode-generator esbuild
npx esbuild src/desktop.js --bundle --format=esm --minify --outfile=public/assets/vendor/desktop.js
```
