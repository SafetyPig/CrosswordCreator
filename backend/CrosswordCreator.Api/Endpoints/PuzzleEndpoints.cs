using System.Text.Json;
using CrosswordCreator.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace CrosswordCreator.Api.Endpoints;

public static class PuzzleEndpoints
{
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
                || normalizedRow.Any(character => character != '.' && !char.IsAsciiLetterUpper(character)))
            {
                errors[$"cells[{rowIndex}]"] = ["Cells may contain only letters A-Z or '.' for an empty square."];
                continue;
            }

            normalizedCells[rowIndex] = normalizedRow;
        }

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
                new PuzzleDocument(1, request.Width, request.Height, normalizedCells),
                JsonOptions)
        };

        dbContext.Puzzles.Add(puzzle);
        await dbContext.SaveChangesAsync(cancellationToken);

        var response = new PuzzleResponse(
            puzzle.Id,
            puzzle.Title,
            puzzle.CreatedUtc,
            puzzle.UpdatedUtc,
            new PuzzleDocument(1, request.Width, request.Height, normalizedCells));

        return Results.Created($"/api/puzzles/{puzzle.Id}", response);
    }

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

public sealed record CreatePuzzleRequest(string? Title, int Width, int Height, string?[]? Cells);

public sealed record PuzzleDocument(int SchemaVersion, int Width, int Height, string[] Cells);

public sealed record PuzzleResponse(
    Guid Id,
    string Title,
    DateTime CreatedUtc,
    DateTime UpdatedUtc,
    PuzzleDocument Content);
