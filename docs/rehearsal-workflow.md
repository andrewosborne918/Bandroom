# Rehearsal and performance

## Before rehearsal

1. Build the setlist in Library and save its order.
2. Use **Ready check** to enable/test each device's sound. Band members use headphones. A dedicated audience output connects to the PA; that role excludes click and band-only guides.
3. Open **Prepare this device** and prepare the set over Wi-Fi. The app distinguishes cached files from a currently authorized rehearsal pack.
4. Everyone joins the same session. Signing in to the band alone does not join shared playback. The ready check names devices that need audio, the current song, a stable clock, or reconnection.

## Practice a part

Open a song, then **Prepare → Practice**. While listening, type a section name and press **Mark here**. These rehearsal markers preserve the original chart sections and line timing. Existing named sections remain available when adding a marker.

Choose **Practice this part** to start a repeating section with count-in. Choose a slower pitch-preserving speed and an optional silent rest between repeats before starting. For a custom passage, mark A and B during playback, then apply the loop. Save named loops for the band. Shared marker/loop editing requires an existing editor role; granted playback controllers may start practice.

## Personal sound and notes

**Backing tracks → My headphone mix** changes only the signed-in musician's monitor on this device. It cannot turn on a part disabled in the band arrangement, and it does not change the audience/PA output. Expand **Band backing arrangement & PA mix** for shared controls.

**Band chart, import & notes** contains shared arrangement notes and device-local private notes. Private notes and monitor settings use the band/user/song scope and are never sent with song updates. They do not synchronize to your other devices.

## Chart review

Paste chords, lyrics, or the selected instrument's tab; preview; explicitly confirm replacement of current chart sections; save the draft; mark timing; then approve the checked version. Saving an import replaces existing chart sections, so the confirmation is deliberate. Generated suggestions remain drafts until reviewed.

Approval identifies the chart text, manual timing, song timing settings, rehearsal markers and shared arrangement notes. Changing those makes approval stale. Volume changes and private notes do not invalidate it. Approval is an editorial status, not an audit signature.

## On stage

Perform starts locked. Chart scrolling and reading controls remain available; chart-line seeking and the position slider are disabled until unlocked. **Stop** remains available, including a local stop for following devices. **Next** preserves Perform mode and locks the new song. The header shows the next song, tuning, tempo and count-in. Practice loops still playing when entering Perform are labeled; stopped practice settings reset for a normal performance start.

Refresh Bndrm on every participating device after this release. Playback protocol 3 supports silent rests in shared practice loops. Older clients are prevented from receiving a rest-enabled transport they cannot play correctly.

## Connection drops

Preparing a rehearsal pack verifies current access, downloads complete audio and pins it against normal app cache eviction for up to two hours. The authorization is kept in memory, bound to band/user/song/asset version/session token, and cleared on sign-out or workspace switch. Known online authorization denials revoke the fallback. The browser may still remove its storage independently.

A prepared pack can bridge a network outage while the app stays open. Solo playback can use that pack until its authorization expires. Shared controls still require the server; a device pauses locally after 30 seconds without session updates rather than following an unknown timeline indefinitely. Reconnect and enable audio to rejoin. This is not a fully offline shared session, and a page/app reload still requires internet.
