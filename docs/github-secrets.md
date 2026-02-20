# GitHub Secrets for Data Sync Workflow

The `data-sync.yml` workflow requires the following secrets and variables to be configured in GitHub repository settings (Settings > Secrets and variables > Actions).

## Required Secrets

| Secret | Description | Where to get it |
|---|---|---|
| `GOOGLE_API_KEY` | Google API Key for Gemini 2.5 Flash OCR | https://console.cloud.google.com (Generative Language API) |
| `JINA_API_KEY` | Jina AI API Key for generating embeddings | https://jina.ai |
| `QDRANT_API_KEY` | Qdrant API key (read+write) | Qdrant dashboard |
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
