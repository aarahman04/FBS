FBS — Face-Based Hyperlink System

1. One-Line Concept

FBS turns a voluntarily registered face into a programmable visual hyperlink. Point the camera at someone who has registered, and their face resolves to whatever they've chosen: a name, a link, or both.

⸻

2. Core Idea

Face → Recognition → User-defined action → Link

A user registers their own face, gives it a display name, and attaches a link (or, later, several links). From then on, anyone who points the app's camera at that person's face sees what they configured.

FBS never looks up unknown people. It only ever recognizes faces that were voluntarily registered by their owner.

⸻

3. Design Direction

The app is built around one idea: the camera is the home screen.

- Opening the app opens the camera immediately — always-on, viewfinder-first, closer to Snapchat than to a typical form-based app.
- A circular icon in the top-left corner is the only other control needed. Tapping it opens the user's own profile — where they register, or edit their name and link(s).
- Outside of that icon, the screen is just the live camera view and whatever it recognizes.

This direction stays constant across every phase below — later phases add capability behind that same simple interface, they don't change it.

⸻

4. Build Philosophy

FBS is being built in phases. Each phase should be a complete, working loop on its own before the next one starts. Nothing gets added "just in case" — every phase should be something that could plausibly ship by itself.

Phase 1 in particular is a feasibility test, not a product. Its only job is to prove the core mechanic works. Once it does, the plan gets revisited before any account system, database, or extra feature gets added.

⸻

5. Phase 1 — Core Loop (build this first)

Goal: prove the core mechanic works, with the least infrastructure possible. No accounts, no hosted database — just confirm that "scan a face → recognize it → open a link" actually works end to end.

Face recognition model:
Use DeepFace with the FaceNet512 backend. It's MIT-licensed with no restriction on commercial use, installs with one pip command, reaches roughly 99.7% accuracy on the standard LFW benchmark, and DeepFace's interface makes it easy to try other backends later without rewriting the matching logic.

The alternative worth knowing about is InsightFace (ArcFace recognition + SCRFD detection), which benchmarks slightly higher — around 99.86% on LFW — and is what most self-hosted production face-recognition systems reach for. The catch: its official pretrained weights are licensed for non-commercial research use only, and commercial use requires contacting InsightFace directly for a license. That's not a problem for a Phase 1 prototype, but it's a reason to start with DeepFace so licensing never becomes something to backtrack on if this goes further.

No database:
Phase 1 doesn't need Postgres, Supabase, or any hosted storage. One registered profile — a name, a link, and a face embedding — can live in a single local file next to the matching code. Comparing a new scan's embedding against that one saved entry is a few lines of cosine-similarity math; there's nothing here that needs a real database yet.

In scope:
- Camera is open by default the moment the app launches.
- A simple registration step: scan a face → type a display name → add one link (the link is optional — a user can register with just a name).
- Recognition: point the camera at the registered face → the display name appears → if a link was set, it opens automatically; if not, only the name is shown.
- A basic way to re-register or overwrite the one saved profile, so the loop can be tested and re-tested without rebuilding anything.

Explicitly out of scope for Phase 1:
- Any hosted or persistent database
- Google or Apple sign-in
- Multiple links or a link dropdown/menu
- The four recognition modes from the original concept — Phase 1 only needs "name, then auto-open the one link if it exists"
- Multiple faces in one camera frame
- Recognizing faces in photos, posters, or video — live camera only
- Custom-branded social icons

Checkpoint: Phase 1 is done when a face can be scanned, saved locally, and recognized again on a live camera to reliably open the right link (or show just the name, if no link was set). At that point, stop and revisit the plan before touching accounts or a real database — if the core mechanic doesn't feel right yet, it's far cheaper to learn that now than after Phase 2 or 3 are built on top of it.

⸻

6. Phase 2 — Accounts

Goal: replace Phase 1's single local test profile with real accounts, so a person's face-profile isn't tied to one phone or one local file.

- Add Google sign-in as a third-party login.
- Add Apple sign-in once the app is close to a real App Store submission (it requires a paid developer account and extra setup, so it's not worth doing earlier).
- When someone signs in, they connect their registered face to that specific account. This is also the natural point where a real, persistent database replaces Phase 1's local file — there's more than one user now, and data needs to survive across devices and sessions.
- Add basic account recovery (what happens if someone re-registers, changes devices, or wants to delete their data).

⸻

7. Phase 3 — Multiple Links & Recognition Modes

Goal: bring back the fuller vision from the original concept, now that the core loop is proven.

- Support up to five links per profile instead of one.
- When a face is recognized, show its links as a dropdown in a display area just below the face — a compact list anchored to the person, not a full-screen menu.
- Each item in the dropdown shows an icon and opens that link when tapped:
  - For popular platforms (Instagram, LinkedIn, Facebook, and other common ones), use a set of icons built into the app, so they always look right.
  - For anything else — a personal website, a portfolio, any custom link — pull that site's favicon automatically if it has one. If it doesn't, fall back to a simple, neutral placeholder icon instead of a blank or broken image.
- Reintroduce the four recognition modes: link-only (auto-open), name-only, name + delayed auto-open, and name + link dropdown (this menu). Let each user pick their preferred mode.
- Add a confidence threshold with an explicit "no match found" state, so the app never guesses at an identity it isn't sure of.

⸻

8. Phase 4 — Multiple Faces & Broader Recognition

Goal: handle the messier real-world cases — more than one registered person in frame, and recognition from something other than a live face.

- Detect several registered faces in a single camera frame and let the user tap the one they're interested in.
- Add a visual marker (outline, highlight) on the selected face.
- Extend recognition beyond a live camera to static images — photos, posters, group pictures.
- This is the phase where the original "point your camera at a conference poster" use case becomes real.

⸻

9. Future Extensions (not scheduled)

These are worth writing down but shouldn't be worked on until Phases 1–4 are done and the app has shown real user interest:

- Temporary or event-specific links
- QR codes and face-based links used together
- Analytics on link visits
- Face anti-spoofing / liveness detection
- Enterprise or event-specific deployments
- A third-party API
- Dynamic, time-based link changes

⸻

10. Privacy & Safety Principles (apply from Phase 1 onward, not bolted on later)

- Registration is explicit and opt-in only — the app never tries to identify someone who hasn't registered.
- Store face embeddings, not raw photographs, wherever the system allows it.
- A user can delete their registration or edit their name/links at any time.
- The app must never claim a match it isn't confident about — a "no match found" result is a required state, not an edge case.
- Any link a user adds is validated before it's opened automatically — dangerous URL schemes are rejected and HTTPS is preferred.

⸻

11. Example Flow (Phase 1)

Ahmed opens the app for the first time. He taps the circular icon top-left, scans his own face, types "Ahmed Rahman" as his display name, and adds his LinkedIn URL. He saves, and the screen returns to the live camera view.

Later, Sarah opens the app and points her camera at Ahmed. His face is recognized, "Ahmed Rahman" appears on screen, and a moment later his LinkedIn page opens automatically — because that's the one link he set.

If Ahmed hadn't added a link, Sarah would just see his name, and nothing more would happen.
