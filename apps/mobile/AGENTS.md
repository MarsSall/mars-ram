This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Builds run on this machine with `eas build --local`; Expo keeps the signing credentials. Use the pinned CLI from `apps/mobile` as `pnpm exec eas <command>`, never `eas-cli@latest`. Local builds need `JAVA_HOME` (JDK 17) and `ANDROID_HOME`.

| Profile | Output | Identity |
| --- | --- | --- |
| `development` | Dev client APK | `com.marssall.marsram` |
| `preview` | Release APK for phone checks | `com.marssall.marsram.preview` («Mars-RAM Prueba»), installs next to the other builds |
| `production` | Play AAB; `versionCode` incremented on EAS | `com.marssall.marsram` |

Example: `pnpm exec eas build --local --platform android --profile preview --output /tmp/mars-ram-preview.apk`. `APP_VARIANT` (set by the profile) selects the identity in `app.config.ts`. `pnpm exec eas submit --platform android --profile production --path <aab>` uploads to the **internal** track and publishes it for the testers' list only (service account `play-submit@marsjs-apps`, key stored in Expo, never in the repo). Add `--profile closed` to send it to the closed-testing track (`alpha`) instead, as a draft: until the app is published Play accepts only drafts there, and the owner sends them to review in the Play Console. Promoting to production is the owner's decision in the Play Console.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
