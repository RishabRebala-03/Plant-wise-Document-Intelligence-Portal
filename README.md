# Plant-wise Document Intelligence Portal

This repository is organized into two apps:

- `backend/` contains the Flask API and backend configuration.
- `frontend/` contains the React + TypeScript + Vite client.

## Run Locally

### Frontend

```bash
cd frontend
npm install
npm run dev -- --host
```

### Backend

```bash
cd backend
pip install -r requirements.txt
python run.py
```

## Docker

The root [docker-compose.yml](./docker-compose.yml) currently starts MongoDB and the backend service.
