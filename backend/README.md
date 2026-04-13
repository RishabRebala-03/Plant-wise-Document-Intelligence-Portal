# Flask + MongoDB Backend

This backend supports the workflows present in the frontend:

- role-based login for `CEO`, `Mining Manager`, and `Admin`
- document upload, replacement, listing, filtering, export, soft delete, and download
- CEO notes with `public` and `private` visibility
- plant summaries and recent plant documents
- analytics for uploads, categories, uploaders, and plants
- admin user management
- profile, notification, display, and security settings
- activity logging for major actions

## Structure

```text
backend/
  app/
    api/
    auth.py
    config.py
    db.py
    seed_data.py
    serializers.py
    utils.py
  run.py
  wsgi.py
```

## Local setup

1. Create a MongoDB instance.
2. Copy `.env.example` to `.env` and adjust secrets/connection details.
3. Install dependencies:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

4. Seed demo data:

```bash
cd backend
python3 -m app.seed_data
```

5. Run the API:

```bash
cd backend
python3 run.py
```

## Key routes

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `GET /api/v1/dashboard/ceo`
- `GET /api/v1/dashboard/manager`
- `GET /api/v1/documents`
- `POST /api/v1/documents`
- `PATCH /api/v1/documents/<document_id>`
- `GET /api/v1/documents/<document_id>/download`
- `GET|POST /api/v1/documents/<document_id>/comments`
- `GET /api/v1/plants`
- `GET /api/v1/analytics/overview`
- `GET|POST /api/v1/users`
- `PATCH /api/v1/users/<user_id>`
- `GET|PUT /api/v1/settings/me`
- `PUT /api/v1/settings/preferences`
- `PUT /api/v1/settings/security/password`

## Demo credentials after seeding

All seeded users use the password from `DEFAULT_DEMO_PASSWORD`.

- `d.richardson@midwestltd.com` (`CEO`)
- `j.carter@midwestltd.com` (`Mining Manager`)
- `admin@midwestltd.com` (`Admin`)
