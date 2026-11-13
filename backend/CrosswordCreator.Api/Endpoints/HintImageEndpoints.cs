using CrosswordCreator.Api.Data;

namespace CrosswordCreator.Api.Endpoints;

public static class HintImageEndpoints
{
    private const long MultipartOverheadBytes = 64 * 1024;

    public static IEndpointRouteBuilder MapHintImageEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var hintImages = endpoints.MapGroup("/api/hint-images");
        hintImages.MapPost("", UploadAsync).WithName("UploadHintImage");
        hintImages.MapGet("/{id:guid}", GetById).WithName("GetHintImage");

        return endpoints;
    }

    private static async Task<IResult> UploadAsync(
        HttpRequest request,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        if (request.ContentLength is > HintImageStore.MaxImageBytes + MultipartOverheadBytes)
        {
            return Results.Problem(
                "The hint image must be 5 MB or smaller.",
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        if (!request.HasFormContentType)
        {
            return Results.BadRequest("Upload a PNG, JPEG, or WebP image.");
        }

        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(cancellationToken);
        }
        catch (InvalidDataException)
        {
            return Results.BadRequest("The image upload could not be read.");
        }

        var image = form.Files.GetFile("image");
        if (image is null || image.Length == 0)
        {
            return Results.BadRequest("Choose an image to upload.");
        }

        if (image.Length > HintImageStore.MaxImageBytes)
        {
            return Results.Problem(
                "The hint image must be 5 MB or smaller.",
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var header = new byte[12];
        (string Extension, string ContentType) format;
        await using (var imageStream = image.OpenReadStream())
        {
            var headerLength = await imageStream.ReadAsync(header.AsMemory(), cancellationToken);
            if (HintImageStore.DetectImageFormat(header.AsSpan(0, headerLength)) is not { } detectedFormat)
            {
                return Results.BadRequest("Hint images must be PNG, JPEG, or WebP files.");
            }

            format = detectedFormat;
        }

        var id = Guid.NewGuid();
        var directory = HintImageStore.GetDirectory(environment);
        Directory.CreateDirectory(directory);

        var filePath = Path.Combine(directory, $"{id:N}{format.Extension}");
        await using var source = image.OpenReadStream();
        await using var destination = new FileStream(
            filePath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None);
        await source.CopyToAsync(destination, cancellationToken);

        return Results.Created($"/api/hint-images/{id:N}", new HintImageUploadResponse(id.ToString("N")));
    }

    private static IResult GetById(Guid id, IWebHostEnvironment environment)
    {
        if (!HintImageStore.TryGetImage(environment, id, out var filePath, out var contentType))
        {
            return Results.NotFound();
        }

        return Results.File(filePath, contentType);
    }
}

public sealed record HintImageUploadResponse(string Id);
