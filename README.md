# Rocket League

Car football for Bloxity. Drive, boost, jump, flip and fly a car - with your own blocky Bloxity avatar in the
driver's seat - and smash a big ball into the other team's goal. Up to 15 players per room; bots fill the empty
seats (at least 3v3) and hand their cars over the moment a human joins.

- Rocket League's driving and ball physics, in its own units: throttle and boost curves, steering curvature,
  powerslides, wall and ceiling driving, jump / double jump / flips, air roll, Psyonix's car-ball hit model,
  bumps and supersonic demolitions, 34 boost pads.
- Server-authoritative (Colyseus) with Rocket League-style full-world client prediction, so your car and your
  touches respond instantly and stay exactly in step with the server.
- Kickoff countdown, a clock that starts on the first touch, goal explosions with a goal camera and a replay,
  overtime, results with MVP, then the next match.
- Five cars to choose from in the garage (G): Viper GT, Breaker, Tempest, Hotshot and Frostbite.
- Arena 1, "Neon Park", styled after Neo Tokyo: a wet asphalt street pitch with worn road paint, dark metal walls
  with LED dot strips, goals under LED "SCORE" hoods, all inside a fully enclosed lattice dome in a dense neon city
  at night - kanji signs, billboards, an elevated monorail with a train, searchlights, a giant ball sculpture.
- Arena 2, "Grand Prix Park": race day in the sun - a turf pitch inside an asphalt track with red-and-white kerbs,
  balloon arches over the goals, a packed stadium under a glass canopy and giant arches, glass towers beyond.
  Every arena has the same shape; the server picks one per room and moves to the next each match.
- A pre-match LOBBY on the floor of the Grand Prix stadium: walk around in your Bloxity avatar, chat and emote,
  check the hanging scoreboard (players, playlists, live matches), look at the cars in the garage showcase, and
  step onto a playlist pad - 1V1 DUEL, 3V3 STANDARD or 4V4 CHAOS - to queue. A full queue (or 10 s of waiting,
  with bots) starts a match; you load in behind a MATCH FOUND card and fly into your car. After the results you
  are back in the lobby.
- Desktop (keyboard + mouse or gamepad) and mobile landscape (stick + thumb buttons).

## Controls

| | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Drive / reverse (air: pitch) | W / S | RT / LT (stick) | stick up / down |
| Steer (air: yaw) | A / D | left stick | stick |
| Jump, double jump, flip | Space / right click | A | JUMP (+ stick for a flip) |
| Boost | Shift / left click | B | BOOST |
| Powerslide (air: roll with A/D) | C | X | DRIFT |
| Air roll left / right | Q / E | LB / RB | - |
| Ball cam | F | Y | CAM |
| Scoreboard | Tab | Back | SCORES |
| Quick chat | 1 - 8 | - | CHAT |
| Switch team (when fair) | T | - | - |
| Garage (choose your car) | G | - | CARS |

## Run it

```bash
npm install
npm run dev
```

Client on http://localhost:5480, server on :2880. See `CLAUDE.md` for the architecture and the test scripts.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) deploys `dev` to Bloxity DEV and `main` to PROD: typecheck and
`npm run verify`, the client built with its channel's server URL and zipped, the server image pushed to GHCR and
rolled through Legion, then the zip uploaded to Bloxity Hosting. Game id `rocket-league-game`.

| | Frontend | Backend (HTTP + WSS) |
| --- | --- | --- |
| DEV (`dev`) | https://rocket-league-game.dev.play.bloxity.io | wss://rocket-league-game.dev.host.bloxity.io |
| PROD (`main`) | https://rocket-league-game.play.bloxity.io | wss://rocket-league-game.host.bloxity.io |

One-time setup: create the `rocket-league-game` game on https://hosting.bloxity.io, add its deploy token as the
repository secret `LEGION_DEPLOY_TOKEN`, and after the first push make the GHCR package `rocket-league-game-server`
public so Legion can pull it.
