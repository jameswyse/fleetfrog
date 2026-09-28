# Security

Report a vulnerability privately through [GitHub's vulnerability reporting](https://github.com/jameswyse/fleetfrog/security/advisories/new) rather than in a public issue. Include the version, what an attacker can do and the steps to reproduce it.

Only the latest release receives fixes while FleetFrog is below 1.0.

Sign-in is off on a new hub, so until an admin turns it on under **Settings › Authentication**, anyone who can reach the hub's dashboard port can see every repository and ask agents to run actions. That is the intended default for a private network, not a vulnerability. Agents still run only the named actions they support, never commands from the hub, and refuse any action their owner's policy denies.
