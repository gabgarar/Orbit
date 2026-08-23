import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(new URL("../../../.scripts/zeroize-orbit.ps1", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../../../.scripts/zeroize-orbit.cmd", import.meta.url), "utf8");

test("the Orbit zeroizer is confirmation-gated and preserves the reset marker while cleaning runtime data", () => {
    assert.match(script, /CmdletBinding\(SupportsShouldProcess\s*=\s*\$true,\s*ConfirmImpact\s*=\s*"High"\)/);
    assert.match(script, /\.orbit-client-state-generation\.json/);
    assert.match(script, /Write-ClientStateGenerationMarker[\s\S]*?Remove-OrbitResetTarget/);
    assert.match(script, /dataRoot\s+"erp"/);
    assert.match(script, /dataRoot\s+"geopotential"/);
    assert.match(script, /configRoot\s+"precise-products"/);
    assert.match(script, /configRoot\s+"manual-erp-snapshots"/);
    assert.match(script, /git -C \$projectRoot restore --source=HEAD --worktree -- "config\/catalog\.json" "config\/system_config\.json"/);
    assert.match(script, /config\/eop\/leap-seconds\.list/);
    assert.match(script, /\$trimCharacters\s*=\s*\[char\[\]\]@\(/);
    assert.match(script, /\.TrimEnd\(\$trimCharacters\)/);
    assert.doesNotMatch(script, /\.TrimEnd\("\\\\", "\/"\)/);
    assert.match(script, /\[System\.IO\.Directory\]::CreateDirectory\(\$target\)/);
    assert.doesNotMatch(script, /New-Item\s+-ItemType\s+Directory\s+-LiteralPath\s+\$target/);
    assert.match(script, /\[System\.IO\.File\]::Replace\(\$temporaryPath, \$markerPath, \$backupPath\)/);
    assert.doesNotMatch(script, /\[System\.IO\.File\]::Replace\(\$temporaryPath, \$markerPath, \$null\)/);
});

test("the Orbit zeroizer never delegates to a broad Git or filesystem wipe", () => {
    assert.doesNotMatch(script, /git\s+(?:clean|reset)\b/i);
    assert.doesNotMatch(script, /Remove-Item\s+[^\r\n]*\$projectRoot\s*(?:$|[-\r\n])/im);
    assert.match(script, /Resolve-ProjectPath/);
    assert.match(script, /Assert-NotReparsePoint/);
    assert.match(script, /\$linkType\s*=\s*\[string\]\$item\.LinkType/);
    assert.match(script, /OneDrive Files On-Demand/);
});

test("the command launcher forwards flags to the safe PowerShell zeroizer", () => {
    assert.match(launcher, /zeroize-orbit\.ps1/);
    assert.match(launcher, /%\*/);
});
