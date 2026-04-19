using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDefaultIdentity<IdentityUser>()
    .AddEntityFrameworkStores<AppDbContext>();
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer("Server=."));
var app = builder.Build();
app.Run();
