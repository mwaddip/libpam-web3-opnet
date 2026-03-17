# Page Templating

The signing and signup pages are split into replaceable HTML/CSS templates and engine-owned JS bundles. Anyone forking the engine can drop in their own HTML/CSS without touching the wallet/chain JavaScript.

## Architecture

```
template (HTML/CSS)     — layout, branding, copy, styles
engine bundle (JS)      — wallet connection, signing, chain interaction
generator (Python/Bash) — injects config variables, combines template + bundle → output
```

The template never contains wallet or chain logic. The bundle never contains layout or styling. The generator is the glue.

## Files

### Signing Page

| File | Role |
|------|------|
| `auth-svc/signing-page/template.html` | Replaceable HTML/CSS template |
| `auth-svc/signing-page/engine.js` | Engine-owned wallet + ML-DSA signing logic |
| `auth-svc/signing-page/index.html` | Generated output (served by auth-svc) |

### Signup Page

| File | Role |
|------|------|
| `scripts/signup-template.html` | Replaceable HTML/CSS template |
| `scripts/signup-engine.js` | Engine-owned wallet + purchase + decrypt logic |
| `scripts/generate-signup-page` | Generator script (Python) |

## Template Variables

Injected as `{{VARIABLE}}` placeholders by the generator.

| Variable | Type | Description |
|----------|------|-------------|
| `PAGE_TITLE` | string | Page heading text |
| `PRIMARY_COLOR` | CSS color | Accent color (from `engine.json` → `accent_color`) |
| `PUBLIC_SECRET` | string | Message text the user signs |
| `SERVER_PUBLIC_KEY` | hex string | secp256k1 public key for ECIES encryption |
| `RPC_URL` | URL | Chain RPC endpoint |
| `NFT_CONTRACT` | hex string | NFT contract address |
| `SUBSCRIPTION_CONTRACT` | hex string | Subscription contract address |
| `PAYMENT_TOKEN` | hex string | OP_20 payment token address (OPNet-specific) |

The accent color is applied via a CSS variable in the template's `<style>` block:

```css
:root {
  --primary: {{PRIMARY_COLOR}};
}
```

## Required DOM Elements

The engine JS finds elements by `id`. Templates must include all of these.

### Signing Page

`btn-connect`, `btn-sign`, `wallet-address`, `status-message`, `step-connect`, `step-sign`

### Signup Page

`btn-connect`, `btn-sign`, `btn-purchase`, `wallet-address`, `plan-select`, `days-input`, `total-cost`, `status-message`, `step-connect`, `step-sign`, `step-purchase`, `step-servers`, `server-list`

## CSS Class Contract

The engine JS adds/removes these classes. The template defines their appearance.

| Class | Applied to | Meaning |
|-------|-----------|---------|
| `hidden` | any step container | Step not yet active |
| `active` | step container | Currently active step |
| `completed` | step container | Step finished |
| `disabled` | button | Button not yet clickable |
| `loading` | button | Operation in progress |
| `error` | `#status-message` | Error state |
| `success` | `#status-message` | Success state |

## CONFIG Object

The template includes a `<script>` block with the CONFIG object, followed by the engine bundle:

```html
<script>
var CONFIG = {
  publicSecret: "{{PUBLIC_SECRET}}",
  serverPublicKey: "{{SERVER_PUBLIC_KEY}}",
  rpcUrl: "{{RPC_URL}}",
  nftContract: "{{NFT_CONTRACT}}",
  subscriptionContract: "{{SUBSCRIPTION_CONTRACT}}",
  paymentToken: "{{PAYMENT_TOKEN}}"
};
</script>
<script src="engine.js"></script>
```

## Creating a Custom Template

1. Copy the default `template.html` or `signup-template.html`
2. Modify HTML structure, CSS, copy, images — anything visual
3. Keep all required DOM element IDs intact
4. Keep the `CONFIG` script block and engine bundle include
5. Rebuild: run the generator or restart auth-svc

The template can add any extra elements, sections, or styling. It must not remove or rename the required IDs.

## Generating the Signup Page

```bash
blockhost-generate-signup --output /var/www/signup.html
blockhost-generate-signup --config /etc/blockhost/blockhost.yaml --output /var/www/signup.html
blockhost-generate-signup --serve 8080  # Serve on IPv4/IPv6 for testing
```

The generator reads config from `blockhost.yaml` + `web3-defaults.yaml`, reads `accent_color` from `engine.json`, replaces `{{VARIABLE}}` placeholders in the template, and copies `signup-engine.js` alongside the output HTML.
