param(
  [Parameter(Mandatory = $true)][string]$HostAddress
)

$ErrorActionPreference = 'Stop'
$Port = 3443
$address = $null
if (-not [System.Net.IPAddress]::TryParse($HostAddress, [ref]$address) -or
    $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    $Port -lt 1 -or $Port -gt 65535) { throw 'Indica una dirección IPv4 y un puerto válidos.' }
$rootPath = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $rootPath 'secrets\ios-lan'
$configPath = Join-Path $secretPath 'config.json'
$certificatePath = Join-Path $rootPath 'public\downlink-local-ca.cer'
if (Test-Path -LiteralPath $configPath) { throw 'Ya existe una configuración para iPhone; no se sobrescribirá.' }
New-Item -ItemType Directory -Path $secretPath -Force | Out-Null

# The CA private key is non-exportable and stays in the current Windows user
# certificate store. The server key and password are restricted to that user.
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true, $false)
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($owner, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $secretPath -AclObject $acl

$root = New-SelfSignedCertificate -Type Custom -Subject 'CN=Downlink Local CA' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -KeyUsage CertSign, CRLSign -TextExtension @('2.5.29.19={critical}{text}CA=true&pathlength=0') -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(3)
$leaf = New-SelfSignedCertificate -Type Custom -Subject 'CN=Downlink Local Server' -Signer $root -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature, KeyEncipherment -TextExtension @("2.5.29.17={text}IPAddress=$HostAddress", '2.5.29.37={text}1.3.6.1.5.5.7.3.1', '2.5.29.19={critical}{text}CA=false') -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(365)
$random = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
$passphrase = [Convert]::ToBase64String($random)
$password = ConvertTo-SecureString -String $passphrase -AsPlainText -Force
Export-PfxCertificate -Cert $leaf -FilePath (Join-Path $secretPath 'server.pfx') -Password $password | Out-Null
Export-Certificate -Cert $root -FilePath $certificatePath -Type CERT | Out-Null
$json = @{ host = $HostAddress; port = $Port; passphrase = $passphrase } | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "Configuración creada. Abre http://${HostAddress}:3000/ios-setup.html en el iPhone."
Write-Host "Huella SHA-256 del certificado: $((Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash)"
