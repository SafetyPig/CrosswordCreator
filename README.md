# CrosswordCreator

CrosswordCreator is a web application starter with a .NET 10 API and a React, TypeScript, and Vite frontend.

## Requirements

- .NET 10 SDK
- Node.js 22.12 or later and npm

## Run locally

Double-click `start-local.bat` to build and start the API and frontend, then
open the application in your browser. The first run installs frontend
dependencies if needed. Use `stop-local.bat` to stop the two processes started
by the script; it leaves the browser window open.

To run the services manually instead:

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
Crosswords can be listed with `GET /api/puzzles`, created with
`POST /api/puzzles`, updated with `PUT /api/puzzles/{id}`, deleted with
`DELETE /api/puzzles/{id}`, and retrieved by ID with `GET /api/puzzles/{id}`.
Use the Choose puzzle list in the editor to load a saved crossword; saving
updates the selected crossword. Hint images use `POST /api/hint-images` and
can be retrieved with `GET /api/hint-images/{id}`.
Grid dimensions must be between 1 and 100; saved rows contain uppercase
letters A-Z and Nordic letters Å, Ä, Ö,
Æ, Ø, Ð, Þ, with `.` representing an empty square. Press H to toggle the hint
tool and U to switch Tab movement when focus is outside editable fields. With a
grid letter cell focused, use Alt+H or Alt+U so plain H and U remain available
as letters. Click an existing hint tile to edit it; activate the hint tool and
click any other square to create an across or down hint tile. With the hint
tool active, drag across any rectangular area of the grid to create a combined
hint, such as a 2×2 or 2×3 area. The hint editor lets you adjust the row and
column count or split the area; replacing letters or removing saved hint images
requires confirmation. Tab moves right by default; select Move: Down to move
down columns instead. Shift+Tab moves in the reverse direction. Print
crossword prints the title, hint images, and empty boxes at letter positions;
unused squares are omitted.
The left column starts with Across hint tiles and the top row starts with Down
hint tiles; the top-left square is Across. Newly added squares along those
edges get the same defaults. Escape closes the hint editor without disabling
the hint tool. Empty hint tiles
can be removed directly, while removing a tile with a saved image asks for
confirmation. Hint images can be uploaded or drawn with text in the editor,
then attached to a puzzle when it is saved.

The API creates and updates its SQLite database on startup at
`backend\CrosswordCreator.Api\App_Data\crosswordcreator.db`. Puzzle records are
stored in the `Puzzles` table; the grid and entries are kept as JSON in
`ContentJson`. Uploaded hint images are stored locally under
`backend\CrosswordCreator.Api\App_Data\HintImages` (PNG, JPEG, or WebP, up to
5 MB each). When a saved puzzle is updated or deleted, images no longer
referenced by any saved puzzle are removed. The database and hint images are
local and excluded from Git.

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
