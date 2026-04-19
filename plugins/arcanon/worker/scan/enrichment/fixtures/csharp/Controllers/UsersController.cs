using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("users")]
[Authorize]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok();
}
