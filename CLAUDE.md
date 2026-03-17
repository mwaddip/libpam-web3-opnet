# libpam-web3-opnet

OPNet ML-DSA authentication plugin for libpam-web3.

## Architecture

```
src/main.rs             — PAM verification plugin (Rust): OTP validation + wallet_address pass-through
auth-svc-src/index.ts   — HTTPS auth service (Node.js): ML-DSA-44/65/87 verification
signing-page/
  index.html            — OPWallet signing UI (default)
  template.html         — Replaceable HTML/CSS template ({{VARIABLE}} placeholders)
  engine.js             — Wallet detection, SHA256→signMLDSAMessage, callback
web3-auth-svc.service   — Systemd unit
libpam-web3.conf        — tmpfiles.d (creates /run/libpam-web3/pending/)
config.example.toml     — Auth-svc config template (optional)
```

## Plugin Protocol

See `docs/specs/plugin-interface.md` in the libpam-web3 core repo.

- **stdin:** `{"sig": <.sig JSON>, "otp_message": "..."}`
- **stdout:** wallet address
- **exit 0** = verified, **non-zero** = denied

## Trust Model

The auth-svc verifies the ML-DSA signature (~2KB) before writing the `.sig` file. This plugin validates the OTP fields and returns the `wallet_address` assertion. The `.sig` file is a trusted assertion, not a cryptographic proof that PAM re-checks.

## Verification Split

| Step | Owner | What |
|------|-------|------|
| Structural + crypto | auth-svc | ML-DSA verify (44/65/87), OTP match, double-hash reconstruction |
| Address derivation | auth-svc | `0x` + hex(SHA256(publicKey)) |
| Identity | PAM plugin | OTP re-validation, returns wallet_address from .sig |
| GECOS match | PAM core | Compares returned address against GECOS `wallet=` |

## Build

```bash
cargo build --release           # Plugin binary: target/release/opnet

# Auth-svc bundle (requires Node.js 22+):
npx esbuild auth-svc-src/index.ts --bundle --platform=node --target=node22 --minify --outfile=auth-svc.js

# Full .deb package:
./packaging/build-deb.sh
```

## Install

```bash
sudo dpkg -i packaging/libpam-web3-opnet_0.1.0_amd64.deb
```

Or manually:
```bash
sudo cp target/release/opnet /usr/lib/libpam-web3/plugins/
sudo chmod 755 /usr/lib/libpam-web3/plugins/opnet
```

## Port

`32448` — derived from `1024 + (crc32("opnet") % 64511)`. No config needed.

## Dependencies

- `libpam-web3` (core PAM module)
- `nodejs >= 22` (for auth-svc runtime + ML-DSA library)
- `@btc-vision/post-quantum` (ML-DSA-44/65/87 verification, bundled by esbuild)

## Note

libpam-web3 core contains a built-in OPNet verification path (reference implementation). This plugin is the standalone version for use with the plugin dispatch system. When the plugin binary is installed, PAM uses it; otherwise, the built-in path handles `"chain": "opnet"`.
