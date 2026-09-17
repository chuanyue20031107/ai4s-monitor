# GitHub-native source operations

## Use

Open the **监控来源** page. Choose **检测**, **抓取 / 重新抓取**, **全部测试**, **全部抓取**, **重试失败来源**, or the enable switch. Confirm the generated request, then submit its prefilled Issue on GitHub. Opening the Issue form is **not** submission and never displays a fake running/success state. Only repository users with `write`, `maintain`, or `admin` permission can execute requests.

The source-operations Action validates the request, executes the real operation, commits JSON data, and deploys Pages. Results appear in the source page and the Issue, including failures. The frontend reads public repository snapshots with a Pages fallback, so it can see committed data even when publication fails. While a local request is pending, it refreshes once per minute in visible tabs and on return to the tab; manual refresh is always available. There is no progress percentage: static snapshots cannot prove live execution progress.

**健康检查** checks the entry and candidate parsing; it does not crawl article bodies or run AI analysis. **抓取** uses the existing bounded collector and its evidence queue; AI analysis remains a separate stage. Failed-source retry excludes disabled, idle, successful, and no-content sources. A no-content result is not proof that a site has no updates. Switches request an explicit true/false state; they are not optimistic toggles.

## Safety and compatibility

- No PAT, GitHub token, WeRSS endpoint, or other credential is stored in the browser. Request drafts contain only source IDs and operation metadata.
- Do not edit the JSON to add arbitrary URLs, shell commands, workflow names, or code. Unknown fields and source IDs are rejected. Issue text is read as data, never interpolated into shell commands.
- `.github/workflows/crawl-and-deploy.yml` is unchanged: cron `17 */6 * * *`, default batch size 36, existing publication behavior, robots/DNS/redirect safeguards, and WeRSS configuration remain intact. The collector now honors verified RSS/Sitemap repairs and bounded network retries; see [source repair](SOURCE_REPAIR.md). Manual operations restore the exact scheduled cursor/settings bytes and merge only the targeted source runtime records into the full inventory.
- Manual work has its own concurrency group and never cancels the scheduled pipeline. Git rebase conflicts fail closed rather than overwrite concurrent work; the Issue must not report success before persistence.
- Requests are idempotent by Issue and request ID. The complete receipt archive is `data/source-commands.json`; the last 500 receipts are exported to `client/public/data/source-commands.json`.
- WeRSS endpoint lookup uses the existing Actions secret or repository variable `WERSS_BASE_URL`; no endpoint is embedded in the new workflow. Missing configuration is reported as `needs_config`.

## Recovery and limits

Use **Source operations → Run workflow** to drain pending request Issues after an interrupted/canceled run. A newer queued run drains open requests so an older pending run being superseded does not lose its Issue. Each run accepts at most 20 open requests and scans at most 1,000 open Issues. Close excessive or invalid requests before recovery. Completed Issue receipts are not re-executed by reruns; create a new request to retry an actual failed operation. Persisted outcomes survive a deployment failure.

Operations can encounter source access restrictions, invalid configuration, network failures, Git conflicts, or Pages failures. These are distinct from a completed crawl, and no operation bypasses restrictions or falsely reports AI analysis completion.

## Validation

`node --test tests/pipeline.test.mjs tests/source-operations.test.mjs`

`npm run typecheck`

`npm run build`
