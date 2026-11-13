# CrosswordCreator

CrosswordCreator is a web application starter with a .NET 10 API and a React, TypeScript, and Vite frontend.

## Requirements

- .NET 10 SDK
- Node.js 22.12 or later and npm

## Run locally

Start the API from the repository root:

```powershell
dotnet run --project backend\CrosswordCreator.Api
```

In another terminal, install frontend dependencies and start the dev server:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite (by default, `http://localhost:5173`). The frontend proxies `/api` requests to the API at `http://localhost:5074`.

The starter API exposes `GET /api/health`.

## Build

```powershell
dotnet build CrosswordCreator.sln
cd frontend
npm run build
```
