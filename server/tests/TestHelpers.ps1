# Loads the bridge's top-level functions into the caller's scope without running the
# listener. Dot-source this file, then call Import-BridgeFunctions inside BeforeAll.

function Get-BridgeFunctionSource {
    $bridgePath = Join-Path $PSScriptRoot '..\bridge.ps1'
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($bridgePath, [ref]$tokens, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) {
        throw "bridge.ps1 has parse errors: $($errors[0].Message)"
    }
    $functions = $ast.EndBlock.Statements |
        Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] }
    ($functions | ForEach-Object { $_.Extent.Text }) -join "`n`n"
}
