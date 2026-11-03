# GitHub Secrets for Data Sync Workflow

The `data-sync.yml` workflow requires the following secrets and variables to be configured in GitHub repository settings (Settings > Secrets and variables > Actions).

## Required Secrets

| Secret | Description | Where to get it |
|---|---|---|
| `JINA_API_KEY` | Jina AI API Key for generating embeddings | https://jina.ai |
| `QDRANT_API_KEY` | Qdrant API key (read+write) | Qdrant dashboard |
| `OPARL_PROXY_SECRET` | Shared Secret für den OParl-Proxy (Header `X-Proxy-Secret`) | Gegenstück steckt im SealedSecret `oparl-proxy/nginx-conf` in `levino/server-config` |
| `GIT_LFS_PASSWORD` | Passwort/Token für den selbst-gehosteten LFS-Server | `git-lfs.nordstemmen-ai.levinkeller.de` |

## Required Variables

| Variable | Description | Example |
|---|---|---|
| `QDRANT_URL` | Qdrant server URL | `https://qdrant.levinkeller.de` |
| `GIT_LFS_USERNAME` | Username für den LFS-Server | (configured in LFS server) |

## Notes

- Der LFS-Server ist **selbst-gehostet** unter `git-lfs.nordstemmen-ai.levinkeller.de` (siehe `.lfsconfig`), nicht GitHub LFS.
- The Qdrant API key needs read+write access to the `nordstemmen` collection.
- The Jina API key is used for the `retrieval.passage` task (document embedding generation).
- The Google API key needs access to the Generative Language API (Gemini). Create the key in Cloud Console (not AI Studio) for proper quota tier.

## Google Cloud (Vertex AI OCR) — no secret needed

The workflow authenticates to Vertex AI via **Workload Identity Federation** (`id-token: write` + `google-github-actions/auth`). Nothing is stored in GitHub.

| What | Value |
|---|---|
| GCP project | `gen-lang-client-0654772712` ("nordstemmen-ai") |
| Service account | `nordstemmen-pipeline@gen-lang-client-0654772712.iam.gserviceaccount.com` (role `roles/aiplatform.user` only) |
| WIF provider | `projects/491104209036/locations/global/workloadIdentityPools/github/providers/nordstemmen-ai` (condition: `assertion.repository=='levino/nordstemmen-ai'`) |
| Budget alert | 20 EUR/month on the project (alerts at 50/90/100 % + forecast) |

The former `GOOGLE_API_KEY` secret is no longer used and can be deleted.
