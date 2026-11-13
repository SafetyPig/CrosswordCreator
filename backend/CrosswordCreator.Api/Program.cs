var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "Healthy",
    service = "CrosswordCreator.Api"
}))
.WithName("GetHealth");

app.Run();
