# hrmny OS desk (public Vercel)

**Production:** https://hrmny-os-desk-hrmnyco.vercel.app  
**Aliases:** https://hrmny-os-desk.vercel.app  
**CRM redesign:** https://hrmny-os-desk-hrmnyco.vercel.app/crm  
**Portal:** https://hrmny-os-desk-hrmnyco.vercel.app/portal  

Team: `hrmnyco` · Project: `hrmny-os-desk` · `prj_6gTgosDuOL69fuOlCjXcLgHAnc29`

## Local

```bash
cd hrmny-os/desk-site
pnpm install --ignore-workspace
pnpm dev   # http://localhost:3001
```

## Deploy

Payload ready at `_deploy-payload.json` (13 source files). From Cursor with Vercel MCP authenticated:

```
deploy_to_vercel ← contents of _deploy-payload.json
```

Or CLI:

```bash
npx vercel login
npx vercel deploy --prod --yes --scope hrmnyco
```

Docs hub (separate): https://hrmny-os-docs.netlify.app
