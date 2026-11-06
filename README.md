# Fiber Node Installer (archived)

This repository is archived and no longer maintained.

To install a Fiber Network Node (fnn) for Nervos CKB, use the official install scripts from the
Fiber team: https://github.com/nervosnetwork/fiber/tree/develop/tools/install

## Why

- The Fiber team now ships its own install scripts and keeps them current with each fnn release
  and with `fnn-migrate`.
- This installer and its dashboard were written for fnn 0.7. Since fnn 0.8 the RPC uses
  `pubkey` where the dashboard expects `node_id`, so the dashboard does not load against a
  current node.
- A new fnn can change its storage format. Back up the store and read the release notes before
  any upgrade.

## If you installed it before

The weekly auto-update fetched releases from the old repository address
`tecmeup123/fiber-node-installer`, which is no longer this project. Remove it:

- Linux: `crontab -l | grep -v 'fiber-node.*update.sh' | crontab -`
- Windows (as Administrator): `Unregister-ScheduledTask -TaskName FiberNodeUpdate -Confirm:$false`

Your node key and store stay in your install folder (`~/fiber-node` on Linux,
`%USERPROFILE%\fiber-node` on Windows). The dashboard has no login: stop it, or keep its port
closed to other machines and do not browse other sites while it runs.

## What is here

- `install-fiber.sh` and `install-fiber.ps1`: the installers, kept for reference. They no
  longer set up automatic updates.
- `fiber-dashboard/`: the web dashboard.
- `tests/`: Pester tests for the Windows installer.

## License

MIT
