using System;
using System.Threading;
using System.Threading.Tasks;
using Xunit;
using Xunit.Abstractions;

namespace Roblox.Rendering.Test;

public class RenderingTest
{
    private readonly ITestOutputHelper _testOutputHelper;

    public RenderingTest(ITestOutputHelper testOutputHelper)
    {
        _testOutputHelper = testOutputHelper;
    }

    [Fact]
    public async Task RenderAvatarThumbnailsConcurrently()
    {
        var renderAuthorization = Environment.GetEnvironmentVariable("RENDER_AUTHORIZATION");
        if (string.IsNullOrWhiteSpace(renderAuthorization))
            throw new InvalidOperationException("RENDER_AUTHORIZATION must be configured.");
        var renderBaseUrl = Environment.GetEnvironmentVariable("RENDER_BASE_URL") ?? "ws://localhost:3189";
        CommandHandler.Configure(renderBaseUrl, renderAuthorization);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(11));
        var avatar = new AvatarData
        {
            userId = 1,
            playerAvatarType = "R6",
            bodyColors = new AvatarBodyColors
            {
                headColorId = 1,
                torsoColorId = 1,
                rightArmColorId = 1,
                leftArmColorId = 1,
                rightLegColorId = 1,
                leftLegColorId = 1,
            },
            assets = Array.Empty<AvatarAssetEntry>(),
        };
        var avatarResults = await Task.WhenAll(
            CommandHandler.RequestPlayerHeadshot(avatar, cancellation.Token),
            CommandHandler.RequestPlayerThumbnail(avatar, cancellation.Token));
        Assert.All(avatarResults, result => Assert.True(result.Length > 0));

        _testOutputHelper.WriteLine("Rendered avatar headshot and thumbnail concurrently.");
    }
}