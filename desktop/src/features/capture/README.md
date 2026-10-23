# Capture Feature

Owns lightweight capture entry points initiated from the app shell.

- `ClipboardCapturePrompt.tsx`: user-facing prompt for detected clipboard captures.
- `useClipboardCapturePrompt.ts`: clipboard polling, duplicate suppression, prompt state, and save orchestration.
- `detectors/`: YouTube, Xiaohongshu, Douyin and international TikTok share/content URL detection. Author-profile batch capture is excluded.
- `captureQueue.ts`: serial UI job tracking, including partial saves.
- `capture:save-url`: main-process browser capture entry; it pins the startup space and browser instance, verifies redirect identity and reuses `capture.save`.
- `youtubeClipboard.ts`: compatibility YouTube URL parsing.

The app shell mounts the prompt, but does not parse clipboard text or call capture channels directly.

Run `pnpm --dir desktop exec node --test tests/socialCapture.test.ts` for persistence, short-link identity and shared browser-lease regression tests.
