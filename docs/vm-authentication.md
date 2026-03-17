# VM Authentication

VMs use NFT-based web3 authentication instead of passwords or SSH keys.

## Flow

1. VM serves signing page on port 8443 via `web3-auth-svc` (HTTPS, self-signed TLS)
2. User connects wallet that owns the NFT
3. User signs challenge message (ML-DSA via OPWallet)
4. Signing page submits signature to auth-svc callback endpoint
5. Auth-svc verifies ML-DSA signature, writes `.sig` file
6. PAM module picks up the `.sig` file, authenticates the user

## Auth Service (web3-auth-svc)

HTTPS signing server, esbuild-bundled for deployment on VMs.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve signing page HTML |
| GET | `/engine.js` | Serve signing page engine bundle |
| GET | `/auth/pending/:session_id` | Return session JSON |
| POST | `/auth/callback/:session_id` | Verify signature, write `.sig` file |

### Signature Format

OPNet ML-DSA authentication. Payload: `{signature, publicKey, otp, machineId}` — all base64-encoded. The auth-svc auto-detects the ML-DSA security level from the public key size.

### Config

Reads `/etc/web3-auth/config.toml`:

```toml
[https]
port = 8443
bind = ["::"]
cert_path = "/etc/libpam-web3/tls/cert.pem"
key_path = "/etc/libpam-web3/tls/key.pem"
signing_page_path = "/usr/share/blockhost/signing-page/index.html"
```

## Template Package

Ships as `blockhost-auth-svc_<version>_all.deb`, installed on VM templates (not the host):

| File | Purpose |
|------|---------|
| `/usr/share/blockhost/auth-svc.js` | Bundled JS |
| `/usr/bin/web3-auth-svc` | Node wrapper script |
| `/usr/share/blockhost/signing-page/index.html` | Signing page (generated) |
| `/usr/share/blockhost/signing-page/template.html` | Signing page template (replaceable) |
| `/usr/share/blockhost/signing-page/engine.js` | Signing page engine bundle |
| `/lib/systemd/system/web3-auth-svc.service` | Systemd unit |
| `/usr/lib/tmpfiles.d/web3-auth-svc.conf` | Creates pending dir on boot |

See [templating.md](templating.md) for how to customize the signing page.
