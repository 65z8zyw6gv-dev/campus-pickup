# Windows-MCP 一键安装脚本（Windows 10 / 11）
#
# 用法（普通 PowerShell 即可，无需管理员）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows-mcp.ps1
#
# 两种模式：
#   -Mode stdio  只安装 CLI，由 MCP 客户端按需拉起（默认，最省资源）
#   -Mode http   另注册为“登录后自启”的本地 HTTP 服务，供局域网/远程客户端连接
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows-mcp.ps1 -Mode http -Port 8000

param(
    [ValidateSet('stdio', 'http')]
    [string]$Mode = 'stdio',
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$Package = 'windows-mcp'

function Write-Step($msg) { Write-Host "`n[+] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }

# ---------- 1. 环境检查 ----------
Write-Step '检查系统与 Python 版本'
if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    throw '当前系统不是 Windows，无法安装 windows-mcp。'
}
$winVer = [System.Environment]::OSVersion.Version
if ($winVer.Major -lt 10) { throw "仅支持 Windows 10 及以上，当前为 $winVer" }
Write-Ok "Windows 版本 $winVer"

# ---------- 2. 安装 uv（Python 包管理器） ----------
Write-Step '检查 uv'
$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) {
    Write-Host '    未找到 uv，正在安装...'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if (-not $uv) { throw 'uv 安装失败，请手动安装：pip install uv' }
}
Write-Ok (& uv --version)

# ---------- 3. 安装 Python 3.14+ ----------
Write-Step '准备 Python 3.14（windows-mcp 要求 >= 3.14）'
& uv python install 3.14
if ($LASTEXITCODE -ne 0) { throw 'Python 3.14 安装失败' }
Write-Ok 'Python 3.14 就绪'

# ---------- 4. 安装 windows-mcp ----------
Write-Step '安装 windows-mcp'
& uv tool install --python 3.14 $Package --force
if ($LASTEXITCODE -ne 0) { throw 'windows-mcp 安装失败' }
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
& windows-mcp --help | Select-Object -First 1
if ($LASTEXITCODE -ne 0) { throw 'windows-mcp 命令不可用，请重开终端后重试' }
Write-Ok '命令行工具已就绪'

# ---------- 5. 按模式配置 ----------
if ($Mode -eq 'http') {
    Write-Step "生成访问令牌并注册自启服务（127.0.0.1:$Port）"
    & windows-mcp auth --transport streamable-http --host 127.0.0.1 --port $Port --force
    if ($LASTEXITCODE -ne 0) { throw '令牌生成失败' }

    & windows-mcp install --transport streamable-http --host 127.0.0.1 --port $Port --force
    if ($LASTEXITCODE -ne 0) { throw '计划任务注册失败' }

    $cfg = Join-Path $env:USERPROFILE '.windows-mcp\config.toml'
    $token = (Select-String -Path $cfg -Pattern 'auth_key\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value

    Write-Host "`n服务地址 : http://127.0.0.1:$Port/mcp" -ForegroundColor Yellow
    Write-Host "访问令牌 : $token" -ForegroundColor Yellow
    Write-Host "日志     : $env:USERPROFILE\.windows-mcp\server.log" -ForegroundColor Yellow
    Write-Host '自启任务 : windows-mcp-server（每次登录自动启动）'
    Write-Host '卸载     : windows-mcp uninstall'
} else {
    Write-Step '注册 MCP 客户端（stdio）'
    Write-Host @"
    把下面配置粘贴到 MCP 客户端的配置中（Trae / Claude Desktop / Cursor 等）：

    {
      "mcpServers": {
        "windows-mcp": {
          "command": "windows-mcp",
          "args": ["serve", "--transport", "stdio"]
        }
      }
    }

    调试：windows-mcp serve --transport stdio --debug
    精简工具集（示例，只保留截图/点击）：加上 --tools Screenshot,Click
"@
}

Write-Host "`n安装完成。首个请求会加载 UIAutomation 组件，可能慢几秒。" -ForegroundColor Green
