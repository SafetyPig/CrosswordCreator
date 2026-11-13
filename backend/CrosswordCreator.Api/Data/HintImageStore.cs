namespace CrosswordCreator.Api.Data;

public static class HintImageStore
{
    public const long MaxImageBytes = 5 * 1024 * 1024;

    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    private static readonly byte[] WebpRiffSignature = [82, 73, 70, 70];
    private static readonly byte[] WebpSignature = [87, 69, 66, 80];

    public static string GetDirectory(IWebHostEnvironment environment) =>
        Path.Combine(environment.ContentRootPath, "App_Data", "HintImages");

    public static (string Extension, string ContentType)? DetectImageFormat(ReadOnlySpan<byte> header)
    {
        if (header.StartsWith(PngSignature))
        {
            return (".png", "image/png");
        }

        if (header.Length >= 3 && header[0] == 255 && header[1] == 216 && header[2] == 255)
        {
            return (".jpg", "image/jpeg");
        }

        if (header.Length >= 12
            && header[..4].SequenceEqual(WebpRiffSignature)
            && header[8..12].SequenceEqual(WebpSignature))
        {
            return (".webp", "image/webp");
        }

        return null;
    }

    public static bool TryGetImage(
        IWebHostEnvironment environment,
        Guid id,
        out string filePath,
        out string contentType)
    {
        var directory = GetDirectory(environment);
        foreach (var format in new[]
        {
            (Extension: ".png", ContentType: "image/png"),
            (Extension: ".jpg", ContentType: "image/jpeg"),
            (Extension: ".webp", ContentType: "image/webp")
        })
        {
            var candidate = Path.Combine(directory, $"{id:N}{format.Extension}");
            if (File.Exists(candidate))
            {
                filePath = candidate;
                contentType = format.ContentType;
                return true;
            }
        }

        filePath = string.Empty;
        contentType = string.Empty;
        return false;
    }
}
