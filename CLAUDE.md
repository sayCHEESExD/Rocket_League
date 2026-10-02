# Rocket League (Bloxity)

Browser car-football for Bloxity (`window.Legion.SDK`): Three.js client, Colyseus 0.16 server, npm workspaces
(`shared` / `server` / `client`). Players start in a walk-around LOBBY (15 per lobby) and pick a playlist - 1v1, 3v3 or
4v4 - which becomes a match room of that size; bots fill empty seats. Platform plumbing (SDK wrapper, token
auth, avatar dressing, deploy) came from `D:\Illgeal Soccer`; the physics, netcode, arena and game are this repo's own.

## Commands

```bash
npm run dev                 # builds shared, then server (tsx watch, :2880, RL_DEBUG=1) + Vite client (:5480)
npm run build               # shared + server + client (client/dist)
npm run typecheck
npm run test:physics        # the physics playtest suite: RL reference numbers (speeds, turn radius, jumps,
                            # flips, wall climbs, hits, bumps, demos, goals/posts, snapshot round trip)
npm run verify              # test:physics + a headless 3-minute bot match through the real server Match
node scripts/bot-eval.mjs 5 # bot quality: touches/shots/goals per minute
npm run verify:multiplayer  # needs a running server: 15 clients, 16th refused, junk input, bandwidth, tick cost
npm run verify:stats        # Bloxity stat reporter + career store against a local stub (guests, batching, ceilings)
npm run verify:lobby        # needs a running server: lobby, walking bounds, 1v1/3v3 queues, reservations, the board, 15 cap
npm run size:client         # client/dist against the 12 MB budget (currently ~6.2 MB: 4.4 MB of it is the music)
```

Dev handle: `window.__rl.game` (`pred`, `net`, `controls.keys` to hold keys, `debugCam = {pos, at, fov}` in sim uu) and
`window.__rl.app` (`app.lobby.queue('3v3')`, `app.lobby` camera/walker). A normal load lands in the LOBBY; `?play=open`
goes straight into an open match room (the old behaviour - use it for `dbg`, the debug camera and match screenshots).
Dev-only server commands (ignored unless `RL_DEBUG=1`, which only `npm run dev` sets):
`game.net.send('dbg', { play: true, bots: false, car: [x,y,z,yaw], ball: [x,y,z,vx,vy,vz], clock: 3 })`.
Do NOT use python from the Bash tool; use node. Write multi-line edit scripts to a file (`scripts/_patch.mjs`,
using the CRLF-safe `edit(path, [[from, to], ...])` helper in `scripts/_edit.mjs` - some sources are CRLF).
Force an arena in dev: `game.net.send('dbg', { arena: 1 })`.
Never commit or push unless asked.

## Non-negotiable rules

- **Gameplay first.** Priority: car physics > ball > car-ball > sync > match/goal > camera > boost/aerial > UI >
  goal presentation > VFX/audio > decoration > more maps. Tune by measuring (`physics-test.mjs`), not by guessing.
- **Arenas are looks, never shapes.** Two so far (`ARENAS` in `shared/src/config/match.ts`): 0 "Neon Park"
  (night) and 1 "Grand Prix Park" (day, added on request). Add more one at a time, only when asked - the physical
  arena (`shared/src/sim/arena.ts`) stays the same for competitive readability. The server owns the choice:
  `MatchState.arena`, random for a new room, next in the list every new match. The client follows it in
  `Game.setArena` (dispose + rebuild `ArenaView(theme)`, then `applyLook` from `world/Themes.ts`: lights, fog,
  sky colour, bloom strength, cached PMREM environment).
- **Units are Rocket League's.** The sim runs in uu (1 uu = 1 cm), Z up, blue defends -Y, orange +Y; car local
  frame +X forward, +Y left, +Z up. Constants in `shared/src/sim/constants.ts` are the documented RL values
  (RocketSim/RLUtilities) unless marked "OUR tuning". Render converts with `world/units.ts` (three = x, z, -y; x0.01).
- **THE DETERMINISM CONTRACT.** `shared/src/sim` is stepped by the server AND replayed by every client for
  prediction, so it must stay deterministic: no `Math.random`, no wall-clock, no allocation-dependent order, no
  per-machine branches. The server calls `quantizeWorld` after every tick, and every quantiser in
  `sim/snapshot.ts` is idempotent (Q(Q(x)) = Q(x)) - so a client decoding a snapshot holds EXACTLY the server's
  state. Any new state field must be (a) copied in `copyFrom`, (b) quantised, (c) encoded/decoded, and the
  `SNAPSHOT_VERSION` bumped. `physics-test` checks the round trip; in the browser the debug line's `corr` must read
  0 uu while driving with no other players near.
- **Server-authoritative.** Clients send INPUT only (`MessageType.Input`: `[seq, count, 6 bytes each]`) and requests
  (identity, avatar, token, switch team, quick chat). Car/ball state, boost, pads, touches, goals, score, clock and
  phases are the server's. Inputs are queued per player and consumed one per tick (`Match.takeInput`); a starved
  queue holds the last input for 0.5 s, then idles.
- **Prediction** (`client/src/net/Prediction.ts`): full-world, like RL - rewind to each snapshot, replay own unacked
  inputs, extrapolate others with their last input; corrections become decaying visual offsets. Phase timing for the
  replayed ticks comes from the schema (`phase`, `phaseEnd`) so a countdown ends on the exact tick.
- **Server clock:** a real-time accumulator (`GameRoom` loop), not `setSimulationInterval` - Node rounds 16.67 ms
  and the resulting 58.8 Hz made the input queues overflow (a one-tick correction every merge).
- **Bandwidth:** snapshots are 66 B/car; 30 Hz up to 8 cars, 20 Hz above (`Match.step`). ~13 KB/s for a 3v3,
  ~24 KB/s per client with 16 cars. Schema patches (names, scores, phases) at 10 Hz carry no motion.
- **Cars:** five bodies recreated from the user's five reference images, one file each in
  `client/src/world/cars/models/` (viper = green supercar, breaker = orange gridded Octane-style, tempest = teal/yellow
  modern muscle, hotshot = red hot hatch with the white kit, frostbite = ice muscle car with the blower); all share ONE
  hitbox (Dominus-like, 127x84x34 uu). The kit (`cars/loft.ts`): a body is a row of SECTIONS (`sec`: eight filleted
  control points - bottom, rocker, widest, shoulder crease, top edge, a level point, top centre), monotone-cubic between
  stations, creased normals (`creased` - three's helper welds at 1/100 unit, so it works in tenths of a mm). PAINT is
  a livery BAKED per texel from a function of the 3D surface point (`paint(p, palette)`: position, normal, arc, cap
  face, distance to the cabin base `p.cab`) into a 1024x512 atlas (512 on phones): albedo + ORM (R clearcoat, G
  roughness, B metal, A glow - emission = colour x alpha x 6, patched into one MeshPhysicalMaterial per car). Parts
  (`cars/parts.ts`: wings, flares, splitters, mirrors...) sample palette swatches in the same atlas: body + roof panel
  + parts = ONE mesh/material. ALL CARS ARE OPEN TOPS (user: see the Bloxity driver while driving): no roof, side or
  rear glass - a short, lightly tinted windscreen (`shell`) in a frame, a low roll hoop, the cockpit tub painted as
  interior; drivers sit 3 cm higher (`CarView.seat`); wings stay LOW (below the driver from the chase camera). Wheels (`cars/wheels.ts`): tyre + rim instanced pools per model, rim design
  per reference. TWO LODs (`BuiltCar.lods`, switched in `CarView` at 26/21 m): far = coarser loft and plain wheels,
  same livery. ~10k tris body + 4 x 2.7k wheels near. Paint looks per arena: `ThemeLook.carEnv` (reflection) and
  `carShade` (albedo; the day sun washes colours out) via `setCarEnvironment` (Game.applyLook, Lobby.enter).
  Model with the DEV car lab: `/carlab.html#car=0..4&view=sheet|ref|ref2|side|front|rear|top&bg=studio|day|neon&rider=1&lod=1`
  (never built; renders on a timer, so it works in a hidden pane). Cars ALWAYS keep their own reference colours -
  never repaint by team (user rule). Team identity: the team-colour underglow ring (`CarView`, on the ground only),
  team name plates, HUD/scoreboard colours. Wheel wells are carved into the loft and the visual steer angle is capped
  at 0.3 rad so tyres stay inside them. Riders sit in a racing position; `seat.h` per model keeps them inside the
  body (check with `rider=1`). Choice: `PlayerState.body`, `MessageType.SetCar`, remembered in localStorage.
- **Shadows:** one real-time directional shadow map over the arena (`Game`: 1536 desktop / 1024 phones, PCF, bounds
  +-74 m; call `updateProjectionMatrix` after changing them). Cars, wheels, ball, goal frames and goal dressing
  cast; pitch, walls, goal boxes, pads receive. Riders do NOT cast (hidden in the car's shadow; they cost ~2 ms).
- **Depth precision / Z-fighting:** camera near plane is 0.15 m (not 0.05). Never stack coplanar or near-coplanar
  faces: city signs sit 0.4 m (blades) / 1.0 m (billboards) off facades, towers never overlap, swept (not
  per-segment box) geometry for long curved things like the monorail, screens >= 7 cm in front of their housings.
- **Controls:** W/S are throttle AND air pitch (RL KBM), but a key already held at take-off is latched and pitches
  nothing until pressed again (`Controls` latches) - holding W into a jump used to somersault the car. A jump
  pressed in the air still takes its flip direction from the raw keys. Pitch is zero on the ground. L = back to the
  lobby. In a match a click locks the pointer (released for garage, social panel, results, leaving). PC shows
  SPACE/SHIFT keycaps beside the boost dial (lit while held; hidden on touch).
- **Stranded-car reset** (`Match.unstick`, server, after `advance`, before `quantizeWorld`): a car on its roof or
  side (up.z < 0.45, < 3 wheels down, < 350 uu/s, on the floor) for 5 s is `placeCar`ed upright where it lies,
  keeping heading and boost. `sim-match` gates it (still stuck at 4 s, upright by 6 s).
- **Bots pass as players (user requirement).** No "Bot" anywhere in UI (scoreboard, name plates, MATCH FOUND card,
  live board); bots get handles from `playerLikeName` (`shared/src/config/names.ts`) - the lobby pre-picks them
  (`botNames` create option) so the card matches the match - and a jittering fake ping (`GameRoom.botPings`).
  `PlayerState.bot` stays replicated for code only; never render it.
- **Boost:** 12.5/s drain (a full tank = 8 s held), 880/930 uu/s^2 ground/air - deliberately longer than RL.
- **Arena height is 2300 uu** (RL: 2044) - raised on request; tests use it.
- **Enclosure:** the arena is sealed physically (SDF) and visually: `world/Barrier.ts` lattice over walls, top curve
  and roof (metre UVs): big 7.5 m cells, hairline lines, outlined pentagons, low alpha (user reference). No girders.
  Goal nets are INSET 5 cm from the opaque goal interior (coplanar = the old flicker).
- **Look of Arena 1 = Rocket League's Neo Tokyo at night** (user reference). `ArenaView`: wet asphalt pitch
  (canvas colour + roughness maps: cracks, glassy puddles, worn orange road paint, zebra crossings, team hatching
  at the ends), dark riveted gunmetal walls, blue/orange LED dot strips, goals under an angled LED hood (scrolling
  chevrons + dot-matrix "SCORE n", 5x7 LED font) with two flanking SCORE screens. Hood and screens sit BEHIND the
  wall plane (visible through the lattice) so nothing visual sticks into the drivable surface. `world/City.ts`:
  street grid of ~700 dark towers packed against the arena, vertical kanji blades + billboards facing the pitch, LED
  edge strips, an elevated monorail loop over one corner with a moving train, searchlights, a giant ball on a
  rooftop, balloons, cloudy night sky, big score screens behind the goals. `world/Environment.ts`: neon PMREM
  environment (scene + garage). Night lights and a blue-violet fog in `core/Game.ts`. No stands, no crowd.
  `world/BoostPads.ts`: spinner pads with flames and golden orbs (user reference). Keep the triangle budget: draw
  only used instances (`WheelPool` sets `mesh.count`); ~210k tris.
- **Look of Arena 2 = a sunny race-day stadium** (user reference). Same `ArenaView` with theme 'day': mown turf
  ringed by red/white kerbs inside dark asphalt (white boundary + lane dashes, yellow chevrons, zebra goal boxes with
  a faint team tint), light concrete walls with pitch-side ad boards, white goal frames, balloon arches standing
  just behind the wall above each goal. `world/Stadium.ts`: a full bowl of stands with a painted crowd texture (no
  NPCs), glass canopy on white ribs, two giant arches, bunting, checkered race towers, balloon columns, tents,
  trees, pale glass skyscrapers, summer sky with clouds; `dayEnvironment` in `world/Environment.ts`. ~190k tris.
- **Boost dial** (`ui/Hud.ts`): charcoal disc, outlined white digits, orange boost bars bottom->top, white speed
  bars top->2 o'clock (user reference). Bloom (desktop only) uses threshold 3.0 - only HDR
  emissives (colours > 1) glow; lit surfaces must stay below it.
- **HUD** follows the user's reference screenshot: slim top-centre scoreboard with YOUR team on the left, top-right
  feed of team-coloured name boxes + icons, "NAME SCORED!" outline text, bottom-left BALL CAM, red boost dial.
  End of match = RL's two screens (user reference, `Game.finish` + `Hud.showResults/finishPodium`): 3.4 s of a
  trophy + "WINNER" + the team name in thin glowing outline letters over a low orbit of the MVP's car, then a cut to
  the winners parked at centre field (MVP in the middle, cheering; losers hidden) with name banners above and title
  cards below (STRIKER / PLAYMAKER / GUARDIAN... from the stats). Render-only poses: the sim stays frozen.
- **Riders:** players are their Bloxity avatar seated in the car (`player/PlayerCharacter.ts` SEATED pose,
  `bloxity/AvatarDresser.ts`), bots wear catalogue looks (`bloxity/botLooks.ts`). The top-left corner stays free
  of ALL UI on every device (the portal draws there); the touch CARS / CHAT / SCORES / SOCIAL / LOBBY row is
  bottom-centre. Lobby HUD: playlist cards bottom-centre, buttons bottom-left (top-right on touch), stick bottom-left.
  Global HUD CSS classes (`.hint`, `.banner`, `.vs`...) collide across modules - prefix new ones.
- **Lobby -> match flow.** `LobbyRoom` (`server/src/rooms/LobbyRoom.ts`, `LOBBY_ROOM`): walkers are client-moved but
  server-bounded (plaza radius, sprint speed); queues per playlist (`MODES` in `shared/src/config/modes.ts`); a full
  queue - or one waiting `LOBBY.fillWaitSeconds` - becomes `matchMaker.createRoom(ROOM_NAME, {mode, arena, expect})`
  + a `reserveSeatFor` per player (team picked by the lobby) sent as `MatchFound`. `GameRoom` with a mode: capacity
  2 x teamSize, bots fill to teamSize, ONE match (no rematch), then `ToLobby` and it closes; its first kickoff waits
  for the `expect`ed players (max 10 s) and gets +2.5 s for the intro. JOIN IN PROGRESS: a queue first fills live
  rooms of its mode with a free seat (not Ended, > 30 s left or overtime) - `MatchFound` with `team: -1`,
  `inProgress` - and the arrival takes over the last bot of a team. It publishes live metadata (score, clock,
  names) that the lobby's board reads via matchMaker.query. Without a mode a `GameRoom` is the old open room (15
  humans, matches back to back). Client: `core/App.ts` switches lobby / loading / match on one renderer;
  `lobby/` = `LobbyNet`, `LobbyWorld` (the Grand Prix stadium as the backdrop, pads, gates, showcase, hanging
  board), `LobbyAvatar` (`PlayerCharacter.walk` - procedural walk/run/jump, full-body emotes), `LobbyHud`, `Lobby`.
- **NO HITCHES ENTERING A MATCH (user requirement).** Behind the MATCH FOUND card `Game.prepare` builds the arena,
  all car bodies + wheel pools, a pool of 8 dressed car views and OUR car in our look, then `warmScene`
  (`core/warmup.ts`): compileAsync with EVERY object made visible (hidden effects too) + `initTexture` on every
  texture, then one composer render. Joining takes cars from the pool (`ensureCar`), dresses at most one avatar a
  frame, and waits (`settle`) until all cars are dressed before `reveal()`; only then does the intro fly (2.1 s,
  smootherstep, dt-clamped) from the wide shot into the car, and other riders are not re-dressed during it. Measured
  cold: 0 shader compiles after the reveal, median ~6 ms, nothing over ~35 ms (it was 96/88/150 ms stalls). Any new
  match-time object must be in the warm scene; any wait on frames must race a timer (`nextFrame`) - background tabs
  get none.
- **Bloxity integration** (all SDK calls go through `client/src/bloxity/Bloxity.ts`; ONE onUserChanged subscription, in
  `Game.startBloxity`; the user is always read fresh, never cached):
  - Account: desktop chip (LOG IN / name) and touch SOCIAL open `ui/SocialPanel.ts` - showAuthPopup, name + pfp +
    Bux balance, friends with presence + INVITE (updateRoom first), COPY INVITE LINK. No shop, so no Bux SKUs and no
    purchase webhook.
  - Lifecycle: loadingStep/loadingEnd, gameplayStart at play and again after each results screen, gameplayEnd at the
    final whistle, updateRoom(roomId) on join / room change and '' while offline, playerInRoom/playerJoined.
  - Settings: every registered key is applied (`camera_sensitivity` -> `CameraRig.sensitivity`, `enable_chat` ->
    quick chat, `background_transparency` -> `--panel-a` on the game's panels).
  - Player events: `respawn_request` -> `MessageType.Respawn` (server: demolition-style, back in 3 s, once per 10 s, play
    phase only - never a free teleport); `play_emote` -> emotes below.
  - Emotes: `registerFeature('emotes')` right after init; catalogue fetched at boot (`animation/BloxityEmotes.ts`,
    never hard-coded ids, unknown ids ignored, ownership never checked). Played as a `BoneOverlay` on the driver,
    LEGS SKIPPED (`EMOTE_SKIP_BONES`) so they stay in the car; replicated as `PlayerState.emote/emoteTick` via
    `MessageType.Emote`; stopped by hard steering, jump or boost (`EMOTE.steerStop`, same rule on server and clients).
  - Profile stats: `server/src/bloxity/statReporter.ts` (inert without BLOXITY_REPORT_TOKEN / BLOXITY_GAME_ID; every 60 s
    and on shutdown after careers settle) reads ONLY `server/src/bloxity/careers.ts` - per-account career totals
    (MongoDB `$inc` when MONGODB_URI is set, `data/careers.json` locally), credited by `GameRoom` at the final whistle
    or when a signed-in player leaves, keyed by the account id the server verified.
  - Rooms: `/api/coly-matchmaker/all-rooms` (`server/src/routes/rooms.ts`) lists this process's rooms when
    MATCHMAKER_REPORT_URL is unset and answers 502 when it is set - the cross-pod directory needs Bloxity's
    `legion-room-reporter` protocol, which is NOT published to us yet (same in the sibling repos). RoomLocator /
    pod-resolved joins depend on it too. Do not "fix" the 502 by falling back to the local process.
- **Audio** (`audio/Sfx.ts`, the user's recordings in `assets/audio`): `car.mp3` is the engine LOOP (trimmed, pitch =
  speed) for our car + 3 panned voices for the nearest other cars; `nitro.mp3` = ignition once, then 0.9-2.25 s looped
  while boosting (others: the ignition only); `racing-music.mp3` STREAMS through a media element (never decode it:
  ~50 MB of samples) and restarts at 130.4 s (silent tail), levels by `setMusicMode` - lobby, match and results all 0.75
  (user: don't duck it in matches) - times music_volume. Hits, jumps, horn, beeps stay synthesised. Audio starts on the first
  gesture (`unlock`). Cars are silenced in the lobby (`silenceCars`).
- **Car stripes, decals, lights and grilles are PAINTED in the livery**, never thin overlay geometry (overlays z-fought).
- **Client build under 12 MB.** Only `assets/` ships as files (unused ones pruned in `client/vite.config.ts`);
  arena, cars, ball, effects and almost all sound are code. Asset names must be URL-safe.

## Layout

- `shared/src/sim/`: `constants.ts`, `math.ts`, `arena.ts` (distance field: rounded octagon + goal boxes with exact
  post/crossbar edges; sphere-traced raycast), `car.ts` (raycast suspension, RL drive/brake/coast + steering
  curvature, powerslide, sticky force + surface hugging for walls, jump/double jump/dodge, air control, hull vs
  world), `ball.ts` (RLUtilities bounce/spin), `world.ts` (substeps, car-ball with Psyonix's extra impulse,
  car-car bumps/demos, pads, respawn, events), `snapshot.ts`, `input.ts`, `predict.ts` (ball path for shot/save).
- `server/src/`: `rooms/GameRoom.ts` (join, identity, inputs, loop), `game/Match.ts` (seats/bots/teams, kickoff,
  clock from first touch, goals/assists/shots/saves, overtime, results), `game/BotBrain.ts` (intercept on the
  simulated ball path, kickoff flips; bots only ever produce a `CarInput`), `auth/BloxityAuth.ts`, `routes/rooms.ts`.
- `client/src/`: `core/Game.ts` (fixed 60 Hz input/predict ticks, render interpolation, events -> FX/SFX, camera
  modes, HUD), `camera/CameraRig.ts` (car/ball cam orbit with a wall-aware up axis, goal and replay shots),
  `world/` (`ArenaView`, `CarView` + `WheelPool`, `BallView`, `Effects`), `replay/Replay.ts` (goal replays from
  the server's snapshots, slow-mo finish), `ui/Hud.ts`, `input/` (keyboard/mouse/gamepad, touch), `audio/Sfx.ts`
  (WebAudio synth), `bloxity/` (portal SDK, avatars).
