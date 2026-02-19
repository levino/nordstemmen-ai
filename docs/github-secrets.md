# GitHub Secrets for Data Sync Workflow

The `data-sync.yml` workflow requires the following secrets to be configured in GitHub repository settings (Settings > Secrets and variables > Actions).

## Required Secrets

| Secret | Description | Where to get it |
|---|---|---|
| `JINA_API_KEY` | Jina AI API Key for generating embeddings | https://jina.ai (Free tier: 1M tokens/month) |
| `QDRANT_URL` | Qdrant Cloud cluster URL | https://cloud.qdrant.io |
| `QDRANT_API_KEY` | Qdrant Cloud API key | Qdrant Cloud dashboard |
| `B2_KEY_ID` | Backblaze B2 application key ID | B2 Cloud Storage > App Keys |
| `B2_APP_KEY` | Backblaze B2 application key | B2 Cloud Storage > App Keys |
| `B2_BUCKET_ID` | Backblaze B2 bucket ID | B2 Cloud Storage > Buckets |
| `B2_BUCKET_NAME` | Backblaze B2 bucket name | B2 Cloud Storage > Buckets |
| `GIT_LFS_USERNAME` | Username für den selbst-gehosteten LFS-Server | `git-lfs.nordstemmen-ai.levinkeller.de` |
| `GIT_LFS_PASSWORD` | Passwort/Token für den LFS-Server | `git-lfs.nordstemmen-ai.levinkeller.de` |

## Notes

- Der LFS-Server ist **selbst-gehostet** unter `git-lfs.nordstemmen-ai.levinkeller.de` (siehe `.lfsconfig`), nicht GitHub LFS.
- The B2 key should have read+write access to the bucket used for PDF and fulltext storage.
- The Qdrant API key needs read+write access to the `nordstemmen` collection.
- The Jina API key is used for the `retrieval.passage` task (document embedding generation).
