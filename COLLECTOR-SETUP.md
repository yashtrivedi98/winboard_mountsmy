# Winboard collector setup

The search profile is in [`collector-profile.json`](./collector-profile.json). It follows MoWeb's published Enterprise AI, Digital Transformation, and Product Engineering service lines. The profile separates hiring intent from freelancer self-promotion and currently aims for a 30-second refresh where provider rules allow it.

## Suggested source targets

- **Reddit:** Start with `forhire`, `hiring`, `freelance_forhire`, `MachineLearningJobs`, `WebDeveloperJobs`, `PythonJobs`, `JavascriptJobs`, `BigDataJobs`, and `RemotePython`. Use Reddit's authorized OAuth Data API and respect its terms and returned rate-limit headers. No page scraping is configured.
- **LinkedIn:** Connect only an app that LinkedIn has approved for the relevant post-reading permissions. The LinkedIn API does not grant unrestricted search of all member posts by default.
- **Discord:** Candidate job communities are NextJob, Freelance Hub, and SkillForge. These are suggestions only. A bot must be invited, have message access, and be configured for the particular channels before it can read them.

## Start and connect

1. Double-click **Start Winboard.bat**. Keep the small server window open while you want monitoring to run; the collector runs on this computer and the browser board refreshes automatically.
2. In Winboard, choose **Connect sources** and follow the Reddit developer registration link. Once the app is approved, enter the app ID and secret in the local form. The server keeps these in `.env`, which is excluded from version control.
3. The collector will then check the selected Reddit communities every 30 seconds, subject to API rate limits, and save matching post links locally. The board shows its connection state and new leads.

The local service and Reddit adapter are implemented. Reddit polling remains inactive until you connect an approved app. LinkedIn and Discord are shown as not connected: LinkedIn post reading requires approved API access, and Discord requires an authorized bot in the specific servers/channels. I can add those adapters once that access is available; no credentials belong in chat or in committed files.

The 30-second value is a target, not a promise: the collector honors provider rate limits and should back off on throttling. Discord is best consumed from its authorized Gateway event stream rather than by repeatedly searching the whole platform.

