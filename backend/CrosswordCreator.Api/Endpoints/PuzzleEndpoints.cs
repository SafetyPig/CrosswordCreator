using System.Text.Json;
using CrosswordCreator.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace CrosswordCreator.Api.Endpoints;

public static class PuzzleEndpoints
{
    private const int CurrentSchemaVersion = 3;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapPuzzleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var puzzles = endpoints.MapGroup("/api/puzzles");
        puzzles.MapPost("", CreateAsync).WithName("CreatePuzzle");
        puzzles.MapGet("/{id:guid}", GetByIdAsync).WithName("GetPuzzle");

        return endpoints;
    }

    private static async Task<IResult> CreateAsync(
        CreatePuzzleRequest request,
        PuzzleDbContext dbContext,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        var title = request.Title?.Trim() ?? string.Empty;

        if (title.Length == 0)
        {
            errors["title"] = ["A title is required."];
        }
        else if (title.Length > 200)
        {
            errors["title"] = ["The title must be 200 characters or fewer."];
        }

        if (request.Width is < 1 or > 100)
        {
            errors["width"] = ["Width must be between 1 and 100."];
        }

        if (request.Height is < 1 or > 100)
        {
            errors["height"] = ["Height must be between 1 and 100."];
        }

        var cells = request.Cells;
        if (cells is null)
        {
            errors["cells"] = ["Grid cells are required."];
        }
        else if (request.Height is >= 1 and <= 100 && cells.Length != request.Height)
        {
            errors["cells"] = ["The number of cell rows must match the grid height."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var normalizedCells = new string[request.Height];
        for (var rowIndex = 0; rowIndex < request.Height; rowIndex++)
        {
            var row = cells![rowIndex];
            if (row is null || row.Length != request.Width)
            {
                errors[$"cells[{rowIndex}]"] = ["Each row must match the grid width."];
                continue;
            }

            var normalizedRow = row.ToUpperInvariant();
            if (normalizedRow.Length != request.Width
                || normalizedRow.Any(character => character != '.' && !IsPuzzleLetter(character)))
            {
                errors[$"cells[{rowIndex}]"] = [
                    "Cells may contain only letters A-Z or Nordic letters Å, Ä, Ö, Æ, Ø, Ð, Þ, or '.' for an empty square."
                ];
                continue;
            }

            normalizedCells[rowIndex] = normalizedRow;
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var normalizedHints = NormalizeHints(
            request.Hints,
            request.Width,
            request.Height,
            normalizedCells,
            environment,
            errors);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var now = DateTime.UtcNow;
        var puzzle = new PuzzleRecord
        {
            Id = Guid.NewGuid(),
            Title = title,
            CreatedUtc = now,
            UpdatedUtc = now,
            ContentJson = JsonSerializer.Serialize(
                new PuzzleDocument(CurrentSchemaVersion, request.Width, request.Height, normalizedCells)
                {
                    Hints = normalizedHints.ToArray()
                },
                JsonOptions)
        };

        dbContext.Puzzles.Add(puzzle);
        await dbContext.SaveChangesAsync(cancellationToken);

        var response = new PuzzleResponse(
            puzzle.Id,
            puzzle.Title,
            puzzle.CreatedUtc,
            puzzle.UpdatedUtc,
            new PuzzleDocument(CurrentSchemaVersion, request.Width, request.Height, normalizedCells)
            {
                Hints = normalizedHints.ToArray()
            });

        return Results.Created($"/api/puzzles/{puzzle.Id}", response);
    }

    private static List<PuzzleHint> NormalizeHints(
        PuzzleHint?[]? hints,
        int width,
        int height,
        string[] cells,
        IWebHostEnvironment environment,
        Dictionary<string, string[]> errors)
    {
        var normalizedHints = new List<PuzzleHint>();
        if (hints is null)
        {
            return normalizedHints;
        }

        var occupiedSquares = new HashSet<(int Row, int Column)>();
        foreach (var hint in hints)
        {
            if (hint is null
                || hint.Row < 0
                || hint.Row >= height
                || hint.Column < 0
                || hint.Column >= width)
            {
                errors["hints"] = ["Hint tiles must refer to a square in the grid."];
                continue;
            }

            if (hint.Direction is not ("across" or "down"))
            {
                errors["hints"] = ["Hint direction must be 'across' or 'down'."];
                continue;
            }

            if (cells[hint.Row][hint.Column] != '.')
            {
                errors["hints"] = ["Hint tiles cannot also contain letters."];
                continue;
            }

            if (!occupiedSquares.Add((hint.Row, hint.Column)))
            {
                errors["hints"] = ["A square can contain only one hint tile."];
                continue;
            }

            string? imageId = null;
            if (hint.ImageId is not null)
            {
                if (!Guid.TryParseExact(hint.ImageId, "N", out var id)
                    || !HintImageStore.TryGetImage(environment, id, out _, out _))
                {
                    errors["hints"] = ["Each hint image must refer to an uploaded image."];
                    continue;
                }

                imageId = id.ToString("N");
            }

            normalizedHints.Add(new PuzzleHint(
                hint.Row,
                hint.Column,
                hint.Direction,
                imageId));
        }

        return normalizedHints;
    }

    private static bool IsPuzzleLetter(char character) =>
        char.IsAsciiLetterUpper(character)
        || character is 'Å' or 'Ä' or 'Ö' or 'Æ' or 'Ø' or 'Ð' or 'Þ';

    private static async Task<IResult> GetByIdAsync(
        Guid id,
        PuzzleDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var puzzle = await dbContext.Puzzles
            .AsNoTracking()
            .SingleOrDefaultAsync(record => record.Id == id, cancellationToken);

        if (puzzle is null)
        {
            return Results.NotFound();
        }

        var document = JsonSerializer.Deserialize<PuzzleDocument>(puzzle.ContentJson, JsonOptions);
        if (document is null)
        {
            return Results.Problem("The saved crossword data could not be read.");
        }

        return Results.Ok(new PuzzleResponse(
            puzzle.Id,
            puzzle.Title,
            puzzle.CreatedUtc,
            puzzle.UpdatedUtc,
            document));
    }
}

public sealed record CreatePuzzleRequest(
    string? Title,
    int Width,
    int Height,
    string?[]? Cells,
    PuzzleHint?[]? Hints = null);

public sealed record PuzzleDocument(int SchemaVersion, int Width, int Height, string[] Cells)
{
    public PuzzleHint[] Hints { get; init; } = [];
}

public sealed record PuzzleHint(int Row, int Column, string Direction, string? ImageId);

public sealed record PuzzleResponse(
    Guid Id,
    string Title,
    DateTime CreatedUtc,
    DateTime UpdatedUtc,
    PuzzleDocument Content);
