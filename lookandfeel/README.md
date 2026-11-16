# Atlex AI Control Plane

This is a separate frontend for the AI Control Plane, styled with the Atlex look
and feel. It includes the dashboard and GitHub metrics views and uses the same
backend and data as `frontend`. It is not a sanitized shareable sample.
The dashboard code is a separate copy; changes made to `frontend` later will
need to be carried over to this folder as appropriate.

## Run locally

```sh
cd lookandfeel
npm ci
npm run dev
```

Open the address printed by Next.js. To generate the static site locally, run
`npm run build`; the exported files are written to `out/`.

The app reads `NEXT_PUBLIC_USAGE_API_URL` at build time. For local development,
set it in an untracked `lookandfeel/.env.local`, for example
`NEXT_PUBLIC_USAGE_API_URL=http://127.0.0.1:4318`. The existing Azure workflow
already supplies the API URL for deployment. Data availability and errors depend
on the configured backend, just as in the original frontend.

## Select the frontend for Azure deployment

The existing workflow deploys `frontend` by default. To deploy this demo instead,
change `app_location` in
`.github/workflows/azure-static-web-apps-polite-cliff-03667eb10.yml` to:

```yaml
app_location: "./lookandfeel"
```

Keep `output_location: "out"` unchanged. To restore the dashboard, change
`app_location` back to `./frontend` and deploy again. This is a deployment-time
choice, not a switch within the running site.
