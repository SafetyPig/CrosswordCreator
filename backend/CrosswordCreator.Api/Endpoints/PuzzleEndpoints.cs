using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;
using CrosswordCreator.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace CrosswordCreator.Api.Endpoints;

public static class PuzzleEndpoints
{
    private const int CurrentSchemaVersion = 5;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapPuzzleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var puzzles = endpoints.MapGroup("/api/puzzles");
        puzzles.MapGet("", ListAsync).WithName("ListPuzzles");
        puzzles.MapPost("", CreateAsync).WithName("CreatePuzzle");
        puzzles.MapPut("/{id:guid}", UpdateAsync).WithName("UpdatePuzzle");
        puzzles.MapDelete("/{id:guid}", DeleteAsync).WithName("DeletePuzzle");
        puzzles.MapGet("/{id:guid}", GetByIdAsync).WithName("GetPuzzle");

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        PuzzleDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var puzzles = await dbContext.Puzzles
            .AsNoTracking()
            .OrderByDescending(puzzle => puzzle.UpdatedUtc)
            .Select(puzzle => new PuzzleListItem(
                puzzle.Id,
                puzzle.Title,
                puzzle.UpdatedUtc))
            .ToListAsync(cancellationToken);

        return Results.Ok(puzzles);
    }

    private static async Task<IResult> CreateAsync(
        CreatePuzzleRequest request,
        PuzzleDbContext dbContext,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        if (!TryNormalizePuzzle(request, environment, out var title, out var document, out var errors))
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
            ContentJson = JsonSerializer.Serialize(document, JsonOptions)
        };

        dbContext.Puzzles.Add(puzzle);
        await dbContext.SaveChangesAsync(cancellationToken);

        var response = new PuzzleResponse(
            puzzle.Id,
            puzzle.Title,
            puzzle.CreatedUtc,
            puzzle.UpdatedUtc,
            document);

        return Results.Created($"/api/puzzles/{puzzle.Id}", response);
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        CreatePuzzleRequest request,
        PuzzleDbContext dbContext,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var puzzle = await dbContext.Puzzles
            .SingleOrDefaultAsync(record => record.Id == id, cancellationToken);
        if (puzzle is null)
        {
            return Results.NotFound();
        }

        if (!TryNormalizePuzzle(request, environment, out var title, out var document, out var errors))
        {
            return Results.ValidationProblem(errors);
        }

        var previousImageIds = GetHintImageIds(puzzle.ContentJson);
        previousImageIds.ExceptWith(GetHintImageIds(document));

        puzzle.Title = title;
        puzzle.UpdatedUtc = DateTime.UtcNow;
        puzzle.ContentJson = JsonSerializer.Serialize(document, JsonOptions);
        await dbContext.SaveChangesAsync(cancellationToken);
        await DeleteUnreferencedHintImagesAsync(
            previousImageIds,
            dbContext,
            environment,
            cancellationToken);

        return Results.Ok(new PuzzleResponse(
            puzzle.Id,
            puzzle.Title,
            puzzle.CreatedUtc,
            puzzle.UpdatedUtc,
            document));
    }

    private static async Task<IResult> DeleteAsync(
        Guid id,
        PuzzleDbContext dbContext,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var puzzle = await dbContext.Puzzles
            .SingleOrDefaultAsync(record => record.Id == id, cancellationToken);
        if (puzzle is null)
        {
            return Results.NotFound();
        }

        var imageIds = GetHintImageIds(puzzle.ContentJson);
        dbContext.Puzzles.Remove(puzzle);
        await dbContext.SaveChangesAsync(cancellationToken);
        await DeleteUnreferencedHintImagesAsync(
            imageIds,
            dbContext,
            environment,
            cancellationToken);

        return Results.NoContent();
    }

    private static HashSet<Guid> GetHintImageIds(string contentJson)
    {
        var document = JsonSerializer.Deserialize<PuzzleDocument>(contentJson, JsonOptions)
            ?? throw new InvalidOperationException("The saved crossword data could not be read.");
        return GetHintImageIds(document);
    }

    private static HashSet<Guid> GetHintImageIds(PuzzleDocument document)
    {
        var imageIds = new HashSet<Guid>();
        foreach (var hint in document.Hints)
        {
            if (Guid.TryParseExact(hint.ImageId, "N", out var imageId))
            {
                imageIds.Add(imageId);
            }
        }

        return imageIds;
    }

    private static async Task DeleteUnreferencedHintImagesAsync(
        IEnumerable<Guid> candidateImageIds,
        PuzzleDbContext dbContext,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var candidates = candidateImageIds.ToHashSet();
        if (candidates.Count == 0)
        {
            return;
        }

        var puzzleContents = await dbContext.Puzzles
            .AsNoTracking()
            .Select(puzzle => puzzle.ContentJson)
            .ToListAsync(cancellationToken);
        var referencedImageIds = new HashSet<Guid>();
        foreach (var contentJson in puzzleContents)
        {
            referencedImageIds.UnionWith(GetHintImageIds(contentJson));
        }

        foreach (var imageId in candidates.Except(referencedImageIds))
        {
            HintImageStore.DeleteImage(environment, imageId);
        }
    }

    private static bool TryNormalizePuzzle(
        CreatePuzzleRequest request,
        IWebHostEnvironment environment,
        out string title,
        [NotNullWhen(true)] out PuzzleDocument? document,
        out Dictionary<string, string[]> errors)
    {
        errors = new Dictionary<string, string[]>();
        document = null;
        title = request.Title?.Trim() ?? string.Empty;

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
            return false;
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
            return false;
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
            return false;
        }

        document = new PuzzleDocument(CurrentSchemaVersion, request.Width, request.Height, normalizedCells)
        {
            Hints = normalizedHints.ToArray()
        };
        return true;
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

            var rowSpan = hint.RowSpan;
            var columnSpan = hint.ColumnSpan;
            if (hint.Span is < 1)
            {
                errors["hints"] = ["Legacy hint spans must be positive."];
                continue;
            }

            if (hint.Span is > 1 && rowSpan == 1 && columnSpan == 1)
            {
                if (hint.Column == 0)
                {
                    rowSpan = hint.Span.Value;
                }
                else if (hint.Row == 0)
                {
                    columnSpan = hint.Span.Value;
                }
                else
                {
                    errors["hints"] = ["Legacy hint spans must be along a grid edge."];
                    continue;
                }
            }

            if (rowSpan < 1
                || columnSpan < 1
                || hint.Row + rowSpan > height
                || hint.Column + columnSpan > width)
            {
                errors["hints"] = ["Hint areas must fit within the grid."];
                continue;
            }

            var areaSquares = new List<(int Row, int Column)>();
            var areaIsValid = true;
            for (var rowOffset = 0; rowOffset < rowSpan && areaIsValid; rowOffset++)
            {
                for (var columnOffset = 0; columnOffset < columnSpan; columnOffset++)
                {
                    var row = hint.Row + rowOffset;
                    var column = hint.Column + columnOffset;
                    if (cells[row][column] != '.')
                    {
                        errors["hints"] = ["Hint areas cannot also contain letters."];
                        areaIsValid = false;
                        break;
                    }

                    if (occupiedSquares.Contains((row, column)))
                    {
                        errors["hints"] = ["Hint areas cannot overlap."];
                        areaIsValid = false;
                        break;
                    }

                    areaSquares.Add((row, column));
                }
            }

            if (!areaIsValid)
            {
                continue;
            }

            foreach (var square in areaSquares)
            {
                occupiedSquares.Add(square);
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
                imageId)
            {
                RowSpan = rowSpan,
                ColumnSpan = columnSpan,
            });
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

public sealed record PuzzleHint(int Row, int Column, string Direction, string? ImageId)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Span { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public int RowSpan { get; init; } = 1;

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public int ColumnSpan { get; init; } = 1;
}

public sealed record PuzzleResponse(
    Guid Id,
    string Title,
    DateTime CreatedUtc,
    DateTime UpdatedUtc,
    PuzzleDocument Content);

public sealed record PuzzleListItem(Guid Id, string Title, DateTime UpdatedUtc);
