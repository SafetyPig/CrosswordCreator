using CrosswordCreator.Api.Data;
using CrosswordCreator.Api.Endpoints;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var databaseDirectory = Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(databaseDirectory);

var defaultConnectionString = new SqliteConnectionStringBuilder
{
    DataSource = Path.Combine(databaseDirectory, "crosswordcreator.db")
}.ToString();
var connectionString = builder.Configuration.GetConnectionString("CrosswordCreator")
    ?? defaultConnectionString;

builder.Services.AddDbContext<PuzzleDbContext>(options =>
    options.UseSqlite(connectionString));

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<PuzzleDbContext>();
    await dbContext.Database.MigrateAsync();
}

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "Healthy",
    service = "CrosswordCreator.Api"
}))
.WithName("GetHealth");

app.MapPuzzleEndpoints();

app.Run();
