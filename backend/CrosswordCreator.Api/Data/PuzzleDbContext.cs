using Microsoft.EntityFrameworkCore;

namespace CrosswordCreator.Api.Data;

public sealed class PuzzleDbContext(DbContextOptions<PuzzleDbContext> options) : DbContext(options)
{
    public DbSet<PuzzleRecord> Puzzles => Set<PuzzleRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var puzzle = modelBuilder.Entity<PuzzleRecord>();

        puzzle.ToTable("Puzzles");
        puzzle.HasKey(record => record.Id);
        puzzle.Property(record => record.Title)
            .HasMaxLength(200)
            .IsRequired();
        puzzle.Property(record => record.ContentJson)
            .IsRequired();
        puzzle.Property(record => record.CreatedUtc)
            .IsRequired();
        puzzle.Property(record => record.UpdatedUtc)
            .IsRequired();
    }
}
