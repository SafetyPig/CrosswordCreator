namespace CrosswordCreator.Api.Data;

public sealed class PuzzleRecord
{
    public Guid Id { get; set; }

    public string Title { get; set; } = string.Empty;

    public DateTime CreatedUtc { get; set; }

    public DateTime UpdatedUtc { get; set; }

    public string ContentJson { get; set; } = string.Empty;
}
