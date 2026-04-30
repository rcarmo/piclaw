# Reverse proxy and tunnel setup

This page documents how to run piclaw's web UI behind a reverse proxy or tunnel.

Use this guidance when the browser reaches piclaw through an external hostname such as:

- Cloudflare Tunnel
- Caddy / Nginx / Traefik TLS termination
- a load balancer or ingress controller
- any setup where piclaw itself only sees an internal `http://host:port` hop

## Why this matters

When piclaw is proxied, the external browser origin may differ from the direct origin seen by the app.
Without proxy trust, that can break:

- browser-origin / CSRF checks on state-changing requests
- WebAuthn / passkey flows
- absolute URL generation for web-channel links
- client IP derivation for logging and rate limiting

piclaw only trusts forwarded proxy headers when you enable proxy trust explicitly.

## Enable proxy trust

Set:

```bash
PICLAW_TRUST_PROXY=1
```

or in `.piclaw/config.json`:

```json
{
  "web": {
    "trustProxy": true
  }
}
```

This maps to the runtime config consumed by:

- `runtime/src/utils/request-client.ts`
- `runtime/src/channels/web/http/security.ts`
- `runtime/src/channels/web/auth/request-origin.ts`

## Forwarded headers piclaw expects

When `PICLAW_TRUST_PROXY=1` is enabled, piclaw resolves the external origin using this data:

1. `X-Forwarded-Proto` (preferred) or `Forwarded: proto=...`
2. `X-Forwarded-Host` (preferred) or `Forwarded: host=...`
3. optional `X-Forwarded-Port`
4. falls back to the request URL / `Host` header when no forwarded values are present

For client-IP derivation it uses:

1. `X-Forwarded-For`
2. `X-Real-IP`
3. otherwise `unknown`

### Minimum required headers

Your proxy should forward either:

- the standard `Forwarded` header

or:

- `X-Forwarded-Host`
- `X-Forwarded-Proto`

Recommended extras:

- `X-Forwarded-Port`
- `X-Forwarded-For`
- `X-Real-IP`

## Cloudflare Tunnel example

A typical `cloudflared` setup can keep piclaw listening only on local HTTP while Cloudflare terminates TLS publicly.

### Piclaw side

```bash
PICLAW_WEB_HOST=127.0.0.1
PICLAW_WEB_PORT=8080
PICLAW_TRUST_PROXY=1
# Leave PICLAW_WEB_EXTERNAL_URL unset when the same instance must work
# through both a public proxy hostname and direct LAN access.
```

If you run inside the standard container, keep the container/web binding consistent with your deployment model. The key point is that the tunnel connects to piclaw over an internal hop while the browser uses the public HTTPS hostname.

Piclaw remembers the browser origin from forwarded headers on authenticated web requests. That remembered origin is used for generated web links and remote-pair callback URLs when `PICLAW_WEB_EXTERNAL_URL` is unset, so public proxy access and LAN access can coexist without pinning the instance to one hostname.

### `cloudflared` config example

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /etc/cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: piclaw.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Cloudflare Tunnel will supply the external host/proto context. With `PICLAW_TRUST_PROXY=1`, piclaw will treat the browser origin as `https://piclaw.example.com` instead of the internal `http://127.0.0.1:8080` hop.

### Notes for passkeys

If WebAuthn/passkeys are enabled, the browser hostname used during enrolment/login must match the public hostname users actually visit.
That is exactly why proxy trust must be enabled behind the tunnel.

## Caddy example

```caddy
piclaw.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy already forwards the usual proxy headers needed for this flow. Enable `PICLAW_TRUST_PROXY=1` on the piclaw side.

## Nginx example

```nginx
server {
    listen 443 ssl http2;
    server_name piclaw.example.com;

    ssl_certificate     /etc/letsencrypt/live/piclaw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/piclaw.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Direct deployments

If users connect directly to piclaw with no proxy/tunnel in front:

- leave `PICLAW_TRUST_PROXY=0`
- do not inject forwarded headers unnecessarily

## Troubleshooting

### Browser POSTs fail with origin / CSRF errors

Check:

- `PICLAW_TRUST_PROXY=1`
- forwarded host/proto headers are present
- the public hostname in the browser matches the forwarded host

Symptoms usually include failed posting, uploads, or other state-changing requests behind a proxy.

### Passkey / WebAuthn login fails only behind the proxy

Check:

- the browser is using the final public hostname
- `PICLAW_TRUST_PROXY=1` is enabled
- the proxy forwards host/proto correctly
- you are not mixing multiple public hostnames during enrolment/login

### Generated links point to the wrong host or `http://`

Check:

- `X-Forwarded-Host`
- `X-Forwarded-Proto`
- optional `X-Forwarded-Port`
- whether the proxy is rewriting `Host` unexpectedly
- whether `PICLAW_WEB_EXTERNAL_URL` is set; if set, it deliberately overrides the remembered forwarded/browser origin

### Client IPs all look wrong

Check:

- `X-Forwarded-For`
- `X-Real-IP`
- whether there is more than one proxy hop in front of piclaw

## Operational checklist

Before declaring a proxied deployment healthy, verify:

- login works
- posting works
- uploads work
- workspace writes work
- SSE/web streaming stays connected
- passkeys work, if enabled
- generated links use the public origin

## Related docs

- [Configuration](configuration.md)
- [README](../README.md)
