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
Crosswords can be saved with `POST /api/puzzles` and retrieved by ID with
`GET /api/puzzles/{id}`. Grid dimensions must be between 1 and 100; saved rows
contain uppercase letters, with `.` representing an empty square.

The API creates and updates its SQLite database on startup at
`backend\CrosswordCreator.Api\App_Data\crosswordcreator.db`. Puzzle records are
stored in the `Puzzles` table; the grid and entries are kept as JSON in
`ContentJson`. The database file is local and is excluded from Git.

To add a schema migration after changing the data model:

```powershell
dotnet tool restore
dotnet ef migrations add MigrationName --project backend\CrosswordCreator.Api
```

## Build

```powershell
dotnet build CrosswordCreator.sln
cd frontend
npm run build
```
