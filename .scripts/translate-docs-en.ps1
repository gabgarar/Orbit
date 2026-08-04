[CmdletBinding()]
param(
    [int]$ChunkSize = 3500,
    [int]$DelayMilliseconds = 250,
    [switch]$Overwrite
)

$ErrorActionPreference = 'Stop'
$docsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\docs\wiki')).Path
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Protect-Markdown {
    param([string]$Content)

    $tokens = [ordered]@{}
    $patterns = @(
        '(?s)\x60{3}.*?\x60{3}',
        '(?s)~~~.*?~~~',
        '(?s)\$\$.*?\$\$',
        '\\\([^\r\n]*?\\\)',
        '\x60[^\x60\r\n]+\x60',
        '(?<=\]\()[^)]+(?=\))'
    )

    foreach ($pattern in $patterns) {
        $Content = [regex]::Replace(
            $Content,
            $pattern,
            {
                param($match)
                $key = "ORBITMARKDOWNTOKEN$($tokens.Count)X"
                $tokens[$key] = $match.Value
                return $key
            }
        )
    }

    return [pscustomobject]@{
        Content = $Content
        Tokens = $tokens
    }
}

function Restore-Markdown {
    param(
        [string]$Content,
        [System.Collections.Specialized.OrderedDictionary]$Tokens
    )

    foreach ($key in @($Tokens.Keys)[($Tokens.Count - 1)..0]) {
        $Content = $Content.Replace($key, [string]$Tokens[$key])
    }
    return $Content
}

function Split-TranslationChunks {
    param(
        [string]$Content,
        [int]$MaximumLength
    )

    $chunks = [System.Collections.Generic.List[string]]::new()
    $buffer = [System.Text.StringBuilder]::new()
    foreach ($line in ($Content -split [Environment]::NewLine)) {
        $lineWithBreak = $line + [Environment]::NewLine
        if ($buffer.Length -gt 0 -and ($buffer.Length + $lineWithBreak.Length) -gt $MaximumLength) {
            $chunks.Add($buffer.ToString())
            [void]$buffer.Clear()
        }
        [void]$buffer.Append($lineWithBreak)
    }
    if ($buffer.Length -gt 0) {
        $chunks.Add($buffer.ToString())
    }
    return $chunks
}

function Translate-Chunk {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text) -or $Text -match '^\s*(ORBITMARKDOWNTOKEN\d+X\s*)+$') {
        return $Text
    }

    $encoded = [uri]::EscapeDataString($Text)
    $uri = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=es&tl=en&dt=t&q=$encoded"
    $response = Invoke-RestMethod -Method Get -Uri $uri
    return (($response[0] | ForEach-Object { [string]$_[0] }) -join '')
}

$sourceFiles = Get-ChildItem -Path $docsRoot -Recurse -File -Filter '*.md' |
    Where-Object {
        $relative = $_.FullName.Substring($docsRoot.Length).TrimStart('\', '/')
        $relative -notmatch '^(en|es|source)[\\/]'
    } |
    Sort-Object FullName

foreach ($source in $sourceFiles) {
    $relative = $source.FullName.Substring($docsRoot.Length).TrimStart('\', '/')
    $destination = Join-Path (Join-Path $docsRoot 'en') $relative
    if ((Test-Path -LiteralPath $destination) -and -not $Overwrite) {
        Write-Host "Skipping existing translation: $relative"
        continue
    }

    $original = [System.IO.File]::ReadAllText($source.FullName, $utf8)
    $protected = Protect-Markdown -Content $original
    $translated = (Split-TranslationChunks -Content $protected.Content -MaximumLength $ChunkSize |
        ForEach-Object {
            $result = Translate-Chunk -Text $_
            Start-Sleep -Milliseconds $DelayMilliseconds
            $result
        }) -join ''
    $output = Restore-Markdown -Content $translated -Tokens $protected.Tokens
    $output = [regex]::Replace($output, '(?m)^(#+)(?=\S)', '$1 ')
    do {
        $normalised = [regex]::Replace($output, '(?m)(?<=#) (?=#)', '')
        $changed = $normalised -ne $output
        $output = $normalised
    } while ($changed)

    $parent = Split-Path -Parent $destination
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    [System.IO.File]::WriteAllText($destination, $output, $utf8)
    Write-Host "Translated: $relative"
}
