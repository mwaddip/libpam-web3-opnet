# libpam-web3-opnet

OPNet verification plugin for libpam-web3.

## Architecture

This repo produces three components:

| Component | Status | Description |
|-----------|--------|-------------|
| `opnet` plugin binary | Implemented | OTP validation + wallet_address pass-through, installed to `/usr/lib/libpam-web3/plugins/opnet` |
| `web3-auth-svc` | Planned | OPNet-specific signing server (to be extracted from engine) |
| `signing-page/` | Planned | ML-DSA wallet connection UI (to be extracted from engine) |

## Plugin Protocol

See `docs/specs/plugin-interface.md` in the libpam-web3 core repo.

- **stdin:** `{"sig": <.sig JSON>, "otp_message": "..."}`
- **stdout:** wallet address
- **exit 0** = verified, **non-zero** = denied

## Trust Model

The auth-svc verifies the ML-DSA signature (~2KB) before writing the `.sig` file. This plugin validates the OTP fields and returns the `wallet_address` assertion. The `.sig` file is a trusted assertion, not a cryptographic proof that PAM re-checks.

## Build

```bash
cargo build --release
# Binary: target/release/opnet
```

## Install

```bash
sudo mkdir -p /usr/lib/libpam-web3/plugins
sudo cp target/release/opnet /usr/lib/libpam-web3/plugins/
sudo chmod 755 /usr/lib/libpam-web3/plugins/opnet
```

## Note

libpam-web3 core contains a built-in OPNet verification path (reference implementation). This plugin is the standalone version for use with the plugin dispatch system. When the plugin binary is installed, PAM uses it; otherwise, the built-in path handles `"chain": "opnet"`.

## Dependencies

Requires `libpam-web3` to be installed on the target system.
