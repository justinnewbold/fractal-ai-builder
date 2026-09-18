# What we changed in the two projects we ship

Fractal Remote's desktop apps carry a copy of two separate open-source
projects, and we run modified copies of both. This file states what we
changed.

**It is here because Apache-2.0 requires it.** Section 4(b) says a modified
file carried in a derivative work must carry "prominent notices stating that
You changed the files". `forgefx-midi` is Apache-2.0, so that is an
obligation rather than a courtesy. ForgeFX itself is MIT and asks only that
its copyright notice travel with it — but saying what we changed there too
costs nothing and is the same information anybody debugging would want.

The authoritative record of *which commit* we ship is
[`desktop/forgefx.lock.json`](../desktop/forgefx.lock.json), whose `_why`
block explains each change in full, with the symptom that caused it. This is
the summary.

---

## forgefx — the device server

**Upstream:** https://github.com/sKuhLight/forgefx · MIT · Copyright (c) 2026 sKuhLight
**We ship:** a branch off `v0.7.5-beta`, not upstream `main`

Every change below exists because a player hit something on real hardware.
None of them changes what the server is or how it talks to a unit; they are
fixes and additions around the edges of the remote path, which upstream has
no reason to care about because upstream has no phone on the other end.

| What we changed | Why |
|---|---|
| Allow renaming a preset or scene over the remote channel | The host refused it, and it was absent from both the allowed list and the never-allowed list — an oversight rather than a boundary. It is an edit-buffer write like the others; committing to a slot is still refused. |
| Honour an optional `host` field naming which computer a request is for | The remote channel is per account, so a request is shouted, not sent. With two Macs signed in, one write was carried out twice on two different units. |
| Carry tuner readings across the relay, throttled to one per 80 ms | They were dropped along with the meter and CPU feeds. Right for those; wrong for the tuner, whose only real use is tuning from a phone away from the computer. |
| Re-read a preset dump whose header is missing | The server took the header on trust, so a dump that lost it was handed to the codec instead of being retried. Players saw a codec error mid-song. |
| Let each driver state its own preset count | The count was inferred from the shape of the signal chain, so a VP4 was served an AM4's 104 slots and an Axe-Fx II was told it held 512 where the codec says 384. |
| Grid cache 500 ms → 15 s, and read a slot's name without loading the preset | The app walks all 512 slots shortly after connecting, and every name cost a full ~24KB preset dump on a port that takes one request at a time. |
| `POST /telemetry/meters` so a client can say it is not drawing meters | The meter loop is ~40 SysEx transactions a second at the control processor of a unit that is also making sound. The audio cut out while the app was open and recovered when it closed. |
| Allow `DELETE /device/cache` remotely | Verifying a write means clearing the cache and reading back. With no DELETE branch, nothing a phone wrote could be verified — five parameters in a row reported unverifiable, all of which had landed. |
| Reopen a serial port that closed underneath the server | One shared open was only ever cleared on a *failed* open, so a port that opened and later went away stayed resolved for good and every later request got the same dead port. |
| Report on `/diag` when the port was lost, why, and the last lines said | An app launched from the Finder inherits nowhere to print, so every line about a port closing went nowhere and a phone saw only "port not open". |
| Pick MIDI before serial for AM4 and VP4 | The AM4's serial node answers the handshake and then loses the port on the first real read. On MIDI the same unit completed 59 of 59 writes. |
| Judge a placement or rename by reading it back, not by the ack | Over USB-MIDI the AM4's command ack has not been observed once, while the writes all land — so a block that was placed correctly was reported refused. |
| Slice a block's channels by the unit's own item count | The per-channel stride came from a table that can disagree with the bulk read, so channel A read correctly and every other channel was offset — knobs that "did not take". |
| Wait for the port to go quiet before re-requesting an incomplete dump | The re-request sent into the previous dump's tail collected the same stale terminator three times over. |

## forgefx-midi — the preset codec

**Upstream:** https://github.com/sKuhLight/forgefx-midi · Apache-2.0 · Copyright 2026 Stephen Staker
**We ship:** a branch off `v0.5.0`

| What we changed | Why |
|---|---|
| Guard the gen-3 Huffman tree builder against an empty or truncated bitstream | The reader answers 0 past the end of its buffer and a 0 bit means "internal node, read two more subtrees", so it recursed for ever. Six slots of one FM3 answered every summary request with a stack overflow. |

Its `NOTICE` file is reproduced at
[`forgefx-midi-NOTICE.txt`](forgefx-midi-NOTICE.txt) and its trademark
statement applies to this app too: **Fractal Remote is not affiliated with,
endorsed by, or sponsored by Fractal Audio Systems.** "Fractal Audio",
"Axe-Fx", "FM3", "FM9", "AM4" and "VP4" are their trademarks, not ours.

---

## Why we ship a fork at all

Two reasons, and both are in `desktop/forgefx.lock.json`.

What goes inside something we sign should not depend on someone else's
repository still being there, still being public, and still having the
history it had last week — so we vendor from our own mirror and pin the
commit rather than a tag, because a tag can be moved and a commit cannot.

And the changes above sit on a branch rather than on the mirror's `main`, so
`main` stays a clean copy of upstream and the next upstream release is a
rebase rather than a merge conflict. Every one of them is a candidate to
send upstream; none has been sent yet.
