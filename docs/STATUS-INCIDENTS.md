# Live status incidents

The public `/status` page reads incidents from the website status API. To publish an incident, set the Vercel environment variable `STATUS_INCIDENTS_JSON` to a JSON array and redeploy. The endpoint is uncached (`Cache-Control: no-store`), so the page reflects the current deployment configuration on its next refresh.

Example:

```json
[
  {
    "id": "release-service-2026-11-08",
    "title": "Release downloads are responding slowly",
    "status": "monitoring",
    "impact": "minor",
    "startedAt": "2026-11-08T10:00:00Z",
    "updates": [
      {
        "status": "Monitoring",
        "message": "The release service is responding again. We are watching recovery.",
        "createdAt": "2026-11-08T10:20:00Z"
      }
    ]
  }
]
```

Allowed incident statuses are `investigating`, `identified`, `monitoring`, and `resolved`. Allowed impact levels are `minor`, `major`, and `critical`. When the variable is unset or invalid, the page safely shows **No incidents reported**. Never put API keys, admin tokens, customer data, or private infrastructure details in an incident title or message.
