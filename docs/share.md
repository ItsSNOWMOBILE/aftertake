# Share a live link

Let someone use Aftertake on your computer from their own browser, for a client
review or for competition judges, through a link only they have.

```sh
node scripts/aftertake.mjs share
```

The launcher installs what is missing, builds the studio and prints the link to
send. Leave it running while people use it; Ctrl+C stops sharing.

## What visitors get

- **A separate copy.** The shared studio has its own workspace, `.data-share`,
  started from the recorded examples. Visitors never see or change your own
  projects, and you keep using your studio as usual.
- **Every studio your computer can render.** They use your GPU, or Comfy Cloud
  for the studios you route there. Renders run one at a time, so a video can take
  a few minutes; a note at the bottom of the page says so and shows how many
  renders they have left.
- **A daily allowance.** Each visitor can start 20 renders a day and all visitors
  together 150. A render is anything that runs a model on your GPU or on Comfy
  Cloud: images, videos, one-tap effects, enhancements, region effects, frame
  edits, depth effects, tracking and character replacement. A one-tap effect
  counts once, including its automatic re-render; a storyboard counts one per
  shot plus one for its song, and planning one is free; a set of takes counts
  one per take. Editing, previews, Color &
  finish, layers, Film export and turning an effect's watermark on or off run on
  the CPU and do not count, and neither does a refused render.
- **Nothing to change in your setup.** Visitors can't change Render setup, connect
  or disconnect Comfy Cloud, or read your Comfy Cloud key.

Without the link, a visitor sees a page that points to the film, the browser
version and the source on GitHub. The link sets a cookie, so it works again in
the same browser for 45 days without being typed.

## Put it online with Tailscale Funnel

[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) is free on the Personal
plan. It gives your computer a fixed HTTPS address and shows visitors no warning
page.

1. Install Tailscale from [tailscale.com/download](https://tailscale.com/download)
   and sign in.
2. Start sharing: `node scripts/aftertake.mjs share`.
3. In a second terminal, run `tailscale funnel --bg 7860`. The first time,
   Tailscale prints a page to turn on HTTPS and Funnel for your account; approve
   it, then run the command again. `--bg` keeps the tunnel on across restarts.
4. Send the link the launcher printed:
   `https://<computer>.<tailnet>.ts.net/?access=…`. Open it yourself in a private
   window first.

`tailscale funnel status` shows the tunnel; `tailscale funnel reset` turns it off.
Any other tunnel that forwards HTTPS to `127.0.0.1:7860` works too, such as
Cloudflare Tunnel or ngrok, but their free addresses change on restart or show a
warning page first.

## Keep it available

- **Keep the computer on and awake.** On Windows, open Settings → System → Power
  → Screen and sleep, and set sleep to Never when plugged in. On macOS, use
  System Settings → Energy (or Battery → Options) to prevent sleeping.
- **Choose where each studio renders** in the shared copy's Render setup at
  `http://127.0.0.1:4311`, which only you can open. Install the model profiles
  you want visitors to use with `setup-gpu`, or send studios to Comfy Cloud.
- **Restart it after a reboot.** Run the share command again; the link stays the
  same.

## Options

| Option | What it does |
| :--- | :--- |
| `--renders-per-visitor=N` | Renders each visitor can start in a day (20) |
| `--renders-per-day=N` | Renders all visitors together can start in a day (150) |
| `--new-link` | Makes a new access link; the old one stops working |
| `--reset` | Starts the shared workspace fresh from the recorded examples |
| `--share-port=N` | The port the tunnel points at (7860) |
| `--studio-port=N` | The shared studio's own port, for your Render setup (4311) |

Set `AFTERTAKE_SHARE_TOKEN` to use your own access token of 16 characters or
more instead of the saved one in `.data-share/share-token`.

## How it works

The shared studio listens on `127.0.0.1:4311` and accepts only requests from
this computer, like the normal studio. `scripts/share-gateway.mjs` listens on
`127.0.0.1:7860`, so only the tunnel reaches it. It checks the access cookie,
refuses changes to the Comfy Cloud connection and render destinations, counts
renders per visitor, and relays everything else to the studio as a local,
same-origin request without the visitor's cookies. Render counts reset when the
share command restarts.
